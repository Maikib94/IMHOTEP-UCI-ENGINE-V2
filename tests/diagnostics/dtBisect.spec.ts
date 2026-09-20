// tests/diagnostics/dtBisect.spec.ts
//
// C1.7 commit 5 — RE-biseccion de la no-invarianza temporal, ahora bajo un
// harness con determinismo probado bit-a-bit (C1.7 commit 4,
// tests/diagnostics/determinism.spec.ts: identidad EXACTA en 601 muestras x
// 11 campos entre dos corridas identicas). GRAVEDAD MAXIMA: el mismo
// escenario septico MUERE a dt=1/240 (x1) y SOBREVIVE a dt=0.25 (x60) en
// corridas mas largas. Este archivo LOCALIZA la causa — NO la corrige (la
// propuesta de fix va por escrito en el reporte de C1.7 commit 5).
//
// CAMBIO DE RAIZ RESPECTO DE C1.7 commit 3: la version anterior de este
// archivo reseteaba solo 4 de ~16 motores singleton entre corridas
// (RespiratoryEngine, AcidBaseEngine, PharmacologyEngine,
// AcuteMortalityEngine) y usaba una copia local ligeramente distinta del
// reset de stores. Eso es exactamente la clase de confound que C1.7
// commit 4 elimino: ahora resetEngines() (importado de
// tests/helpers/dtBisectHarness.ts) llama resetAllEngines() +
// resetAllStores() — la MISMA funcion que ya demostro dar identidad
// bit-exacta. Los hallazgos de C1.7 commit 3 (hipotesis del VentilatorSM100
// PHYS_HZ, H1-H5) se re-evaluan aqui bajo esta garantia — ver veredicto
// CONFIRMA/ATENUA/DESAPARECE en el reporte.
//
// Paso 5a: serie temporal (muestreada cada 1s simulado) de bloodVolume,
// strokeVolume, cardiacOutput, meanArterialPressure, urineOutput,
// heartRate, svr, cvp, lactate, hco3, pH — comparando dt=1/240 vs dt=0.25
// sobre el MISMO escenario (cadena completa), reportando el primer instante
// en que cada campo supera 1% de divergencia relativa.
//
// Paso 5a (biseccion): repite la comparacion activando subconjuntos
// incrementales de motores para localizar en cual aparece la divergencia.

import { describe, it, expect } from 'vitest';
import { applySepsisSdra } from '../fixtures/clinicalCases';
import {
  runSampled, firstDivergence, SAMPLE_FIELDS,
  type EngineName,
} from '../helpers/dtBisectHarness';

const SEED = 1337;

describe('C1.7 commit 5 — RE-biseccion de la no-invarianza de dt (harness deterministico, diagnostico, no corrige)', () => {
  it('5a — serie temporal cadena completa: primer instante de divergencia por campo (600s)', () => {
    const fullChain: EngineName[] = ['pathology', 'pharmacology', 'renal', 'respiratory', 'cardiovascular', 'acidbase', 'crosstalk', 'mortality'];
    const fine   = runSampled(1 / 240, 600, fullChain, applySepsisSdra, SEED);
    const coarse = runSampled(0.25,    600, fullChain, applySepsisSdra, SEED);

    const divergence = firstDivergence(fine, coarse);
    const ranked = SAMPLE_FIELDS
      .map(f => ({ campo: f, primerT: divergence[f] }))
      .filter(r => r.primerT !== null)
      .sort((a, b) => (a.primerT! - b.primerT!));

    console.log('=== 5a: primer instante de divergencia >1% por campo (orden cronologico) ===');
    console.table(ranked);

    console.log('=== 5a: primeras 20 muestras — fine (dt=1/240) ===');
    console.table(fine.slice(0, 20));
    console.log('=== 5a: primeras 20 muestras — coarse (dt=0.25) ===');
    console.table(coarse.slice(0, 20));

    expect(ranked.length).toBeGreaterThanOrEqual(0); // diagnostico puro
  }, 300_000);

  it.each([
    { label: '(1) solo Cardiovascular', engines: ['cardiovascular'] as EngineName[] },
    { label: '(2) +Renal', engines: ['renal', 'cardiovascular'] as EngineName[] },
    { label: '(3) +Respiratory', engines: ['renal', 'respiratory', 'cardiovascular'] as EngineName[] },
    { label: '(4) +AcidBase', engines: ['renal', 'respiratory', 'cardiovascular', 'acidbase'] as EngineName[] },
    { label: '(5) +Pharmacology', engines: ['pharmacology', 'renal', 'respiratory', 'cardiovascular', 'acidbase'] as EngineName[] },
    { label: '(6) cadena completa', engines: ['pathology', 'pharmacology', 'renal', 'respiratory', 'cardiovascular', 'acidbase', 'crosstalk', 'mortality'] as EngineName[] },
  ])('5a biseccion por motor: $label (300s)', ({ label, engines }) => {
    const fine   = runSampled(1 / 240, 300, engines, applySepsisSdra, SEED);
    const coarse = runSampled(0.25,    300, engines, applySepsisSdra, SEED);
    const divergence = firstDivergence(fine, coarse);
    const ranked = SAMPLE_FIELDS
      .map(f => ({ campo: f, primerT: divergence[f] }))
      .filter(r => r.primerT !== null)
      .sort((a, b) => (a.primerT! - b.primerT!));

    console.log(`=== 5a ${label}: campos que divergen >1% en 300s (subconjunto: ${engines.join(',')}) ===`);
    if (ranked.length === 0) {
      console.log('  (sin divergencia >1% detectada en esta ventana/subconjunto)');
    } else {
      console.table(ranked);
    }

    expect(ranked.length).toBeGreaterThanOrEqual(0); // diagnostico puro
  }, 300_000);
});
