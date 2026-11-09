// src/scenarios/hematoScenarios.ts
//
// Escenarios de hematología crítica.
//
// Los tres primeros existían desde hacía tiempo y los tres se declaraban
// `domain: 'sepsis'` porque el dominio hematológico no existía. Un paciente con
// PTT evolucionaba como un séptico: la plasmaféresis no hacía nada, el
// laboratorio informaba las plaquetas que correspondían a la severidad de la
// sepsis —no las 12.000 que dice la descripción— y transfundirle plaquetas, que
// es la única contraindicación formal de un producto sanguíneo en toda la UCI,
// no tenía consecuencia alguna. La CID además declaraba la sepsis DOS veces,
// activando el mismo dominio contra sí mismo.
//
// Los tres últimos son nuevos y cierran el triángulo que el dominio enseña:
// la HIT (trombopenia que trombosa), la neutropenia febril (donde el defecto es
// de defensa, no de hemostasia) y la sobreanticoagulación (donde el INR alto no
// es consumo). Cada uno existe para que su subtipo tenga un caso que lo use.
//
// Refs: Scully Blood Adv 2020 (PTT); ISTH 2018 (CID); Coiffier JCO 2008 (TLS);
//       Cuker Blood Adv 2018 (HIT); Freifeld CID 2011 (neutropenia febril);
//       Sarode Circulation 2013 (reversión de anticoagulación).
import type { ScenarioDefinition } from '../store/useScenarioStore';

export const hematoScenarios: ScenarioDefinition[] = [
  {
    id: 'hemato_ptt_severo',
    category: 'hemato',
    name: 'PTT con MAHA y compromiso neurológico',
    description: 'Mujer 35 años, fiebre + petequias + confusión + AKI + anemia microangiopática. Plaquetas 12k, LDH 1820, esquistocitos +++. ADAMTS13 pendiente.',
    baseSeverity: 0.85,
    tags: ['PTT', 'hemato', 'plasmaféresis', 'microangiopatía'],
    pathologyConfigs: [
      { domain: 'hematologic', subtype: 'ptt', baseSeverity: 0.85 },
    ],
    initialVitals: {
      heartRate: 110, systolicBP: 142, diastolicBP: 82,
      meanArterialPressure: 102, respiratoryRate: 20,
      spo2: 96, temperature: 38.4,
      gcs: 12, creatinine: 2.4, lactate: 1.8,
      // La pentada en la analítica. Lo decisivo es lo que está NORMAL:
      // fibrinógeno e INR intactos son lo que separa esto de una CID.
      plateletsK: 12, ldhUl: 1820, haptoglobinMgDl: 5, schistocytes: 3,
      fibrinogenMgDl: 310, inr: 1.05, dDimerNgMl: 1100,
    },
    clinicalNotes: 'EMERGENCIA HEMATOLÓGICA: iniciar plasmaféresis dentro de 4h. Si no disponible: PFC alto volumen (15-30 mL/kg) mientras se traslada. Metilprednisolona 1 g IV/día. Rituximab 375 mg/m² semana 1. Caplacizumab si disponible (TITAN 2019) — sube las plaquetas en 24-48h SIN recuperar el ADAMTS13: controla el fenómeno, no la causa. CONTRAINDICACIÓN ABSOLUTA: transfusión de plaquetas (precipita trombosis microvascular). El fibrinógeno y el INR NORMALES son lo que descarta la CID.',
    references: ['Scully M, Blood Adv 2020', 'Peyvandi F, NEJM 2016 (TITAN)', 'Rock GA, NEJM 1991'],
  },
  {
    id: 'hemato_cid_septica',
    category: 'hemato',
    name: 'CID asociada a sepsis — ISTH Score 6',
    description: 'Sepsis grave por foco abdominal + CID overt. Sangrado por venopunciones, hematuria. Plaquetas 38k, fibrinógeno 90, INR 2.4, dímero-D 28.000.',
    baseSeverity: 0.80,
    tags: ['CID', 'hemato', 'sepsis', 'coagulopatía'],
    pathologyConfigs: [
      // La CID séptica es los DOS dominios a la vez: el foco infeccioso es el
      // motor y la coagulopatía la consecuencia. Antes eran dos entradas de
      // 'sepsis' idénticas, que activaban el mismo dominio dos veces y dejaban
      // la coagulopatía sin modelar.
      { domain: 'hematologic', subtype: 'cid', baseSeverity: 0.80 },
      { domain: 'sepsis',      subtype: null,  baseSeverity: 0.85 },
    ],
    initialVitals: {
      heartRate: 128, systolicBP: 84, diastolicBP: 48,
      meanArterialPressure: 60, respiratoryRate: 26,
      spo2: 91, temperature: 39.1,
      lactate: 3.6, creatinine: 2.1,
      pH: 7.22, hco3: 14,
      // Aquí sí se consume todo a la vez: es la diferencia con la PTT.
      plateletsK: 38, fibrinogenMgDl: 90, inr: 2.4, dDimerNgMl: 28000,
      ldhUl: 520, haptoglobinMgDl: 14, schistocytes: 1,
      wbcK: 21, ancK: 18,
    },
    clinicalNotes: 'TRATAR FOCO SÉPTICO es PRIORIDAD #1 (la CID es consecuencia: sin control del foco los productos corrigen la analítica y no el proceso). Soporte hemostático: PFC 15 mL/kg si INR>1.5 + sangrado activo; crioprecipitados 10U si fibrinógeno <100 mg/dL; plaquetas si <20k o <50k con sangrado. Ácido tranexámico 1 g IV SOLO si patrón hiperfibrinolítico (D-dímero muy alto, ROTEM con LY30>15%) — en la CID de predominio trombótico retira el único freno a la fibrina ya depositada. Heparina solo si trombosis predominante.',
    references: ['ISTH 2018 DIC Score', 'Taylor FB, Thromb Haemost 2001', 'Levi M, Blood 2018'],
  },
  {
    id: 'hemato_tls_qt',
    category: 'hemato',
    name: 'Síndrome de Lisis Tumoral post-QT agresiva',
    description: 'Linfoma Burkitt, 48h post-ciclofosfamida. K+ 6.8, fósforo 9.4, ácido úrico 18, Ca++ 6.2 mg/dL, creatinina 3.2, anuria.',
    baseSeverity: 0.78,
    tags: ['TLS', 'hemato', 'oncohematología', 'AKI', 'hiperkalemia'],
    pathologyConfigs: [
      { domain: 'hematologic', subtype: 'lisis_tumoral', baseSeverity: 0.85 },
    ],
    initialVitals: {
      heartRate: 102, systolicBP: 124, diastolicBP: 72,
      meanArterialPressure: 89, respiratoryRate: 22,
      spo2: 95,
      kPlasma: 6.8, creatinine: 3.2,
      urineOutput: 0.1,
      // Urgencia METABÓLICA: la hemostasia está intacta a propósito, para que
      // no se busque una coagulopatía donde el problema es el potasio.
      uricAcidMgDl: 18, phosphateMgDl: 9.4,
      plateletsK: 210, fibrinogenMgDl: 330, inr: 1.05,
      ldhUl: 1400,   // la LDH alta aquí es masa tumoral lisada, no hemólisis
      schistocytes: 0,
    },
    clinicalNotes: 'Rasburicasa 0.2 mg/kg IV × 1 dosis: es una uricasa y degrada el urato YA circulante. El alopurinol solo inhibe la xantina oxidasa y frena la producción nueva — con uricemia de 18 no sirve de rescate. NO rasburicasa en déficit de G6PD. Hiperhidratación 3 L/m²/día SF 0.9% (sin K+, sin fosfato). Corregir hiperK: calcio gluconato 1 g IV (estabiliza membrana, no baja el K) + insulina 10U + D50 25g + bicarbonato. NO corregir hipoCa asintomática: eleva el producto CaxP y precipita en el túbulo. CRRT temprana si oligoanuria + K+>6.5. Meta uricemia <8 mg/dL.',
    references: ['Coiffier B, JCO 2008', 'Cairo MS, Br J Haematol 2004'],
  },
  {
    id: 'hemato_hit_tipo2',
    category: 'hemato',
    name: 'HIT tipo II — trombopenia con trombosis en el día 7 de heparina',
    description: 'Varón 68 años, postoperatorio de cirugía vascular, día 7 de heparina no fraccionada en infusión. Plaquetas de 240k a 58k, TVP femoral nueva. Fibrinógeno 330, INR 1.05. Score 4T de 8.',
    baseSeverity: 0.85,
    tags: ['HIT', 'hemato', '4T', 'argatrobán', 'trombosis'],
    pathologyConfigs: [
      { domain: 'hematologic', subtype: 'hit', baseSeverity: 0.85 },
    ],
    initialVitals: {
      heartRate: 96, systolicBP: 138, diastolicBP: 80,
      meanArterialPressure: 99, respiratoryRate: 18,
      spo2: 94, temperature: 37.2,
      gcs: 15, creatinine: 1.3,
      // Trombopenia con hemostasia INTACTA: no es CID, y ahí está la trampa.
      plateletsK: 58, fibrinogenMgDl: 330, inr: 1.05, dDimerNgMl: 3800,
      ldhUl: 240, haptoglobinMgDl: 95, schistocytes: 0,
    },
    clinicalNotes: 'Los dos errores que más cuestan aquí se cometen leyendo el recuento sin el contexto temporal. PRIMERO: este paciente TROMBOSA, no sangra — transfundir plaquetas está desaconsejado y solo se reserva para sangrado activo. SEGUNDO: suspender la heparina no es el tratamiento, es la mitad del tratamiento; retirarla sin sustituirla deja el riesgo trombótico intacto. Suspender TODA fuente de heparina (incluidos lavados de catéter y HBPM) y anticoagular con argatrobán, bivalirudina o fondaparinux. NO iniciar antagonistas de vitamina K hasta recuperar las plaquetas (gangrena venosa). Calcular el 4T: la trombopenia se mide como CAÍDA desde el basal, no como valor absoluto, y un nadir por debajo de 10k apunta a otra cosa.',
    references: ['Cuker A, Blood Adv 2018 (ASH)', 'Lo GK, J Thromb Haemost 2006 (4T)', 'Greinacher A, NEJM 2015'],
  },
  {
    id: 'hemato_neutropenia_febril',
    category: 'hemato',
    name: 'Neutropenia febril post-quimioterapia — la primera hora',
    description: 'Mujer 54 años, día 10 de quimioterapia por LMA. Fiebre 38.9 °C, neutrófilos 180/µL, sin foco evidente. Hemodinámicamente estable al ingreso.',
    baseSeverity: 0.72,
    tags: ['neutropenia febril', 'hemato', 'oncohematología', 'antibiótico precoz'],
    pathologyConfigs: [
      { domain: 'hematologic', subtype: 'neutropenia_febril', baseSeverity: 0.88 },
      // La sepsis arranca baja: el caso enseña que la ventana de la primera
      // hora existe porque el paciente TODAVÍA está estable, no porque no
      // vaya a dejar de estarlo.
      { domain: 'sepsis',      subtype: null,                 baseSeverity: 0.25 },
    ],
    initialVitals: {
      heartRate: 104, systolicBP: 118, diastolicBP: 68,
      meanArterialPressure: 85, respiratoryRate: 20,
      spo2: 96, temperature: 38.9,
      gcs: 15, creatinine: 0.9, lactate: 1.4,
      // El defecto es de DEFENSA: la hemostasia está casi intacta y la
      // trombopenia que hay es la aplasia, no un consumo.
      wbcK: 0.6, ancK: 0.18, plateletsK: 42,
      fibrinogenMgDl: 410, inr: 1.1, dDimerNgMl: 700,
      ldhUl: 260, haptoglobinMgDl: 130, schistocytes: 0,
    },
    clinicalNotes: 'ANTIBIÓTICO DE AMPLIO ESPECTRO EN LA PRIMERA HORA, antes de tener el foco y antes del cultivo: betalactámico antipseudomónico (piperacilina-tazobactam, cefepime o meropenem). Tomar hemocultivos sin retrasar la primera dosis. Añadir cobertura para grampositivos resistentes solo si hay inestabilidad, catéter infectado, mucositis grave o colonización conocida. Antifúngico si la fiebre persiste más de 4-7 días. G-CSF acorta la duración de la neutropenia; NO trata la infección ya establecida. Aislamiento protector. La estabilidad del ingreso es engañosa: sin neutrófilos la progresión a shock no da los avisos habituales.',
    references: ['Freifeld AG, Clin Infect Dis 2011 (IDSA)', 'Averbuch D, Haematologica 2013 (ECIL-4)'],
  },
  {
    id: 'hemato_sobreanticoagulacion',
    category: 'hemato',
    name: 'INR 7.8 con hemorragia digestiva — reversión urgente',
    description: 'Varón 78 años anticoagulado con acenocumarol por FA, tras ciclo de antibiótico. INR 7.8, melenas, Hb 7.9. Plaquetas 215k y fibrinógeno 340 normales.',
    baseSeverity: 0.80,
    tags: ['sobreanticoagulación', 'hemato', 'CCP', 'vitamina K', 'hemorragia'],
    pathologyConfigs: [
      { domain: 'hematologic', subtype: 'sobreanticoagulacion', baseSeverity: 0.85 },
    ],
    initialVitals: {
      heartRate: 112, systolicBP: 92, diastolicBP: 54,
      meanArterialPressure: 67, respiratoryRate: 22,
      spo2: 95, temperature: 36.4,
      gcs: 15, creatinine: 1.4, lactate: 2.2,
      // INR altísimo con plaquetas y fibrinógeno NORMALES: el defecto está en
      // los factores dependientes de vitamina K, no en el consumo. Si se leyera
      // como CID se trataría con los productos equivocados.
      inr: 7.8, plateletsK: 215, fibrinogenMgDl: 340, dDimerNgMl: 420,
      ldhUl: 200, haptoglobinMgDl: 100, schistocytes: 0,
    },
    initialBloodVolumeMl: 4200,
    clinicalNotes: 'Hemorragia que amenaza la vida con INR crítico: CONCENTRADO DE COMPLEJO PROTROMBÍNICO (25-50 U/kg según INR), que corrige en minutos. El plasma fresco NO es la primera línea aquí: exige volúmenes que este paciente no tolera y corrige menos y más tarde. VITAMINA K 10 mg IV SIEMPRE junto al complejo — el complejo aporta factores que se agotan en horas y el déficit de síntesis vuelve: dar solo el complejo corrige el INR y lo deja rebotar. Suspender el anticoagulante. Transfundir concentrado de glóbulos por la anemia, no por el INR. Endoscopia cuando la coagulación esté corregida. Revisar la interacción: el antibiótico desplazó el INR.',
    references: ['Sarode R, Circulation 2013', 'Tomaselli GF, JACC 2020 (ACC Expert Consensus)', 'Crowther MA, Chest 2007'],
  },
];
