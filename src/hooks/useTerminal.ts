import { create } from 'zustand';
import type { TerminalMessage } from '../../shared/types.ts';

const MAX_MESSAGES = 500;

interface TerminalState {
  buffers: Map<string, TerminalMessage[]>;
  appendMessages: (nodeId: string, messages: TerminalMessage[]) => void;
  setMessages: (nodeId: string, messages: TerminalMessage[]) => void;
  getMessages: (nodeId: string) => TerminalMessage[];
  clear: (nodeId: string) => void;
}

export const useTerminal = create<TerminalState>((set, get) => ({
  buffers: new Map(),

  appendMessages(nodeId: string, messages: TerminalMessage[]) {
    set((state) => {
      const newBuffers = new Map(state.buffers);
      const existing = newBuffers.get(nodeId) ?? [];
      const combined = [...existing, ...messages];
      // Trim to MAX_MESSAGES, keeping newest
      const trimmed = combined.length > MAX_MESSAGES
        ? combined.slice(combined.length - MAX_MESSAGES)
        : combined;
      newBuffers.set(nodeId, trimmed);
      return { buffers: newBuffers };
    });
  },

  setMessages(nodeId: string, messages: TerminalMessage[]) {
    set((state) => {
      const newBuffers = new Map(state.buffers);
      // Trim to MAX_MESSAGES, keeping newest
      const trimmed = messages.length > MAX_MESSAGES
        ? messages.slice(messages.length - MAX_MESSAGES)
        : messages;
      newBuffers.set(nodeId, trimmed);
      return { buffers: newBuffers };
    });
  },

  getMessages(nodeId: string) {
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
