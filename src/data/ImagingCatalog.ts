// src/data/ImagingCatalog.ts
// Catálogo de tipos de estudios de imagen y hallazgos deterministas.
// Refs: Schmidt M ICM 2013; Lichtenstein DA Chest 2015; Gattinoni NEJM 2020.

export type StudyType =
  | 'chest_xray'
  | 'chest_ct'
  | 'head_ct'
  | 'abdominal_ct'
  | 'echo_transthoracic'
  | 'echo_transesophageal'
  | 'pocus'
  | 'abdominal_ultrasound'
  | 'lower_limb_doppler';

export interface StudyFinding {
  title:      string;
  summary:    string;
  detail:     string[];
  impression: string;
  svgKey:     string;
  orderedAt:  number;
  resultAt:   number;
  isReady:    boolean;
}

export interface StudyOrder {
  id:      string;
  type:    StudyType;
  finding: StudyFinding | null;
}

export const STUDY_LABELS: Record<StudyType, string> = {
  chest_xray:           'Rx Tórax AP',
  chest_ct:             'TC Tórax',
  head_ct:              'TC Cráneo',
  abdominal_ct:         'TC Abdomen/Pelvis',
  echo_transthoracic:   'Eco TT',
  echo_transesophageal: 'Eco TE',
  pocus:                'POCUS Bedside',
  abdominal_ultrasound: 'Eco Abdominal',
  lower_limb_doppler:   'Doppler MMII',
};

// Turnaround en segundos SIMULADOS (useTimeStore.simulatedElapsed) — NO ticks
// (C1.9: ticks avanza a 240/s real fijo, independiente de speedMultiplier;
// no equivale a segundos simulados). CONSTANTE NO CONSUMIDA actualmente por
// ningun motor — ImagingEngine.requestStudy() usa MODALITY_DELAY_S +
// setTimeout de reloj real en su lugar. Se corrige el nombre/comentario para
// que si alguien la conecta en el futuro no reintroduzca el bug.
export const TURNAROUND_SIM_S: Record<StudyType, number> = {
  chest_xray:           60,
  pocus:                90,
  echo_transthoracic:   120,
  abdominal_ultrasound: 120,
  lower_limb_doppler:   120,
  chest_ct:             180,
  head_ct:              180,
  abdominal_ct:         180,
  echo_transesophageal: 240,
};

// Grouped for order UI
export const STUDY_GROUPS: { label: string; types: StudyType[] }[] = [
  {
    label: 'Rápidos (< 2 min)',
    types: ['chest_xray', 'pocus'],
  },
  {
    label: 'Ecografía / Eco',
    types: ['echo_transthoracic', 'echo_transesophageal', 'abdominal_ultrasound', 'lower_limb_doppler'],
  },
  {
    label: 'Tomografía',
    types: ['chest_ct', 'head_ct', 'abdominal_ct'],
  },
];
