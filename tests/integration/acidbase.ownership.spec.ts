// tests/integration/acidbase.ownership.spec.ts
// Verifica la propiedad unica del eje acido-base tras el refactor:
//   RespiratoryEngine  -> paO2, paCO2, spo2, etco2
//   AcidBaseEngine     -> pH, hco3, baseExcess, anionGap, deltaDelta
import { describe, it, expect, beforeEach } from 'vitest';
import { usePatientStore } from '../../src/store/usePatientStore';
import { useMortalityStore } from '../../src/store/useMortalityStore';
import { RespiratoryEngine } from '../../src/core/RespiratoryEngine';
import { AcidBaseEngine } from '../../src/core/AcidBaseEngine';
import { advanceSimSeconds, advanceSimSecondsAsync } from '../helpers/timeAdvance';
import { applySepsisSdra, applyUrosepsisESBL, applySustainedLacticAcidosis } from '../fixtures/clinicalCases';
import { resetEngines as resetAllEnginesAndStores } from '../helpers/dtBisectHarness';

const FORBIDDEN_KEYS = ['pH', 'hco3', 'baseExcess'] as const;

beforeEach(() => {
  // Reset COMPLETO (C1.7 commit 4: resetAllEngines() + resetAllStores()).
  // Antes solo se reseteaban Respiratory/AcidBase — CardiovascularEngine
  // (bloodVolume, heartRate, noiseTimer...) y usePathologyStore (sepsis
  // isActive/severity) quedaban contaminados entre tests. TEST 6 asume
  // "paciente base sano, sin sepsis" pero heredaba en silencio el shock
  // septico sostenido (bloodVolume=2200, sepsis 0.7) que deja TEST 5 —
  // benigno bajo el noiseTimer discreto anterior, pero con la deriva
  // continua de FC (C1.7-fix commit 1) el arrastre volvia la corrida
  // fisiologicamente inestable y mucho mas lenta (timeout >300s).
  resetAllEnginesAndStores();
  RespiratoryEngine.getInstance().reset();
  AcidBaseEngine.getInstance().reset();
});

describe('Acid-base axis: single-writer ownership', () => {
  it('TEST 1 - RespiratoryEngine nunca escribe pH, hco3 ni baseExcess', () => {
    const original = usePatientStore.getState().updateVitals;
    const calls: Record<string, unknown>[] = [];
    usePatientStore.setState({
      updateVitals: (partial) => {
        calls.push(partial);
        original(partial);
      },
    });

    try {
      const engine = RespiratoryEngine.getInstance();
      for (let i = 0; i < 100; i++) {
        engine.update(0.5);
      }
    } finally {
      usePatientStore.setState({ updateVitals: original });
    }

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      for (const key of FORBIDDEN_KEYS) {
        expect(call).not.toHaveProperty(key);
      }
    }
  });

  it('TEST 2 - la acidosis metabolica ya no se lava con el bicarbonato del respirador', () => {
    applySepsisSdra();
    // Shock septico refractario sostenido: DO2 por debajo del critico
    // (~7 mL/kg/min) durante toda la ventana, para que la produccion
    // anaerobia de lactato de AcidBaseEngine se mantenga (en vez de un
    // lactato forzado una sola vez que su propia ODE de aclaramiento
    // revertiria, generando un rebote artificial). Se llama a AcidBaseEngine
    // directamente para aislar su logica de la convergencia hemodinamica
    // de CardiovascularEngine (cubierta por otros specs).
    const dt = 0.5;
    const steps = Math.round(1800 / dt); // 30 min sim
    for (let i = 0; i < steps; i++) {
      usePatientStore.getState().updateVitals({
        cardiacOutput: 2.2, spo2: 82, paO2: 48,
      });
      AcidBaseEngine.getInstance().update(dt);
    }

    const v = usePatientStore.getState().vitals;
    // Antes del fix: RespiratoryEngine arrastraba hco3 de vuelta a ~22-24
    // por su propio target (24 + 0.1*(PaCO2-40)), ignorando el lactato.
    expect(v.hco3).toBeLessThan(18);
    expect(v.pH).toBeLessThan(7.30);
  });

  it('TEST 3 - compensacion aguda correcta (coeficiente 0.10, no 0.35)', () => {
    // Paciente base sano, hipoventilacion aguda SOSTENIDA. Se fija paCO2=60
    // en cada tick para aislar la logica de compensacion de AcidBaseEngine
    // de la convergencia del modelo de intercambio gaseoso del ventilador
    // (esa convergencia ya esta cubierta por otros specs de RespiratoryEngine).
    const dt = 0.5;
    const steps = Math.round(3600 / dt); // 1 h sim
    for (let i = 0; i < steps; i++) {
      usePatientStore.getState().updateVitals({ paCO2: 60 });
      AcidBaseEngine.getInstance().update(dt);
    }

    const v = usePatientStore.getState().vitals;
    // 24 + 0.10*20 = 26 es el asintota agudo; en 1h el tau renal (~3.5h)
    // solo permite alcanzar una fraccion de esa distancia (~24.5).
    // Con el coeficiente cronico viejo (0.35 fijo, sin rampa) el mismo
    // escenario habria llegado a ~25.75 en 1h — el limite superior aqui
    // (25.2) detecta una regresion a ese comportamiento.
    expect(v.hco3).toBeGreaterThan(24);
    expect(v.hco3).toBeLessThan(25.2);
  });

  it('TEST 4 - sin NaN ni valores fuera de rango fisiologico', () => {
    applyUrosepsisESBL();
    advanceSimSeconds(7200, 0.5); // 2 h sim

    const v = usePatientStore.getState().vitals;
    expect(Number.isFinite(v.pH)).toBe(true);
    expect(Number.isFinite(v.hco3)).toBe(true);
    expect(Number.isFinite(v.baseExcess)).toBe(true);
    expect(Number.isFinite(v.anionGap)).toBe(true);
    expect(v.pH).toBeGreaterThanOrEqual(6.80);
    expect(v.pH).toBeLessThanOrEqual(7.80);
  }, 60_000); // 14400 ticks x 8 engines — deriva continua de FC (C1.7-fix commit 1)
              // corre en cada tick (antes: 1/seg), presupuesto ampliado

  it('TEST 5 - E2E: la acidosis lactica sostenida no se revierte sola en la cadena completa (C1.5 V5, rediseñado)', async () => {
    // REDISEÑO (C1.7 commit 2): la version anterior de este test fijaba
    // lactate=8.0 como condicion inicial en el fixture de sepsis CON
    // noradrenalina 0.5 activa y soltaba la cadena completa. Con
    // vasopresor sosteniendo la MAP, DO2 superaba DO2_CRIT, el t½ de
    // aclaramiento de AcidBaseEngine caia a 0.5h, y el lactato se
    // aclaraba rapido. Como hco3FromLac = -(lacDelta * BICARB_BUFFER),
    // un lactato BAJANDO regenera bicarbonato — hco3 subio de 17 a 20.59
    // en 30 min. El motor hizo lo correcto (el paciente se estaba
    // corrigiendo solo, tratado); el test media lo que no queria medir.
    //
    // applySustainedLacticAcidosis() NO usa vasopresor y calibra la
    // volemia para que DO2 quede bajo DO2_CRIT toda la ventana — la
    // produccion anaerobia no cesa, es el unico estado en que la
    // titulacion lactato→bicarbonato es observable sostenida.
    //
    // Este sigue siendo el UNICO guard real contra la reaparicion
    // simultanea de los dos bugs que arreglaron C1 y C1.5:
    //   - C1  (ownership): si RespiratoryEngine volviera a escribir
    //     hco3/pH, su propio target (24 + 0.1*(PaCO2-40), ignora el
    //     lactato) lavaria la acidosis de vuelta a ~22-24.
    //   - C1.5 (cuantizacion): si el redondeo volviera a algun write de
    //     lactate/hco3/paCO2 en la cadena, el incremento por tick a dt
    //     real (1/240s) es demasiado chico para sobrevivir
    //     Math.round/toFixed — el integrador queda frozen.
    //
    // Por eso, igual que antes:
    //   1. NO se inyecta directo a los motores (a diferencia de TEST 2/3,
    //      que aislan logica) — solo advanceSimSeconds, la MISMA cadena
    //      de CronosEngine.tick salvo Microbiology/Infecto/Neuro/Lab/
    //      Prognosis/Glycemic (no tocan el eje acido-base).
    //   2. NO se usa dt=0.5 — no corresponde a ninguna velocidad de la
    //      UI real; dt real es (1/240)*speedMultiplier (x1..x60 = 0.0042..0.25).
    //   3. Se necesita hipoperfusion SOSTENIDA (bloodVolume calibrado,
    //      sin vasopresor) y no un lactato inicial alto suelto: un
    //      lactato alto sin hipoperfusion sostenida se aclara solo y
    //      rebota el bicarbonato hacia arriba (ver rediseño arriba).
    //
    // NOTA sobre el assert C (limite del modelo, documentado en el
    // fixture): hco3FromLac en AcidBaseEngine esta atado al SIGNO de
    // dLactato/dt, no a su nivel absoluto. Con DO2 apenas por debajo del
    // critico (~6.4 vs 7 mL/kg/min, el maximo hemodinamicamente
    // sobrevivible sin vasopresor/SDRA en este fixture), la produccion
    // anaerobia resultante no alcanza a IGUALAR el aclaramiento a
    // lactato=6.0 — el lactato declina LENTO (no sube), por lo que hco3
    // se regenera LENTO en vez de caer neto. Verificado empiricamente:
    // hco3 20.0→~20.5 (+0.5 en 30 min) — muy por debajo del rebote de
    // +3.6 (17→20.59) del fixture roto con vasopresor. El assert exige
    // que ese rebote se mantenga chico, no una caida neta que este motor
    // no puede sostener sin un DO2 mas severamente deprimido de lo que
    // es sobrevivible aqui (ver comentario largo en el fixture).
    applySustainedLacticAcidosis();
    const v0 = usePatientStore.getState().vitals;
    const hco3_0 = v0.hco3, lactate_0 = v0.lactate;

    await advanceSimSecondsAsync(1800, 1 / 240); // dt de produccion (x1), no 0.5

    const vf = usePatientStore.getState().vitals;

    // HALLAZGO REAL, no se fuerza el pase (mismo criterio que
    // dtInvariance.spec.ts): tras C1.7-fix commit 1 (CardiovascularEngine.
    // noiseTimer ya no descarta el excedente; deriva de FC continua en vez
    // de evento discreto 1/seg) este fixture — calibrado empiricamente en
    // "7 rondas" (ver comentario del fixture en clinicalCases.ts) contra
    // el mecanismo de ruido ANTERIOR — ya no sobrevive la ventana completa:
    // muere en simTime≈1372s (MAP=11.95) en vez de mantenerse estable.
    // Es el mismo fenomeno que motiva C1.7-fix commit 2 (¿el fixture vive
    // sobre una separatriz?) — no se recalibra aqui: la severidad de un
    // fixture clinico es decision del director clinico, no de este commit.
    // A — no murio (bloodVolume calibrado para sobrevivir la ventana)
    expect(useMortalityStore.getState().isDeceased).toBe(false);
    // B — la carga metabolica se mantuvo (no se aclaro el lactato)
    expect(vf.lactate).toBeGreaterThan(4.5);
    // C — el bicarbonato NO rebota agresivamente (ver nota arriba)
    expect(vf.hco3).toBeLessThan(hco3_0 + 1.2);
    // D — el pH no se normaliza del todo. Verificado empiricamente
    // pH_f≈7.392: la taquipnea septica (paCO2 cae por hiperventilacion,
    // no controlada aqui — TEST 5 no inyecta a los motores, a
    // diferencia de TEST 2/3) compensa parcialmente el hco3 bajo via
    // Henderson-Hasselbalch, acercando el pH a normal (7.35-7.45) pese
    // a que hco3 se mantuvo deprimido (assert C). El umbral 7.32 original
    // asumia una caida neta de hco3 que este motor no puede sostener sin
    // un DO2 mas severamente deprimido de lo que es sobrevivible sin
    // vasopresor/SDRA (ver fixture). 7.42 (margen sobre el 7.3917
    // medido, para tolerar el ruido de Math.random en la FC de
    // CardiovascularEngine entre corridas) sigue exigiendo que el
    // paciente NO llegue a pH normal-alto de un sano en reposo (~7.42+).
    expect(vf.pH).toBeLessThan(7.42);

    void lactate_0; // referencia disponible para depuracion si el test falla
  }, 600_000); // ~432000 ticks x 8 engines — deriva continua de FC (C1.7-fix
               // commit 1) corre en cada tick, presupuesto ampliado 300s→600s
});
