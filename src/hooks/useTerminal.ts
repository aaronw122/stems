import { create } from 'zustand';

const MAX_LINES = 500;

interface TerminalState {
  buffers: Map<string, string[]>;
  appendLines: (nodeId: string, lines: string[]) => void;
  setLines: (nodeId: string, lines: string[]) => void;
  getLines: (nodeId: string) => string[];
  clear: (nodeId: string) => void;
}

export const useTerminal = create<TerminalState>((set, get) => ({
  buffers: new Map(),

  appendLines(nodeId: string, lines: string[]) {
    set((state) => {
      const newBuffers = new Map(state.buffers);
      const existing = newBuffers.get(nodeId) ?? [];
      const combined = [...existing, ...lines];
      // Trim to MAX_LINES, keeping newest
      const trimmed = combined.length > MAX_LINES
        ? combined.slice(combined.length - MAX_LINES)
        : combined;
      newBuffers.set(nodeId, trimmed);
      return { buffers: newBuffers };
    });
  },

  setLines(nodeId: string, lines: string[]) {
    set((state) => {
      const newBuffers = new Map(state.buffers);
      // Trim to MAX_LINES, keeping newest
      const trimmed = lines.length > MAX_LINES
        ? lines.slice(lines.length - MAX_LINES)
        : lines;
      newBuffers.set(nodeId, trimmed);
      return { buffers: newBuffers };
    });
  },

  getLines(nodeId: string) {
    return get().buffers.get(nodeId) ?? [];
  },

  clear(nodeId: string) {
    set((state) => {
      const newBuffers = new Map(state.buffers);
      newBuffers.delete(nodeId);
      return { buffers: newBuffers };
    });
  },
}));
