// src/core/EndocrineEngine.ts
//
// Crisis endocrinas agudas: tormenta tiroidea, coma mixedematoso, cetoacidosis,
// estado hiperosmolar y crisis suprarrenal.
//
// MOTIVO: el catalogo tenia escenarios endocrinos desde hacia tiempo, pero
// ninguno podia declararse como lo que era —no existia el dominio— y todos se
// activaban como 'sepsis'. Un paciente con tormenta tiroidea evolucionaba como
// un septico: el propiltiouracilo y el esmolol no hacian nada, y tratarlo con
// antibioticos y vasopresores "funcionaba". El simulador enseñaba a tratar una
// crisis tiroidea como una sepsis.
//
// Los dos polos tiroideos son opuestos en todo —frecuencia, temperatura, gasto
// cardiaco, nivel de conciencia— y por eso se modelan juntos: comparten eje y
// se aprenden por contraste.
//
// REFERENCIAS
//   Burch HB, Wartofsky L, Endocrinol Metab Clin North Am 1993;22:263-77
//     — escala diagnostica de la tormenta tiroidea.
//   Ross DS et al., Thyroid 2016;26:1343-421 — guia ATA de hipertiroidismo.
//   Wartofsky L, Thyroid 2006;16:1229-31 — coma mixedematoso.
//   Chiha M et al., J Intensive Care Med 2015;30:131-40 — mixedema en UCI.
//   Annane D et al., Intensive Care Med 2017;43:1751-63 — insuficiencia
//     suprarrenal en el paciente critico.
//   Kitabchi AE et al., Diabetes Care 2009;32:1335-43 — crisis hiperglucemicas.

import { usePatientStore }       from '../store/usePatientStore';
import { usePathologyStore }     from '../store/usePathologyStore';
import { usePharmacologyStore }  from '../store/usePharmacologyStore';

/** Objetivos fisiologicos de cada crisis, hacia los que el motor empuja. */
interface CrisisTarget {
  /** Delta sobre la frecuencia basal, lpm. */
  hr: number;
  /** Delta sobre la temperatura basal, °C. */
  temp: number;
  /** Multiplicador del gasto cardiaco. */
  co: number;
  /** Multiplicador de la resistencia vascular sistemica. */
  svr: number;
  /** Delta sobre la frecuencia respiratoria. */
  rr: number;
  /** Delta sobre el nivel de conciencia (GCS). */
  gcs: number;
}

/** Constante de tiempo con que el paciente se mueve hacia el objetivo (s). */
const TAU_S = 180;

export class EndocrineEngine {
  private static inst: EndocrineEngine | null = null;
  public static getInstance(): EndocrineEngine {
    if (!EndocrineEngine.inst) EndocrineEngine.inst = new EndocrineEngine();
    return EndocrineEngine.inst;
  }
  public reset(): void { /* sin estado propio: todo vive en los stores */ }

  public update(dtSeconds: number): void {
    if (dtSeconds <= 0 || !isFinite(dtSeconds)) return;

    const path = usePathologyStore.getState();
    const endo = path.endocrine;
    if (!endo.isActive || endo.severity <= 0) return;

    const pat   = usePatientStore.getState();
    const pharm = usePharmacologyStore.getState();
    const v     = pat.vitals;

    // ── Tratamiento: lo que mueve la carga hormonal ────────────────────────
    // Solo la tormenta tiroidea tiene carga que bajar. Las tionamidas frenan
    // la sintesis y el propiltiouracilo ademas bloquea la conversion
    // periferica de T4 a T3; la hidrocortisona bloquea esa misma conversion,
    // que es la razon de darla aqui y no solo por la insuficiencia suprarrenal
    // relativa que acompaña a la crisis (Ross 2016).
    if (endo.subtype === 'tormenta_tiroidea') {
      const cp = pharm.plasmaConcentrations;
      const ptu  = cp['propylthiouracil_oral'] ?? 0;
      const mmi  = cp['methimazole_oral']      ?? 0;
      const hydro= cp['hydrocortisone']        ?? 0;

      // Aclaramiento por hora de tratamiento, escalado a dt.
      const clearancePerHour =
          Math.min(1, ptu)   * 0.28     // tionamida + bloqueo de conversion
        + Math.min(1, mmi)   * 0.20     // tionamida sola
        + Math.min(1, hydro) * 0.12;    // bloqueo de conversion periferica
      if (clearancePerHour > 0) {
        const next = endo.thyroidLoad - clearancePerHour * (dtSeconds / 3600);
        usePathologyStore.getState().setThyroidLoad(next);
      }
    }

    // La severidad efectiva de la crisis tiroidea sigue a la carga hormonal:
    // sin tratamiento no cede, y con el cede de verdad. En las demas crisis la
    // severidad la gobiernan otros ejes (glucemia, cortisol) que ya viven en
    // sus propios motores, asi que aqui solo se usa la declarada.
    const sev = endo.subtype === 'tormenta_tiroidea'
      ? Math.max(0, Math.min(1, endo.thyroidLoad))
      : Math.max(0, Math.min(1, endo.severity));
    if (sev <= 0.02) return;

    const target = this.targetFor(endo.subtype, sev);

    // El betabloqueo controla la frecuencia sin tocar la hormona: es la
    // diferencia entre tratar el sintoma y tratar la causa, y conviene que el
    // simulador la muestre — la taquicardia cede, la crisis sigue.
    const esmolol = pharm.infusionRates['esmolol'] ?? 0;
    const beta = Math.min(1, esmolol / 150);
    const hrTarget = target.hr * (1 - beta * 0.65);

    // ── Convergencia exponencial hacia el objetivo ─────────────────────────
    const k = 1 - Math.exp(-dtSeconds / TAU_S);
    const baseHR   = 78, baseTemp = 36.8, baseRR = 16, baseGCS = 15;

    const nextHR   = v.heartRate        + ((baseHR   + hrTarget)    - v.heartRate)        * k;
    const nextTemp = v.temperature      + ((baseTemp + target.temp) - v.temperature)      * k;
    const nextRR   = v.respiratoryRate  + ((baseRR   + target.rr)   - v.respiratoryRate)  * k;
    const nextGCS  = v.gcs              + ((baseGCS  + target.gcs)  - v.gcs)              * k;
    const nextCO   = v.cardiacOutput    + ((5.0 * target.co)        - v.cardiacOutput)    * k;
    const nextSVR  = (v.svr ?? 1100)    + ((1100 * target.svr)      - (v.svr ?? 1100))    * k;

    usePatientStore.getState().updateVitals({
      heartRate:       clamp(30, 220, nextHR),
      temperature:     clamp(32, 43,  nextTemp),
      respiratoryRate: clamp(6,  50,  nextRR),
      // Sin redondear: el paso por tick es de centesimas y Math.round lo
      // devolvia al valor de partida en cada iteracion, con lo que el GCS no
      // se movia nunca. El redondeo es cosa de quien lo presenta.
      gcs:             clamp(3,  15,  nextGCS),
      cardiacOutput:   clamp(1.5, 14, nextCO),
      svr:             clamp(300, 4000, nextSVR),
    });
  }

  /** Perfil fisiologico de cada crisis, escalado por severidad. */
  private targetFor(subtype: string | null, sev: number): CrisisTarget {
    switch (subtype) {
      // Tirotoxicosis: estado hipermetabolico. Taquicardia extrema, fiebre,
      // gasto cardiaco alto con resistencias bajas — se parece a una sepsis en
      // el monitor, y de ahi que el sustituto 'sepsis' colara sin chirriar.
      case 'tormenta_tiroidea':
        return { hr: 85 * sev, temp: 3.6 * sev, co: 1 + 0.75 * sev,
                 svr: 1 - 0.38 * sev, rr: 12 * sev, gcs: -4 * sev };

      // Mixedema: el polo opuesto. Bradicardia, hipotermia, hipoventilacion
      // con retencion de CO2 y descenso del nivel de conciencia.
      case 'coma_mixedematoso':
        return { hr: -32 * sev, temp: -4.2 * sev, co: 1 - 0.42 * sev,
                 svr: 1 + 0.30 * sev, rr: -7 * sev, gcs: -8 * sev };

      // Cetoacidosis: taquipnea de Kussmaul y deshidratacion.
      case 'cetoacidosis':
        return { hr: 38 * sev, temp: -0.3 * sev, co: 1 - 0.18 * sev,
                 svr: 1 + 0.12 * sev, rr: 16 * sev, gcs: -3 * sev };

      // Hiperosmolar: deshidratacion mas profunda, sin la taquipnea acidotica.
      case 'hiperosmolar':
        return { hr: 32 * sev, temp: 0.4 * sev, co: 1 - 0.28 * sev,
                 svr: 1 + 0.20 * sev, rr: 5 * sev, gcs: -6 * sev };

      // Crisis suprarrenal: shock que no responde a vasopresores porque falta
      // el cortisol que permite al vaso responder a las catecolaminas.
      case 'crisis_suprarrenal':
        return { hr: 40 * sev, temp: 1.2 * sev, co: 1 - 0.10 * sev,
                 svr: 1 - 0.45 * sev, rr: 8 * sev, gcs: -4 * sev };

      default:
        return { hr: 0, temp: 0, co: 1, svr: 1, rr: 0, gcs: 0 };
    }
  }
}

function clamp(lo: number, hi: number, x: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export default EndocrineEngine;
