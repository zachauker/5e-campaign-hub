import { create } from "zustand";

interface UIState {
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  assistantOpen: boolean;
  assistantPending: string | null;
  setAssistantOpen: (open: boolean) => void;
  openAssistantWith: (question: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  assistantOpen: false,
  assistantPending: null,
  setAssistantOpen: (open) => set({ assistantOpen: open }),
  openAssistantWith: (question) => set({ assistantOpen: true, assistantPending: question }),
}));
