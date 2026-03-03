import { create } from 'zustand';
import type { TerminalMessage, QueuedMessage } from '../../shared/types.ts';

const MAX_MESSAGES = 500;

interface TerminalState {
  buffers: Map<string, TerminalMessage[]>;
  queues: Map<string, QueuedMessage[]>;
  appendMessages: (nodeId: string, messages: TerminalMessage[]) => void;
  setMessages: (nodeId: string, messages: TerminalMessage[]) => void;
  setQueue: (nodeId: string, messages: QueuedMessage[]) => void;
  getMessages: (nodeId: string) => TerminalMessage[];
  clear: (nodeId: string) => void;
}

export const useTerminal = create<TerminalState>((set, get) => ({
  buffers: new Map(),
  queues: new Map(),

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

      let trimmed: TerminalMessage[];
      if (merged.length > MAX_MESSAGES) {
        const hasBanner = merged[0]?.type === 'session_banner';
        if (hasBanner) {
          trimmed = [merged[0]!, ...merged.slice(merged.length - (MAX_MESSAGES - 1))];
        } else {
          trimmed = merged.slice(merged.length - MAX_MESSAGES);
        }
      } else {
        trimmed = merged;
      }
      newBuffers.set(nodeId, trimmed);
      return { buffers: newBuffers };
    });
  },

  setMessages(nodeId: string, messages: TerminalMessage[]) {
    set((state) => {
      const newBuffers = new Map(state.buffers);
      // Trim to MAX_MESSAGES, keeping newest (pin banner at index 0)
      let trimmed: TerminalMessage[];
      if (messages.length > MAX_MESSAGES) {
        const hasBanner = messages[0]?.type === 'session_banner';
        if (hasBanner) {
          trimmed = [messages[0]!, ...messages.slice(messages.length - (MAX_MESSAGES - 1))];
        } else {
          trimmed = messages.slice(messages.length - MAX_MESSAGES);
        }
      } else {
        trimmed = messages;
      }
      newBuffers.set(nodeId, trimmed);
      return { buffers: newBuffers };
    });
  },

  setQueue(nodeId: string, messages: QueuedMessage[]) {
    set((state) => {
      const newQueues = new Map(state.queues);
      if (messages.length === 0) {
        newQueues.delete(nodeId);
      } else {
        newQueues.set(nodeId, messages);
      }
      return { queues: newQueues };
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
