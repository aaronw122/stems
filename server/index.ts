import type { ServerWebSocket } from 'bun';
import type { ClientMessage, WeftNode, WeftEdge } from '../shared/types.ts';
import {
  addNode,
  updateNode,
  removeNode,
  getNode,
  getAllNodes,
  getEdges,
  addEdge,
  addToDoneList,
  getDoneList,
  addClient,
  removeClient,
  subscribeTerminal,
  unsubscribeTerminal,
  broadcast,
} from './state.ts';
import { spawnSession, killSession, killAllSessions, sendInput, cleanupStaleProcesses } from './session.ts';
import { join } from 'node:path';
import { basename } from 'node:path';

// ── Helpers ──────────────────────────────────────────────────────────

function makeId(): string {
  return crypto.randomUUID();
}

function makeRepoNode(repoPath: string): WeftNode {
  return {
    id: makeId(),
    type: 'repo',
    parentId: null,
    title: basename(repoPath),
    nodeState: 'idle',
    displayStage: 'planning',
    needsHuman: false,
    humanNeededType: null,
    humanNeededPayload: null,
    sessionId: null,
    errorInfo: null,
    overlap: { hasOverlap: false, overlappingNodes: [] },
    prUrl: null,
    prState: null,
    costUsd: 0,
    tokenUsage: { input: 0, output: 0 },
    x: 0,
    y: 0,
    repoPath,
  };
}

function makeChildNode(
  parentId: string,
  type: 'feature' | 'subtask',
  title: string,
): WeftNode {
  return {
    id: makeId(),
    type,
    parentId,
    title,
    nodeState: 'idle',
    displayStage: 'planning',
    needsHuman: false,
    humanNeededType: null,
    humanNeededPayload: null,
    sessionId: null,
    errorInfo: null,
    overlap: { hasOverlap: false, overlappingNodes: [] },
    prUrl: null,
    prState: null,
    costUsd: 0,
    tokenUsage: { input: 0, output: 0 },
    x: 0,
    y: 0,
  };
}

function findRepoPath(nodeId: string): string | null {
  let current = getNode(nodeId);
  while (current) {
    if (current.type === 'repo' && current.repoPath) {
      return current.repoPath;
    }
    if (current.parentId) {
      current = getNode(current.parentId);
    } else {
      break;
    }
  }
  return null;
}

// ── Message handler ──────────────────────────────────────────────────

async function handleMessage(ws: ServerWebSocket<unknown>, raw: string): Promise<void> {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw) as ClientMessage;
  } catch {
    ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
    return;
  }

  switch (msg.type) {
    case 'add_repo': {
      const node = makeRepoNode(msg.path);
      addNode(node);
      broadcast({ type: 'node_added', node, edge: null });
      break;
    }

    case 'spawn_feature':
    case 'spawn_subtask': {
      const childType = msg.type === 'spawn_feature' ? 'feature' : 'subtask';
      const node = makeChildNode(msg.parentId, childType as 'feature' | 'subtask', msg.title);
      addNode(node);

      const edge: WeftEdge = {
        id: `${msg.parentId}-${node.id}`,
        source: msg.parentId,
        target: node.id,
      };
      addEdge(edge);
      broadcast({ type: 'node_added', node, edge });

      // Find repo path and spawn session
      const repoPath = findRepoPath(msg.parentId);
      if (repoPath) {
        await spawnSession(node.id, repoPath, msg.prompt);
      } else {
        const updated = updateNode(node.id, {
          nodeState: 'crashed',
          errorInfo: { type: 'no_repo', message: 'Could not find repo path for this node' },
        });
        if (updated) {
          broadcast({ type: 'node_updated', node: updated });
        }
      }
      break;
    }

    case 'subscribe_terminal': {
      subscribeTerminal(msg.nodeId, ws);
      break;
    }

    case 'unsubscribe_terminal': {
      unsubscribeTerminal(msg.nodeId, ws);
      break;
    }

    case 'update_title': {
      const updated = updateNode(msg.nodeId, { title: msg.title });
      if (updated) {
        broadcast({ type: 'node_updated', node: updated });
      }
      break;
    }

    case 'close_node': {
      await killSession(msg.nodeId);
      const removed = removeNode(msg.nodeId);
      if (removed) {
        addToDoneList(removed);
        broadcast({ type: 'node_removed', nodeId: msg.nodeId });
        broadcast({ type: 'done_list_updated', doneList: getDoneList() });
      }
      break;
    }

    case 'node_moved': {
      const updated = updateNode(msg.nodeId, { x: msg.x, y: msg.y });
      if (updated) {
        broadcast({ type: 'node_updated', node: updated });
      }
      break;
    }

    case 'send_input': {
      const { nodeId, payload } = msg;
      switch (payload.kind) {
        case 'question_answer':
          sendInput(nodeId, payload.answer);
          break;
        case 'permission':
          sendInput(nodeId, payload.granted ? 'yes' : 'no');
          break;
        case 'text_input':
          sendInput(nodeId, payload.text);
          break;
      }
      break;
    }

    default: {
      ws.send(JSON.stringify({ type: 'error', message: `Unknown message type` }));
    }
  }
}

// ── Server ───────────────────────────────────────────────────────────

// Cleanup stale processes from previous runs
await cleanupStaleProcesses();

const server = Bun.serve({
  port: 4800,

  fetch(req) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === '/ws') {
      const success = server.upgrade(req);
      if (success) return undefined;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    // Health check
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Static file serving for production builds
    const filePath = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = Bun.file(join('dist', filePath));
    return file.exists().then((exists) => {
      if (exists) return new Response(file);
      return new Response('Not Found', { status: 404 });
    });
  },

  websocket: {
    open(ws: ServerWebSocket<unknown>) {
      addClient(ws);
      // Send full state to the new client
      const fullState = {
        type: 'full_state' as const,
        nodes: getAllNodes(),
        edges: getEdges(),
        doneList: getDoneList(),
      };
      ws.send(JSON.stringify(fullState));
    },

    message(ws: ServerWebSocket<unknown>, message: string | Buffer) {
      const raw = typeof message === 'string' ? message : message.toString();
      handleMessage(ws, raw).catch((err) => {
        console.error('[ws] message handler error:', err);
        ws.send(JSON.stringify({ type: 'error', message: 'Internal server error' }));
      });
    },

    close(ws: ServerWebSocket<unknown>) {
      removeClient(ws);
    },
  },
});

console.log(`weft-flow server listening on http://localhost:${server.port}`);

// ── Graceful shutdown ────────────────────────────────────────────────

process.on('SIGTERM', async () => {
  console.log('[shutdown] SIGTERM received, killing sessions...');
  await killAllSessions();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[shutdown] SIGINT received, killing sessions...');
  await killAllSessions();
  process.exit(0);
});
