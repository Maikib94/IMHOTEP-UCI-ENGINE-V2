// src/store/useInvasiveNeuroStore.ts
// Gate de monitorización neurológica invasiva (catéter PIC)

import { create } from 'zustand';
import { useTimeStore } from './useTimeStore';

export type IcpCatheterType = 'parenchymal' | 'intraventricular';

interface InvasiveNeuroState {
  icpCatheterPlaced: boolean;
  catheterType: IcpCatheterType | null;
  placementTick: number | null;

  placeCatheter: (type: IcpCatheterType) => void;
  removeCatheter: () => void;
}

export const useInvasiveNeuroStore = create<InvasiveNeuroState>((set) => ({
  icpCatheterPlaced: false,
  catheterType: null,
  placementTick: null,

  placeCatheter: (type) => set({
    icpCatheterPlaced: true,
    catheterType: type,
    placementTick: useTimeStore.getState().ticks,
  }),

  removeCatheter: () => set({
    icpCatheterPlaced: false,
    catheterType: null,
    placementTick: null,
  }),
}));
