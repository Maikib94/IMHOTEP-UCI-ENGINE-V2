// tests/unit/hematoLabReader.spec.ts
//
// El panel de hematología lee las analíticas RESULTADAS, no el estado vivo del
// paciente, porque el proyecto modela con cuidado el tiempo de respuesta del
// laboratorio y leer en vivo lo habría convertido en decorado. Lo que se
// verifica aquí es que esa lectura es correcta: que toma el resultado más
// reciente, que no se inventa lo que no se ha pedido, y que el recuento
// absoluto de neutrófilos sale del leucocitario por el porcentaje —que es la
// cifra que decide en la neutropenia febril y la que nadie informa directa.

import { describe, it, expect } from 'vitest';
import {
  readHematoLabs, hematoSnapshotFromLabs, hasMinimumLabs, HEMATO_ASSUMED,
} from '../../src/core/hematoLabReader';
import type { LabOrder, LabResult } from '../../src/store/usePatientStore';

/** Una orden resuelta con los valores dados. */
function order(
  type: string, orderedAt: number, readyAt: number,
  values: Record<string, number | string> | null,
): LabOrder {
  const result: LabResult | null = values === null ? null : {
    values,
    units: {}, refs: {},
    flags: {} as LabResult['flags'],
  };
  return {
    id: `${type}_${orderedAt}`, type, label: type,
    category: 'hema', priority: 'rutina',
    baseProcessingTimeS: readyAt - orderedAt,
    orderedAt, readyAt, result,
    snapshot: {}, bloodVolume: 5000, redBloodCellMass: 2250,
  };
}

describe('Lectura de las analíticas hematológicas', () => {
  it('no devuelve nada cuando no hay ninguna resuelta', () => {
    const labs = readHematoLabs([]);
    expect(labs.plateletsK).toBeUndefined();
    expect(hasMinimumLabs(labs)).toBe(false);
  });

  it('ignora las órdenes pendientes: un tubo en el laboratorio no es un dato', () => {
    const labs = readHematoLabs([order('cbc', 0, 2400, null)]);
    expect(labs.plateletsK).toBeUndefined();
    expect(hasMinimumLabs(labs)).toBe(false);
  });

  it('extrae las plaquetas del hemograma con la hora de extracción', () => {
    const labs = readHematoLabs([
      order('cbc', 100, 2500, { Plaquetas: 38, 'WBC total': 21, 'Neutrof. %': 82, 'Cayados %': 9 }),
    ]);
    expect(labs.plateletsK?.value).toBe(38);
    expect(labs.plateletsK?.drawnAtSimS).toBe(100);
    expect(labs.plateletsK?.resultedAtSimS).toBe(2500);
  });

  it('cruza pruebas distintas: el fibrinógeno y el INR salen de la coagulación', () => {
    // Es el punto del panel: plaquetas y fibrinógeno viven en analíticas
    // separadas, con demoras distintas, y la lectura exige las dos.
    const labs = readHematoLabs([
      order('cbc',  100, 2500, { Plaquetas: 38 }),
      order('coag', 100, 3200, { INR: 2.4, Fibrinogeno: 90 }),
      order('ddimer', 100, 3600, { 'Dimero-D': 28000 }),
    ]);
    expect(labs.plateletsK?.value).toBe(38);
    expect(labs.inr?.value).toBe(2.4);
    expect(labs.fibrinogenMgDl?.value).toBe(90);
    expect(labs.dDimerNgMl?.value).toBe(28000);
  });

  it('toma el resultado MÁS RECIENTE de cada analito', () => {
    const labs = readHematoLabs([
      order('cbc', 0,    2400, { Plaquetas: 120 }),
      order('cbc', 7200, 9600, { Plaquetas: 38  }),   // más reciente
    ]);
    expect(labs.plateletsK?.value).toBe(38);
  });

  it('y el orden en que llegan las órdenes no importa', () => {
    const labs = readHematoLabs([
      order('cbc', 7200, 9600, { Plaquetas: 38  }),
      order('cbc', 0,    2400, { Plaquetas: 120 }),
    ]);
    expect(labs.plateletsK?.value).toBe(38);
  });

  it('acepta el fósforo de cualquiera de las dos pruebas que lo informan', () => {
    const deMagphos = readHematoLabs([order('magphos', 0, 5400, { Fosforo: 9.4 })]);
    const deTls     = readHematoLabs([order('tls',     0, 2880, { Fosforo: 9.4 })]);
    expect(deMagphos.phosphateMgDl?.value).toBe(9.4);
    expect(deTls.phosphateMgDl?.value).toBe(9.4);
  });

  it('acepta el potasio con cualquiera de sus dos nombres', () => {
    expect(readHematoLabs([order('bmp',      0, 5400, { K: 6.8 })]).kPlasma?.value).toBe(6.8);
    expect(readHematoLabs([order('ionogram', 0, 3000, { Potasio: 6.8 })]).kPlasma?.value).toBe(6.8);
  });

  it('convierte las cruces del frotis a número', () => {
    // Los esquistocitos se informan como texto porque son una lectura
    // morfológica; el score necesita puntuarlos.
    const casos: [string, number][] = [['Ausentes', 0], ['+', 1], ['++', 2], ['+++', 3]];
    for (const [texto, valor] of casos) {
      const labs = readHematoLabs([order('hemolysis', 0, 3300, { Esquistocitos: texto })]);
      expect(labs.schistocytes?.value, texto).toBe(valor);
    }
  });

  it('calcula el recuento absoluto de neutrófilos, que ninguna prueba informa', () => {
    // ANC = leucocitos × (segmentados + cayados) / 100. Es la cifra que define
    // la neutropenia febril (< 500/µL) y no aparece en el hemograma.
    const labs = readHematoLabs([
      order('cbc', 0, 2400, { 'WBC total': 0.6, 'Neutrof. %': 25, 'Cayados %': 5 }),
    ]);
    expect(labs.ancK?.value).toBeCloseTo(0.18, 4);
  });

  it('el ANC tolera que no se informen cayados', () => {
    const labs = readHematoLabs([
      order('cbc', 0, 2400, { 'WBC total': 8, 'Neutrof. %': 60 }),
    ]);
    expect(labs.ancK?.value).toBeCloseTo(4.8, 4);
  });

  it('sin leucocitario no hay ANC: no se deduce del porcentaje solo', () => {
    const labs = readHematoLabs([order('cbc', 0, 2400, { 'Neutrof. %': 60 })]);
    expect(labs.ancK).toBeUndefined();
  });
});

describe('Mezcla de lo medido con lo asumido', () => {
  it('sin ninguna analítica devuelve el paciente normal', () => {
    expect(hematoSnapshotFromLabs({})).toEqual(HEMATO_ASSUMED);
  });

  it('sustituye solo los campos medidos y deja el resto en su valor normal', () => {
    // Asumir lo normal es lo honesto: no se puede puntuar lo que no se sabe.
    // El panel marca aparte qué celdas son medidas y cuáles supuestas.
    const labs = readHematoLabs([order('cbc', 0, 2400, { Plaquetas: 12 })]);
    const snap = hematoSnapshotFromLabs(labs);
    expect(snap.plateletsK).toBe(12);
    expect(snap.fibrinogenMgDl).toBe(HEMATO_ASSUMED.fibrinogenMgDl);
    expect(snap.adamts13Pct).toBe(HEMATO_ASSUMED.adamts13Pct);
  });

  it('el hemograma es el mínimo para interpretar; lo demás es opcional', () => {
    expect(hasMinimumLabs(readHematoLabs([order('coag', 0, 3200, { INR: 2.4 })]))).toBe(false);
    expect(hasMinimumLabs(readHematoLabs([order('cbc',  0, 2400, { Plaquetas: 38 })]))).toBe(true);
  });
});
