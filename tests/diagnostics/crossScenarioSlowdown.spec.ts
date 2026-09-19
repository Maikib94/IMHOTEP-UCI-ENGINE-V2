// tests/diagnostics/crossScenarioSlowdown.spec.ts
//
// C1.9 commit 4 — ich_brainstem aislado (300s) y repetido 6x consecutivas
// (tests/diagnostics/repeatedRunSlowdown.spec.ts) NO reproducen la
// anomalia — ambos ~36-49s por corrida, normal. Solo aparece dentro del
// barrido completo de 107 escenarios (b5990e6), donde ich_brainstem es
// la corrida ~16 en la secuencia. Hipotesis restante: el efecto requiere
// haber corrido VARIOS escenarios DISTINTOS antes (no repeticiones del
// mismo) dentro del MISMO proceso — replica los primeros ~16 escenarios
// del barrido real, en el MISMO orden, y mide cada uno.

import { describe, it } from 'vitest';
import { ALL_SCENARIOS } from '../../src/scenarios/index';
import type { ScenarioDefinition } from '../../src/store/useScenarioStore';
import { usePatientStore } from '../../src/store/usePatientStore';
import { usePathologyStore } from '../../src/store/usePathologyStore';
import { resetEngines, tickSubset, FULL_CHAIN } from '../helpers/dtBisectHarness';
import { installSeededRandom, restoreRandom } from '../helpers/seededRandom';

function applyScenarioDef(scenario: ScenarioDefinition): void {
  const patient = usePatientStore.getState();
  const pathology = usePathologyStore.getState();
  patient.setBloodVolume(scenario.initialBloodVolumeMl ?? 5000);
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
  scenario: ScenarioDefinition, seed: number, durationS: number, dt: number, wallBudgetMs: number,
): { ms: number; simSReached: number; aborted: boolean } {
  const t0 = Date.now();
  resetEngines();
  installSeededRandom(seed);
  let simSReached = 0;
  let aborted = false;
  try {
    applyScenarioDef(scenario);
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

describe('C1.9 commit 4 — ¿requiere una secuencia de VARIOS escenarios distintos antes?', () => {
  it('primeros 17 escenarios del catalogo, mismo orden que el barrido real, 1 corrida c/u (60s sim)', () => {
    const targets = ALL_SCENARIOS.slice(0, 17);
    const timings: Array<{ escenario: string; ms: number; simSReached: number; aborted: boolean }> = [];
    for (const scenario of targets) {
      const result = runOnce(scenario, 1337, 60, 1 / 240, 60_000);
      timings.push({ escenario: scenario.id, ...result });
      console.log(`  [${scenario.id}] ${result.ms}ms — simS=${result.simSReached.toFixed(1)} ${result.aborted ? '(ABORTADO)' : '(completo)'}`);
    }
    console.log('\n=== Secuencia de 17 escenarios distintos — tiempo por escenario ===');
    console.table(timings);
  }, 1_800_000);
});
