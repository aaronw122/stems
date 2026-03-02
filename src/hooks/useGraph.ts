import { create } from 'zustand';
import dagre from 'dagre';
import type { Node, Edge, NodeChange, EdgeChange } from '@xyflow/react';
import { applyNodeChanges as xyApplyNodeChanges, applyEdgeChanges as xyApplyEdgeChanges } from '@xyflow/react';
import type { WeftNode, WeftEdge, ServerMessage } from '../../shared/types.ts';
import { useSubagents } from './useSubagents.ts';

// ── Dagre layout ─────────────────────────────────────────────────────

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;
const SUBTASK_WIDTH = 160;
const SUBTASK_HEIGHT = 60;
const PHANTOM_WIDTH = 140;
const PHANTOM_HEIGHT = 44;

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  newNodeIds?: Set<string>,
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 80, ranksep: 120 });

  for (const node of nodes) {
    let width = NODE_WIDTH;
    let height = NODE_HEIGHT;
    if (node.type === 'phantom') {
      width = PHANTOM_WIDTH;
      height = PHANTOM_HEIGHT;
    } else if (node.type === 'subtask') {
      width = SUBTASK_WIDTH;
      height = SUBTASK_HEIGHT;
    }
    g.setNode(node.id, { width, height });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const dagreNode = g.node(node.id);
    // Only apply layout to new nodes (or all if newNodeIds not specified)
    if (newNodeIds && !newNodeIds.has(node.id)) {
      return node;
    }

    let width = NODE_WIDTH;
    let height = NODE_HEIGHT;
    if (node.type === 'phantom') {
      width = PHANTOM_WIDTH;
      height = PHANTOM_HEIGHT;
    } else if (node.type === 'subtask') {
      width = SUBTASK_WIDTH;
      height = SUBTASK_HEIGHT;
    }

    return {
      ...node,
      position: {
        x: dagreNode.x - width / 2,
        y: dagreNode.y - height / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

// ── Convert WeftNode to React Flow Node ──────────────────────────────

function toFlowNode(node: WeftNode): Node {
  return {
    id: node.id,
    type: node.type,
    position: { x: node.x, y: node.y },
    data: { ...node },
  };
}

function toFlowEdge(edge: WeftEdge): Edge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
  };
}

// ── Terminal window rect ─────────────────────────────────────────────

export interface TerminalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── Zustand store ────────────────────────────────────────────────────

interface GraphState {
  nodes: Node[];
  edges: Edge[];
  doneList: WeftNode[];
  selectedNodeId: string | null;
  terminalRect: TerminalRect | null;
  processMessage: (msg: ServerMessage) => void;
  setSelectedNode: (id: string | null) => void;
  setTerminalRect: (rect: TerminalRect) => void;
  onNodeDragStop: (id: string, x: number, y: number) => void;
  applyNodeChanges: (changes: NodeChange[]) => void;
  applyEdgeChanges: (changes: EdgeChange[]) => void;
  relayout: () => void;
}

export const useGraph = create<GraphState>((set, get) => ({
  nodes: [],
  edges: [],
  doneList: [],
  selectedNodeId: null,
  terminalRect: null,

  processMessage(msg: ServerMessage) {
    switch (msg.type) {
      case 'full_state': {
        const flowNodes = msg.nodes.map(toFlowNode);
        const flowEdges = msg.edges.map(toFlowEdge);
        const { nodes, edges } = getLayoutedElements(flowNodes, flowEdges);
        set({ nodes, edges, doneList: msg.doneList });

        // Initialize subagent tracking for any existing phantom nodes
        const subagentStore = useSubagents.getState();
        for (const node of msg.nodes) {
          if (node.isPhantomSubagent) {
            subagentStore.updateFromNode(node);
          }
        }
        break;
      }

      case 'node_added': {
        const newNode = toFlowNode(msg.node);
        const { nodes: currentNodes, edges: currentEdges } = get();
        const allNodes = [...currentNodes, newNode];
        const allEdges = msg.edge
          ? [...currentEdges, toFlowEdge(msg.edge)]
          : [...currentEdges];

        const newNodeIds = new Set([msg.node.id]);
        const { nodes, edges } = getLayoutedElements(allNodes, allEdges, newNodeIds);
        // Auto-select spawned feature/subtask nodes to open terminal.
        // Skip phantom subagent nodes — they would steal focus from the parent terminal.
        const autoSelect = (msg.node.type === 'feature' || msg.node.type === 'subtask')
          && !msg.node.isPhantomSubagent;
        set({ nodes, edges, ...(autoSelect ? { selectedNodeId: msg.node.id } : {}) });

        // Track phantom subagents in the dedicated store
        if (msg.node.isPhantomSubagent) {
          useSubagents.getState().updateFromNode(msg.node);
        }
        break;
      }

      case 'node_updated': {
        set((state) => ({
          nodes: state.nodes.map((n) =>
            n.id === msg.node.id
              ? { ...n, data: { ...msg.node } }
              : n,
          ),
        }));

        // Keep the subagent summary widget in sync
        if (msg.node.isPhantomSubagent) {
          useSubagents.getState().updateFromNode(msg.node);
        }
        break;
      }

      case 'node_removed': {
        // Clean up subagent tracking before removing the node
        useSubagents.getState().removeSubagent(msg.nodeId);

        set((state) => ({
          nodes: state.nodes.filter((n) => n.id !== msg.nodeId),
          edges: state.edges.filter(
            (e) => e.source !== msg.nodeId && e.target !== msg.nodeId,
          ),
          // Clear selection if the removed node was selected (phantom nodes auto-remove)
          ...(state.selectedNodeId === msg.nodeId ? { selectedNodeId: null } : {}),
        }));
        break;
      }

      case 'tree_removed': {
        const removedSet = new Set(msg.nodeIds);
        // Clean up any phantom subagents in the removed tree
        const subagentStore = useSubagents.getState();
        for (const nodeId of msg.nodeIds) {
          subagentStore.removeSubagent(nodeId);
        }
        set((state) => ({
          nodes: state.nodes.filter((n) => !removedSet.has(n.id)),
          edges: state.edges.filter(
            (e) => !removedSet.has(e.source) && !removedSet.has(e.target),
          ),
          ...(state.selectedNodeId && removedSet.has(state.selectedNodeId)
            ? { selectedNodeId: null }
            : {}),
        }));
        break;
      }

      case 'done_list_updated': {
        set({ doneList: msg.doneList });
        break;
      }

      case 'terminal_data':
      case 'terminal_replay':
      case 'error':
        // These are handled elsewhere (terminal panel, error toasts)
        break;
    }
  },

  setSelectedNode(id: string | null) {
    set({ selectedNodeId: id });
  },

  setTerminalRect(rect: TerminalRect) {
    set({ terminalRect: rect });
  },

  onNodeDragStop(id: string, x: number, y: number) {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === id ? { ...n, position: { x, y } } : n,
      ),
    }));
  },

  applyNodeChanges(changes: NodeChange[]) {
    set((state) => ({
      nodes: xyApplyNodeChanges(changes, state.nodes),
    }));
  },

  applyEdgeChanges(changes: EdgeChange[]) {
    set((state) => ({
      edges: xyApplyEdgeChanges(changes, state.edges),
    }));
  },

  relayout() {
    const { nodes, edges } = get();
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(nodes, edges);
    set({ nodes: layoutedNodes, edges: layoutedEdges });
  },
}));
