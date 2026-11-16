// tests/unit/hematoInterpretation.spec.ts
//
// Verifica que la lectura hematologica distingue los cuadros por la
// COMBINACION de variables. El caso que justifica todo el modulo es el primero
// del tercer bloque: la PTT y la CID con el MISMO recuento de plaquetas y la
// MISMA hemolisis, separadas solo por el fibrinogeno y el INR, y llevando a
// conductas opuestas. Si eso no sale, el panel enseña a transfundir plaquetas
// a un paciente en el que estan contraindicadas.

import { describe, it, expect } from 'vitest';
import {
  interpretHemato, isthDicScore, fourTScore,
  HEMATO_RANGES, HEMATO_CUTOFFS,
  type HematoSnapshot, type HematoContext,
} from '../../src/core/hematoInterpretation';

/** Paciente hematologicamente normal; cada caso desvia solo lo que le define. */
function snap(over: Partial<HematoSnapshot> = {}): HematoSnapshot {
  return {
    plateletsK: 230,
    fibrinogenMgDl: 320,
    inr: 1.0,
    dDimerNgMl: 250,
    ldhUl: 180,
    haptoglobinMgDl: 110,
    schistocytes: 0,
    adamts13Pct: 100,
    uricAcidMgDl: 4.8,
    phosphateMgDl: 3.5,
    kPlasma: 4.0,
    creatinine: 1.0,
    ancK: 4.5,
    ...over,
  };
}

function ctx(over: Partial<HematoContext> = {}): HematoContext {
  return {
    baselinePlateletsK: 230,
    heparinExposureH: 0,
    newThrombosis: false,
    otherCauseLikely: false,
    activeBleeding: false,
    fever: false,
    ...over,
  };
}

/** PTT: consumo masivo de plaquetas con coagulacion INTACTA. */
const PTT = snap({
  plateletsK: 12, ldhUl: 1820, haptoglobinMgDl: 5, schistocytes: 3,
  adamts13Pct: 3, creatinine: 2.4,
  fibrinogenMgDl: 310, inr: 1.05,          // ← lo que la separa de la CID
});

/** CID: el mismo recuento, pero la hemostasia tambien se ha consumido. */
const CID = snap({
  plateletsK: 38, ldhUl: 480, haptoglobinMgDl: 12, schistocytes: 1,
  fibrinogenMgDl: 90, inr: 2.4, dDimerNgMl: 28000, creatinine: 2.1,
});

describe('Score ISTH de CID', () => {
  it('un paciente normal puntúa 0 y no es CID overt', () => {
    const r = isthDicScore(snap());
    expect(r.total).toBe(0);
    expect(r.overt).toBe(false);
  });

  it('la CID del escenario puntúa ≥ 5 y se declara overt', () => {
    const r = isthDicScore(CID);
    // plaquetas 38 → 2; dímero-D 28.000 → 3; INR 2.4 → 2; fibrinógeno 90 → 1
    expect(r.platelets).toBe(2);
    expect(r.fibrinMarker).toBe(3);
    expect(r.prolongedPt).toBe(2);
    expect(r.fibrinogen).toBe(1);
    expect(r.total).toBe(8);
    expect(r.overt).toBe(true);
  });

  it('la PTT NO puntúa como CID: el fibrinógeno y el INR están intactos', () => {
    const r = isthDicScore(PTT);
    expect(r.prolongedPt).toBe(0);
    expect(r.fibrinogen).toBe(0);
    expect(r.overt).toBe(false);
  });

  it('cada componente puntúa en su banda', () => {
    // El corte del ISTH está en 100, no en el límite inferior del rango
    // normal: 120.000 plaquetas no puntúan aunque estén por debajo de 150.
    expect(isthDicScore(snap({ plateletsK: 120 })).platelets).toBe(0);
    expect(isthDicScore(snap({ plateletsK: 80  })).platelets).toBe(1);
    expect(isthDicScore(snap({ plateletsK: 45  })).platelets).toBe(2);
    expect(isthDicScore(snap({ dDimerNgMl: 1500 })).fibrinMarker).toBe(2);
    expect(isthDicScore(snap({ dDimerNgMl: 9000 })).fibrinMarker).toBe(3);
    expect(isthDicScore(snap({ inr: 1.5 })).prolongedPt).toBe(1);
    expect(isthDicScore(snap({ inr: 2.0 })).prolongedPt).toBe(2);
    expect(isthDicScore(snap({ fibrinogenMgDl: 95 })).fibrinogen).toBe(1);
  });
});

describe('Score 4T de HIT', () => {
  it('mide la caída desde el basal, no el valor absoluto', () => {
    // 60.000 plaquetas son normales para quien partía de 90.000 y una caída
    // del 70 % para quien partía de 200.000. El mismo número, otro score.
    const desdeAlto = fourTScore(snap({ plateletsK: 60 }), ctx({ baselinePlateletsK: 200, heparinExposureH: 168 }));
    const desdeBajo = fourTScore(snap({ plateletsK: 60 }), ctx({ baselinePlateletsK: 70,  heparinExposureH: 168 }));
    expect(desdeAlto.thrombocytopenia).toBe(2);
    expect(desdeBajo.thrombocytopenia).toBe(0);
  });

  it('el día 5-10 de heparina es la ventana de máxima puntuación', () => {
    const base = snap({ plateletsK: 60 });
    expect(fourTScore(base, ctx({ heparinExposureH: 24  })).timing).toBe(0);  // día 1
    expect(fourTScore(base, ctx({ heparinExposureH: 168 })).timing).toBe(2);  // día 7
    expect(fourTScore(base, ctx({ heparinExposureH: 480 })).timing).toBe(1);  // día 20
  });

  it('un nadir por debajo de 10.000 apunta a otra cosa, no a HIT', () => {
    const r = fourTScore(snap({ plateletsK: 8 }), ctx({ heparinExposureH: 168 }));
    expect(r.thrombocytopenia).toBe(0);
  });

  it('el caso típico de HIT con trombosis sale de probabilidad alta', () => {
    const r = fourTScore(snap({ plateletsK: 55 }), ctx({ heparinExposureH: 168, newThrombosis: true }));
    expect(r.total).toBeGreaterThanOrEqual(6);
    expect(r.probability).toBe('alta');
  });

  it('otra causa evidente de trombopenia resta los dos puntos de la cuarta T', () => {
    const conOtra = fourTScore(snap({ plateletsK: 55 }), ctx({ heparinExposureH: 168, otherCauseLikely: true }));
    const sinOtra = fourTScore(snap({ plateletsK: 55 }), ctx({ heparinExposureH: 168, otherCauseLikely: false }));
    expect(sinOtra.total - conOtra.total).toBe(2);
  });
});

describe('PTT contra CID — el cruce que decide la conducta', () => {
  it('la PTT se lee como microangiopatía, no como CID', () => {
    const r = interpretHemato(PTT, ctx());
    expect(r.profile).toBe('microangiopatia');
    expect(r.profileLabel).toContain('ADAMTS13');
    expect(r.profileWhy).toContain('no es CID');
  });

  it('la CID se lee como CID overt', () => {
    const r = interpretHemato(CID, ctx());
    expect(r.profile).toBe('cid');
    expect(r.isth.overt).toBe(true);
  });

  it('con plaquetas y hemólisis parecidas, el fibrinógeno invierte el diagnóstico', () => {
    // Este es el punto entero del panel. Se parte de la PTT y se consume SOLO
    // el fibrinógeno y el INR, dejando todo lo demás igual.
    const comoPtt = interpretHemato(PTT, ctx());
    const comoCid = interpretHemato(
      { ...PTT, fibrinogenMgDl: 85, inr: 2.3, dDimerNgMl: 12000 }, ctx(),
    );
    expect(comoPtt.profile).toBe('microangiopatia');
    expect(comoCid.profile).toBe('cid');
    // Y llevan a conductas opuestas respecto a las plaquetas.
    expect(comoPtt.plateletTransfusionSafe).toBe(false);
    expect(comoCid.plateletTransfusionSafe).toBe(true);
  });

  it('las dos comparten hemólisis microangiopática: no es eso lo que las separa', () => {
    expect(interpretHemato(PTT, ctx()).hemolysis).toBe('microangiopatica');
    expect(interpretHemato(CID, ctx()).hemolysis).toBe('microangiopatica');
  });

  it('la PTT exige recambio plasmático sin esperar al ADAMTS13', () => {
    const r = interpretHemato({ ...PTT, adamts13Pct: 100 }, ctx());
    const plan = r.actions.join(' ');
    expect(plan).toContain('Recambio plasmático URGENTE');
    expect(plan).toContain('NO esperar el resultado');
  });

  it('la CID manda tratar la causa antes que la analítica', () => {
    const plan = interpretHemato(CID, ctx()).actions.join(' ');
    expect(plan).toContain('Tratar la CAUSA');
    expect(plan).toContain('crioprecipitado');
  });

  it('sin sangrado, la CID no pide productos por el número', () => {
    const plan = interpretHemato(CID, ctx({ activeBleeding: false })).actions.join(' ');
    expect(plan).toContain('corregir la analítica no corrige la CID');
  });

  it('con sangrado activo, la CID sí pide plasma', () => {
    const plan = interpretHemato(CID, ctx({ activeBleeding: true })).actions.join(' ');
    expect(plan).toContain('Plasma fresco congelado');
  });
});

describe('Contraindicación de transfundir plaquetas', () => {
  it('la microangiopatía la contraindica de forma explícita', () => {
    const r = interpretHemato(PTT, ctx());
    expect(r.plateletTransfusionSafe).toBe(false);
    expect(r.plateletTransfusionWhy).toContain('CONTRAINDICADA');
    expect(r.actions.join(' ')).toContain('NO transfundir plaquetas');
  });

  it('la HIT también, por fenotipo trombótico', () => {
    const r = interpretHemato(
      snap({ plateletsK: 55 }),
      ctx({ heparinExposureH: 168, newThrombosis: true }),
    );
    expect(r.profile).toBe('hit');
    expect(r.plateletTransfusionSafe).toBe(false);
  });

  it('una trombopenia sin mecanismo trombótico sí admite transfusión', () => {
    const r = interpretHemato(snap({ plateletsK: 8 }), ctx());
    expect(r.plateletTransfusionSafe).toBe(true);
    expect(r.plateletTransfusionWhy).toContain('profiláctica');
  });
});

describe('HIT — la trombopenia que trombosa', () => {
  it('se declara con 4T ≥ 4 y exposición a heparina', () => {
    const r = interpretHemato(snap({ plateletsK: 55 }), ctx({ heparinExposureH: 168 }));
    expect(r.profile).toBe('hit');
    expect(r.phenotype).toBe('trombosis');
  });

  it('sin heparina, la misma analítica NO es HIT', () => {
    const r = interpretHemato(snap({ plateletsK: 55 }), ctx({ heparinExposureH: 0 }));
    expect(r.profile).not.toBe('hit');
  });

  it('retirar la heparina sin sustituirla no basta, y el plan lo dice', () => {
    const plan = interpretHemato(snap({ plateletsK: 55 }), ctx({ heparinExposureH: 168 })).actions.join(' ');
    expect(plan).toContain('SUSPENDER toda heparina');
    expect(plan).toContain('NO heparínico');
    expect(plan).toContain('retirar sin sustituir');
  });
});

describe('Lisis tumoral — urgencia metabólica, no hemostática', () => {
  const TLS = snap({
    uricAcidMgDl: 18, phosphateMgDl: 9.4, kPlasma: 6.8, creatinine: 3.2,
  });

  it('se reconoce por el urato y el fósforo, no por la coagulación', () => {
    const r = interpretHemato(TLS, ctx());
    expect(r.profile).toBe('lisis_tumoral');
    expect(r.profileSeverity).toBe('alert');
  });

  it('distingue la rasburicasa del alopurinol', () => {
    // El alopurinol inhibe la xantina oxidasa: frena la producción futura y no
    // toca el urato que ya está en el plasma. Confundirlos es el error.
    const plan = interpretHemato(TLS, ctx()).actions.join(' ');
    expect(plan).toContain('Rasburicasa');
    expect(plan).toContain('alopurinol solo frena');
  });

  it('avisa de no corregir la hipocalcemia asintomática', () => {
    const plan = interpretHemato(TLS, ctx()).actions.join(' ');
    expect(plan).toContain('producto calcio-fósforo');
  });

  it('pide reemplazo renal cuando la oligoanuria y el potasio lo exigen', () => {
    const plan = interpretHemato(TLS, ctx()).actions.join(' ');
    expect(plan).toContain('reemplazo renal');
  });
});

describe('Sobreanticoagulación', () => {
  it('INR crítico con plaquetas y fibrinógeno normales no es CID', () => {
    const r = interpretHemato(snap({ inr: 7.8 }), ctx());
    expect(r.profile).toBe('sobreanticoagulacion');
    expect(r.isth.overt).toBe(false);
  });

  it('con sangrado pide complejo protrombínico, no plasma', () => {
    const plan = interpretHemato(snap({ inr: 7.8 }), ctx({ activeBleeding: true })).actions.join(' ');
    expect(plan).toContain('complejo protrombínico');
    expect(plan).toContain('NO plasma como primera línea');
  });

  it('la vitamina K es obligatoria porque el complejo se agota', () => {
    const plan = interpretHemato(snap({ inr: 7.8 }), ctx({ activeBleeding: true })).actions.join(' ');
    expect(plan).toContain('Vitamina K SIEMPRE');
  });
});

describe('Neutropenia febril', () => {
  it('con fiebre exige antibiótico en la primera hora', () => {
    const r = interpretHemato(snap({ ancK: 0.2 }), ctx({ fever: true }));
    expect(r.profile).toBe('neutropenia');
    expect(r.profileSeverity).toBe('alert');
    expect(r.actions.join(' ')).toContain('PRIMERA HORA');
  });

  it('sin fiebre es neutropenia grave, no emergencia', () => {
    const r = interpretHemato(snap({ ancK: 0.2 }), ctx({ fever: false }));
    expect(r.profileSeverity).toBe('warn');
  });
});

describe('Eje de hemólisis', () => {
  it('sin hemólisis cuando la LDH y la haptoglobina están en rango', () => {
    expect(interpretHemato(snap(), ctx()).hemolysis).toBe('ninguna');
  });

  it('los esquistocitos son lo que la hace mecánica', () => {
    const conEsquisto = interpretHemato(snap({ ldhUl: 900, haptoglobinMgDl: 8, schistocytes: 2 }), ctx());
    const sinEsquisto = interpretHemato(snap({ ldhUl: 900, haptoglobinMgDl: 8, schistocytes: 0 }), ctx());
    expect(conEsquisto.hemolysis).toBe('microangiopatica');
    expect(sinEsquisto.hemolysis).toBe('no_microangiopatica');
    expect(sinEsquisto.hemolysisWhy).toContain('no es mecánica');
  });
});

describe('Lectura basal y robustez', () => {
  it('reconoce la hemostasia normal y no propone nada', () => {
    const r = interpretHemato(snap(), ctx());
    expect(r.profile).toBe('normal');
    expect(r.profileSeverity).toBe('ok');
    expect(r.actions).toHaveLength(0);
  });

  it('sin contexto asume el peor caso y no inventa un 4T', () => {
    // Sin saber las plaquetas basales ni los días de heparina, declarar HIT
    // sería inventarse el score. Por omisión se asume otra causa probable.
    const r = interpretHemato(snap({ plateletsK: 55 }));
    expect(r.profile).not.toBe('hit');
  });

  it('los rangos coinciden con los que pinta el panel', () => {
    expect(HEMATO_RANGES.platelets).toEqual({ low: 150, high: 400 });
    expect(HEMATO_RANGES.fibrinogen).toEqual({ low: 200, high: 400 });
    expect(HEMATO_RANGES.adamts13).toEqual({ low: 50, high: 100 });
    expect(HEMATO_CUTOFFS.adamts13Deficient).toBe(10);
    expect(HEMATO_CUTOFFS.ancSevere).toBe(0.5);
  });
});
