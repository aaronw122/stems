import type { ServerWebSocket } from 'bun';
import type { WeftNode, WeftEdge, ServerMessage } from '../shared/types.ts';

// ── In-memory state ──────────────────────────────────────────────────

const nodes = new Map<string, WeftNode>();
const edges: WeftEdge[] = [];
const doneList: WeftNode[] = [];

// ── WebSocket client tracking ────────────────────────────────────────

const clients = new Set<ServerWebSocket<unknown>>();
const terminalSubscriptions = new Map<string, Set<ServerWebSocket<unknown>>>();

// ── Server-side terminal buffers (for context summarization) ────────

const MAX_SERVER_LINES = 200;
const terminalBuffers = new Map<string, string[]>();

export function appendTerminalLines(nodeId: string, lines: string[]): void {
  const existing = terminalBuffers.get(nodeId) ?? [];
  const combined = [...existing, ...lines];
  const trimmed = combined.length > MAX_SERVER_LINES
    ? combined.slice(combined.length - MAX_SERVER_LINES)
    : combined;
  terminalBuffers.set(nodeId, trimmed);
}

export function getTerminalLines(nodeId: string, lastN?: number): string[] {
  const buf = terminalBuffers.get(nodeId) ?? [];
  if (lastN && lastN < buf.length) {
    return buf.slice(buf.length - lastN);
  }
  return [...buf];
}

export function clearTerminalBuffer(nodeId: string): void {
  terminalBuffers.delete(nodeId);
}

// ── Human-needed helpers ─────────────────────────────────────────────

/** Clear human-needed flags without touching nodeState (callers manage state transitions) */
export function clearHumanNeeded(nodeId: string): void {
  const node = nodes.get(nodeId);
  if (!node?.needsHuman) return;

  const updated = { ...node, needsHuman: false, humanNeededType: null, humanNeededPayload: null } as WeftNode;
  nodes.set(nodeId, updated);
  broadcast({ type: 'node_updated', node: updated });
}

// ── CRUD ─────────────────────────────────────────────────────────────

export function addNode(node: WeftNode): void {
  nodes.set(node.id, node);
}

export function updateNode(id: string, patch: Partial<WeftNode>): WeftNode | null {
  const existing = nodes.get(id);
  if (!existing) return null;
  const updated = { ...existing, ...patch } as WeftNode;
  nodes.set(id, updated);
  return updated;
}

export function removeNode(id: string): WeftNode | null {
  const node = nodes.get(id);
  if (!node) return null;
  nodes.delete(id);
  // Remove related edges
  const toRemove = new Set<number>();
  for (let i = edges.length - 1; i >= 0; i--) {
    if (edges[i]!.source === id || edges[i]!.target === id) {
      toRemove.add(i);
    }
  }
  for (const i of [...toRemove].sort((a, b) => b - a)) {
    edges.splice(i, 1);
  }
  return node;
}

export function getNode(id: string): WeftNode | undefined {
  return nodes.get(id);
}

export function getAllNodes(): WeftNode[] {
  return [...nodes.values()];
}

export function getEdges(): WeftEdge[] {
  return [...edges];
}

export function addEdge(edge: WeftEdge): void {
  edges.push(edge);
}

export function addToDoneList(node: WeftNode): void {
  doneList.push(node);
}

export function getDoneList(): WeftNode[] {
  return [...doneList];
}

// ── Client management ────────────────────────────────────────────────

export function addClient(ws: ServerWebSocket<unknown>): void {
  clients.add(ws);
}

export function removeClient(ws: ServerWebSocket<unknown>): void {
  clients.delete(ws);
  // Clean up terminal subscriptions
  for (const [, subs] of terminalSubscriptions) {
    subs.delete(ws);
  }
}

export function getClients(): Set<ServerWebSocket<unknown>> {
  return clients;
}

// ── Terminal subscriptions ───────────────────────────────────────────

export function subscribeTerminal(nodeId: string, ws: ServerWebSocket<unknown>): void {
  let subs = terminalSubscriptions.get(nodeId);
  if (!subs) {
    subs = new Set();
    terminalSubscriptions.set(nodeId, subs);
  }
  subs.add(ws);
}

export function unsubscribeTerminal(nodeId: string, ws: ServerWebSocket<unknown>): void {
  const subs = terminalSubscriptions.get(nodeId);
  if (subs) {
    subs.delete(ws);
    if (subs.size === 0) {
      terminalSubscriptions.delete(nodeId);
    }
  }
}

// ── Broadcasting ─────────────────────────────────────────────────────

export function broadcast(msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    try {
      ws.send(data);
    } catch {
      // Client disconnected — will be cleaned up on close
    }
  }
}

export function broadcastTerminal(nodeId: string, lines: string[]): void {
  // Store lines server-side for context summarization
  appendTerminalLines(nodeId, lines);

  const subs = terminalSubscriptions.get(nodeId);
  if (!subs || subs.size === 0) return;

  const data = JSON.stringify({
    type: 'terminal_data',
    nodeId,
    lines,
  } satisfies ServerMessage);

  for (const ws of subs) {
    try {
      ws.send(data);
    } catch {
      // Client disconnected — will be cleaned up on close
    }
  }
}
