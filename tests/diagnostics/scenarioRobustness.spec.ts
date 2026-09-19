// tests/diagnostics/scenarioRobustness.spec.ts
//
// C1.7-fix commit 2 — ¿viven los escenarios sobre una separatriz?
//
// MOTIVO: en commit 1 se corrigio un sesgo SISTEMATICO del ~0.42% en
// CardiovascularEngine.noiseTimer que por si solo volteaba muerte vs
// supervivencia en un escenario severo. El fix hace que dos corridas
// CON LA MISMA semilla y el mismo dt converjan — pero NO garantiza que
// el desenlace sea estable frente a perturbaciones minimas (semilla de
// RNG distinta, o una diferencia de volemia inicial del orden del error
// de medicion clinico real). Si un escenario vive sobre una separatriz,
// cualquier cambio futuro al motor puede voltear su desenlace, y dos
// alumnos con el mismo manejo clinico podrian terminar con resultados
// opuestos — un problema de DISEÑO del escenario, no de los motores.
//
// REDUCCION DE ALCANCE (documentada, decidida con el usuario ante
// inviabilidad de computo): el barrido completo (92 escenarios x 12
// corridas x 1800s) se proyecta en decenas de horas — una sola corrida
// de 600s de un escenario neurocritico (ich_brainstem) ya supero 120s
// sin terminar. Se reduce a 300s por corrida y 6 corridas por escenario
// (3 semilla + 3 volemia, en vez de 6+6), manteniendo el catalogo
// COMPLETO (92/92 escenarios, no una muestra) — prioriza cobertura total
// del catalogo sobre profundidad por escenario. La clasificacion
// ESTABLE/FRAGIL/SEPARATRIZ se reescala proporcionalmente a N=6.
//
// NO SE CORRIGE NINGUN ESCENARIO AQUI. Entregable = diagnostico.
//
// RESULTADO DE LA CORRIDA REAL (107 escenarios, 41.8h de computo total):
// 0 FRAGIL, 0 SEPARATRIZ, 107 ESTABLE — PERO este resultado es debil, no
// una confirmacion de robustez: NINGUNO de los 107 escenarios murio en
// NINGUNA de sus 6 corridas dentro de los 300s. La clasificacion por
// desenlace de mortalidad nunca tuvo un desenlace terminal que comparar
// — no discrimino nada. Commit 1 ya probo (dtInvariance.spec.ts) que
// applySepsisSdra SI diverge en desenlace a 1800s (muere a t=1372s en la
// corrida fina, sobrevive en las otras dos) — la ventana de 300s de este
// barrido es demasiado corta para capturar ese tipo de divergencia
// tardia. La pregunta real de separatriz queda ABIERTA para ventanas
// clinicamente completas (900-1800s); ver reporte para el ranking por
// dispersion de MAP (señal secundaria, unica disponible en esta corrida)
// y la propuesta escrita de como completar el barrido.
//
// ACTUALIZACION C1.9 commit 3 (separatrixDiscriminant.spec.ts): para
// applySepsisSdra especificamente la pregunta YA NO esta abierta —
// CORREGIDA. NO es separatriz (robusto 8/8 a semilla, 6/6 a volemia a dt
// fijo); es una dependencia de dt residual real. Sigue abierta para el
// resto del catalogo (este archivo no probo ningun otro fixture con
// desenlace terminal).
//
// HALLAZGO NO ANTICIPADO: 5 de 107 escenarios (ich_brainstem,
// refractory_metabolic_acidosis, trauma_tce_abdomen_pelvis,
// trauma_fulminante_clase3, burn_fuego_40pct) tardaron entre 12 minutos y
// >14 HORAS cada uno (vs ~150-300s del resto) — vitest los marco como
// timeout (su propio watchdog no puede interrumpir un loop sincronico de
// JS), pero terminaron y sus resultados SI se registraron (6/6 vivos).
// Causa no investigada — fuera de alcance de este commit (diagnostico de
// robustez de escenarios, no de rendimiento del motor).

import { describe, it, expect } from 'vitest';
import { ALL_SCENARIOS } from '../../src/scenarios/index';
import type { ScenarioDefinition } from '../../src/store/useScenarioStore';
import { usePatientStore } from '../../src/store/usePatientStore';
import { usePathologyStore } from '../../src/store/usePathologyStore';
import { useMortalityStore } from '../../src/store/useMortalityStore';
import { resetEngines, tickSubset, FULL_CHAIN } from '../helpers/dtBisectHarness';
import { installSeededRandom, restoreRandom } from '../helpers/seededRandom';

const DT = 1 / 240;
const DURATION_S = 300; // reducido de 1800s — ver nota de alcance arriba
const SEEDS = [1337, 2024, 42];               // 3 corridas "solo semilla"
const BV_PERTURB_PCT = [-1.0, -0.5, 1.0];     // 3 corridas "solo volemia" (%)
const BASE_SEED = 777; // semilla fija para el grupo de perturbacion de volemia

interface RunResult {
  kind: 'seed' | 'bloodVolume';
  label: string;
  isDeceased: boolean;
  deathCause: string | null;
  deathTime: number | null;
  finalMAP: number;
  finalLactate: number;
  finalUrineOutput: number;
}

interface ScenarioResult {
  id: string;
  runs: RunResult[];
  aliveCount: number;
  deadCount: number;
  classification: 'ESTABLE' | 'FRAGIL' | 'SEPARATRIZ';
  mapDispersion: number; // max-min de MAP final entre las 6 corridas
  modalDeathCause: string | null;
  seedGroupSplit: string;  // ej "2 vivos / 1 muerto"
  bvGroupSplit: string;
}

function applyScenarioDef(scenario: ScenarioDefinition, bvOverrideMl?: number): void {
  const patient = usePatientStore.getState();
  const pathology = usePathologyStore.getState();
  patient.setBloodVolume(bvOverrideMl ?? scenario.initialBloodVolumeMl ?? 5000);
  if (scenario.initialVitals && Object.keys(scenario.initialVitals).length > 0) {
    patient.updateVitals(scenario.initialVitals);
  }
  patient.setVentilatorConnected(scenario.isVentilatorConnected ?? false);
  if (scenario.ventilatorPreset) patient.setVentilatorSettings(scenario.ventilatorPreset);
  for (const cfg of scenario.pathologyConfigs ?? []) {
    pathology.activatePathology(cfg.domain, cfg.subtype, cfg.baseSeverity);
  }
  if (scenario.initialModifiers) {
    const NEUTRAL = { svrMultiplier: 1.0, capillaryLeakRate: 0, hyperdynamicFactor: 1.0, lungShuntFraction: 0.05, complianceMultiplier: 1.0 };
    pathology.updateModifiers({ ...NEUTRAL, ...scenario.initialModifiers });
  }
}

function runOnce(scenario: ScenarioDefinition, seed: number, bvOverrideMl: number | undefined, kind: 'seed' | 'bloodVolume', label: string): RunResult {
  resetEngines();
  installSeededRandom(seed);
  try {
    applyScenarioDef(scenario, bvOverrideMl);
    const steps = Math.round(DURATION_S / DT);
    for (let i = 0; i < steps; i++) {
      tickSubset(DT, FULL_CHAIN);
      if (useMortalityStore.getState().isDeceased) break; // no seguir tras la muerte
    }
  } finally {
    restoreRandom();
  }
  const mortality = useMortalityStore.getState();
  const v = usePatientStore.getState().vitals;
  return {
    kind, label,
    isDeceased: mortality.isDeceased,
    deathCause: mortality.deathCause ?? null,
    deathTime: mortality.deathTime ?? null,
    finalMAP: v.meanArterialPressure,
    finalLactate: v.lactate,
    finalUrineOutput: v.urineOutput,
  };
}

const allResults: ScenarioResult[] = [];

describe('C1.7-fix commit 2 — robustez de escenarios (¿separatriz?)', () => {
  it.each(ALL_SCENARIOS.map(s => ({ scenario: s })))(
    'robustez: $scenario.id',
    ({ scenario }) => {
      const baseBV = scenario.initialBloodVolumeMl ?? 5000;
      const runs: RunResult[] = [];

      for (const seed of SEEDS) {
        runs.push(runOnce(scenario, seed, undefined, 'seed', `seed=${seed}`));
      }
      for (const pct of BV_PERTURB_PCT) {
        const bv = baseBV * (1 + pct / 100);
        runs.push(runOnce(scenario, BASE_SEED, bv, 'bloodVolume', `bv${pct >= 0 ? '+' : ''}${pct}%`));
      }

      const aliveCount = runs.filter(r => !r.isDeceased).length;
      const deadCount = runs.length - aliveCount;
      const n = runs.length; // 6

      let classification: ScenarioResult['classification'];
      if (aliveCount === n || deadCount === n) classification = 'ESTABLE';
      else if (aliveCount === n - 1 || deadCount === n - 1) classification = 'FRAGIL';
      else classification = 'SEPARATRIZ';

      const maps = runs.map(r => r.finalMAP);
      const mapDispersion = Math.max(...maps) - Math.min(...maps);

      const causeCounts = new Map<string, number>();
      for (const r of runs) {
        if (r.deathCause) causeCounts.set(r.deathCause, (causeCounts.get(r.deathCause) ?? 0) + 1);
      }
      let modalDeathCause: string | null = null;
      let modalCount = 0;
      for (const [cause, count] of causeCounts) {
        if (count > modalCount) { modalCount = count; modalDeathCause = cause; }
      }

      const seedRuns = runs.filter(r => r.kind === 'seed');
      const bvRuns = runs.filter(r => r.kind === 'bloodVolume');
      const seedAlive = seedRuns.filter(r => !r.isDeceased).length;
      const bvAlive = bvRuns.filter(r => !r.isDeceased).length;

      allResults.push({
        id: scenario.id,
        runs,
        aliveCount, deadCount, classification, mapDispersion, modalDeathCause,
        seedGroupSplit: `${seedAlive} vivos / ${seedRuns.length - seedAlive} muertos`,
        bvGroupSplit: `${bvAlive} vivos / ${bvRuns.length - bvAlive} muertos`,
      });

      // Diagnostico puro — no se espera que todos los escenarios sean ESTABLE.
      expect(classification).toBeDefined();
    },
    600_000,
  );

  it('REPORTE FINAL — tabla de robustez por escenario', () => {
    const bySeverityDesc = [...allResults].sort((a, b) => {
      const order = { SEPARATRIZ: 0, FRAGIL: 1, ESTABLE: 2 };
      return order[a.classification] - order[b.classification] || b.mapDispersion - a.mapDispersion;
    });

    console.log(`\n=== C1.7-fix commit 2 — ROBUSTEZ POR ESCENARIO (${allResults.length}/${ALL_SCENARIOS.length} escenarios, N=6 corridas c/u, orden por fragilidad) ===`);
    console.table(bySeverityDesc.map(r => ({
      escenario: r.id,
      'vivos/6': r.aliveCount,
      'muertos/6': r.deadCount,
      clasificacion: r.classification,
      'dispersion MAP final': r.mapDispersion.toFixed(1),
      'causa muerte modal': r.modalDeathCause ?? '-',
    })));

    const separatriz = bySeverityDesc.filter(r => r.classification === 'SEPARATRIZ');
    if (separatriz.length > 0) {
      console.log(`\n=== SEPARATRIZ (${separatriz.length}) — desglose semilla vs volemia ===`);
      console.table(separatriz.map(r => ({
        escenario: r.id,
        'grupo semilla (3)': r.seedGroupSplit,
        'grupo volemia (3)': r.bvGroupSplit,
      })));
    }

    const summary = {
      total: allResults.length,
      ESTABLE: allResults.filter(r => r.classification === 'ESTABLE').length,
      FRAGIL: allResults.filter(r => r.classification === 'FRAGIL').length,
      SEPARATRIZ: allResults.filter(r => r.classification === 'SEPARATRIZ').length,
    };
    console.log('\n=== RESUMEN ===', JSON.stringify(summary));

    expect(allResults.length).toBeGreaterThan(0);
  }, 30_000);
});
