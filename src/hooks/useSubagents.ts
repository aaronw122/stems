import { create } from 'zustand';
import type { WeftNode } from '../../shared/types.ts';

export interface SubagentInfo {
  name: string;
  toolUseCount: number;
  totalTokens: number;
  currentActivity: string;
  status: 'running' | 'completed' | 'crashed';
}

interface SubagentState {
  /** Active subagents keyed by node ID (not task ID — nodes are the source of truth on the frontend) */
  activeSubagents: Map<string, SubagentInfo>;

  /** Update a subagent's info from a node_updated message */
  updateFromNode: (node: WeftNode) => void;

  /** Remove a subagent when its phantom node is removed */
  removeSubagent: (nodeId: string) => void;

  /** Get count of currently running subagents for a parent node */
  getRunningCount: (parentNodeId: string, edges: { source: string; target: string }[]) => number;
}

export const useSubagents = create<SubagentState>((set, get) => ({
  activeSubagents: new Map(),

  updateFromNode(node: WeftNode) {
    if (!node.isPhantomSubagent) return;

    set((state) => {
      const next = new Map(state.activeSubagents);
      next.set(node.id, {
        name: node.title,
        toolUseCount: node.toolUseCount ?? 0,
        totalTokens: node.totalTokens ?? 0,
        currentActivity: node.currentActivity ?? '',
        status: node.nodeState === 'completed' ? 'completed'
          : node.nodeState === 'crashed' ? 'crashed'
          : 'running',
      });
      return { activeSubagents: next };
    });
  },

  removeSubagent(nodeId: string) {
    set((state) => {
      if (!state.activeSubagents.has(nodeId)) return state;
      const next = new Map(state.activeSubagents);
      next.delete(nodeId);
      return { activeSubagents: next };
    });
  },

  getRunningCount(_parentNodeId: string, _edges: { source: string; target: string }[]) {
    const { activeSubagents } = get();
    let count = 0;
    for (const info of activeSubagents.values()) {
      if (info.status === 'running') count++;
    }
    return count;
  },
}));
