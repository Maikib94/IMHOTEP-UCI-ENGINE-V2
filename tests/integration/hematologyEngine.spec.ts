// tests/integration/hematologyEngine.spec.ts
//
// El dominio hematológico existe porque sin él los tres escenarios de
// hematología se declaraban como 'sepsis' y el laboratorio no podía informar
// lo que el propio escenario decía: las plaquetas salían de la severidad de la
// sepsis y la coagulación entera de la presión arterial media. Lo que se
// verifica aquí es que cada crisis evoluciona como lo que es, que el
// tratamiento específico la modifica, y —sobre todo— que transfundir plaquetas
// en una PTT empeora al paciente, porque esa es la única contraindicación
// formal de un producto sanguíneo que el residente puede encontrarse teniendo
// delante el número que la pide.

import { describe, it, expect, beforeEach } from 'vitest';
import { usePatientStore }      from '../../src/store/usePatientStore';
import { usePathologyStore }    from '../../src/store/usePathologyStore';
import { usePharmacologyStore } from '../../src/store/usePharmacologyStore';
import { useCRRTStore }         from '../../src/store/useCRRTStore';
import { HematologyEngine }     from '../../src/core/HematologyEngine';
import { interpretHemato }      from '../../src/core/hematoInterpretation';
import { ALL_SCENARIOS }        from '../../src/scenarios';

/** Avanza el motor `seconds`.
 *
 *  El paso es configurable porque la serie blanca tarda días en moverse y
 *  recorrer 48 h de un segundo en un segundo son 172.800 iteraciones: el test
 *  agotaba el tiempo límite antes de llegar al nadir. Toda la convergencia del
 *  motor es exponencial en dt y sus términos horarios se escalan por dt, así
 *  que un paso de 30 s da el mismo resultado; se reserva el paso fino para los
 *  tests que miran los primeros minutos tras un bolo. */
function run(seconds: number, step = 1) {
  const eng = HematologyEngine.getInstance();
  const n = Math.max(1, Math.round(seconds / step));
  for (let i = 0; i < n; i++) eng.update(step);
}

const H = 3600;

/** Deja al paciente en basal hematológico y activa la crisis pedida. */
function startCrisis(subtype: string, severity = 0.85) {
  usePatientStore.getState().updateVitals({
    plateletsK: 230, fibrinogenMgDl: 320, inr: 1.0, dDimerNgMl: 250,
    ldhUl: 180, haptoglobinMgDl: 110, schistocytes: 0,
    uricAcidMgDl: 4.8, phosphateMgDl: 3.5, wbcK: 7.5, ancK: 4.5,
    kPlasma: 4.0, creatinine: 1.0, gcs: 15,
  });
  usePathologyStore.getState().activatePathology('hematologic', subtype, severity);
}

const vitals = () => usePatientStore.getState().vitals;
const hemato = () => usePathologyStore.getState().hematologic;

beforeEach(() => {
  usePathologyStore.getState().deactivatePathology('hematologic');
  usePathologyStore.getState().deactivatePathology('sepsis');
  usePharmacologyStore.getState().resetAll();
  usePatientStore.getState().resetFluidTracking();
  useCRRTStore.getState().resetCRRT();
  HematologyEngine.getInstance().reset();
});

describe('PTT — consumo plaquetario con coagulación intacta', () => {
  it('lleva a trombopenia profunda, LDH alta y esquistocitos', () => {
    startCrisis('ptt');
    run(6 * H, 5);
    const v = vitals();
    expect(v.plateletsK).toBeLessThan(30);
    expect(v.ldhUl).toBeGreaterThan(1000);
    expect(v.haptoglobinMgDl).toBeLessThan(20);
    expect(v.schistocytes).toBeGreaterThan(1.5);
  });

  it('deja el fibrinógeno y el INR NORMALES — es lo que la separa de la CID', () => {
    startCrisis('ptt');
    run(6 * H, 5);
    const v = vitals();
    expect(v.fibrinogenMgDl).toBeGreaterThan(250);
    expect(v.inr).toBeLessThan(1.2);
  });

  it('el panel la lee como microangiopatía y no como CID', () => {
    startCrisis('ptt');
    run(6 * H, 5);
    const v = vitals();
    const r = interpretHemato({
      plateletsK: v.plateletsK, fibrinogenMgDl: v.fibrinogenMgDl, inr: v.inr,
      dDimerNgMl: v.dDimerNgMl, ldhUl: v.ldhUl, haptoglobinMgDl: v.haptoglobinMgDl,
      schistocytes: v.schistocytes, adamts13Pct: hemato().adamts13Pct,
      uricAcidMgDl: v.uricAcidMgDl, phosphateMgDl: v.phosphateMgDl,
      kPlasma: v.kPlasma, creatinine: v.creatinine, ancK: v.ancK,
    });
    expect(r.profile).toBe('microangiopatia');
    expect(r.plateletTransfusionSafe).toBe(false);
  });

  it('la microtrombosis baja el Glasgow y sube la creatinina', () => {
    startCrisis('ptt');
    run(6 * H, 5);
    expect(hemato().microthrombosis).toBeGreaterThan(0.5);
    expect(vitals().gcs).toBeLessThan(13);
    expect(vitals().creatinine).toBeGreaterThan(1.3);
  });

  it('el recambio plasmático recupera las plaquetas; sin él no ceden', () => {
    startCrisis('ptt');
    run(6 * H, 5);
    const sinTratar = vitals().plateletsK;

    usePathologyStore.getState().setPlasmaExchange(true);
    run(24 * H, 20);
    const tratado = vitals().plateletsK;

    expect(tratado).toBeGreaterThan(sinTratar + 50);
    expect(hemato().adamts13Pct).toBeGreaterThan(30);
    expect(hemato().plasmaExchangeSessions).toBeGreaterThanOrEqual(1);
  });

  it('sin tratamiento específico la PTT no se resuelve sola', () => {
    startCrisis('ptt');
    run(24 * H, 20);
    expect(vitals().plateletsK).toBeLessThan(40);
    expect(hemato().adamts13Pct).toBeLessThan(15);
  });

  it('el caplacizumab sube las plaquetas SIN recuperar el ADAMTS13', () => {
    // La distinción que el simulador debe mostrar: controlar el fenómeno no es
    // tratar la causa. Las plaquetas suben y el déficit enzimático sigue, así
    // que suspenderlo antes de apagar el inhibidor recae.
    startCrisis('ptt');
    run(6 * H, 5);
    const pltAntes = vitals().plateletsK;

    usePharmacologyStore.getState().setPlasmaConc('caplacizumab_iv', 1.0);
    run(24 * H, 20);

    expect(vitals().plateletsK).toBeGreaterThan(pltAntes + 60);
    expect(hemato().adamts13Pct).toBeLessThan(15);   // la causa, intacta
  });

  it('el rituximab apaga el inhibidor, que es lo que el recambio solo arrastra', () => {
    startCrisis('ptt');
    const inhibidorInicial = hemato().inhibitorTiter;
    usePharmacologyStore.getState().setPlasmaConc('rituximab_iv', 1.0);
    run(12 * H, 10);
    expect(hemato().inhibitorTiter).toBeLessThan(inhibidorInicial - 0.2);
  });

  it('transfundir plaquetas EMPEORA la microtrombosis', () => {
    // La lección entera del caso. Dos pacientes idénticos; a uno se le
    // transfunde el pool de aféresis que el recuento parece pedir.
    startCrisis('ptt');
    run(6 * H, 5);
    const microAntes = hemato().microthrombosis;
    const gcsAntes   = vitals().gcs;

    usePatientStore.getState().administerFluid('platelets', 250);
    run(2 * H, 2);

    expect(hemato().microthrombosis).toBeGreaterThan(microAntes);
    expect(vitals().gcs).toBeLessThan(gcsAntes);
  });

  it('y además apenas sube el recuento, porque se consumen', () => {
    startCrisis('ptt');
    run(6 * H, 5);
    const pltAntes = vitals().plateletsK;
    usePatientStore.getState().administerFluid('platelets', 250);
    run(2 * H, 2);
    // Un pool rinde ~30 K/µL en un paciente sin consumo; aquí no.
    expect(vitals().plateletsK).toBeLessThan(pltAntes + 15);
  });
});

describe('CID — consumo con coagulopatía', () => {
  it('consume plaquetas, fibrinógeno y factores a la vez', () => {
    startCrisis('cid', 0.80);
    run(6 * H, 5);
    const v = vitals();
    expect(v.plateletsK).toBeLessThan(90);
    expect(v.fibrinogenMgDl).toBeLessThan(150);
    expect(v.inr).toBeGreaterThan(1.9);
    expect(v.dDimerNgMl).toBeGreaterThan(10000);
  });

  it('el panel la declara CID overt con score ISTH alto', () => {
    startCrisis('cid', 0.80);
    run(6 * H, 5);
    const v = vitals();
    const r = interpretHemato({
      plateletsK: v.plateletsK, fibrinogenMgDl: v.fibrinogenMgDl, inr: v.inr,
      dDimerNgMl: v.dDimerNgMl, ldhUl: v.ldhUl, haptoglobinMgDl: v.haptoglobinMgDl,
      schistocytes: v.schistocytes, adamts13Pct: 100,
      uricAcidMgDl: v.uricAcidMgDl, phosphateMgDl: v.phosphateMgDl,
      kPlasma: v.kPlasma, creatinine: v.creatinine, ancK: v.ancK,
    });
    expect(r.profile).toBe('cid');
    expect(r.isth.overt).toBe(true);
  });

  it('el control del foco es lo que apaga el consumo', () => {
    usePathologyStore.getState().activateSepsis(0.85);
    startCrisis('cid', 0.80);
    run(6 * H, 5);
    const consumoSinControl = hemato().consumption;

    usePathologyStore.getState().setSourceControl(true);
    usePathologyStore.getState().setAdequateAntibiotics(true);
    run(12 * H, 10);

    expect(hemato().consumption).toBeLessThan(consumoSinControl - 0.25);
    expect(vitals().fibrinogenMgDl).toBeGreaterThan(150);
  });

  it('sin control del foco, los productos no cambian la trayectoria', () => {
    startCrisis('cid', 0.80);
    run(6 * H, 5);
    const fibAntes = vitals().fibrinogenMgDl;

    // Diez unidades de crioprecipitado: sube de inmediato…
    usePatientStore.getState().administerFluid('cryo', 500);
    run(30 * 60);
    const fibPico = vitals().fibrinogenMgDl;
    expect(fibPico).toBeGreaterThan(fibAntes);

    // …y vuelve a bajar, porque el consumo sigue encendido.
    run(8 * H, 10);
    expect(vitals().fibrinogenMgDl).toBeLessThan(fibPico);
    expect(hemato().consumption).toBeGreaterThan(0.5);
  });

  it('el fibrinógeno SUBE en la sepsis sin CID — por eso sirve para distinguirlas', () => {
    // Reactante de fase aguda. Si bajara también en la sepsis simple, el
    // fibrinógeno no discriminaría nada y el score ISTH sería ruido.
    usePathologyStore.getState().activateSepsis(0.80);
    usePatientStore.getState().updateVitals({ fibrinogenMgDl: 320, plateletsK: 230 });
    run(6 * H, 5);
    expect(vitals().fibrinogenMgDl).toBeGreaterThan(360);
    // Y las plaquetas bajan, pero sin coagulopatía.
    expect(vitals().plateletsK).toBeLessThan(180);
    expect(vitals().inr).toBeLessThan(1.35);
  });
});

describe('HIT — la trombopenia que trombosa', () => {
  it('necesita la exposición previa: el nadir llega por el reloj, no por el fármaco', () => {
    startCrisis('hit', 0.85);
    // El escenario arranca en el día 7 de heparina (168 h acumuladas), que es
    // el centro de la ventana del día 5 al 10.
    expect(hemato().heparinExposureH).toBeCloseTo(168, 0);
    usePharmacologyStore.getState().setPlasmaConc('heparin_iv', 1.0);
    run(12 * H, 10);
    expect(vitals().plateletsK).toBeLessThan(120);
  });

  it('deja el fibrinógeno y el INR intactos — no es una CID', () => {
    startCrisis('hit', 0.85);
    usePharmacologyStore.getState().setPlasmaConc('heparin_iv', 1.0);
    run(12 * H, 10);
    expect(vitals().fibrinogenMgDl).toBeGreaterThan(250);
    expect(vitals().inr).toBeLessThan(1.2);
  });

  it('el reloj de exposición corre con la heparina, haya o no HIT declarada', () => {
    usePharmacologyStore.getState().setPlasmaConc('heparin_iv', 1.0);
    run(10 * H, 10);
    expect(hemato().heparinExposureH).toBeGreaterThan(9);
  });

  it('retirar la heparina frena el consumo', () => {
    startCrisis('hit', 0.85);
    usePharmacologyStore.getState().setPlasmaConc('heparin_iv', 1.0);
    run(12 * H, 10);
    const pltConHeparina = vitals().plateletsK;

    usePharmacologyStore.getState().setPlasmaConc('heparin_iv', 0);
    run(24 * H, 20);
    expect(vitals().plateletsK).toBeGreaterThan(pltConHeparina + 20);
  });

  it('retirarla SIN sustituirla deja el riesgo trombótico; el argatrobán lo baja', () => {
    startCrisis('hit', 0.85);
    usePharmacologyStore.getState().setPlasmaConc('heparin_iv', 1.0);
    run(12 * H, 10);
    const microConHeparina = hemato().microthrombosis;
    expect(microConHeparina).toBeGreaterThan(0.3);

    usePharmacologyStore.getState().setPlasmaConc('argatroban_iv', 1.0);
    run(12 * H, 10);
    expect(hemato().microthrombosis).toBeLessThan(microConHeparina);
  });
});

describe('Lisis tumoral — urgencia metabólica', () => {
  it('eleva urato, fósforo y potasio, y la creatinina con ellos', () => {
    startCrisis('lisis_tumoral', 0.85);
    run(4 * H, 5);
    const v = vitals();
    expect(v.uricAcidMgDl).toBeGreaterThan(10);
    expect(v.phosphateMgDl).toBeGreaterThan(6);
    expect(v.kPlasma).toBeGreaterThan(5.5);
    expect(v.creatinine).toBeGreaterThan(1.8);
  });

  it('no toca la hemostasia: el problema no es coagulopático', () => {
    startCrisis('lisis_tumoral', 0.85);
    run(4 * H, 5);
    const v = vitals();
    expect(v.plateletsK).toBeGreaterThan(190);
    expect(v.fibrinogenMgDl).toBeGreaterThan(280);
    expect(v.inr).toBeLessThan(1.15);
  });

  it('la rasburicasa desploma el urato', () => {
    startCrisis('lisis_tumoral', 0.85);
    run(4 * H, 5);
    const uratoAntes = vitals().uricAcidMgDl;

    usePharmacologyStore.getState().setPlasmaConc('rasburicase_iv', 1.0);
    run(4 * H, 5);
    expect(vitals().uricAcidMgDl).toBeLessThan(uratoAntes * 0.4);
  });

  it('el alopurinol NO baja el urato que ya circula — toda la diferencia', () => {
    startCrisis('lisis_tumoral', 0.85);
    run(4 * H, 5);
    const uratoAntes = vitals().uricAcidMgDl;

    usePharmacologyStore.getState().setPlasmaConc('allopurinol_oral', 1.0);
    run(4 * H, 5);
    // Frena la producción, así que baja algo; nunca como la uricasa.
    expect(vitals().uricAcidMgDl).toBeGreaterThan(uratoAntes * 0.55);
  });

  it('la hiperhidratación y la CRRT aclaran el potasio', () => {
    startCrisis('lisis_tumoral', 0.85);
    run(4 * H, 5);
    const kSinDepurar = vitals().kPlasma;

    useCRRTStore.getState().setActive(true);
    run(4 * H, 5);
    expect(vitals().kPlasma).toBeLessThan(kSinDepurar);
  });

  it('dar calcio con el fósforo alto empeora la creatinina — la trampa del caso', () => {
    startCrisis('lisis_tumoral', 0.85);
    run(4 * H, 5);
    const crSinCalcio = vitals().creatinine;
    expect(vitals().phosphateMgDl).toBeGreaterThan(6);

    usePharmacologyStore.getState().setPlasmaConc('calcium_gluconate_iv', 1.0);
    run(2 * H, 2);
    expect(vitals().creatinine).toBeGreaterThan(crSinCalcio);
  });
});

describe('Neutropenia febril y sobreanticoagulación', () => {
  it('la neutropenia hunde los neutrófilos absolutos por debajo de 500/µL', () => {
    startCrisis('neutropenia_febril', 0.90);
    run(48 * H, 30);
    expect(vitals().ancK).toBeLessThan(0.5);
  });

  it('el G-CSF los recupera', () => {
    startCrisis('neutropenia_febril', 0.90);
    run(48 * H, 30);
    const ancSinGcsf = vitals().ancK;
    usePharmacologyStore.getState().setPlasmaConc('filgrastim_sc', 1.0);
    run(72 * H, 30);
    expect(vitals().ancK).toBeGreaterThan(ancSinGcsf);
  });

  it('la sobreanticoagulación eleva el INR dejando plaquetas y fibrinógeno normales', () => {
    startCrisis('sobreanticoagulacion', 0.85);
    run(4 * H, 5);
    const v = vitals();
    expect(v.inr).toBeGreaterThan(4.5);
    expect(v.plateletsK).toBeGreaterThan(190);
    expect(v.fibrinogenMgDl).toBeGreaterThan(280);
  });

  it('el complejo protrombínico corrige el INR en minutos', () => {
    startCrisis('sobreanticoagulacion', 0.85);
    run(4 * H, 5);
    const inrAntes = vitals().inr;
    usePharmacologyStore.getState().setPlasmaConc('pcc_4factor', 1.0);
    run(30 * 60);
    expect(vitals().inr).toBeLessThan(inrAntes - 1.5);
  });

  it('la vitamina K sola también corrige, pero el motor permite ver la diferencia', () => {
    startCrisis('sobreanticoagulacion', 0.85);
    run(4 * H, 5);
    const inrAntes = vitals().inr;
    usePharmacologyStore.getState().setPlasmaConc('vitamin_k_iv', 1.0);
    run(30 * 60);
    const conVitK = inrAntes - vitals().inr;

    // Reiniciar y repetir con complejo protrombínico a la misma dosis relativa.
    usePathologyStore.getState().deactivatePathology('hematologic');
    usePharmacologyStore.getState().resetAll();
    HematologyEngine.getInstance().reset();
    startCrisis('sobreanticoagulacion', 0.85);
    run(4 * H, 5);
    const inrAntes2 = vitals().inr;
    usePharmacologyStore.getState().setPlasmaConc('pcc_4factor', 1.0);
    run(30 * 60);
    const conCcp = inrAntes2 - vitals().inr;

    expect(conCcp).toBeGreaterThan(conVitK);
  });
});

describe('Sin crisis activa', () => {
  it('el motor devuelve la serie a la normalidad y no la mantiene alterada', () => {
    usePatientStore.getState().updateVitals({
      plateletsK: 40, fibrinogenMgDl: 90, inr: 2.5, ldhUl: 1500,
    });
    run(12 * H, 10);
    const v = vitals();
    expect(v.plateletsK).toBeGreaterThan(190);
    expect(v.fibrinogenMgDl).toBeGreaterThan(280);
    expect(v.inr).toBeLessThan(1.15);
    expect(v.ldhUl).toBeLessThan(250);
  });

  it('no deja residuo en el potasio, la creatinina ni el Glasgow', () => {
    // El motor aporta un INCREMENTO sobre variables de otros motores. Si no
    // descontara lo ya aplicado al resolverse la crisis, dejaría un offset
    // permanente en el paciente siguiente.
    startCrisis('lisis_tumoral', 0.85);
    run(4 * H, 5);
    expect(vitals().kPlasma).toBeGreaterThan(5.5);

    usePathologyStore.getState().deactivatePathology('hematologic');
    run(6 * H, 5);
    expect(vitals().kPlasma).toBeLessThan(4.5);
    expect(vitals().creatinine).toBeLessThan(1.3);
    expect(vitals().gcs).toBeGreaterThan(14.5);
  });

  it('la leucopenia séptica se decide una vez y no cambia entre extracciones', () => {
    // Antes se sorteaba en cada hemograma, así que el mismo paciente alternaba
    // entre 2.500 y 24.000 leucocitos entre dos tubos consecutivos.
    usePathologyStore.getState().activateSepsis(0.85);
    run(6 * H, 5);
    const primera = vitals().wbcK;
    run(6 * H, 5);
    const segunda = vitals().wbcK;
    // Converge hacia un único objetivo, no salta de rama.
    expect(Math.abs(segunda - primera)).toBeLessThan(primera * 0.5);
  });
});

describe('Los escenarios ya no se disfrazan de sepsis', () => {
  it('las crisis hematológicas se declaran con su propio dominio', () => {
    const hematos = ALL_SCENARIOS.filter(s => s.category === 'hemato');
    expect(hematos.length).toBeGreaterThanOrEqual(6);
    for (const s of hematos) {
      const dominios = s.pathologyConfigs.map(p => p.domain);
      expect(dominios).toContain('hematologic');
    }
  });

  it('la PTT declara su subtipo, no sepsis a secas', () => {
    const s = ALL_SCENARIOS.find(x => x.id === 'hemato_ptt_severo');
    expect(s).toBeDefined();
    const cfg = s!.pathologyConfigs.find(p => p.domain === 'hematologic');
    expect(cfg?.subtype).toBe('ptt');
  });

  it('la CID conserva la sepsis que la dispara, además de su propio dominio', () => {
    // La CID séptica es los dos a la vez: el foco infeccioso es el motor y la
    // coagulopatía la consecuencia. Perder la sepsis al migrar el escenario
    // habría roto el caso.
    const s = ALL_SCENARIOS.find(x => x.id === 'hemato_cid_septica');
    expect(s).toBeDefined();
    const dominios = s!.pathologyConfigs.map(p => p.domain);
    expect(dominios).toContain('hematologic');
    expect(dominios).toContain('sepsis');
  });

  it('existen los casos de HIT, neutropenia febril y sobreanticoagulación', () => {
    for (const id of ['hemato_hit_tipo2', 'hemato_neutropenia_febril', 'hemato_sobreanticoagulacion']) {
      expect(ALL_SCENARIOS.find(x => x.id === id), id).toBeDefined();
    }
  });
});
