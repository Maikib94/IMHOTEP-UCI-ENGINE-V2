// src/core/hematoInterpretation.ts
//
// Lectura hematologica: convierte el hemograma y la coagulacion en la pregunta
// que de verdad se hace a pie de cama — ¿este paciente sangra o trombosa, y
// puedo transfundirle plaquetas?
//
// MOTIVO: la PTT y la CID se presentan igual en pantalla. Plaquetas en el
// suelo, LDH alta, esquistocitos, fallo organico, confusion. Y exigen conductas
// OPUESTAS: en la PTT se recambia plasma de urgencia y transfundir plaquetas
// esta formalmente contraindicado porque alimenta la trombosis microvascular;
// en la CID se controla el foco y los productos solo se dan si hay sangrado.
// Lo que las separa no es ninguna variable aislada sino el CRUCE: el
// fibrinogeno y el INR estan normales en la microangiopatia y consumidos en la
// coagulopatia. Igual que en el PiCCO, el valor diagnostico esta en la
// combinacion, y enseñar a leerla es el objetivo del panel.
//
// La HIT es el tercer vertice y el mas contraintuitivo: una trombopenia que
// TROMBOSA. El reflejo de reponer plaquetas y el de seguir con la heparina son
// los dos errores que mas cuestan, y los dos se cometen leyendo el numero sin
// el contexto temporal.
//
// REFERENCIAS
//   Taylor FB et al., Thromb Haemost 2001;86:1327-30 — score ISTH de CID overt.
//   Levi M, Scully M, Blood 2018;131:845-54 — CID: diagnostico y manejo.
//   Wada H et al., J Thromb Haemost 2013;11:761-7 — guia ISTH de CID.
//   Scully M et al., Blood Adv 2020;4:4656-69 — guia ISTH de PTT.
//   Peyvandi F et al., NEJM 2016;374:511-22 — caplacizumab (TITAN).
//   George JN, Nester CM, NEJM 2014;371:654-66 — microangiopatias trombóticas.
//   Lo GK et al., J Thromb Haemost 2006;4:759-65 — score 4T de HIT.
//   Cuker A et al., Blood Adv 2018;2:3360-92 — guia ASH de HIT.
//   Coiffier B et al., J Clin Oncol 2008;26:2767-78 — sindrome de lisis tumoral.
//   Cairo MS, Bishop M, Br J Haematol 2004;127:3-11 — definicion de Cairo-Bishop.
//   Freifeld AG et al., Clin Infect Dis 2011;52:e56-93 — neutropenia febril (IDSA).

// ─── Umbrales ─────────────────────────────────────────────────────────────────
// Coinciden con los que pinta el panel, para que la interpretacion no
// contradiga al numero que hay al lado.
export const HEMATO_RANGES = {
  platelets:   { low: 150,  high: 400 },   // K/µL
  fibrinogen:  { low: 200,  high: 400 },   // mg/dL
  inr:         { low: 0.9,  high: 1.1 },
  dDimer:      { low: 0,    high: 500 },   // ng/mL FEU
  ldh:         { low: 120,  high: 250 },   // U/L
  haptoglobin: { low: 30,   high: 200 },   // mg/dL
  adamts13:    { low: 50,   high: 100 },   // %
  uricAcid:    { low: 3.0,  high: 7.0 },   // mg/dL
  phosphate:   { low: 2.5,  high: 4.5 },   // mg/dL
  anc:         { low: 1.5,  high: 7.5 },   // K/µL
} as const;

/** Cortes que definen conductas, no solo "fuera de rango". */
export const HEMATO_CUTOFFS = {
  /** Fibrinogeno por debajo del cual se repone con crioprecipitado. */
  fibrinogenReplace: 100,
  /** Fibrinogeno/INR por encima de los cuales ya NO es microangiopatia pura. */
  fibrinogenConsumed: 150,
  inrConsumed: 1.4,
  /** ADAMTS13 que define la PTT. */
  adamts13Deficient: 10,
  /** Umbral profilactico de transfusion de plaquetas (sin sangrado). */
  plateletsProphylactic: 10,
  /** Umbral con sangrado activo. */
  plateletsBleeding: 50,
  /** Neutropenia grave — ventana de antibiotico de 1 hora (IDSA). */
  ancSevere: 0.5,
  /** INR con riesgo hemorragico critico. */
  inrCritical: 4.5,
} as const;

export type HematoProfile =
  | 'normal'
  | 'microangiopatia'        // PTT / SHU — consumo SIN coagulopatia
  | 'cid'                    // consumo CON coagulopatia
  | 'hit'                    // trombopenia inmune por heparina
  | 'lisis_tumoral'          // urgencia metabolica, no hemostatica
  | 'neutropenia'            // el defecto es de defensa, no de hemostasia
  | 'sobreanticoagulacion'   // INR critico con hemostasia por lo demas intacta
  | 'trombopenia_inespecifica'
  | 'indeterminado';

/** Eje de hemolisis — el analogo del PVPI en el PiCCO: dice de donde sale. */
export type HemolysisNature = 'ninguna' | 'microangiopatica' | 'no_microangiopatica';

/** Fenotipo que decide la conducta: reponer o anticoagular. */
export type HemostaticPhenotype = 'sangrado' | 'trombosis' | 'mixto' | 'equilibrio';

export type Severity = 'ok' | 'warn' | 'alert';

export interface HematoSnapshot {
  plateletsK: number;
  fibrinogenMgDl: number;
  inr: number;
  dDimerNgMl: number;
  ldhUl: number;
  haptoglobinMgDl: number;
  /** Cruces de esquistocitos en el frotis, 0-3. */
  schistocytes: number;
  /** Actividad de ADAMTS13, %. 100 si no se ha pedido. */
  adamts13Pct: number;
  uricAcidMgDl: number;
  phosphateMgDl: number;
  kPlasma: number;
  creatinine: number;
  ancK: number;
}

/** Contexto clinico sin el cual varios scores no se pueden calcular. */
export interface HematoContext {
  /** Plaquetas previas al episodio, K/µL. El 4T mide la CAIDA, no el valor. */
  baselinePlateletsK: number;
  /** Horas acumuladas de exposicion a heparina. 0 = no ha recibido. */
  heparinExposureH: number;
  /** Trombosis nueva demostrada o necrosis cutanea. */
  newThrombosis: boolean;
  /** Hay otra causa evidente de trombopenia (sepsis, dilucion, farmacos). */
  otherCauseLikely: boolean;
  /** Sangrado clinico activo. */
  activeBleeding: boolean;
  /** Fiebre documentada. */
  fever: boolean;
}

export interface IsthScore {
  /** 0-8. ≥ 5 define CID overt (Taylor 2001). */
  total: number;
  platelets: number;
  fibrinMarker: number;
  prolongedPt: number;
  fibrinogen: number;
  overt: boolean;
  detail: string;
}

export interface FourTScore {
  /** 0-8. 0-3 bajo, 4-5 intermedio, 6-8 alto (Lo 2006). */
  total: number;
  thrombocytopenia: number;
  timing: number;
  thrombosis: number;
  otherCauses: number;
  probability: 'baja' | 'intermedia' | 'alta';
  detail: string;
}

export interface HematoReading {
  profile: HematoProfile;
  profileLabel: string;
  profileWhy: string;
  profileSeverity: Severity;

  hemolysis: HemolysisNature;
  hemolysisLabel: string;
  hemolysisWhy: string;
  hemolysisSeverity: Severity;

  phenotype: HemostaticPhenotype;
  phenotypeLabel: string;
  phenotypeWhy: string;

  isth: IsthScore;
  fourT: FourTScore;

  /** Falso cuando transfundir plaquetas empeoraria al paciente. */
  plateletTransfusionSafe: boolean;
  /** Por que no, cuando no. */
  plateletTransfusionWhy: string;

  actions: string[];
}

// ─── Score ISTH de CID overt ──────────────────────────────────────────────────
//
// El score existe porque la CID no tiene una prueba propia: se diagnostica por
// la suma de cuatro desviaciones en un paciente con una causa que la explique.
// El INR sustituye aqui a la prolongacion del TP en segundos, que es la forma
// original del score; la equivalencia es la de uso corriente.
export function isthDicScore(s: Pick<HematoSnapshot,
  'plateletsK' | 'dDimerNgMl' | 'inr' | 'fibrinogenMgDl'>): IsthScore {
  const platelets =
      s.plateletsK < 50  ? 2
    : s.plateletsK < 100 ? 1
    : 0;

  const fibrinMarker =
      s.dDimerNgMl > 3000 ? 3   // elevacion fuerte
    : s.dDimerNgMl > 500  ? 2   // elevacion moderada
    : 0;

  const prolongedPt =
      s.inr > 1.7 ? 2
    : s.inr > 1.3 ? 1
    : 0;

  const fibrinogen = s.fibrinogenMgDl < HEMATO_CUTOFFS.fibrinogenReplace ? 1 : 0;

  const total = platelets + fibrinMarker + prolongedPt + fibrinogen;
  return {
    total, platelets, fibrinMarker, prolongedPt, fibrinogen,
    overt: total >= 5,
    detail: `plaquetas ${platelets} + dímero-D ${fibrinMarker} + TP ${prolongedPt} + fibrinógeno ${fibrinogen} = ${total}/8`,
  };
}

// ─── Score 4T de HIT ──────────────────────────────────────────────────────────
//
// Las cuatro T son Trombocitopenia, Timing, Trombosis y oTras causas. El score
// importa porque la decision que desencadena —retirar toda la heparina y pasar
// a un anticoagulante alternativo— no puede esperar al anticuerpo, que tarda.
export function fourTScore(
  s: Pick<HematoSnapshot, 'plateletsK'>,
  ctx: HematoContext,
): FourTScore {
  const baseline = Math.max(1, ctx.baselinePlateletsK);
  const fallPct  = Math.max(0, (baseline - s.plateletsK) / baseline) * 100;

  // Una caida grande con nadir todavia por encima de 20.000 es el patron
  // tipico; un nadir por debajo de 10.000 apunta a otra cosa, no a la HIT —
  // y por eso el nadir profundo PUNTUA CERO aunque la caida sea del 95 %.
  const thrombocytopenia =
      s.plateletsK < 10 ? 0
    : (fallPct > 50 && s.plateletsK >= 20) ? 2
    : (fallPct >= 30 || s.plateletsK < 20) ? 1
    : 0;

  // Dia 5-10 de exposicion es la ventana de la sensibilizacion inmune.
  const days = ctx.heparinExposureH / 24;
  const timing =
      (days >= 5 && days <= 10) ? 2
    : (days > 10 || (days >= 4 && days < 5)) ? 1
    : 0;

  const thrombosis = ctx.newThrombosis ? 2 : 0;
  const otherCauses = ctx.otherCauseLikely ? 0 : 2;

  const total = thrombocytopenia + timing + thrombosis + otherCauses;
  return {
    total, thrombocytopenia, timing, thrombosis, otherCauses,
    probability: total >= 6 ? 'alta' : total >= 4 ? 'intermedia' : 'baja',
    detail: `caída ${fallPct.toFixed(0)} % (${thrombocytopenia}) + día ${days.toFixed(1)} (${timing})`
          + ` + trombosis ${thrombosis} + otras causas ${otherCauses} = ${total}/8`,
  };
}

// ─── Eje de hemolisis ─────────────────────────────────────────────────────────
function readHemolysis(s: HematoSnapshot): Pick<HematoReading,
  'hemolysis' | 'hemolysisLabel' | 'hemolysisWhy' | 'hemolysisSeverity'> {
  const R = HEMATO_RANGES;
  const highLdh = s.ldhUl > R.ldh.high;
  const lowHapto = s.haptoglobinMgDl < R.haptoglobin.low;
  const schisto = s.schistocytes >= 1;

  if (!highLdh && !lowHapto && !schisto) {
    return {
      hemolysis: 'ninguna',
      hemolysisLabel: 'Sin datos de hemólisis',
      hemolysisWhy: `LDH ${Math.round(s.ldhUl)} U/L y haptoglobina ${Math.round(s.haptoglobinMgDl)} mg/dL en rango`,
      hemolysisSeverity: 'ok',
    };
  }
  // Los esquistocitos son la huella del eritrocito partido al pasar por una
  // malla de fibrina o de trombos plaquetarios: hemolisis MECANICA. Sin ellos
  // la hemolisis es de otra naturaleza (inmune, toxica, transfusional) y no
  // apunta a una microangiopatia.
  if (schisto) {
    return {
      hemolysis: 'microangiopatica',
      hemolysisLabel: 'Hemólisis microangiopática (MAHA)',
      hemolysisWhy: `esquistocitos ${'+'.repeat(Math.round(s.schistocytes))} con LDH ${Math.round(s.ldhUl)} U/L`
        + (lowHapto ? ` y haptoglobina ${Math.round(s.haptoglobinMgDl)} consumida` : '')
        + ': el eritrocito se rompe al atravesar la microcirculación',
      hemolysisSeverity: s.ldhUl > 1000 ? 'alert' : 'warn',
    };
  }
  return {
    hemolysis: 'no_microangiopatica',
    hemolysisLabel: 'Hemólisis sin esquistocitos',
    hemolysisWhy: `LDH ${Math.round(s.ldhUl)} U/L alta sin esquistocitos en el frotis:`
      + ' no es mecánica — buscar causa inmune, tóxica o transfusional',
    hemolysisSeverity: 'warn',
  };
}

/**
 * Lectura completa. `ctx` aporta lo que ningun analito dice por si mismo —
 * las plaquetas de partida, los dias de heparina, si hay sangrado o trombosis.
 * Sin el, el 4T no se puede calcular y la lectura lo declara no valorable en
 * vez de inventarse un numero.
 */
export function interpretHemato(s: HematoSnapshot, ctx?: HematoContext): HematoReading {
  const R = HEMATO_RANGES;
  const C = HEMATO_CUTOFFS;
  const context: HematoContext = ctx ?? {
    baselinePlateletsK: 230, heparinExposureH: 0, newThrombosis: false,
    otherCauseLikely: true, activeBleeding: false, fever: false,
  };

  const lowPlt      = s.plateletsK < R.platelets.low;
  const lowFib      = s.fibrinogenMgDl < C.fibrinogenConsumed;
  const highInr     = s.inr > C.inrConsumed;
  const highDdimer  = s.dDimerNgMl > R.dDimer.high;
  const neutropenic = s.ancK < R.anc.low;

  const isth  = isthDicScore(s);
  const fourT = fourTScore(s, context);
  const hemolysis = readHemolysis(s);
  const maha = hemolysis.hemolysis === 'microangiopatica';

  // ── Perfil ────────────────────────────────────────────────────────────────
  let profile: HematoProfile = 'indeterminado';
  let profileLabel = 'Patrón hematológico no concluyente';
  let profileWhy = 'la combinación de recuento, coagulación y hemólisis no encaja en un patrón único';
  let profileSeverity: Severity = 'warn';

  // La lisis tumoral va primero porque no es un problema de hemostasia: es una
  // urgencia metabolica que vive en este dominio por especialidad, no por
  // mecanismo, y confundirla con lo demas lleva a mirar la coagulacion de un
  // paciente cuyo problema es el potasio.
  const tls = s.uricAcidMgDl > 8 && s.phosphateMgDl > R.phosphate.high;

  if (tls) {
    profile = 'lisis_tumoral';
    profileLabel = 'Síndrome de lisis tumoral';
    profileWhy = `ácido úrico ${s.uricAcidMgDl.toFixed(1)} mg/dL y fósforo ${s.phosphateMgDl.toFixed(1)} mg/dL`
      + ` con K⁺ ${s.kPlasma.toFixed(1)} y creatinina ${s.creatinine.toFixed(1)}:`
      + ' el contenido celular lisado está en el plasma';
    profileSeverity = (s.kPlasma > 6.0 || s.creatinine > 2.5) ? 'alert' : 'warn';

  } else if (maha && lowPlt && !lowFib && !highInr) {
    // EL cruce que separa la PTT de la CID. Consumo masivo de plaquetas con
    // fibrinogeno e INR intactos significa que no hay trombina sistemica
    // descontrolada: los trombos son de plaquetas y factor von Willebrand, no
    // de fibrina. Eso es una microangiopatia, y el tratamiento es recambio
    // plasmatico, no productos.
    profile = 'microangiopatia';
    const confirmed = s.adamts13Pct < C.adamts13Deficient;
    profileLabel = confirmed
      ? 'Microangiopatía trombótica — PTT (ADAMTS13 deficiente)'
      : 'Microangiopatía trombótica (PTT/SHU)';
    profileWhy = `plaquetas ${Math.round(s.plateletsK)} K/µL con MAHA pero fibrinógeno`
      + ` ${Math.round(s.fibrinogenMgDl)} mg/dL e INR ${s.inr.toFixed(2)} NORMALES:`
      + ' consumo plaquetario sin coagulopatía de consumo — no es CID'
      + (confirmed ? `; ADAMTS13 ${s.adamts13Pct.toFixed(0)} % < 10 lo confirma` : '');
    profileSeverity = 'alert';

  } else if (lowPlt && (lowFib || highInr) && highDdimer) {
    profile = 'cid';
    profileLabel = isth.overt
      ? `CID overt — score ISTH ${isth.total}/8`
      : `Coagulopatía de consumo — score ISTH ${isth.total}/8 (no overt)`;
    profileWhy = `plaquetas ${Math.round(s.plateletsK)} K/µL CON fibrinógeno ${Math.round(s.fibrinogenMgDl)} mg/dL`
      + ` e INR ${s.inr.toFixed(2)} consumidos y dímero-D ${Math.round(s.dDimerNgMl)}:`
      + ' se está generando y degradando fibrina a la vez';
    profileSeverity = isth.overt ? 'alert' : 'warn';

  } else if (lowPlt && context.heparinExposureH > 0 && fourT.total >= 4) {
    profile = 'hit';
    profileLabel = `Sospecha de HIT — 4T ${fourT.total}/8 (probabilidad ${fourT.probability})`;
    profileWhy = `trombopenia en el día ${(context.heparinExposureH / 24).toFixed(0)} de heparina`
      + ` con fibrinógeno e INR conservados: ${fourT.detail}`;
    profileSeverity = fourT.total >= 6 ? 'alert' : 'warn';

  } else if (!lowPlt && s.inr > C.inrCritical && !lowFib) {
    profile = 'sobreanticoagulacion';
    profileLabel = 'Sobreanticoagulación por antagonistas de vitamina K';
    profileWhy = `INR ${s.inr.toFixed(1)} con plaquetas ${Math.round(s.plateletsK)} K/µL`
      + ` y fibrinógeno ${Math.round(s.fibrinogenMgDl)} normales: el defecto está en los factores`
      + ' dependientes de vitamina K, no en el consumo';
    profileSeverity = context.activeBleeding ? 'alert' : 'warn';

  } else if (neutropenic && s.ancK < C.ancSevere) {
    profile = 'neutropenia';
    profileLabel = context.fever
      ? 'Neutropenia febril — emergencia infecciosa'
      : 'Neutropenia grave';
    profileWhy = `neutrófilos ${(s.ancK * 1000).toFixed(0)}/µL < 500`
      + (context.fever ? ' con fiebre: el antibiótico no espera al cultivo' : '');
    profileSeverity = context.fever ? 'alert' : 'warn';

  } else if (lowPlt) {
    profile = 'trombopenia_inespecifica';
    profileLabel = 'Trombopenia sin patrón definido';
    profileWhy = `plaquetas ${Math.round(s.plateletsK)} K/µL sin hemólisis mecánica,`
      + ' sin coagulopatía de consumo y sin exposición a heparina que lo explique';
    profileSeverity = s.plateletsK < 20 ? 'alert' : 'warn';

  } else if (!neutropenic && !highInr && !lowFib && hemolysis.hemolysis === 'ninguna') {
    profile = 'normal';
    profileLabel = 'Hemostasia y serie blanca sin alteración';
    profileWhy = `plaquetas ${Math.round(s.plateletsK)} K/µL, fibrinógeno ${Math.round(s.fibrinogenMgDl)} mg/dL`
      + ` e INR ${s.inr.toFixed(2)} en rango`;
    profileSeverity = 'ok';
  }

  // ── Fenotipo: sangra o trombosa ───────────────────────────────────────────
  // Es la pregunta que decide la conducta, y la respuesta no se deduce del
  // recuento. Una HIT con 40.000 plaquetas necesita anticoagulacion; una CID
  // con 40.000 y sangrado necesita productos. El mismo numero, el contrario.
  let phenotype: HemostaticPhenotype = 'equilibrio';
  let phenotypeLabel = 'Sin fenotipo hemorrágico ni trombótico dominante';
  let phenotypeWhy = 'ni sangrado activo ni trombosis demostrada';

  if (profile === 'hit' || profile === 'microangiopatia') {
    phenotype = 'trombosis';
    phenotypeLabel = 'Fenotipo TROMBÓTICO a pesar de la trombopenia';
    phenotypeWhy = profile === 'hit'
      ? 'las plaquetas se consumen formando trombos, no por fallo de producción:'
        + ' el riesgo es la trombosis, no el sangrado'
      : 'los trombos plaquetarios ocluyen la microcirculación y dañan cerebro y riñón';
  } else if (context.activeBleeding && (lowPlt || lowFib || highInr)) {
    phenotype = 'sangrado';
    phenotypeLabel = 'Fenotipo HEMORRÁGICO';
    phenotypeWhy = 'sangrado activo con hemostasia comprometida: la reposición es prioritaria';
  } else if (profile === 'cid') {
    phenotype = context.newThrombosis ? 'trombosis' : 'mixto';
    phenotypeLabel = context.newThrombosis
      ? 'CID de predominio trombótico'
      : 'CID con riesgo simultáneo de sangrado y trombosis';
    phenotypeWhy = context.newThrombosis
      ? 'trombosis demostrada en una CID: aquí la heparina tiene indicación'
      : 'se consume y se degrada fibrina a la vez; el fenotipo depende de qué predomine';
  } else if (context.activeBleeding) {
    phenotype = 'sangrado';
    phenotypeLabel = 'Sangrado activo con hemostasia conservada';
    phenotypeWhy = 'el sangrado no se explica por la coagulación: buscar causa quirúrgica o anatómica';
  } else if (context.newThrombosis) {
    phenotype = 'trombosis';
    phenotypeLabel = 'Fenotipo trombótico';
    phenotypeWhy = 'trombosis nueva demostrada';
  }

  // ── Transfusion de plaquetas ──────────────────────────────────────────────
  // La unica contraindicacion formal de un producto sanguineo que un residente
  // puede encontrarse teniendo el numero que la pide delante.
  let plateletTransfusionSafe = true;
  let plateletTransfusionWhy = '';
  if (profile === 'microangiopatia') {
    plateletTransfusionSafe = false;
    plateletTransfusionWhy = 'CONTRAINDICADA en microangiopatía trombótica: las plaquetas transfundidas'
      + ' alimentan los trombos y empeoran la isquemia de órgano. Solo si hay'
      + ' hemorragia que amenaza la vida, y nunca como profilaxis por el recuento.';
  } else if (profile === 'hit') {
    plateletTransfusionSafe = false;
    plateletTransfusionWhy = 'Desaconsejada en HIT: el riesgo es trombótico, no hemorrágico.'
      + ' Reservar para sangrado activo.';
  } else if (s.plateletsK < C.plateletsProphylactic) {
    plateletTransfusionWhy = `plaquetas < ${C.plateletsProphylactic} K/µL: indicación profiláctica`;
  } else if (context.activeBleeding && s.plateletsK < C.plateletsBleeding) {
    plateletTransfusionWhy = `sangrado activo con plaquetas < ${C.plateletsBleeding} K/µL: indicada`;
  }

  // ── Que hacer ─────────────────────────────────────────────────────────────
  const actions: string[] = [];

  if (profile === 'microangiopatia') {
    actions.push('Recambio plasmático URGENTE — dentro de las primeras 4-6 h; es el tratamiento que cambia la mortalidad');
    actions.push('Corticoides a dosis altas y caplacizumab si está disponible; rituximab para apagar el inhibidor');
    actions.push('NO transfundir plaquetas: alimentan la trombosis microvascular');
    if (s.adamts13Pct >= C.adamts13Deficient) {
      actions.push('Solicitar actividad de ADAMTS13, pero NO esperar el resultado para recambiar');
    }
  }

  if (profile === 'cid') {
    actions.push('Tratar la CAUSA: la CID es consecuencia — control del foco y antibiótico adecuado');
    if (s.fibrinogenMgDl < C.fibrinogenReplace) {
      actions.push(`Fibrinógeno ${Math.round(s.fibrinogenMgDl)} mg/dL: crioprecipitado o concentrado de fibrinógeno`);
    }
    if (context.activeBleeding && s.inr > 1.5) {
      actions.push('Plasma fresco congelado por sangrado activo con INR prolongado');
    }
    if (!context.activeBleeding) {
      actions.push('Sin sangrado, los productos no están indicados por el número: corregir la analítica no corrige la CID');
    }
    if (context.newThrombosis) {
      actions.push('Predominio trombótico: la heparina tiene indicación aquí');
    }
  }

  if (profile === 'hit') {
    actions.push('SUSPENDER toda heparina, incluidos lavados de catéter y heparina de bajo peso molecular');
    actions.push('Anticoagular con un fármaco NO heparínico (argatrobán, bivalirudina o fondaparinux): retirar sin sustituir deja el riesgo trombótico intacto');
    actions.push('No iniciar antagonistas de vitamina K hasta que las plaquetas se recuperen (riesgo de gangrena venosa)');
  }

  if (profile === 'lisis_tumoral') {
    actions.push('Rasburicasa: degrada el urato YA circulante — el alopurinol solo frena el que falta por producirse');
    actions.push('Hiperhidratación sin potasio ni fosfato; diuresis objetivo > 2 mL/kg/h');
    if (s.kPlasma > 6.0) {
      actions.push(`K⁺ ${s.kPlasma.toFixed(1)}: gluconato de calcio para estabilizar la membrana, insulina con glucosa para internalizarlo`);
    }
    if (s.phosphateMgDl > 6) {
      actions.push('No corregir la hipocalcemia asintomática: elevar el producto calcio-fósforo precipita en el túbulo y empeora el fallo renal');
    }
    if (s.creatinine > 2.5 || s.kPlasma > 6.5) {
      actions.push('Terapia de reemplazo renal precoz: oligoanuria con hiperpotasemia no se corrige con fluidos');
    }
  }

  if (profile === 'sobreanticoagulacion') {
    actions.push(context.activeBleeding
      ? 'Sangrado con INR crítico: concentrado de complejo protrombínico (corrige en minutos), NO plasma como primera línea'
      : `INR ${s.inr.toFixed(1)} sin sangrado: suspender el anticoagulante y vitamina K oral`);
    actions.push('Vitamina K SIEMPRE junto al concentrado: el complejo dura horas y el déficit de factores vuelve');
  }

  if (profile === 'neutropenia' || (neutropenic && s.ancK < C.ancSevere)) {
    if (context.fever) {
      actions.push('Antibiótico de amplio espectro en la PRIMERA HORA, antes de tener el foco y antes del cultivo');
    }
    actions.push('Aislamiento protector; valorar factor estimulante de colonias según el riesgo');
  }

  if (profile === 'trombopenia_inespecifica' && s.plateletsK < C.plateletsProphylactic) {
    actions.push(`Plaquetas ${Math.round(s.plateletsK)} K/µL: transfusión profiláctica indicada`);
  }

  return {
    profile, profileLabel, profileWhy, profileSeverity,
    ...hemolysis,
    phenotype, phenotypeLabel, phenotypeWhy,
    isth, fourT,
    plateletTransfusionSafe, plateletTransfusionWhy,
    actions,
  };
}
