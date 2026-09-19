// tests/helpers/storeReset.ts
// Resets all Zustand stores to clean state between tests.

import { usePatientStore }      from '../../src/store/usePatientStore';
import { usePathologyStore }    from '../../src/store/usePathologyStore';
import { usePharmacologyStore } from '../../src/store/usePharmacologyStore';
import { useTimeStore }         from '../../src/store/useTimeStore';
import { useUIStore }           from '../../src/store/useUIStore';
import { useScenarioStore }     from '../../src/store/useScenarioStore';
import { useMonitoringStore }   from '../../src/store/useMonitoringStore';
import { useECMOStore }         from '../../src/store/useECMOStore';
import { useCRRTStore }         from '../../src/store/useCRRTStore';
import { useMicrobiologyStore } from '../../src/store/useMicrobiologyStore';
import { usePrognosisStore }    from '../../src/store/usePrognosisStore';
import { useManeuverHistoryStore } from '../../src/store/useManeuverHistoryStore';
import { useInvasiveNeuroStore }   from '../../src/store/useInvasiveNeuroStore';

export function resetAllStores(): void {
  // Time
  useTimeStore.getState().pause();
  useTimeStore.getState().reset();
  useTimeStore.getState().setSpeed(1);

  // Patient
  const pat = usePatientStore.getState();
  pat.resetFluidTracking();
  pat.setBloodVolume(5000);
  // Reset COMPLETO (los 31 campos de Vitals) — updateVitals() con un objeto
  // parcial dejaba cualquier campo no mencionado (strokeVolume, svr, gedi,
  // ardsActive, pplat...) con el valor de la corrida anterior. Este era el
  // origen real de la divergencia t=594-600s detectada en la prueba de
  // determinismo de C1.7 commit 4 — no un problema de los motores.
  pat.resetVitals();
  pat.setProcedure('arterialLine', false);
  pat.setProcedure('picMonitor', false);
  pat.setProcedure('ecmo', false);
  pat.setProcedure('crrt', false);
  pat.setProcedure('urinaryCatheter', true);
  pat.setVentilatorConnected(false);
  // C6 commit 1 — labOrders no se limpiaba entre tests (gap real de
  // aislamiento: ordenes 'urgente' pendientes de un test contaminaban el
  // conteo de saturacion del siguiente). instantResults/labTurnaroundFactor
  // tambien se reafirman por las dudas (defaults de produccion).
  pat.clearLabOrders();
  pat.setInstantResults(false);
  pat.setLabTurnaroundFactor(1.0);

  // Pathology
  const path = usePathologyStore.getState();
  path.resetAllPathologies();
  path.setCaseCategory('general');

  // Pharmacology
  usePharmacologyStore.getState().resetAll();

  // UI
  const ui = useUIStore.getState();
  ui.setPiccoPanelVisible(true);
  ui.setPiccoQuickParams(['ci', 'gedi', 'evlwi', 'svv']);
  ui.setDripUnitMode('medical');

  // Scenario — only reset state without triggering full async applyScenario
  useScenarioStore.setState({
    isSimulationStarted: false,
    activeScenario:      null,
    activePatient:       null,
    launchError:         null,
    scenarioStartSimS:   0,
  });

  // Monitoring
  useMonitoringStore.getState().clearMonitoring();
  useMonitoringStore.getState().setInvasiveMode('none');

  // ECMO / CRRT
  useECMOStore.getState().resetECMO();
  useCRRTStore.getState().resetCRRT();

  // Microbiology / Prognosis / maniobras / neuro invasivo — motores singleton
  // sólo resetean su estado privado (resetAllEngines()); los datos viven en
  // estos stores y deben limpiarse aparte (C1.7 commit 4).
  useMicrobiologyStore.getState().resetMicrobiology();
  usePrognosisStore.getState().reset();
  useManeuverHistoryStore.getState().clearHistory();
  useInvasiveNeuroStore.getState().removeCatheter();
}
