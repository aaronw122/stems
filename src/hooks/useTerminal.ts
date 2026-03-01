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
    if (messages.length === 0) return;
    set((state) => {
      const newBuffers = new Map(state.buffers);
      const existing = newBuffers.get(nodeId) ?? [];

      // Merge consecutive assistant_text: if the tail of the buffer and the
      // head of the incoming batch are both assistant_text, concatenate their
      // text so markdown renders as a single block.
      let merged: TerminalMessage[];
      if (
        existing.length > 0 &&
        existing[existing.length - 1]!.type === 'assistant_text' &&
        messages[0]!.type === 'assistant_text'
      ) {
        merged = existing.slice();
        merged[merged.length - 1] = {
          ...merged[merged.length - 1]!,
          text: merged[merged.length - 1]!.text + messages[0]!.text,
        };
        for (let i = 1; i < messages.length; i++) merged.push(messages[i]!);
      } else {
        merged = [...existing, ...messages];
      }

      const trimmed = merged.length > MAX_MESSAGES
        ? merged.slice(merged.length - MAX_MESSAGES)
        : merged;
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
