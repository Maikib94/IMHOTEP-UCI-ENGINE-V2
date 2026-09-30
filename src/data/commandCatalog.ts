// src/data/commandCatalog.ts
//
// Catalogo de acciones ejecutables desde la paleta de comandos (Ctrl+K).
//
// Los `keywords` son la parte que decide si la paleta sirve. Quien busca con
// prisa no teclea el nombre del catalogo: teclea el sinonimo que usa en su
// hospital ("epinefrina", "noradre"), o directamente la indicacion ("paro",
// "shock", "convulsion"). Cada entrada carga esos tres caminos.

import type { DrugId } from '../store/usePharmacologyStore';
import { dosesFor } from './clinicalDoses';

export type CommandGroup =
  | 'Vasopresores' | 'Inotropicos' | 'Sedacion' | 'Analgesia'
  | 'Bloqueo neuromuscular' | 'Antiarritmicos' | 'Farmacos especiales'
  | 'Ventilacion' | 'Paneles' | 'Simulacion';

export interface Command {
  id: string;
  label: string;
  /** Contexto a la derecha del nombre: unidad, via, indicacion breve. */
  sublabel?: string;
  group: CommandGroup;
  /** Sinonimos e indicaciones por los que tambien debe encontrarse. */
  keywords: string;
  run: () => void;
  /** Dosis sugerida que aplicara `run`, para mostrarla antes de ejecutar. */
  doseHint?: string;
}

/** Farmaco en infusion, con la dosis de inicio que la paleta aplica. */
interface InfusionSpec {
  drug: DrugId;
  label: string;
  unit: string;
  group: CommandGroup;
  keywords: string;
}

const INFUSIONS: InfusionSpec[] = [
  // Vasopresores
  { drug: 'noradrenaline', label: 'Noradrenalina', unit: 'mcg/kg/min', group: 'Vasopresores',
    keywords: 'norepinefrina levophed vasopresor shock septico hipotension pam' },
  { drug: 'adrenaline', label: 'Adrenalina', unit: 'mcg/kg/min', group: 'Vasopresores',
    keywords: 'epinefrina paro parada rcp anafilaxia shock bajo gasto' },
  { drug: 'vasopressin', label: 'Vasopresina', unit: 'U/h', group: 'Vasopresores',
    keywords: 'adh segundo vasopresor shock septico refractario' },
  { drug: 'methylene_blue', label: 'Azul de metileno', unit: 'mg/kg/h', group: 'Vasopresores',
    keywords: 'vasoplejia refractaria metahemoglobinemia' },
  // Inotropicos
  { drug: 'dobutamine', label: 'Dobutamina', unit: 'mcg/kg/min', group: 'Inotropicos',
    keywords: 'inotropico bajo gasto cardiogenico disfuncion ventricular' },
  { drug: 'dopamine', label: 'Dopamina', unit: 'mcg/kg/min', group: 'Inotropicos',
    keywords: 'inotropico bradicardia' },
  { drug: 'milrinone', label: 'Milrinona', unit: 'mcg/kg/min', group: 'Inotropicos',
    keywords: 'inodilatador fosfodiesterasa hipertension pulmonar ventriculo derecho' },
  { drug: 'levosimendan', label: 'Levosimendan', unit: 'mcg/kg/min', group: 'Inotropicos',
    keywords: 'sensibilizador calcio inotropico cardiogenico' },
  // Sedacion
  { drug: 'propofol', label: 'Propofol', unit: 'mg/kg/h', group: 'Sedacion',
    keywords: 'hipnotico sedacion rass status epileptico' },
  { drug: 'midazolam', label: 'Midazolam', unit: 'mg/kg/h', group: 'Sedacion',
    keywords: 'benzodiacepina sedacion convulsion status epileptico' },
  { drug: 'dexmedetomidine', label: 'Dexmedetomidina', unit: 'mcg/kg/h', group: 'Sedacion',
    keywords: 'precedex alfa2 delirio destete despertar' },
  { drug: 'ketamine', label: 'Ketamina', unit: 'mg/kg/h', group: 'Sedacion',
    keywords: 'disociativo broncoespasmo asma analgesia shock' },
  { drug: 'thiopental', label: 'Tiopental', unit: 'mg/kg/h', group: 'Sedacion',
    keywords: 'barbiturico coma hipertension intracraneal hic refractaria' },
  // Analgesia
  { drug: 'morphine', label: 'Morfina', unit: 'mg/h', group: 'Analgesia',
    keywords: 'opioide dolor analgesia' },
  { drug: 'fentanyl', label: 'Fentanilo', unit: 'mcg/kg/h', group: 'Analgesia',
    keywords: 'opioide analgesia arm intubado dolor' },
  { drug: 'remifentanil', label: 'Remifentanilo', unit: 'mcg/kg/min', group: 'Analgesia',
    keywords: 'opioide ultracorto destete neurocritico' },
  // Bloqueo neuromuscular
  { drug: 'cisatracurium', label: 'Cisatracurio', unit: 'mg/kg/h', group: 'Bloqueo neuromuscular',
    keywords: 'bnm relajante paralisis sdra asincronia hofmann' },
  { drug: 'rocuronium', label: 'Rocuronio', unit: 'mg/kg/h', group: 'Bloqueo neuromuscular',
    keywords: 'bnm relajante paralisis intubacion secuencia rapida' },
  { drug: 'atracurium', label: 'Atracurio', unit: 'mg/kg/h', group: 'Bloqueo neuromuscular',
    keywords: 'bnm relajante paralisis' },
  { drug: 'pancuronium', label: 'Pancuronio', unit: 'mg/kg/h', group: 'Bloqueo neuromuscular',
    keywords: 'bnm relajante paralisis' },
  // Otros
  { drug: 'insulin_regular_iv', label: 'Insulina regular IV', unit: 'U/h', group: 'Farmacos especiales',
    keywords: 'hiperglucemia cetoacidosis cad glucemia' },
  { drug: 'argatroban_iv', label: 'Argatroban', unit: 'mcg/kg/min', group: 'Farmacos especiales',
    keywords: 'anticoagulante trombopenia heparina hit' },
];

export interface CommandDeps {
  setInfusionRate: (drug: DrugId, rate: number) => void;
  openPanel: (panel: PanelId) => void;
  setO2Support?: (support: string) => void;
}

export type PanelId =
  | 'lab' | 'vent' | 'imaging' | 'ecmocrrt' | 'picco' | 'instructor' | 'scenario';

const PANELS: { id: PanelId; label: string; keywords: string }[] = [
  { id: 'lab',        label: 'Laboratorio',        keywords: 'labs analitica gasometria hemograma bioquimica cultivo' },
  { id: 'vent',       label: 'Ventilador (ARM)',   keywords: 'arm ventilacion mecanica respirador curvas peep fio2 sm100' },
  { id: 'imaging',    label: 'Estudios de imagen', keywords: 'radiografia rx tac tc ecografia imagen placa' },
  { id: 'ecmocrrt',   label: 'ECMO / CRRT',        keywords: 'ecmo crrt depuracion hemofiltracion dialisis oxigenacion membrana' },
  { id: 'picco',      label: 'Monitor PiCCO',      keywords: 'picco gasto cardiaco termodilucion evlw gedi svv hemodinamia avanzada' },
  { id: 'instructor', label: 'Panel de instructor', keywords: 'instructor docente override control caso' },
  { id: 'scenario',   label: 'Cambiar de caso',    keywords: 'escenario caso paciente nuevo reiniciar' },
];

/** Construye el catalogo completo con las dependencias ya enlazadas. */
export function buildCommands(deps: CommandDeps): Command[] {
  const out: Command[] = [];

  for (const spec of INFUSIONS) {
    const steps = dosesFor(spec.drug);
    if (steps.length === 0) continue;
    // La paleta aplica el primer escalon (dosis de inicio). Titular fino
    // sigue siendo cosa del panel, que es donde se ve la respuesta.
    const start = steps[0];
    out.push({
      id: `infusion:${spec.drug}`,
      label: spec.label,
      sublabel: `${spec.group} · ${spec.unit}`,
      group: spec.group,
      keywords: spec.keywords,
      doseHint: `${start.label} ${start.value} ${spec.unit}`,
      run: () => deps.setInfusionRate(spec.drug, start.value),
    });
    // Escalon alto como comando propio: en shock refractario se busca
    // directamente la dosis alta, no el inicio.
    const top = steps[steps.length - 1];
    if (top !== start) {
      out.push({
        id: `infusion:${spec.drug}:max`,
        label: `${spec.label} — dosis ${top.label.toLowerCase()}`,
        sublabel: `${top.value} ${spec.unit} · ${top.hint}`,
        group: spec.group,
        keywords: `${spec.keywords} alta maxima refractario`,
        doseHint: `${top.value} ${spec.unit}`,
        run: () => deps.setInfusionRate(spec.drug, top.value),
      });
    }
  }

  for (const p of PANELS) {
    out.push({
      id: `panel:${p.id}`,
      label: p.label,
      sublabel: 'Abrir panel',
      group: 'Paneles',
      keywords: `abrir ver panel ${p.keywords}`,
      run: () => deps.openPanel(p.id),
    });
  }

  return out;
}

/** Campos por los que se busca cada comando. */
export function commandFields(c: Command): string[] {
  return [c.label, c.keywords, c.group, c.sublabel ?? ''];
}
