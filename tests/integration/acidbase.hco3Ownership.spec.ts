// tests/integration/acidbase.hco3Ownership.spec.ts
// TEST 6 del eje acido-base, extraido de acidbase.ownership.spec.ts.
//
// Vive en su propio archivo por presupuesto de reloj, no por tema: TEST 5 y
// TEST 6 corren ~110 s cada uno y vitest solo paraleliza ENTRE archivos,
// nunca dentro de uno. Juntos serializaban ~230 s y marcaban la ruta critica
// de `npm test`; separados corren a la vez. El beforeEach resetea motores y
// stores por completo, asi que ambos ya eran independientes.
import { describe, it, expect, beforeEach } from 'vitest';
import { usePatientStore } from '../../src/store/usePatientStore';
import { RespiratoryEngine } from '../../src/core/RespiratoryEngine';
import { AcidBaseEngine } from '../../src/core/AcidBaseEngine';
import { advanceSimSecondsAsync } from '../helpers/timeAdvance';
import { resetEngines as resetAllEnginesAndStores } from '../helpers/dtBisectHarness';

beforeEach(() => {
  resetAllEnginesAndStores();
  RespiratoryEngine.getInstance().reset();
  AcidBaseEngine.getInstance().reset();
});

describe('Acid-base axis: hco3 single-writer ownership', () => {
  it('TEST 6 - ownership puro: solo AcidBaseEngine mueve hco3 en la cadena completa (C1.5 V5, complemento)', async () => {
    // A diferencia de TEST 5 (que depende de la cinetica de lactato),
    // este test aisla la propiedad que arreglo C1 (un solo motor escribe
    // hco3) sin depender de shock ni de la ODE de lactato: paciente base
    // sano, sin sepsis, lactato en baseline (~1.0, sin drift relevante).
    //
    // Con ownership correcto, el UNICO motor que mueve hco3 es
    // AcidBaseEngine. Con paCO2≈40 (normal), paCO2Delta≈0, por lo que
    // renalTgt ≈ HCO3_NORMAL (24) independientemente del coeficiente
    // agudo/cronico — tirando hco3 desde 14 hacia 24 con kRenal=8e-5:
    //   hco3_esperado = 14 + (24-14)*(1 - exp(-1800*8e-5)) ≈ 15.3
    //
    // Es discriminante: si RespiratoryEngine volviera a escribir hco3
    // (regresion de C1), su propio target viejo (24 + 0.1*(PaCO2-40))
    // coincidia aproximadamente con el de AcidBaseEngine en paCO2 normal,
    // pero AMBOS integradores sumarian su delta cada tick sobre el MISMO
    // campo — el doble conteo empuja hco3 por encima de lo que un unico
    // motor puede alcanzar en la misma ventana. El limite superior (15.7)
    // detecta ese doble escritor.
    usePatientStore.getState().updateVitals({ hco3: 14, paCO2: 40, lactate: 1.0 });
    await advanceSimSecondsAsync(1800, 1 / 240);

    const v = usePatientStore.getState().vitals;
    expect(v.hco3).toBeGreaterThan(15.0);
    expect(v.hco3).toBeLessThan(15.7);
  }, 600_000); // presupuesto ampliado — ver nota de TEST 5
});
