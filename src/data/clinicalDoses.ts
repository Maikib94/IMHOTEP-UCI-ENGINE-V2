// src/data/clinicalDoses.ts
//
// Dosis de referencia por farmaco en infusion continua, para que poner una
// perfusion cueste un click en vez de veinte pulsaciones del stepper.
//
// MOTIVO: el stepper de adrenalina avanza de 0,02 en 0,02 mcg/kg/min. Llevarla
// de cero a una dosis de shock refractario (0,5) son 25 pulsaciones, y en una
// parada ese tiempo es tratamiento que no se esta dando. Los tres escalones de
// aqui cubren el recorrido clinico habitual de cada droga y dejan el stepper
// para la titulacion fina.
//
// Cada escalon queda dentro de DRUG_MAX_DOSES (drugControls.tsx), que recoge
// el techo clinico de cada farmaco. Las unidades son EXACTAMENTE las que cada
// InfusionControl declara: cambiarlas aqui sin mirar alli entrega una dosis
// equivocada, asi que los comentarios anotan la conversion cuando el uso
// clinico habitual se expresa en otra unidad.

import type { DrugId } from '../store/usePharmacologyStore';

export interface DoseStep {
  /** Etiqueta corta para el boton. */
  label: string;
  /** Valor en la unidad que declara el InfusionControl del farmaco. */
  value: number;
  /** Contexto clinico, se muestra como tooltip. */
  hint: string;
}

export const CLINICAL_DOSES: Partial<Record<DrugId, DoseStep[]>> = {
  // ── Vasopresores ────────────────────────────────────────────────────────
  noradrenaline: [   // mcg/kg/min
    { label: 'Inicio', value: 0.05, hint: 'Inicio habitual en shock septico' },
    { label: 'Media',  value: 0.20, hint: 'Dosis intermedia, titular por PAM' },
    { label: 'Alta',   value: 0.50, hint: 'Shock refractario — replantear volemia y asociar vasopresina' },
  ],
  adrenaline: [      // mcg/kg/min
    { label: 'Inicio', value: 0.05, hint: 'Inicio en shock con bajo gasto' },
    { label: 'Media',  value: 0.20, hint: 'Dosis intermedia' },
    { label: 'Alta',   value: 0.50, hint: 'Shock refractario — vigilar lactato y taquiarritmia' },
  ],
  vasopressin: [     // U/h  (0,03 U/min = 1,8 U/h, la dosis fija de referencia)
    { label: 'Baja',  value: 1.2, hint: '0,02 U/min' },
    { label: 'Fija',  value: 1.8, hint: '0,03 U/min — dosis fija habitual como segundo vasopresor' },
    { label: 'Alta',  value: 2.4, hint: '0,04 U/min' },
  ],
  methylene_blue: [  // mg/kg/h
    { label: 'Inicio', value: 0.5, hint: 'Vasoplejia refractaria a catecolaminas' },
    { label: 'Media',  value: 1.0, hint: 'Mantenimiento' },
    { label: 'Alta',   value: 2.0, hint: 'Techo — vigilar interaccion serotoninergica' },
  ],

  // ── Inotropicos ─────────────────────────────────────────────────────────
  dobutamine: [      // mcg/kg/min
    { label: 'Inicio', value: 2.5, hint: 'Inicio en bajo gasto' },
    { label: 'Media',  value: 5.0, hint: 'Dosis inotropica habitual' },
    { label: 'Alta',   value: 10,  hint: 'Vigilar taquicardia e hipotension por vasodilatacion' },
  ],
  dopamine: [        // mcg/kg/min
    { label: 'Beta',  value: 5,  hint: 'Rango inotropico' },
    { label: 'Media', value: 10, hint: 'Efecto mixto' },
    { label: 'Alfa',  value: 15, hint: 'Rango vasopresor' },
  ],
  milrinone: [       // mcg/kg/min
    { label: 'Baja',  value: 0.250, hint: 'Inicio; ajustar en insuficiencia renal' },
    { label: 'Media', value: 0.375, hint: 'Dosis habitual' },
    { label: 'Alta',  value: 0.500, hint: 'Vigilar hipotension' },
  ],
  levosimendan: [    // mcg/kg/min
    { label: 'Baja',  value: 0.05, hint: 'Inicio sin bolo de carga si hay hipotension' },
    { label: 'Media', value: 0.10, hint: 'Dosis habitual, 24 h' },
    { label: 'Alta',  value: 0.20, hint: 'Techo' },
  ],

  // ── Sedacion ────────────────────────────────────────────────────────────
  propofol: [        // mg/kg/h
    { label: 'Ligera', value: 1.0, hint: 'Sedacion superficial, RASS -1/-2' },
    { label: 'Media',  value: 2.0, hint: 'Sedacion habitual' },
    { label: 'Profunda', value: 4.0, hint: 'Techo — riesgo de sindrome por infusion de propofol' },
  ],
  midazolam: [       // mg/kg/h
    { label: 'Ligera', value: 0.03, hint: 'Sedacion superficial' },
    { label: 'Media',  value: 0.10, hint: 'Sedacion habitual' },
    { label: 'Profunda', value: 0.20, hint: 'Acumulacion en infusion prolongada' },
  ],
  dexmedetomidine: [ // mcg/kg/h
    { label: 'Baja',  value: 0.2, hint: 'Inicio sin bolo de carga' },
    { label: 'Media', value: 0.7, hint: 'Dosis habitual, mantiene despertar facil' },
    { label: 'Alta',  value: 1.4, hint: 'Vigilar bradicardia e hipotension' },
  ],
  ketamine: [        // mg/kg/h
    { label: 'Analg.', value: 0.5, hint: 'Rango analgesico, preserva el drive respiratorio' },
    { label: 'Media',  value: 1.0, hint: 'Sedoanalgesia' },
    { label: 'Alta',   value: 2.0, hint: 'Broncoespasmo grave / status asmatico' },
  ],
  thiopental: [      // mg/kg/h
    { label: 'Inicio', value: 1, hint: 'Hipertension intracraneal refractaria' },
    { label: 'Media',  value: 3, hint: 'Coma barbiturico, titular por EEG' },
    { label: 'Alta',   value: 5, hint: 'Techo — vigilar hipotension e inmunosupresion' },
  ],

  // ── Analgesia ───────────────────────────────────────────────────────────
  morphine: [        // mg/h
    { label: 'Baja',  value: 1, hint: 'Inicio' },
    { label: 'Media', value: 3, hint: 'Dosis habitual' },
    { label: 'Alta',  value: 5, hint: 'Acumula en insuficiencia renal' },
  ],
  fentanyl: [        // mcg/kg/h
    { label: 'Baja',  value: 0.5, hint: 'Inicio' },
    { label: 'Media', value: 1.5, hint: 'Analgesia habitual en ARM' },
    { label: 'Alta',  value: 3.0, hint: 'Techo — rigidez toracica con bolos rapidos' },
  ],
  remifentanil: [    // mcg/kg/min
    { label: 'Baja',  value: 0.05, hint: 'Inicio; vida media contextual constante' },
    { label: 'Media', value: 0.15, hint: 'Dosis habitual' },
    { label: 'Alta',  value: 0.30, hint: 'Hiperalgesia de rebote al suspender' },
  ],

  // ── Bloqueo neuromuscular ───────────────────────────────────────────────
  // Anulan el esfuerzo del paciente: con ellos no hay asincronia posible,
  // pero tampoco drive propio.
  cisatracurium: [   // mg/kg/h  (1-3 mcg/kg/min = 0,06-0,18 mg/kg/h)
    { label: 'Inicio', value: 0.06, hint: '1 mcg/kg/min — eliminacion de Hofmann, no depende de rinon ni higado' },
    { label: 'Media',  value: 0.15, hint: '2,5 mcg/kg/min — titular por tren de cuatro' },
    { label: 'Alta',   value: 0.25, hint: 'SDRA grave con asincronia refractaria' },
  ],
  rocuronium: [      // mg/kg/h
    { label: 'Inicio', value: 0.30, hint: 'Mantenimiento tras bolo' },
    { label: 'Media',  value: 0.45, hint: 'Titular por tren de cuatro' },
    { label: 'Alta',   value: 0.60, hint: 'Acumula en insuficiencia hepatica' },
  ],
  atracurium: [      // mg/kg/h
    { label: 'Inicio', value: 0.30, hint: 'Mantenimiento' },
    { label: 'Media',  value: 0.45, hint: 'Titular por tren de cuatro' },
    { label: 'Alta',   value: 0.60, hint: 'Libera histamina — vigilar broncoespasmo' },
  ],
  pancuronium: [     // mg/kg/h
    { label: 'Inicio', value: 0.03, hint: 'Mantenimiento; vagolitico, produce taquicardia' },
    { label: 'Media',  value: 0.06, hint: 'Titular por tren de cuatro' },
    { label: 'Alta',   value: 0.10, hint: 'Acumula en insuficiencia renal' },
  ],

  // ── Otros ───────────────────────────────────────────────────────────────
  insulin_regular_iv: [  // U/h
    { label: 'Baja',  value: 1, hint: 'Inicio; controlar glucemia horaria' },
    { label: 'Media', value: 3, hint: 'Dosis habitual en hiperglucemia de estres' },
    { label: 'Alta',  value: 6, hint: 'Cetoacidosis — vigilar potasio' },
  ],
  argatroban_iv: [       // mcg/kg/min
    { label: 'Baja',  value: 0.5, hint: 'Inicio en insuficiencia hepatica' },
    { label: 'Media', value: 1.0, hint: 'Trombopenia inducida por heparina — titular por TTPa' },
    { label: 'Alta',  value: 2.0, hint: 'Techo' },
  ],
};

/** Escalones de dosis de un farmaco, o vacio si no tiene referencia definida. */
export function dosesFor(drug: DrugId): DoseStep[] {
  return CLINICAL_DOSES[drug] ?? [];
}
