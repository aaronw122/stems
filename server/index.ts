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
  clearTerminalBuffer,
  clearHumanNeeded,
  getTerminalLines,
} from './state.ts';
import { spawnSession, hasSession, killSession, killAllSessions, sendInput } from './session.ts';
import { getAllActiveFiles, clearNode as clearOverlapNode } from './overlap-tracker.ts';
import { stopPolling as stopPRPolling, stopTracking as stopPRTracking } from './pr-tracker.ts';
import { summarizeContext } from './context-summary.ts';
import { join, basename } from 'node:path';

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

// ── Overlap context builder ──────────────────────────────────────────

function buildOverlapContext(): string | undefined {
  const activeFiles = getAllActiveFiles();
  if (activeFiles.size === 0) return undefined;

  const parts: string[] = [];

  for (const [nId, files] of activeFiles) {
    const node = getNode(nId);
    const label = node ? node.title : nId;
    parts.push(`- ${label}: ${files.join(', ')}`);
  }

  return [
    'Other active sessions are currently editing files. Avoid modifying these files if possible:',
    ...parts,
  ].join('\n');
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
      node.prompt = msg.prompt;
      addNode(node);

      const edge: WeftEdge = {
        id: `${msg.parentId}-${node.id}`,
        source: msg.parentId,
        target: node.id,
      };
      addEdge(edge);
      broadcast({ type: 'node_added', node, edge });

      // Find repo path and spawn session (only if prompt provided;
      // interactive sessions defer spawn until the user sends first message
      // because `claude -p` exits immediately without a prompt)
      const repoPath = findRepoPath(msg.parentId);
      if (repoPath && msg.prompt) {
        // Build system prompt additions
        const promptParts: string[] = [];

        // For subtasks, inject parent's prompt as context
        if (childType === 'subtask') {
          const parentNode = getNode(msg.parentId);
          if (parentNode?.prompt) {
            promptParts.push(`Context from parent task: ${parentNode.prompt}`);
          }
        }

        // Inject overlap context so the session knows which files to avoid
        const overlapCtx = buildOverlapContext();
        if (overlapCtx) {
          promptParts.push(overlapCtx);
        }

        const appendSystemPrompt = promptParts.length > 0 ? promptParts.join('\n\n') : undefined;
        await spawnSession(node.id, repoPath, msg.prompt, appendSystemPrompt);
      } else if (!repoPath) {
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
      // Replay buffered terminal lines to the subscribing client only
      const bufferedLines = getTerminalLines(msg.nodeId);
      if (bufferedLines.length > 0) {
        ws.send(JSON.stringify({
          type: 'terminal_replay',
          nodeId: msg.nodeId,
          lines: bufferedLines,
        }));
      }
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
      clearOverlapNode(msg.nodeId);
      stopPRTracking(msg.nodeId);
      clearTerminalBuffer(msg.nodeId);
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

      // Clear human-needed for question/permission responses (not errors —
      // clearing an error state would resurrect a crashed node)
      const inputNode = getNode(nodeId);
      if (inputNode?.humanNeededType === 'question' || inputNode?.humanNeededType === 'permission') {
        clearHumanNeeded(nodeId);
      }

      // Deferred spawn: if no session exists yet (interactive mode), the user's
      // first text_input spawns the session with their message as the prompt.
      // This works around `claude -p` exiting immediately without a prompt arg.
      if (payload.kind === 'text_input' && !hasSession(nodeId)) {
        const repoPath = findRepoPath(nodeId);
        if (repoPath) {
          const promptParts: string[] = [];
          const node = getNode(nodeId);

          // For subtasks, inject parent context
          if (node?.type === 'subtask' && node.parentId) {
            const parentNode = getNode(node.parentId);
            if (parentNode?.prompt) {
              promptParts.push(`Context from parent task: ${parentNode.prompt}`);
            }
          }

          const overlapCtx = buildOverlapContext();
          if (overlapCtx) promptParts.push(overlapCtx);

          const appendSystemPrompt = promptParts.length > 0 ? promptParts.join('\n\n') : undefined;

          // Store the prompt on the node for future context
          if (node) {
            updateNode(nodeId, { prompt: payload.text });
          }

          await spawnSession(nodeId, repoPath, payload.text, appendSystemPrompt);
          break;
        }
      }

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

const server = Bun.serve({
  port: 4800,

  async fetch(req) {
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

    // Context summarization for subtask spawning
    const contextMatch = url.pathname.match(/^\/api\/context\/(.+)$/);
    if (contextMatch) {
      const nodeId = contextMatch[1]!;
      const node = getNode(nodeId);
      if (!node) {
        return new Response(JSON.stringify({ error: 'Node not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      try {
        const context = await summarizeContext(nodeId);
        return new Response(JSON.stringify({ context }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch {
        return new Response(JSON.stringify({ context: node.prompt ?? '' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Native folder picker via macOS osascript
    if (url.pathname === '/api/pick-folder') {
      try {
        const proc = Bun.spawn(
          ['osascript', '-e', 'POSIX path of (choose folder with prompt "Select a repository folder")'],
          { stdout: 'pipe', stderr: 'pipe' },
        );
        // Read stdout/stderr concurrently with waiting for exit (Bun streams close after exit)
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        if (exitCode !== 0) {
          console.log(`[pick-folder] cancelled or error (code ${exitCode}): ${stderr.trim()}`);
          return new Response(JSON.stringify({ cancelled: true }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const path = stdout.trim().replace(/\/$/, '');
        console.log(`[pick-folder] selected: ${path}`);
        return new Response(JSON.stringify({ path }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        console.error('[pick-folder] error:', err);
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
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

console.log(`stems server listening on http://localhost:${server.port}`);

// ── Graceful shutdown ────────────────────────────────────────────────

process.on('SIGTERM', async () => {
  console.log('[shutdown] SIGTERM received, killing sessions...');
  stopPRPolling();
  await killAllSessions();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[shutdown] SIGINT received, killing sessions...');
  stopPRPolling();
  await killAllSessions();
  process.exit(0);
});
