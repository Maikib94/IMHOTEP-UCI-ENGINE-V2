// tests/integration/endocrineEngine.spec.ts
//
// El dominio endocrino existe porque sin el los escenarios de crisis
// endocrinas se declaraban como 'sepsis' y evolucionaban como un septico: el
// propiltiouracilo no hacia nada y los antibioticos "funcionaban". Lo que se
// verifica aqui es justamente eso — que la crisis evoluciona como lo que es y
// que el tratamiento especifico la modifica.

import { describe, it, expect, beforeEach } from 'vitest';
import { usePatientStore }      from '../../src/store/usePatientStore';
import { usePathologyStore }    from '../../src/store/usePathologyStore';
import { usePharmacologyStore } from '../../src/store/usePharmacologyStore';
import { EndocrineEngine }      from '../../src/core/EndocrineEngine';
import { ALL_SCENARIOS }        from '../../src/scenarios';

/** Avanza el motor endocrino `seconds` en pasos de 1 s. */
function run(seconds: number) {
  const eng = EndocrineEngine.getInstance();
  for (let i = 0; i < seconds; i++) eng.update(1);
}

function startCrisis(subtype: string, severity = 0.85) {
  usePatientStore.getState().updateVitals({
    heartRate: 78, temperature: 36.8, respiratoryRate: 16, gcs: 15,
    cardiacOutput: 5.0, svr: 1100,
  });
  usePathologyStore.getState().activatePathology('endocrine', subtype, severity);
}

beforeEach(() => {
  usePathologyStore.getState().deactivatePathology('endocrine');
  usePharmacologyStore.getState().resetAll();
});

describe('Tormenta tiroidea', () => {
  it('lleva al paciente a taquicardia, fiebre y gasto alto', () => {
    startCrisis('tormenta_tiroidea');
    run(600);
    const v = usePatientStore.getState().vitals;
    expect(v.heartRate).toBeGreaterThan(130);
    expect(v.temperature).toBeGreaterThan(39);
    expect(v.cardiacOutput).toBeGreaterThan(6);
    expect(v.svr ?? 1100).toBeLessThan(1000);   // resistencias bajas
  });

  it('el propiltiouracilo baja la carga hormonal; sin tratamiento no cede', () => {
    startCrisis('tormenta_tiroidea');
    run(60);
    const sinTratar = usePathologyStore.getState().endocrine.thyroidLoad;

    usePharmacologyStore.getState().setPlasmaConc('propylthiouracil_oral', 1.0);
    run(3600);
    const tratado = usePathologyStore.getState().endocrine.thyroidLoad;

    expect(tratado).toBeLessThan(sinTratar);
    // Antes de que existiera el dominio, dar PTU no cambiaba absolutamente nada.
    expect(sinTratar - tratado).toBeGreaterThan(0.2);
  });

  it('sin tratamiento específico la carga hormonal se mantiene', () => {
    startCrisis('tormenta_tiroidea');
    const inicial = usePathologyStore.getState().endocrine.thyroidLoad;
    run(3600);
    expect(usePathologyStore.getState().endocrine.thyroidLoad).toBeCloseTo(inicial, 5);
  });

  it('la hidrocortisona también aclara, por bloqueo de la conversión periférica', () => {
    startCrisis('tormenta_tiroidea');
    const inicial = usePathologyStore.getState().endocrine.thyroidLoad;
    usePharmacologyStore.getState().setPlasmaConc('hydrocortisone', 1.0);
    run(3600);
    expect(usePathologyStore.getState().endocrine.thyroidLoad).toBeLessThan(inicial);
  });

  it('el esmolol controla la frecuencia pero NO la crisis', () => {
    // Distinción que el simulador debe mostrar: tratar el síntoma no es tratar
    // la causa. La taquicardia cede y la carga hormonal sigue intacta.
    startCrisis('tormenta_tiroidea');
    run(600);
    const hrSinBeta = usePatientStore.getState().vitals.heartRate;
    const cargaAntes = usePathologyStore.getState().endocrine.thyroidLoad;

    usePharmacologyStore.getState().setInfusionRate('esmolol', 150);
    run(600);

    expect(usePatientStore.getState().vitals.heartRate).toBeLessThan(hrSinBeta);
    expect(usePathologyStore.getState().endocrine.thyroidLoad).toBeCloseTo(cargaAntes, 5);
  });
});

describe('Coma mixedematoso — el polo opuesto', () => {
  it('lleva a bradicardia, hipotermia e hipoventilación', () => {
    startCrisis('coma_mixedematoso');
    run(600);
    const v = usePatientStore.getState().vitals;
    expect(v.heartRate).toBeLessThan(60);
    expect(v.temperature).toBeLessThan(34);
    expect(v.respiratoryRate).toBeLessThan(12);
    expect(v.gcs).toBeLessThan(11);
  });

  it('los dos polos tiroideos divergen en sentido contrario desde el mismo basal', () => {
    startCrisis('tormenta_tiroidea');
    run(600);
    const tormenta = { ...usePatientStore.getState().vitals };

    usePathologyStore.getState().deactivatePathology('endocrine');
    startCrisis('coma_mixedematoso');
    run(600);
    const mixedema = usePatientStore.getState().vitals;

    expect(tormenta.heartRate).toBeGreaterThan(mixedema.heartRate + 60);
    expect(tormenta.temperature).toBeGreaterThan(mixedema.temperature + 5);
  });
});

describe('Otras crisis endocrinas', () => {
  it('la cetoacidosis produce taquipnea de Kussmaul', () => {
    startCrisis('cetoacidosis');
    run(600);
    expect(usePatientStore.getState().vitals.respiratoryRate).toBeGreaterThan(26);
  });

  it('la crisis suprarrenal cursa con resistencias bajas', () => {
    startCrisis('crisis_suprarrenal');
    run(600);
    expect(usePatientStore.getState().vitals.svr ?? 1100).toBeLessThan(900);
  });

  it('sin crisis activa el motor no toca nada', () => {
    usePatientStore.getState().updateVitals({ heartRate: 78, temperature: 36.8 });
    run(600);
    const v = usePatientStore.getState().vitals;
    expect(v.heartRate).toBe(78);
    expect(v.temperature).toBe(36.8);
  });
});

describe('Los escenarios ya no se disfrazan de sepsis', () => {
  it('las crisis endocrinas se declaran con su propio dominio', () => {
    const endocrinos = ALL_SCENARIOS.filter(s => s.category === 'endocrino');
    expect(endocrinos.length).toBeGreaterThanOrEqual(4);
    for (const s of endocrinos) {
      const dominios = s.pathologyConfigs.map(p => p.domain);
      expect(dominios).toContain('endocrine');
    }
  });

  it('la tormenta tiroidea declara su subtipo, no sepsis a secas', () => {
    const s = ALL_SCENARIOS.find(x => x.id === 'endo_tormenta_tiroidea'
                                   || /Tormenta Tiroidea/i.test(x.name));
    expect(s).toBeDefined();
    const cfg = s!.pathologyConfigs.find(p => p.domain === 'endocrine');
    expect(cfg?.subtype).toBe('tormenta_tiroidea');
  });

  it('existe el polo opuesto, que antes faltaba', () => {
    const s = ALL_SCENARIOS.find(x => x.id === 'endo_coma_mixedematoso');
    expect(s).toBeDefined();
    expect(s!.pathologyConfigs[0].subtype).toBe('coma_mixedematoso');
  });
});
