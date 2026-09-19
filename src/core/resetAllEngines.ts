// src/core/resetAllEngines.ts
//
// C1.7 commit 4 — reset centralizado de TODOS los singletons de motor.
//
// Los singletons de src/core/ arrastran estado de instancia entre corridas
// (auditoría completa en el reporte de C1.7 commit 4). Antes de este
// archivo, useScenarioStore.ts y los tests llamaban reset() a mano en un
// subconjunto de motores — cualquier motor nuevo, o cualquiera que un
// desarrollador olvidara, quedaba arrastrando estado del caso/corrida
// anterior. Esta función es la única fuente de verdad: agregar un motor
// aquí es obligatorio si tiene reset().
//
// Orden: no importa para la correctitud (cada reset() solo toca su propio
// estado privado), pero se preserva el orden del tick de CronosEngine.ts
// por legibilidad.

import { MicrobiologyEngine } from './MicrobiologyEngine';
import { InfectoEngine } from './InfectoEngine';
import { PathologyEngine } from './PathologyEngine';
import { PharmacologyEngine } from './PharmacologyEngine';
import { RenalEngine } from './RenalEngine';
import { RespiratoryEngine } from './RespiratoryEngine';
import { CardiovascularEngine } from './CardiovascularEngine';
import { AcidBaseEngine } from './AcidBaseEngine';
import { NeuroEngine } from './NeuroEngine';
import { LabEngine } from './LabEngine';
import { PrognosisEngine } from './PrognosisEngine';
import { GlycemicEngine } from './GlycemicEngine';
import { CrosstalkEngine } from './CrosstalkEngine';
import { AcuteMortalityEngine } from './AcuteMortalityEngine';
import { ImagingEngine } from './ImagingEngine';
import { CronosEngine } from './CronosEngine';
import { resetRng } from './rng';

export function resetAllEngines(): void {
  // C1.9 commit 2 — re-siembra los streams de RNG con un valor no
  // determinista por defecto. El llamador (test via installSeededRandom(),
  // o produccion via useScenarioStore.applyScenario()) debe sembrar
  // explicitamente despues si necesita reproducibilidad — ver src/core/rng.ts.
  resetRng();
  MicrobiologyEngine.getInstance().reset();
  InfectoEngine.getInstance().reset();
  PathologyEngine.getInstance().reset();
  PharmacologyEngine.getInstance().reset();
  RenalEngine.getInstance().reset();
  RespiratoryEngine.getInstance().reset(); // cascada: VentilatorSM100Engine.reset()
  CardiovascularEngine.getInstance().reset();
  AcidBaseEngine.getInstance().reset();
  NeuroEngine.getInstance().reset();
  LabEngine.getInstance().reset();
  PrognosisEngine.getInstance().reset();
  GlycemicEngine.getInstance().reset();
  CrosstalkEngine.getInstance().reset();
  AcuteMortalityEngine.getInstance().reset();
  ImagingEngine.getInstance().reset();
  CronosEngine.getInstance().reset();
}
