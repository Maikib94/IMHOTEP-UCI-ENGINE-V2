// tests/integration/newScenarios.spec.ts
//
// Los escenarios nuevos cubren subtipos que el motor ya modelaba y ningun caso
// usaba. Lo que se verifica aqui no es que existan, sino que ENSEÑAN lo que
// dicen enseñar: que el shock cardiogenico y el hemorragico se separan en el
// PiCCO pese a compartir indice cardiaco bajo, y que cada uno lleva a la
// conducta contraria. Un escenario cuyo perfil hemodinamico no sale como
// pretende es peor que no tenerlo: enseña el patron equivocado.

import { describe, it, expect } from 'vitest';
import { ALL_SCENARIOS } from '../../src/scenarios';
import { interpretPicco, type SvvValidity } from '../../src/core/piccoInterpretation';
import type { PiCCOSnapshot } from '../../src/store/useMonitoringStore';

const byId = (id: string) => {
  const s = ALL_SCENARIOS.find(x => x.id === id);
  if (!s) throw new Error(`escenario ausente: ${id}`);
  return s;
};

/** Replica el cálculo del store para los campos que dependen del escenario. */
function piccoFrom(scenarioId: string): PiCCOSnapshot {
  const s = byId(scenarioId);
  const v = s.initialVitals;
  const bv = s.initialBloodVolumeMl ?? 5000;
  const weight = v.weight ?? 70;
  const bsa = Math.sqrt((170 * weight) / 3600);
  const ardsOn = !!v.ardsActive;
  const ardsInj = ardsOn ? (s.pathologyConfigs.find(p => p.domain === 'ards')?.baseSeverity ?? 0.5) : 0;
  const capLeak = s.initialModifiers?.capillaryLeakRate ?? 0;

  return {
    timestampSimS: 0,
    co: v.cardiacOutput ?? 5,
    ci: (v.cardiacOutput ?? 5) / bsa,
    gedi: Math.round(740 * Math.min(1.5, Math.max(0.3, bv / 5000))),
    itbv: 0, ppv: 0,
    svv: 10,
    svri: (v.svr ?? 1100) * bsa,
    gef: 30, cfi: 5, dpmx: 1500, cpi: 0.6,
    evlwi: Math.min(22, Math.max(2, 5 + (ardsOn ? ardsInj * 12 : 0) + capLeak * 0.18)),
    pvpi: Math.min(7, Math.max(1, ardsOn ? 2.8 + ardsInj * 2.2 : 1.5 + capLeak * 0.05)),
    scvo2: 72, do2i: 450, vo2i: 130,
  };
}

const PASIVO: SvvValidity = { ventilated: true, vtPerKg: 8.5, patientEffort: 0, arrhythmia: false };

describe('Escenarios nuevos — existen y están en el catálogo', () => {
  const ids = [
    'cardio_shock_cardiogenico_refractario',
    'cardio_scasest_alto_riesgo',
    'resp_neumonia_aspirativa',
    'resp_asma_grave_vmni',
    'trauma_pelvis_shock_hemorragico',
    'trauma_tce_abdomen_conflicto',
  ];

  it.each(ids)('%s está registrado en ALL_SCENARIOS', id => {
    expect(byId(id).name.length).toBeGreaterThan(5);
  });

  it('cada uno declara notas clínicas y referencias', () => {
    for (const id of ids) {
      const s = byId(id);
      expect(s.clinicalNotes.length).toBeGreaterThan(80);
      expect(s.references.length).toBeGreaterThan(0);
    }
  });

  it('usan subtipos que antes ningún escenario explotaba', () => {
    const subtipos = ids.flatMap(id => byId(id).pathologyConfigs.map(p => p.subtype));
    for (const esperado of ['shock_cardiogenico', 'iam_nstemi', 'aspirativa', 'grave',
                            'fractura_pelvis_mayor', 'tce_abdomen']) {
      expect(subtipos).toContain(esperado);
    }
  });
});

describe('Los perfiles hemodinámicos salen como el caso pretende enseñar', () => {
  it('el shock cardiogénico se lee como fallo de bomba, no como hipovolemia', () => {
    const r = interpretPicco(piccoFrom('cardio_shock_cardiogenico_refractario'), PASIVO);
    expect(r.profile).toBe('cardiogenico');
    expect(r.actions.join(' ')).toContain('evitar más volumen');
  });

  it('su edema es hidrostático: ahí depletar sí funciona', () => {
    // Fuga capilar moderada SIN SDRA deja agua pulmonar alta con barrera
    // íntegra. Si saliera "permeabilidad", el caso enseñaría lo contrario.
    const r = interpretPicco(piccoFrom('cardio_shock_cardiogenico_refractario'), PASIVO);
    expect(r.edema).toBe('hidrostatico');
  });

  it('el shock hemorrágico se lee como hipovolemia pese a compartir CI bajo', () => {
    const r = interpretPicco(piccoFrom('trauma_pelvis_shock_hemorragico'), PASIVO);
    expect(r.profile).toBe('hipovolemico');
    expect(r.actions.join(' ')).toContain('volumen');
  });

  it('los dos shocks llegan a conductas opuestas — el punto del par de casos', () => {
    const cardio = interpretPicco(piccoFrom('cardio_shock_cardiogenico_refractario'), PASIVO);
    const hemo   = interpretPicco(piccoFrom('trauma_pelvis_shock_hemorragico'), PASIVO);
    expect(cardio.profile).not.toBe(hemo.profile);
    expect(cardio.actions.join(' ')).toContain('evitar más volumen');
    expect(hemo.actions.join(' ')).toContain('volumen');
  });

  it('la neumonía aspirativa, con SDRA, da edema por permeabilidad', () => {
    const r = interpretPicco(piccoFrom('resp_neumonia_aspirativa'), PASIVO);
    expect(r.edema).toBe('permeabilidad');
  });

  it('los casos sin shock no se leen como shock', () => {
    for (const id of ['cardio_scasest_alto_riesgo', 'resp_asma_grave_vmni']) {
      const r = interpretPicco(piccoFrom(id), PASIVO);
      expect(['normal', 'distributivo', 'indeterminado']).toContain(r.profile);
    }
  });
});
