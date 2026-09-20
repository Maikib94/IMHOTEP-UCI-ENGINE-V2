// tests/diagnostics/repeatedRunSlowdown.spec.ts
//
// C1.9 commit 4 — hallazgo: un unico run aislado de ich_brainstem/
// dka_severe (300s sim, tests/diagnostics/slowScenarioProfile.spec.ts) NO
// reproduce la anomalia — ambos corren en ~46-49s wall-clock, identico.
// Pero el barrido original (b5990e6) hace 6 corridas CONSECUTIVAS del
// MISMO escenario dentro del MISMO it() (3 semilla + 3 volemia) — hipotesis:
// el efecto es ACUMULATIVO entre corridas dentro del mismo proceso, no
// inherente a la fisiologia del escenario. Este archivo mide el tiempo de
// CADA una de 6 corridas consecutivas de 300s (misma secuencia que el
// barrido real) para ver si una corrida LATER en la secuencia se vuelve
// anomalamente lenta.

import { describe, it } from 'vitest';
import { ALL_SCENARIOS } from '../../src/scenarios/index';
import type { ScenarioDefinition } from '../../src/store/useScenarioStore';
import { usePatientStore } from '../../src/store/usePatientStore';
import { usePathologyStore } from '../../src/store/usePathologyStore';
import { resetEngines, tickSubset, FULL_CHAIN } from '../helpers/dtBisectHarness';
import { installSeededRandom, restoreRandom } from '../helpers/seededRandom';

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
}

function runOnce(
  scenario: ScenarioDefinition, seed: number, bvOverrideMl: number | undefined,
  durationS: number, dt: number, wallBudgetMs: number,
): { ms: number; simSReached: number; aborted: boolean } {
  const t0 = Date.now();
  resetEngines();
  installSeededRandom(seed);
  let simSReached = 0;
  let aborted = false;
  try {
    applyScenarioDef(scenario, bvOverrideMl);
    const steps = Math.round(durationS / dt);
    for (let i = 0; i < steps; i++) {
      tickSubset(dt, FULL_CHAIN);
      simSReached = (i + 1) * dt;
      if ((i & 0x3ff) === 0 && Date.now() - t0 > wallBudgetMs) {
        aborted = true;
        break;
      }
    }
  } finally {
    restoreRandom();
  }
  return { ms: Date.now() - t0, simSReached, aborted };
}

describe('C1.9 commit 4 — ¿el efecto es acumulativo entre corridas repetidas?', () => {
  it('ich_brainstem — 6 corridas consecutivas de 300s (misma secuencia que el barrido real)', () => {
    const scenario = ALL_SCENARIOS.find(s => s.id === 'ich_brainstem')!;
    const baseBV = scenario.initialBloodVolumeMl ?? 5000;
    const runs = [
      { label: 'seed=1337', seed: 1337, bv: undefined },
      { label: 'seed=2024', seed: 2024, bv: undefined },
      { label: 'seed=42',   seed: 42,   bv: undefined },
      { label: 'bv-1%',     seed: 777,  bv: baseBV * 0.99 },
      { label: 'bv-0.5%',   seed: 777,  bv: baseBV * 0.995 },
      { label: 'bv+1%',     seed: 777,  bv: baseBV * 1.01 },
    ];
    const timings: Array<{ corrida: string; ms: number; simSReached: number; aborted: boolean }> = [];
    for (const r of runs) {
      const result = runOnce(scenario, r.seed, r.bv, 300, 1 / 240, 90_000);
      timings.push({ corrida: r.label, ...result });
      console.log(`  [${r.label}] ${result.ms}ms — simS=${result.simSReached.toFixed(1)} ${result.aborted ? '(ABORTADO)' : '(completo)'}`);
    }
    console.log('\n=== ich_brainstem — 6 corridas consecutivas, tiempo por corrida ===');
    console.table(timings);
  }, 900_000);
});
