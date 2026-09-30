// tests/helpers/testSeed.ts
//
// Semilla unica para toda la suite.
//
// Vive aqui, y no en tests/setup.ts, porque hay dos momentos que tienen que
// sembrar y uno no puede importar del otro: el beforeEach global, y el
// resetEngines() del harness. Este ultimo llama a resetAllEngines(), que a su
// vez llama a resetRng() y siembra con Date.now() — comportamiento correcto en
// produccion, donde cada partida debe salir distinta, pero que machacaba la
// semilla que el beforeEach acababa de fijar, dejando la suite irreproducible.

import { seedAll } from '../../src/core/rng';

export const TEST_SEED = 20260101;

/** Deja los streams en el punto de partida fijo de la suite. */
export function seedForTests(): void {
  seedAll(TEST_SEED);
}
