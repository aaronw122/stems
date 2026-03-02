import type { ServerWebSocket } from 'bun';
import type { WeftNode, WeftEdge, ServerMessage, TerminalMessage } from '../shared/types.ts';
import { scheduleSave, flushSave } from './persistence.ts';

export { flushSave };

// ── In-memory state ──────────────────────────────────────────────────

const nodes = new Map<string, WeftNode>();
const edges: WeftEdge[] = [];
const doneList: WeftNode[] = [];

// ── Persistence helpers ────────────────────────────────────────────────

export function getStateSnapshot(): { nodes: WeftNode[]; edges: WeftEdge[]; doneList: WeftNode[] } {
  return {
    nodes: [...nodes.values()],
    edges: [...edges],
    doneList: [...doneList],
  };
}

export function hydrateState(data: { nodes: WeftNode[]; edges: WeftEdge[]; doneList: WeftNode[] }): void {
  nodes.clear();
  edges.length = 0;
  doneList.length = 0;

  for (const node of data.nodes) {
    nodes.set(node.id, node);
  }
  for (const edge of data.edges) {
    edges.push(edge);
  }
  for (const node of data.doneList) {
    doneList.push(node);
  }
}

// ── WebSocket client tracking ────────────────────────────────────────

const clients = new Set<ServerWebSocket<unknown>>();
const terminalSubscriptions = new Map<string, Set<ServerWebSocket<unknown>>>();

// ── Server-side terminal buffers (for context summarization) ────────

const MAX_SERVER_MESSAGES = 200;
const terminalBuffers = new Map<string, TerminalMessage[]>();

export function appendTerminalMessages(nodeId: string, messages: TerminalMessage[]): void {
  if (messages.length === 0) return;
  const existing = terminalBuffers.get(nodeId) ?? [];

  // Merge consecutive assistant_text: if the tail of the buffer and the head
  // of the incoming batch are both assistant_text, concatenate their text
  // instead of creating a new entry.  This keeps the buffer compact and lets
  // the client render accumulated text as a single markdown block.
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

  const trimmed = merged.length > MAX_SERVER_MESSAGES
    ? merged.slice(merged.length - MAX_SERVER_MESSAGES)
    : merged;
  terminalBuffers.set(nodeId, trimmed);
}

export function getTerminalMessages(nodeId: string, lastN?: number): TerminalMessage[] {
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
  scheduleSave(getStateSnapshot);
}

// ── CRUD ─────────────────────────────────────────────────────────────

export function addNode(node: WeftNode): void {
  nodes.set(node.id, node);
  scheduleSave(getStateSnapshot);
}

/** Register a phantom (transient) node and edge without triggering persistence.
 *  Phantom nodes are ephemeral subagent visualizations that should not be saved
 *  to disk. The startup sweep in index.ts handles cleanup if they leak via updateNode. */
export function addPhantomNode(node: WeftNode, edge: WeftEdge): void {
  nodes.set(node.id, node);
  edges.push(edge);
  broadcast({ type: 'node_added', node, edge });
}

export function updateNode(id: string, patch: Partial<WeftNode>): WeftNode | null {
  const existing = nodes.get(id);
  if (!existing) return null;
  const updated = { ...existing, ...patch } as WeftNode;
  nodes.set(id, updated);
  scheduleSave(getStateSnapshot);
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
  scheduleSave(getStateSnapshot);
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
  scheduleSave(getStateSnapshot);
}

export function addToDoneList(node: WeftNode): void {
  doneList.push(node);
  scheduleSave(getStateSnapshot);
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

// ── Tree traversal helpers ────────────────────────────────────────────

export function getDescendants(nodeId: string): string[] {
  const snapshot = [...edges]; // snapshot — removeNode mutates edges in place
  const descendants: string[] = [];
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of snapshot) {
      if (edge.source === current) {
        descendants.push(edge.target);
        queue.push(edge.target);
      }
    }
  }
  return descendants;
}

export function clearTerminalSubscriptions(nodeId: string): void {
  terminalSubscriptions.delete(nodeId);
}

export function removeFromDoneList(nodeId: string): boolean {
  const idx = doneList.findIndex((n) => n.id === nodeId);
  if (idx === -1) return false;
  doneList.splice(idx, 1);
  scheduleSave(getStateSnapshot);
  return true;
}

export function broadcastTerminal(nodeId: string, messages: TerminalMessage[]): void {
  // Store messages server-side for context summarization
  appendTerminalMessages(nodeId, messages);

  const subs = terminalSubscriptions.get(nodeId);
  if (!subs || subs.size === 0) return;

  const data = JSON.stringify({
    type: 'terminal_data',
    nodeId,
    messages,
  } satisfies ServerMessage);

  for (const ws of subs) {
    try {
      ws.send(data);
    } catch {
      // Client disconnected — will be cleaned up on close
    }
  }
}
