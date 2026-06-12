"use client";

import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { CombatantWithParsed, EncounterWithCombatants, Condition, DDBCharacter } from "@/lib/types";

interface EncounterState {
  encounter: EncounterWithCombatants | null;
  selectedCombatantId: string | null;
  statBlockCombatantId: string | null;
  isDirty: boolean;
  pendingRemove: CombatantWithParsed | null;

  setEncounter: (encounter: EncounterWithCombatants) => void;
  selectCombatant: (id: string | null) => void;
  showStatBlock: (id: string | null) => void;

  updateHP: (combatantId: string, delta: number) => void;
  setHP: (combatantId: string, current: number) => void;
  setTempHP: (combatantId: string, temp: number) => void;
  setInitiative: (combatantId: string, initiative: number | null) => void;
  toggleCondition: (combatantId: string, condition: Condition) => void;
  toggleConcentration: (combatantId: string) => void;
  setNotes: (combatantId: string, notes: string) => void;
  updateCombatant: (combatantId: string, updates: Partial<CombatantWithParsed>) => void;
  reorderCombatants: (combatants: CombatantWithParsed[]) => void;
  addCombatant: (combatant: CombatantWithParsed) => void;
  removeCombatant: (combatantId: string) => void;
  restoreLastRemoved: () => void;
  clearPendingRemove: () => void;

  nextTurn: () => void;
  prevTurn: () => void;
  startEncounter: () => void;
  endEncounter: () => void;
  resetRound: () => void;

  updateDDBCharacter: (combatantId: string, char: DDBCharacter) => void;

  markDirty: () => void;
  markClean: () => void;
}

function sortedByInitiative(combatants: CombatantWithParsed[]): CombatantWithParsed[] {
  return [...combatants].sort((a, b) => {
    const ia = a.initiative ?? -Infinity;
    const ib = b.initiative ?? -Infinity;
    if (ib !== ia) return ib - ia;
    return b.initiativeBonus - a.initiativeBonus;
  });
}

export const useEncounterStore = create<EncounterState>()(
  subscribeWithSelector((set, get) => ({
    encounter: null,
    selectedCombatantId: null,
    statBlockCombatantId: null,
    isDirty: false,
    pendingRemove: null,

    setEncounter: (encounter) => set({ encounter, isDirty: false }),
    selectCombatant: (id) => set({ selectedCombatantId: id }),
    showStatBlock: (id) => set({ statBlockCombatantId: id }),

    // Sync DDB character data + live combat stats from the player's sheet.
    // Does NOT touch conditions or initiative — those stay under DM control.
    // Does NOT mark dirty — DDB syncs shouldn't trigger the encounter auto-save.
    updateDDBCharacter: (combatantId, char) =>
      set((state) => {
        if (!state.encounter) return state;
        const combatants = state.encounter.combatants.map((c) => {
          if (c.id !== combatantId) return c;
          return {
            ...c,
            hpCurrent: char.currentHp ?? char.maxHp,
            hpMax: char.maxHp,
            hpTemp: char.tempHp ?? 0,
            ac: char.ac,
            speed: char.speed,
            initiativeBonus: char.initiativeBonus,
            ddbCharacter: char,
          };
        });
        return { encounter: { ...state.encounter, combatants } };
      }),

    markDirty: () => set({ isDirty: true }),
    markClean: () => set({ isDirty: false }),

    updateHP: (combatantId, delta) =>
      set((state) => {
        if (!state.encounter) return state;
        const combatants = state.encounter.combatants.map((c) => {
          if (c.id !== combatantId) return c;
          let newCurrent = c.hpCurrent + delta;
          if (delta < 0 && c.hpTemp > 0) {
            const absorbed = Math.min(c.hpTemp, Math.abs(delta));
            newCurrent = c.hpCurrent - Math.max(0, Math.abs(delta) - absorbed);
            return { ...c, hpTemp: c.hpTemp - absorbed, hpCurrent: Math.max(0, newCurrent) };
          }
          return { ...c, hpCurrent: Math.max(0, Math.min(c.hpMax, newCurrent)) };
        });
        return { encounter: { ...state.encounter, combatants }, isDirty: true };
      }),

    setHP: (combatantId, current) =>
      set((state) => {
        if (!state.encounter) return state;
        const combatants = state.encounter.combatants.map((c) =>
          c.id === combatantId ? { ...c, hpCurrent: Math.max(0, Math.min(c.hpMax, current)) } : c
        );
        return { encounter: { ...state.encounter, combatants }, isDirty: true };
      }),

    setTempHP: (combatantId, temp) =>
      set((state) => {
        if (!state.encounter) return state;
        const combatants = state.encounter.combatants.map((c) =>
          c.id === combatantId ? { ...c, hpTemp: Math.max(0, temp) } : c
        );
        return { encounter: { ...state.encounter, combatants }, isDirty: true };
      }),

    setInitiative: (combatantId, initiative) =>
      set((state) => {
        if (!state.encounter) return state;
        const combatants = state.encounter.combatants.map((c) =>
          c.id === combatantId ? { ...c, initiative } : c
        );
        const sorted = sortedByInitiative(combatants).map((c, i) => ({ ...c, sortOrder: i }));
        return { encounter: { ...state.encounter, combatants: sorted }, isDirty: true };
      }),

    toggleCondition: (combatantId, condition) =>
      set((state) => {
        if (!state.encounter) return state;
        const combatants = state.encounter.combatants.map((c) => {
          if (c.id !== combatantId) return c;
          const has = c.conditions.includes(condition);
          const conditions = has
            ? c.conditions.filter((x) => x !== condition)
            : [...c.conditions, condition];
          return { ...c, conditions };
        });
        return { encounter: { ...state.encounter, combatants }, isDirty: true };
      }),

    toggleConcentration: (combatantId) =>
      set((state) => {
        if (!state.encounter) return state;
        const combatants = state.encounter.combatants.map((c) =>
          c.id === combatantId ? { ...c, isConcentrating: !c.isConcentrating } : c
        );
        return { encounter: { ...state.encounter, combatants }, isDirty: true };
      }),

    setNotes: (combatantId, notes) =>
      set((state) => {
        if (!state.encounter) return state;
        const combatants = state.encounter.combatants.map((c) =>
          c.id === combatantId ? { ...c, notes } : c
        );
        return { encounter: { ...state.encounter, combatants }, isDirty: true };
      }),

    updateCombatant: (combatantId, updates) =>
      set((state) => {
        if (!state.encounter) return state;
        const combatants = state.encounter.combatants.map((c) =>
          c.id === combatantId ? { ...c, ...updates } : c
        );
        return { encounter: { ...state.encounter, combatants }, isDirty: true };
      }),

    reorderCombatants: (combatants) =>
      set((state) => {
        if (!state.encounter) return state;
        const reordered = combatants.map((c, i) => ({ ...c, sortOrder: i }));
        return { encounter: { ...state.encounter, combatants: reordered }, isDirty: true };
      }),

    addCombatant: (combatant) =>
      set((state) => {
        if (!state.encounter) return state;
        const combatants = sortedByInitiative([...state.encounter.combatants, combatant]).map(
          (c, i) => ({ ...c, sortOrder: i })
        );
        return { encounter: { ...state.encounter, combatants }, isDirty: true };
      }),

    removeCombatant: (combatantId) =>
      set((state) => {
        if (!state.encounter) return state;
        const removed = state.encounter.combatants.find((c) => c.id === combatantId) ?? null;
        const combatants = state.encounter.combatants
          .filter((c) => c.id !== combatantId)
          .map((c, i) => ({ ...c, sortOrder: i }));
        const currentCombatantId =
          state.encounter.currentCombatantId === combatantId
            ? null
            : state.encounter.currentCombatantId;
        return {
          encounter: { ...state.encounter, combatants, currentCombatantId },
          selectedCombatantId:
            state.selectedCombatantId === combatantId ? null : state.selectedCombatantId,
          pendingRemove: removed,
          isDirty: true,
        };
      }),

    restoreLastRemoved: () =>
      set((state) => {
        if (!state.encounter || !state.pendingRemove) return state;
        const restored = state.pendingRemove;
        const combatants = sortedByInitiative([
          ...state.encounter.combatants,
          restored,
        ]).map((c, i) => ({ ...c, sortOrder: i }));
        return {
          encounter: { ...state.encounter, combatants },
          pendingRemove: null,
          isDirty: true,
        };
      }),

    clearPendingRemove: () => set({ pendingRemove: null }),

    nextTurn: () =>
      set((state) => {
        if (!state.encounter) return state;
        const visible = state.encounter.combatants.filter((c) => c.isVisible);
        if (visible.length === 0) return state;
        const sorted = [...visible].sort((a, b) => a.sortOrder - b.sortOrder);
        const currentIdx = sorted.findIndex(
          (c) => c.id === state.encounter!.currentCombatantId
        );
        let nextIdx = currentIdx + 1;
        let round = state.encounter.round;
        if (nextIdx >= sorted.length) {
          nextIdx = 0;
          round += 1;
        }
        return {
          encounter: {
            ...state.encounter,
            currentCombatantId: sorted[nextIdx].id,
            round,
          },
          isDirty: true,
        };
      }),

    prevTurn: () =>
      set((state) => {
        if (!state.encounter) return state;
        const visible = state.encounter.combatants.filter((c) => c.isVisible);
        if (visible.length === 0) return state;
        const sorted = [...visible].sort((a, b) => a.sortOrder - b.sortOrder);
        const currentIdx = sorted.findIndex(
          (c) => c.id === state.encounter!.currentCombatantId
        );
        let prevIdx = currentIdx - 1;
        let round = state.encounter.round;
        if (prevIdx < 0) {
          prevIdx = sorted.length - 1;
          round = Math.max(1, round - 1);
        }
        return {
          encounter: {
            ...state.encounter,
            currentCombatantId: sorted[prevIdx].id,
            round,
          },
          isDirty: true,
        };
      }),

    startEncounter: () =>
      set((state) => {
        if (!state.encounter) return state;
        const visible = state.encounter.combatants.filter((c) => c.isVisible);
        const sorted = [...visible].sort((a, b) => a.sortOrder - b.sortOrder);
        return {
          encounter: {
            ...state.encounter,
            status: "active",
            round: 1,
            currentCombatantId: sorted[0]?.id ?? null,
          },
          isDirty: true,
        };
      }),

    endEncounter: () =>
      set((state) => {
        if (!state.encounter) return state;
        return {
          encounter: { ...state.encounter, status: "completed" },
          isDirty: true,
        };
      }),

    resetRound: () =>
      set((state) => {
        if (!state.encounter) return state;
        return {
          encounter: { ...state.encounter, round: 1, status: "idle", currentCombatantId: null },
          isDirty: true,
        };
      }),
  }))
);
