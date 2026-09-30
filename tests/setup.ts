// tests/setup.ts
import '@testing-library/jest-dom/vitest';
import { beforeEach } from 'vitest';
import { mockOffscreenCanvas } from './helpers/mockOffscreenCanvas';
import { resetAllStores }      from './helpers/storeReset';
import { seedAll }             from '../src/core/rng';

mockOffscreenCanvas();

/**
 * Semilla fija para toda la suite.
 *
 * rng.ts arranca con `createGenerators(Date.now())` y resetRng() vuelve a
 * sembrar con Date.now(), a proposito: en produccion cada partida debe salir
 * distinta. El contrato que documenta ese modulo es que "el llamador (test o
 * produccion) debe invocar seedAll() explicitamente si necesita
 * reproducibilidad" — y aqui nadie lo invocaba.
 *
 * El efecto era una suite irreproducible: cada corrida usaba una semilla
 * distinta, el ruido de FC que CardiovascularEngine saca del stream
 * 'cardioNoise' cambiaba con ella, y los fixtures calibrados al filo caian a
 * un lado o a otro. Medido sobre acidbase.ownership TEST 5: cuatro corridas
 * identicas, mismo commit y mismo arbol, dieron 1 fallo y 3 pases. Un test que
 * falla una de cada cuatro veces no informa de nada y enseña a ignorar los
 * fallos.
 *
 * Los tests que necesiten otra semilla siguen pudiendo llamar seedAll() con la
 * suya; este beforeEach solo garantiza el punto de partida.
 */
const TEST_SEED = 20260101;

beforeEach(() => {
  resetAllStores();
  seedAll(TEST_SEED);
});
