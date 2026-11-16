// src/core/HematologyEngine.ts
//
// Crisis hematologicas agudas: PTT, CID, lisis tumoral, HIT, neutropenia
// febril y sobreanticoagulacion.
//
// MOTIVO: el catalogo tenia tres escenarios hematologicos y ninguno podia
// declararse como lo que era —no existia el dominio— asi que los tres se
// activaban como 'sepsis'. Peor aun: las plaquetas del hemograma se calculaban
// como "200 menos la severidad de la sepsis", y la coagulacion entera salia de
// la presion arterial media. Una PTT con 12.000 plaquetas o una CID con
// fibrinogeno de 90 e INR de 2.4 eran literalmente inexpresables: el escenario
// las declaraba en su descripcion y el laboratorio informaba otra cosa. El
// propiltiouracilo del dominio endocrino tenia su equivalente aqui — la
// rasburicasa, el argatroban, el acido tranexamico, la vitamina K, el complejo
// protrombinico y la desmopresina ya estaban en el catalogo de farmacos, ya se
// podian administrar desde la interfaz, y no hacian absolutamente nada.
//
// LAS TRES LECCIONES QUE EL MOTOR TIENE QUE PODER ENSEÑAR
//
//   1. PTT contra CID. Misma pantalla, conducta opuesta. Lo que las separa es
//      el fibrinogeno y el INR —normales en la microangiopatia, consumidos en
//      la coagulopatia— y la consecuencia es que en la PTT transfundir
//      plaquetas EMPEORA al paciente. Aqui eso ocurre de verdad: la
//      transfusion sube la carga de microtrombosis, y la microtrombosis baja
//      el Glasgow y sube la creatinina.
//
//   2. Tratar el fenomeno no es tratar la causa. El caplacizumab sube las
//      plaquetas en horas sin tocar el ADAMTS13; el recambio plasmatico repone
//      el ADAMTS13 pero no apaga el inhibidor que lo consume; solo el
//      rituximab y los corticoides lo apagan, y tardan dias. Suspender el
//      caplacizumab con el inhibidor todavia alto recae.
//
//   3. Rasburicasa contra alopurinol. La primera es una uricasa y degrada el
//      urato que YA circula; el segundo inhibe la xantina oxidasa y solo frena
//      el que falta por producirse. En un paciente con urato de 18 son dos
//      farmacos distintos, no dos opciones.
//
// PROPIEDAD DE LAS VARIABLES
//   El motor escribe en ABSOLUTO solo lo hematologico (plaquetas, fibrinogeno,
//   INR, dimero-D, LDH, haptoglobina, esquistocitos, urato, fosforo,
//   leucocitos, neutrofilos). Sobre el potasio, la creatinina y el Glasgow
//   —que son de RenalEngine y NeuroEngine— lleva la cuenta de SU PROPIA
//   contribucion y aplica el incremento entre ticks, de modo que su efecto es
//   idempotente y no borra lo que el otro motor acaba de calcular.
//
// REFERENCIAS
//   Taylor FB et al., Thromb Haemost 2001;86:1327-30 — score ISTH de CID.
//   Levi M, Scully M, Blood 2018;131:845-54 — CID en el paciente critico.
//   Scully M et al., Blood Adv 2020;4:4656-69 — guia ISTH de PTT.
//   Peyvandi F et al., NEJM 2016;374:511-22 — caplacizumab (TITAN).
//   Scully M et al., NEJM 2019;380:335-46 — caplacizumab (HERCULES).
//   Rock GA et al., NEJM 1991;325:393-7 — recambio plasmatico contra plasma.
//   Cuker A et al., Blood Adv 2018;2:3360-92 — guia ASH de HIT.
//   Greinacher A, NEJM 2015;373:252-61 — HIT: mecanismo y manejo.
//   Coiffier B et al., J Clin Oncol 2008;26:2767-78 — lisis tumoral.
//   Freifeld AG et al., Clin Infect Dis 2011;52:e56-93 — neutropenia febril.
//   Sarode R et al., Circulation 2013;128:1234-43 — CCP contra plasma.

import { usePatientStore }      from '../store/usePatientStore';
import { usePathologyStore }    from '../store/usePathologyStore';
import { usePharmacologyStore, type DrugId } from '../store/usePharmacologyStore';
import { useCRRTStore }         from '../store/useCRRTStore';
import { rand }                 from './rng';

/** Valores de reposo de la serie, hacia los que el paciente vuelve. */
const BASE = {
  platelets: 230,   // K/µL
  fibrinogen: 320,  // mg/dL
  inr: 1.0,
  dDimer: 250,      // ng/mL FEU
  ldh: 180,         // U/L
  haptoglobin: 110, // mg/dL
  uricAcid: 4.8,    // mg/dL
  phosphate: 3.5,   // mg/dL
  wbc: 7.5,         // K/µL
  neutFrac: 0.62,
} as const;

/** Constantes de tiempo de cada eje, en segundos.
 *  La hemostasia se consume en minutos y se repone en horas; la serie blanca
 *  tarda dias. Las constantes reflejan ese orden de magnitud. */
const TAU = {
  /** Consumo/recuperacion plaquetaria. */
  platelets: 5400,
  /** Factores y fibrinogeno. */
  coag: 3600,
  /** Marcadores de hemolisis. */
  hemolysis: 2700,
  /** Metabolitos de la lisis tumoral. */
  metabolic: 2400,
  /** Serie blanca. */
  wbc: 43200,
} as const;

export class HematologyEngine {
  private static inst: HematologyEngine | null = null;
  public static getInstance(): HematologyEngine {
    if (!HematologyEngine.inst) HematologyEngine.inst = new HematologyEngine();
    return HematologyEngine.inst;
  }

  /** Contribucion propia ya aplicada a variables de OTROS motores. */
  private appliedK  = 0;
  private appliedCr = 0;
  private appliedGcs = 0;
  /** Unidades de producto vistas en el tick anterior. */
  private lastPlateletUnits = 0;
  private lastCryoUnits     = 0;
  private lastFfpUnits      = 0;
  /** Fenotipo leucocitario del episodio septico en curso — se decide UNA vez. */
  private septicLeukopenia = false;
  private sepsisWasActive  = false;
  /** Acumulado de recambio plasmatico, en fracciones de volumen plasmatico. */
  private pexVolumesProcessed = 0;

  public reset(): void {
    this.appliedK = 0;
    this.appliedCr = 0;
    this.appliedGcs = 0;
    this.lastPlateletUnits = 0;
    this.lastCryoUnits = 0;
    this.lastFfpUnits = 0;
    this.septicLeukopenia = false;
    this.sepsisWasActive = false;
    this.pexVolumesProcessed = 0;
  }

  public update(dtSeconds: number): void {
    if (dtSeconds <= 0 || !isFinite(dtSeconds)) return;

    const path  = usePathologyStore.getState();
    const pat   = usePatientStore.getState();
    const pharm = usePharmacologyStore.getState();
    const v     = pat.vitals;
    const hema  = path.hematologic;
    const sepsisS = path.sepsis.isActive ? path.sepsis.severity : 0;

    // ── Fenotipo leucocitario del episodio septico ────────────────────────
    // Antes esto se sorteaba en el LabEngine CADA VEZ que se generaba un
    // hemograma, de modo que el mismo paciente alternaba entre leucopenia de
    // 2.500 y leucocitosis de 24.000 entre dos extracciones consecutivas. La
    // leucopenia septica es un rasgo del episodio —y de mal pronostico—, no
    // del tubo: se decide al empezar la sepsis y se mantiene.
    if (path.sepsis.isActive && !this.sepsisWasActive) {
      this.septicLeukopenia = sepsisS > 0.6 && rand('hematology') < 0.14;
    }
    this.sepsisWasActive = path.sepsis.isActive;

    // ── Tratamientos ──────────────────────────────────────────────────────
    const cp = pharm.plasmaConcentrations;
    const dose = (id: DrugId) => Math.min(1.5, cp[id] ?? 0);

    const heparin     = Math.max(dose('heparin_iv'), dose('enoxaparin') * 0.8);
    const argatroban  = dose('argatroban_iv');
    const caplacizumab= dose('caplacizumab_iv');
    const rituximab   = dose('rituximab_iv');
    const steroids    = Math.max(dose('methylprednisolone'), dose('hydrocortisone') * 0.6);
    const rasburicase = dose('rasburicase_iv');
    const allopurinol = dose('allopurinol_oral');
    const txa         = dose('tranexamic_acid_iv');
    const vitK        = dose('vitamin_k_iv');
    const pcc         = dose('pcc_4factor');
    const filgrastim  = dose('filgrastim_sc');
    const calcium     = dose('calcium_gluconate_iv');

    const crrt = useCRRTStore.getState();
    const crrtClearance = crrt.active ? Math.min(1, crrt.dose_mLkgh / 25) : 0;
    // Hiperhidratacion: 3 L/m²/dia en un adulto medio son unos 240 mL/h.
    const hydration = Math.min(1, (pat.maintenanceFluidRate_mLh ?? 0) / 240);

    // ── Productos sanguineos transfundidos en este tick ───────────────────
    const pltUnits  = Math.max(0, pat.plateletUnitsGiven - this.lastPlateletUnits);
    const cryoUnits = Math.max(0, pat.cryoUnitsGiven     - this.lastCryoUnits);
    const ffpUnits  = Math.max(0, pat.ffpUnitsGiven      - this.lastFfpUnits);
    this.lastPlateletUnits = pat.plateletUnitsGiven;
    this.lastCryoUnits     = pat.cryoUnitsGiven;
    this.lastFfpUnits      = pat.ffpUnitsGiven;

    // ── Objetivos de reposo, modulados por lo que NO es hematologico ──────
    //
    // El fibrinogeno SUBE en la sepsis: es un reactante de fase aguda. Que
    // suba sin CID y se hunda con ella es justamente lo que permite usarlo
    // para distinguirlas, y por eso el basal septico no es el normal.
    let tPlatelets   = BASE.platelets - sepsisS * 120;
    let tFibrinogen  = BASE.fibrinogen + sepsisS * 130;
    let tInr         = BASE.inr + sepsisS * 0.22;
    let tDdimer      = BASE.dDimer + sepsisS * 900;
    let tLdh         = BASE.ldh + sepsisS * 120;
    let tHapto       = BASE.haptoglobin - sepsisS * 25;
    let tSchisto     = 0;
    let tUricAcid    = BASE.uricAcid;
    let tPhosphate   = BASE.phosphate;
    let tWbc         = this.septicLeukopenia ? 2.4 : BASE.wbc + sepsisS * 17;
    let tNeutFrac    = BASE.neutFrac + sepsisS * 0.26;

    // Coagulopatia dilucional de la transfusion masiva: el concentrado de
    // globulos no lleva plaquetas ni factores, asi que reponer volumen con el
    // diluye la hemostasia. Es la razon del ratio 1:1:1 (PROPPR 2015).
    const dilution = Math.min(1, Math.max(0, (pat.prbcUnitsGiven - 4) / 10));
    tPlatelets  -= dilution * 90;
    tFibrinogen -= dilution * 120;
    tInr        += dilution * 0.5;

    // ── Estado hematologico propio ────────────────────────────────────────
    let adamts13    = hema.adamts13Pct;
    let inhibitor   = hema.inhibitorTiter;
    let microthrombi= hema.microthrombosis;
    let consumption = hema.consumption;
    let heparinH    = hema.heparinExposureH;
    let pexSessions = hema.plasmaExchangeSessions;

    // El reloj de exposicion corre siempre que haya heparina circulando,
    // tenga o no el paciente una HIT declarada: es la condicion previa.
    if (heparin > 0.05) heparinH += dtSeconds / 3600;

    const active = hema.isActive && hema.severity > 0;
    const sub = active ? hema.subtype : null;

    if (sub === 'ptt') {
      // ── Recambio plasmatico ───────────────────────────────────────────────
      // Repone el ADAMTS13 que falta y arrastra el inhibidor que lo consume.
      // Una sesion procesa 1-1.5 volumenes plasmaticos en unas 2-3 horas: aqui
      // se cuenta el volumen procesado, no el reloj, para que interrumpirla a
      // medias no cuente como sesion completa (Rock NEJM 1991).
      if (hema.plasmaExchangeActive) {
        const volPerHour = 0.5;   // volúmenes plasmáticos por hora
        const dVol = volPerHour * (dtSeconds / 3600);
        this.pexVolumesProcessed += dVol;
        adamts13  += dVol * 55;             // reposición por aporte de plasma
        inhibitor -= dVol * 0.30;           // arrastre del autoanticuerpo
        if (this.pexVolumesProcessed >= 1.0) {
          this.pexVolumesProcessed -= 1.0;
          pexSessions += 1;
        }
      }
      // El rituximab y los corticoides apagan la produccion del anticuerpo en
      // la fuente. Tardan dias: no sustituyen al recambio en la fase aguda.
      inhibitor -= (rituximab * 0.07 + steroids * 0.035) * (dtSeconds / 3600);
      inhibitor = clamp(0, 1, inhibitor);

      // Mientras el inhibidor siga alto, el ADAMTS13 repuesto se vuelve a
      // consumir: es la razon de que el recambio haya que repetirlo a diario.
      adamts13 -= inhibitor * 22 * (dtSeconds / 3600);
      adamts13 = clamp(0, 110, adamts13);

      // La actividad deficitaria deja multimeros ultralargos de factor von
      // Willebrand que capturan plaquetas. El caplacizumab bloquea esa captura
      // sin reponer nada: controla el fenomeno aguas abajo de la causa.
      const deficit = clamp(0, 1, (50 - adamts13) / 50);
      const capture = deficit * (1 - Math.min(0.85, caplacizumab * 0.85));

      tPlatelets  = 230 - capture * 218;             // hasta ~12 K/µL
      tLdh        = 180 + capture * 1900;
      tHapto      = 110 - capture * 106;
      tSchisto    = capture > 0.65 ? 3 : capture > 0.35 ? 2 : capture > 0.12 ? 1 : 0;
      // Y esto es lo que la separa de la CID: la via de la fibrina esta
      // intacta, asi que el fibrinogeno y el INR NO se mueven.
      tFibrinogen = BASE.fibrinogen;
      tInr        = BASE.inr;
      tDdimer     = 400 + capture * 900;             // elevación discreta

      // La microtrombosis sigue a la captura plaquetaria y es la via por la
      // que la PTT daña cerebro y riñon.
      microthrombi += (capture - microthrombi) * k(dtSeconds, 3600);

      // Transfundir plaquetas aqui añade sustrato a los trombos. El recuento
      // sube poco —se consumen— y el daño de organo empeora: exactamente lo
      // que la contraindicacion formal describe.
      if (pltUnits > 0) {
        microthrombi = clamp(0, 1, microthrombi + pltUnits * 0.10 * deficit);
      }

    } else if (sub === 'cid') {
      // La CID es consecuencia: su motor es el disparador. Controlar el foco y
      // cubrir con antibiotico adecuado es lo que apaga el consumo; reponer
      // productos corrige la analitica y no el proceso.
      const sepsis = path.sepsis;
      const trigger = Math.max(
        hema.severity,
        sepsis.isActive ? sepsis.severity : 0,
      );
      const controlled = (sepsis.sourceControlAchieved ? 0.55 : 0)
                       + (sepsis.adequateAntibiotics   ? 0.25 : 0);
      const drive = trigger * (1 - Math.min(0.80, controlled));
      consumption += (drive - consumption) * k(dtSeconds, 7200);

      tPlatelets  = 230 - consumption * 200;
      tFibrinogen = 320 - consumption * 250;          // hasta ~70 mg/dL
      tInr        = 1.0 + consumption * 1.9;
      tDdimer     = 500 + consumption * 32000;        // elevación masiva
      tLdh        = 180 + consumption * 420;
      tHapto      = 110 - consumption * 85;
      tSchisto    = consumption > 0.55 ? 1 : 0;

      // El acido tranexamico frena la fibrinolisis. En la CID con fenotipo
      // hiperfibrinolitico (dimero-D muy alto) ayuda; en la de predominio
      // trombotico retira el unico freno que el organismo tiene a la fibrina
      // ya depositada y aumenta la microtrombosis.
      if (txa > 0.1) {
        const hyperfibrinolytic = v.dDimerNgMl > 10000;
        if (!hyperfibrinolytic) {
          microthrombi = clamp(0, 1, microthrombi + txa * 0.04 * (dtSeconds / 3600));
        }
      }
      microthrombi += (consumption * 0.45 - microthrombi) * k(dtSeconds, 5400);

    } else if (sub === 'hit') {
      // El anticuerpo anti-PF4/heparina activa la plaqueta: se consume
      // formando trombos. Por eso el paciente con 50.000 plaquetas trombosa
      // en vez de sangrar, y por eso reponer plaquetas no es la respuesta.
      //
      // La sensibilizacion inmune empieza hacia el dia 4 y esta completa hacia
      // el dia 7: antes de eso la trombopenia no es atribuible a la heparina,
      // y es justamente lo que el timing del score 4T mide.
      const sensitized = clamp(0, 1, (heparinH - 96) / 72);
      const immune = hema.severity * sensitized * (heparin > 0.05 ? 1 : 0.35);

      tPlatelets  = 230 - immune * 175;               // nadir ~55 K/µL
      tFibrinogen = BASE.fibrinogen;                  // intacto: no es CID
      tInr        = BASE.inr;
      tDdimer     = 500 + immune * 3500;
      tLdh        = 180 + immune * 90;
      tSchisto    = 0;

      // Retirar la heparina frena el consumo; retirarla SIN sustituirla deja
      // el riesgo trombotico intacto, y eso es lo que el motor debe mostrar.
      const anticoagulated = argatroban > 0.15;
      const thrombosisDrive = immune * (anticoagulated ? 0.25 : 1.0);
      microthrombi += (thrombosisDrive - microthrombi) * k(dtSeconds, 7200);

      if (pltUnits > 0) {
        microthrombi = clamp(0, 1, microthrombi + pltUnits * 0.07 * immune);
      }

    } else if (sub === 'lisis_tumoral') {
      // La carga de celulas lisadas vierte potasio, fosforo y purinas. Se
      // aclara por orina y por depuracion extracorporea; la rasburicasa actua
      // solo sobre el urato, y el alopurinol solo sobre su produccion.
      const clearance = 0.10 + hydration * 0.35 + crrtClearance * 0.55;
      const burden = hema.severity * Math.max(0.15, 1 - clearance);

      tPhosphate = 3.5 + burden * 7.5;
      // Rasburicasa: uricasa recombinante. Degrada el urato CIRCULANTE, y por
      // eso lo desploma en horas. Alopurinol: inhibidor de la xantina oxidasa,
      // solo frena la produccion nueva — con urato de 18 no sirve de rescate.
      const uricProduction = burden * 13.5 * (1 - Math.min(0.65, allopurinol * 0.65));
      const uricolysis     = Math.min(0.92, rasburicase * 0.92);
      tUricAcid = (4.8 + uricProduction) * (1 - uricolysis);

      consumption = burden;
      // La hemostasia no esta implicada: dejar los objetivos basales es
      // deliberado, para que el residente no busque una coagulopatia donde el
      // problema es metabolico.

    } else if (sub === 'neutropenia_febril') {
      // El defecto es de defensa, no de hemostasia. El G-CSF acorta la
      // duracion de la neutropenia; no trata la infeccion establecida.
      const depth = hema.severity;
      const recovery = Math.min(0.75, filgrastim * 0.75);
      tWbc      = Math.max(0.3, 7.5 - depth * 7.0 + recovery * 4.5);
      tNeutFrac = Math.max(0.05, 0.20 + recovery * 0.35);
      // Trombopenia acompañante de la aplasia post-quimioterapia.
      tPlatelets = 230 - depth * 170;

    } else if (sub === 'sobreanticoagulacion') {
      // Deficit funcional de los factores II, VII, IX y X. El complejo
      // protrombinico los repone en minutos y se agota en horas; la vitamina K
      // permite volver a sintetizarlos y tarda 6-12 h. Dar solo el complejo
      // corrige el INR y lo deja rebotar.
      const deficit = clamp(0, 1, hema.severity - Math.min(0.9, pcc * 0.85) - Math.min(0.8, vitK * 0.55));
      tInr = 1.0 + deficit * 8.0;
      tPlatelets  = BASE.platelets;
      tFibrinogen = BASE.fibrinogen;
    }

    // ── Efecto inmediato de los productos transfundidos ───────────────────
    //
    // Los productos se aplican como un ESCALON sobre el valor, no como un
    // empujon al objetivo: el fibrinogeno del crioprecipitado ya esta en el
    // plasma del paciente en el momento de pasarlo. Hacerlo contra el objetivo
    // lo diluia en la constante de tiempo de una hora y media y la transfusion
    // no se veia en la analitica siguiente. Que luego el valor vuelva a caer
    // es correcto y es la leccion: corregir la analitica no corrige el proceso
    // que la consume.
    let stepPlt = 0, stepFib = 0, stepInr = 0;
    // Un pool de aferesis rinde unas 30.000 plaquetas en un adulto de 70 kg —
    // salvo donde se consumen al entrar, que es el caso de la PTT y la HIT.
    if (pltUnits > 0) {
      const yieldPerPool = (sub === 'ptt' || sub === 'hit') ? 6 : 30;
      stepPlt += pltUnits * yieldPerPool;
    }
    // 1 unidad de crioprecipitado sube el fibrinogeno unos 7 mg/dL.
    if (cryoUnits > 0) stepFib += cryoUnits * 7;
    // 1 unidad de plasma corrige el INR tanto menos cuanto mas alto esta.
    if (ffpUnits > 0)  stepInr -= ffpUnits * 0.10;

    // Sin crisis activa, la microtrombosis y el consumo se resuelven.
    if (!active) {
      microthrombi += (0 - microthrombi) * k(dtSeconds, 5400);
      consumption  += (0 - consumption)  * k(dtSeconds, 5400);
    }

    // ── Convergencia hacia los objetivos ──────────────────────────────────
    const nextPlt   = approach(v.plateletsK,      tPlatelets,  dtSeconds, TAU.platelets) + stepPlt;
    const nextFib   = approach(v.fibrinogenMgDl,  tFibrinogen, dtSeconds, TAU.coag)      + stepFib;
    const nextInr   = approach(v.inr,             tInr,        dtSeconds, TAU.coag)      + stepInr;
    const nextDd    = approach(v.dDimerNgMl,      tDdimer,     dtSeconds, TAU.coag);
    const nextLdh   = approach(v.ldhUl,           tLdh,        dtSeconds, TAU.hemolysis);
    const nextHapto = approach(v.haptoglobinMgDl, tHapto,      dtSeconds, TAU.hemolysis);
    const nextUric  = approach(v.uricAcidMgDl,    tUricAcid,   dtSeconds, TAU.metabolic);
    const nextPhos  = approach(v.phosphateMgDl,   tPhosphate,  dtSeconds, TAU.metabolic);
    const nextWbc   = approach(v.wbcK,            tWbc,        dtSeconds, TAU.wbc);
    // Los esquistocitos son una lectura morfologica discreta: aparecen y
    // desaparecen con retraso respecto a la LDH, no de un tick al siguiente.
    const nextSchis = approach(v.schistocytes,    tSchisto,    dtSeconds, TAU.hemolysis);

    const nextNeutFrac = clamp(0.02, 0.97, tNeutFrac);
    const nextAnc = clamp(0.01, 60, nextWbc * nextNeutFrac);

    // ── Contribucion a variables de OTROS motores ─────────────────────────
    // Se aplica el INCREMENTO respecto a lo ya aportado, no el valor: asi el
    // efecto es idempotente y RenalEngine o NeuroEngine conservan lo suyo.
    const burdenTls = (sub === 'lisis_tumoral') ? consumption : 0;

    // Potasio: lo vierte la celula lisada; sale por orina y por depuracion.
    const wantK = burdenTls * 2.9 * (1 - Math.min(0.75, hydration * 0.3 + crrtClearance * 0.6));
    // Creatinina: nefropatia por urato y por precipitacion de calcio-fosforo,
    // mas la isquemia de la microtrombosis. Dar calcio con el fosforo alto
    // eleva el producto y empeora el deposito tubular: es la trampa del caso.
    const caPhosInsult = (nextPhos > 6 && calcium > 0.2) ? calcium * 0.55 : 0;
    const wantCr = burdenTls * (1.6 + Math.max(0, nextUric - 8) * 0.06 + caPhosInsult)
                 + microthrombi * 1.1;
    // Glasgow: la microtrombosis cerebral es lo que pone en coma a la PTT.
    const wantGcs = -microthrombi * 7.5;

    const dK   = wantK   - this.appliedK;
    const dCr  = wantCr  - this.appliedCr;
    const dGcs = wantGcs - this.appliedGcs;
    this.appliedK   = wantK;
    this.appliedCr  = wantCr;
    this.appliedGcs = wantGcs;

    usePatientStore.getState().updateVitals({
      plateletsK:      clamp(1, 900, nextPlt),
      fibrinogenMgDl:  clamp(20, 900, nextFib),
      inr:             clamp(0.8, 12, nextInr),
      dDimerNgMl:      clamp(50, 60000, nextDd),
      ldhUl:           clamp(80, 6000, nextLdh),
      haptoglobinMgDl: clamp(1, 400, nextHapto),
      schistocytes:    clamp(0, 3, nextSchis),
      uricAcidMgDl:    clamp(0.5, 40, nextUric),
      phosphateMgDl:   clamp(0.5, 18, nextPhos),
      wbcK:            clamp(0.1, 80, nextWbc),
      ancK:            nextAnc,
      kPlasma:         clamp(1.5, 9.0, v.kPlasma    + dK),
      creatinine:      clamp(0.2, 15,  v.creatinine + dCr),
      // Sin redondear: el paso por tick es de centesimas y Math.round lo
      // devolveria al valor de partida en cada iteracion.
      gcs:             clamp(3, 15, v.gcs + dGcs),
    });

    // El patch se omite cuando nada ha cambiado de forma apreciable. No es una
    // microoptimizacion: patchHematologic construye un objeto nuevo, y el
    // CronosEngine corre a 240 ticks por segundo, asi que escribir cada tick
    // daba una referencia nueva —y un re-render de todo suscriptor del slice—
    // 240 veces por segundo incluso con el paciente sano y el dominio apagado.
    const next = {
      adamts13Pct: adamts13,
      inhibitorTiter: clamp(0, 1, inhibitor),
      microthrombosis: clamp(0, 1, microthrombi),
      consumption: clamp(0, 1, consumption),
      heparinExposureH: heparinH,
      plasmaExchangeSessions: pexSessions,
    };
    const changed =
         Math.abs(next.adamts13Pct     - hema.adamts13Pct)      > 1e-4
      || Math.abs(next.inhibitorTiter  - hema.inhibitorTiter)   > 1e-6
      || Math.abs(next.microthrombosis - hema.microthrombosis)  > 1e-6
      || Math.abs(next.consumption     - hema.consumption)      > 1e-6
      || Math.abs(next.heparinExposureH - hema.heparinExposureH) > 1e-6
      || next.plasmaExchangeSessions !== hema.plasmaExchangeSessions;
    if (changed) usePathologyStore.getState().patchHematologic(next);
  }
}

/** Fraccion del camino al objetivo recorrida en dt con constante tau. */
function k(dtSeconds: number, tauS: number): number {
  return 1 - Math.exp(-dtSeconds / Math.max(1, tauS));
}

function approach(current: number, target: number, dtSeconds: number, tauS: number): number {
  return current + (target - current) * k(dtSeconds, tauS);
}

function clamp(lo: number, hi: number, x: number): number {
  if (!isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

export default HematologyEngine;
