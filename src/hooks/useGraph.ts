import { create } from 'zustand';
import dagre from 'dagre';
import type { Node, Edge, NodeChange, EdgeChange } from '@xyflow/react';
import { applyNodeChanges as xyApplyNodeChanges, applyEdgeChanges as xyApplyEdgeChanges } from '@xyflow/react';
import type { WeftNode, WeftEdge, ServerMessage } from '../../shared/types.ts';

// ── Dagre layout ─────────────────────────────────────────────────────

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;
const SUBTASK_WIDTH = 160;
const SUBTASK_HEIGHT = 60;

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  newNodeIds?: Set<string>,
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 80, ranksep: 120 });

  for (const node of nodes) {
    const isSubtask = node.type === 'subtask';
    g.setNode(node.id, {
      width: isSubtask ? SUBTASK_WIDTH : NODE_WIDTH,
      height: isSubtask ? SUBTASK_HEIGHT : NODE_HEIGHT,
    });
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

    const isSubtask = node.type === 'subtask';
    const width = isSubtask ? SUBTASK_WIDTH : NODE_WIDTH;
    const height = isSubtask ? SUBTASK_HEIGHT : NODE_HEIGHT;

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
        // Auto-select spawned feature/subtask nodes to open terminal
        const autoSelect = msg.node.type === 'feature' || msg.node.type === 'subtask';
        set({ nodes, edges, ...(autoSelect ? { selectedNodeId: msg.node.id } : {}) });
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
        break;
      }

      case 'node_removed': {
        set((state) => ({
          nodes: state.nodes.filter((n) => n.id !== msg.nodeId),
          edges: state.edges.filter(
            (e) => e.source !== msg.nodeId && e.target !== msg.nodeId,
          ),
        }));
        break;
      }

      case 'done_list_updated': {
        set({ doneList: msg.doneList });
        break;
      }

      case 'terminal_data':
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
