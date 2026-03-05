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
  broadcastTerminal,
  clearTerminalBuffer,
  clearHumanNeeded,
  getTerminalMessages,
  getDescendants,
  clearTerminalSubscriptions,
  removeFromDoneList,
  hydrateState,
  hydrateTerminalBuffers,
  flushSave,
  removePhantomNode,
  getPhantomNode,
} from './state.ts';
import { spawnSession, hasSession, killSession, killAllSessions, sendInput, isSessionBusy, dequeueInput, getSlashCommands, generateFeatureTitle, getPendingInputs } from './session.ts';
import { autoMoveIfComplete } from './completion.ts';
import { getAllActiveFiles, clearNode as clearOverlapNode } from './overlap-tracker.ts';
import { stopPolling as stopPRPolling, stopTracking as stopPRTracking } from './pr-tracker.ts';
import { summarizeContext } from './context-summary.ts';
import { loadWorkspace, loadTerminals } from './persistence.ts';
import { getCustomSkills } from './skill-scanner.ts';
import { bootstrapServerConfig, getProviderRolloutFlagSnapshot } from './config.ts';
import { join, basename, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';

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
    contextPercent: null,
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
    contextPercent: null,
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
        broadcastTerminal(node.id, [{ type: 'user_message', text: msg.prompt }]);
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
      // Replay buffered terminal messages to the subscribing client only
      const bufferedMessages = getTerminalMessages(msg.nodeId);
      if (bufferedMessages.length > 0) {
        ws.send(JSON.stringify({
          type: 'terminal_replay',
          nodeId: msg.nodeId,
          messages: bufferedMessages,
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

    case 'stop_session': {
      const node = getNode(msg.nodeId);
      if (!node) break;

      // Save pending inputs before killing — killSession clears the client queue
      const pendingInputs = getPendingInputs(msg.nodeId);

      await killSession(msg.nodeId);
      clearOverlapNode(msg.nodeId);

      // Feature nodes go idle (can receive new input), subtasks go completed
      const nextState = node.type === 'feature' ? 'idle' : 'completed';
      const updated = updateNode(msg.nodeId, {
        nodeState: nextState,
        needsHuman: false,
        humanNeededType: null,
        humanNeededPayload: null,
      });
      if (updated) {
        broadcast({ type: 'node_updated', node: updated });
        if (nextState === 'completed') {
          autoMoveIfComplete(msg.nodeId);
        }
      }

      broadcastTerminal(msg.nodeId, [{ type: 'system', text: 'Session stopped by user (^C)' }]);

      // Auto-send queued messages for feature nodes (deferred spawn creates a new session)
      if (node.type === 'feature' && pendingInputs.length > 0) {
        const combinedText = pendingInputs.map((m) => m.text).join('\n\n');
        const allImages = pendingInputs.flatMap((m) => m.images ?? []);
        const repoPath = findRepoPath(msg.nodeId);

        if (repoPath) {
          // Show queued messages in terminal
          for (const pending of pendingInputs) {
            broadcastTerminal(msg.nodeId, [{ type: 'user_message', text: pending.text }]);
          }

          const promptParts: string[] = [];
          const overlapCtx = buildOverlapContext();
          if (overlapCtx) promptParts.push(overlapCtx);
          const appendSystemPrompt = promptParts.length > 0 ? promptParts.join('\n\n') : undefined;

          await spawnSession(
            msg.nodeId,
            repoPath,
            combinedText,
            appendSystemPrompt,
            allImages.length > 0 ? allImages : undefined,
          );
        }
      }
      break;
    }

    case 'close_node': {
      await killSession(msg.nodeId);
      clearOverlapNode(msg.nodeId);
      stopPRTracking(msg.nodeId);
      clearTerminalBuffer(msg.nodeId);
      // Phantom nodes live in a separate map — try phantom first, then main
      const phantomRemoved = getPhantomNode(msg.nodeId) ? removePhantomNode(msg.nodeId) : null;
      if (phantomRemoved) {
        // Phantom nodes are transient — never enter the done list.
        // removePhantomNode already broadcasts node_removed.
        break;
      }
      const removed = removeNode(msg.nodeId);
      if (removed) {
        addToDoneList(removed);
        broadcast({ type: 'done_list_updated', doneList: getDoneList() });
        broadcast({ type: 'node_removed', nodeId: msg.nodeId });
      }
      break;
    }

    case 'delete_tree': {
      const descendantIds = getDescendants(msg.nodeId);
      const allIds = [...descendantIds, msg.nodeId]; // children first, root last

      let donePruned = false;
      for (const id of allIds) {
        await killSession(id);
        clearOverlapNode(id);
        stopPRTracking(id);
        clearTerminalBuffer(id);
        clearTerminalSubscriptions(id);
        if (removeFromDoneList(id)) donePruned = true;
        removeNode(id);
      }

      broadcast({ type: 'tree_removed', nodeIds: allIds });
      if (donePruned) {
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

            // Fire-and-forget: generate a smart title via LLM
            generateFeatureTitle(nodeId, payload.text, repoPath);
          }

          const spawnImages = payload.images;
          const spawnDisplayText = spawnImages && spawnImages.length > 0
            ? `${spawnImages.map((img) => `[${img.name}]`).join(' ')} ${payload.text}`
            : payload.text;
          broadcastTerminal(nodeId, [{ type: 'user_message', text: spawnDisplayText }]);
          await spawnSession(nodeId, repoPath, payload.text, appendSystemPrompt, spawnImages, node?.sessionId ?? undefined);
          break;
        }
      }

      switch (payload.kind) {
        case 'question_answer':
          broadcastTerminal(nodeId, [{ type: 'user_message', text: payload.answer }]);
          sendInput(nodeId, payload.answer);
          break;
        case 'permission':
          broadcastTerminal(nodeId, [{ type: 'user_message', text: payload.granted ? 'yes' : 'no' }]);
          sendInput(nodeId, payload.granted ? 'yes' : 'no');
          break;
        case 'text_input': {
          const images = payload.images;
          const status = sendInput(nodeId, payload.text, images);
          // Only show the message immediately if it was sent (not queued).
          // Queued messages appear below the thinking indicator on the client,
          // and get broadcast as regular user_messages when the turn completes.
          if (status !== 'queued') {
            const displayText = images && images.length > 0
              ? `${images.map((img) => `[${img.name}]`).join(' ')} ${payload.text}`
              : payload.text;
            broadcastTerminal(nodeId, [{ type: 'user_message', text: displayText }]);
          }
          break;
        }
      }
      break;
    }

    case 'dequeue': {
      dequeueInput(msg.nodeId, msg.action);
      break;
    }

    default: {
      ws.send(JSON.stringify({ type: 'error', message: `Unknown message type` }));
    }
  }
}

// ── Restore persisted workspace ──────────────────────────────────────

const serverConfig = bootstrapServerConfig();

const savedWorkspace = await loadWorkspace();
if (savedWorkspace) {
  hydrateState(savedWorkspace);

  // Legacy cleanup: remove any phantom subagent nodes that leaked into
  // persistence from the previous implementation (before phantom nodes were
  // stored in a separate in-memory map). Safe to remove once all workspaces
  // have been cleaned.
  const phantomIds = getAllNodes()
    .filter((n) => n.isPhantomSubagent)
    .map((n) => n.id);
  for (const id of phantomIds) {
    removeNode(id);
  }
  if (phantomIds.length > 0) {
    console.log(`[startup] Cleaned up ${phantomIds.length} legacy phantom node(s) from persistence`);
  }

  console.log(`[startup] Restored workspace: ${savedWorkspace.nodes.length - phantomIds.length} node(s), ${savedWorkspace.doneList.length} done`);
} else {
  console.log('[startup] No saved workspace found, starting fresh');
}

// Restore terminal buffers (separate from workspace to keep files independent)
const savedTerminals = await loadTerminals();
if (savedTerminals) {
  hydrateTerminalBuffers(savedTerminals);
  console.log(`[startup] Restored terminal buffers for ${savedTerminals.size} node(s)`);
}

// ── Server ───────────────────────────────────────────────────────────

const server = Bun.serve({
  port: 7482,
  idleTimeout: 120, // seconds — osascript folder picker blocks until user responds

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
      return new Response(JSON.stringify({
        status: 'ok',
        configLoadedAt: serverConfig.loadedAt,
        rolloutFlags: getProviderRolloutFlagSnapshot(serverConfig.providerRollout),
      }), {
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

    // Read a markdown file from disk
    if (url.pathname === '/api/read-file') {
      const filePath = url.searchParams.get('path');
      const cwd = url.searchParams.get('cwd');
      if (!filePath) {
        return new Response(JSON.stringify({ error: 'Missing "path" query parameter' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (!filePath.endsWith('.md')) {
        return new Response(JSON.stringify({ error: 'Only .md files are supported' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      try {
        // Try multiple resolutions for relative paths
        const candidates: string[] = [];
        if (filePath.startsWith('/')) {
          candidates.push(filePath);
        } else if (cwd) {
          // Try cwd first, then parent of cwd (handles repo-root-relative paths)
          candidates.push(`${cwd}/${filePath}`);
          const parentCwd = cwd.replace(/\/[^/]+$/, '');
          if (parentCwd !== cwd) candidates.push(`${parentCwd}/${filePath}`);
        }
        // Always try the raw path last
        candidates.push(filePath);

        for (const candidate of candidates) {
          const file = Bun.file(candidate);
          if (await file.exists()) {
            const content = await file.text();
            return new Response(JSON.stringify({ content, path: candidate }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }
        return new Response(JSON.stringify({ error: 'File not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        console.error('[read-file] error:', err);
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Editable markdown file (opens in new window as a simple text editor)
    if (url.pathname === '/api/view-md') {
      const filePath = url.searchParams.get('path');
      const cwd = url.searchParams.get('cwd');
      if (!filePath || !filePath.endsWith('.md')) {
        return new Response('Missing or invalid path', { status: 400 });
      }
      try {
        const candidates: string[] = [];
        if (filePath.startsWith('/')) {
          candidates.push(filePath);
        } else if (cwd) {
          candidates.push(`${cwd}/${filePath}`);
          const parentCwd = cwd.replace(/\/[^/]+$/, '');
          if (parentCwd !== cwd) candidates.push(`${parentCwd}/${filePath}`);
        }
        candidates.push(filePath);

        let content: string | null = null;
        let resolvedPath = filePath;
        for (const candidate of candidates) {
          const file = Bun.file(candidate);
          if (await file.exists()) {
            content = await file.text();
            resolvedPath = candidate;
            break;
          }
        }
        if (content === null) {
          return new Response('File not found', { status: 404 });
        }

        const fileName = resolvedPath.split('/').pop() ?? resolvedPath;
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${fileName}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
    font-size: 13px;
    line-height: 1.6;
    color: #e4e4e7;
    background: #18181b;
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .header {
    padding: 8px 16px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    font-size: 11px;
    color: #71717a;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  }
  .header .path { word-break: break-all; }
  .header .status { color: #22c55e; opacity: 0; transition: opacity 300ms; }
  .header .status.visible { opacity: 1; }
  textarea {
    flex: 1;
    width: 100%;
    padding: 16px 20px;
    background: transparent;
    color: #e4e4e7;
    border: none;
    outline: none;
    resize: none;
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    tab-size: 2;
  }
</style>
</head>
<body>
<div class="header">
  <span class="path">${resolvedPath}</span>
  <span class="status" id="status">Saved</span>
</div>
<textarea id="editor" spellcheck="false">${content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
<script>
  const editor = document.getElementById('editor');
  const status = document.getElementById('status');
  const filePath = ${JSON.stringify(resolvedPath)};
  let saveTimer = null;
  let dirty = false;

  function save() {
    if (!dirty) return;
    dirty = false;
    fetch('/api/save-md', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content: editor.value }),
    }).then(res => {
      if (res.ok) {
        status.classList.add('visible');
        setTimeout(() => status.classList.remove('visible'), 1500);
      }
    });
  }

  editor.addEventListener('input', () => {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 1000);
  });

  editor.addEventListener('blur', save);

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      save();
    }
  });
</script>
</body>
</html>`;
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      } catch (err) {
        console.error('[view-md] error:', err);
        return new Response(`Error: ${String(err)}`, { status: 500 });
      }
    }

    // POST /api/save-md — write markdown content back to disk
    if (url.pathname === '/api/save-md' && req.method === 'POST') {
      try {
        const body = await req.json() as { path?: string; content?: string };
        if (!body.path || typeof body.content !== 'string') {
          return new Response(JSON.stringify({ error: 'Missing path or content' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          });
        }
        if (!body.path.endsWith('.md')) {
          return new Response(JSON.stringify({ error: 'Only .md files' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          });
        }
        await Bun.write(body.path, body.content);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        console.error('[save-md] error:', err);
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // File listing for autocomplete (gitignore-respecting)
    const filesMatch = url.pathname.match(/^\/api\/files\/(.+)$/);
    if (filesMatch) {
      const nodeId = filesMatch[1]!;
      const repoPath = findRepoPath(nodeId);
      if (!repoPath) {
        return new Response(JSON.stringify({ error: 'Could not resolve repo path' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const query = url.searchParams.get('q') ?? '';

      try {
        const proc = Bun.spawn(
          ['git', 'ls-files', '--cached', '--others', '--exclude-standard'],
          { cwd: repoPath, stdout: 'pipe', stderr: 'pipe' },
        );
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        if (exitCode !== 0) {
          console.error(`[files] git ls-files failed (code ${exitCode}): ${stderr.trim()}`);
          return new Response(JSON.stringify({ error: 'git ls-files failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const lowerQuery = query.toLowerCase();
        const files: string[] = [];
        for (const line of stdout.split('\n')) {
          if (!line) continue;
          if (lowerQuery && !line.toLowerCase().includes(lowerQuery)) continue;
          files.push(line);
          if (files.length >= 100) break;
        }

        return new Response(JSON.stringify({ files, repoPath }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        console.error('[files] error:', err);
        return new Response(JSON.stringify({ error: String(err) }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Slash commands for autocomplete
    const commandsMatch = url.pathname.match(/^\/api\/commands\/(.+)$/);
    if (commandsMatch) {
      const nodeId = commandsMatch[1]!;
      const commands = getSlashCommands(nodeId);

      if (commands) {
        // Merge custom skills that aren't already in the SDK's command list
        const customSkills = getCustomSkills();
        const sessionNames = new Set(commands.map((c) => c.name));
        const extraSkills = customSkills.filter((s) => !sessionNames.has(s.name));
        const merged = [...commands, ...extraSkills];
        return new Response(JSON.stringify({ commands: merged, source: 'session' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Session hasn't initialized yet — return hardcoded built-in commands + custom skills
      const builtinCommands = [
        { name: 'help', description: 'Show available commands', argumentHint: '' },
        { name: 'clear', description: 'Clear conversation history', argumentHint: '' },
        { name: 'compact', description: 'Compact conversation to save context', argumentHint: '[instructions]' },
        { name: 'cost', description: 'Show token usage and cost', argumentHint: '' },
        { name: 'model', description: 'Switch or display the current model', argumentHint: '[model-name]' },
        { name: 'status', description: 'Show session status', argumentHint: '' },
        { name: 'review', description: 'Review a pull request', argumentHint: '[pr-url]' },
        { name: 'bug', description: 'Report a bug', argumentHint: '[description]' },
        { name: 'init', description: 'Initialize project configuration', argumentHint: '' },
        { name: 'config', description: 'Open or manage configuration', argumentHint: '' },
        { name: 'memory', description: 'Edit CLAUDE.md memory files', argumentHint: '' },
        { name: 'permissions', description: 'View or manage permissions', argumentHint: '' },
      ];

      // Merge custom skills — they take priority over hardcoded placeholders
      const customSkills = getCustomSkills();
      const customNames = new Set(customSkills.map((s) => s.name));
      const dedupedBuiltins = builtinCommands.filter((c) => !customNames.has(c.name));
      const fallbackCommands = [...dedupedBuiltins, ...customSkills];

      return new Response(JSON.stringify({ commands: fallbackCommands, source: 'fallback' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Resolve a local image file to base64 for image attachment
    if (url.pathname === '/api/resolve-image') {
      const nodeId = url.searchParams.get('nodeId');
      const imagePath = url.searchParams.get('path');

      if (!nodeId || !imagePath) {
        return new Response(JSON.stringify({ error: 'Missing nodeId or path parameter' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const repoPath = findRepoPath(nodeId);
      if (!repoPath) {
        return new Response(JSON.stringify({ error: 'Could not resolve repo path' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Resolve relative paths against the repo root
      const resolvedPath = imagePath.startsWith('/') ? imagePath : join(repoPath, imagePath);

      // Path traversal protection — resolved path must be within repo
      try {
        const normalizedRepo = await realpath(repoPath);
        const normalizedPath = await realpath(resolvedPath);
        if (!normalizedPath.startsWith(normalizedRepo + '/')) {
          return new Response(JSON.stringify({ error: 'Path outside repository' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch {
        return new Response(JSON.stringify({ error: 'File not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Validate extension
      const ext = resolvedPath.split('.').pop()?.toLowerCase();
      const mimeMap: Record<string, string> = {
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
      };
      const mediaType = ext ? mimeMap[ext] : undefined;
      if (!mediaType) {
        return new Response(JSON.stringify({ error: 'Unsupported image format' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      try {
        const file = Bun.file(resolvedPath);
        if (!(await file.exists())) {
          return new Response(JSON.stringify({ error: 'File not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const buffer = await file.arrayBuffer();
        const data = Buffer.from(buffer).toString('base64');
        const name = basename(resolvedPath);

        return new Response(JSON.stringify({ data, mediaType, name }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        console.error('[resolve-image] error:', err);
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
  console.log('[shutdown] SIGTERM received, saving workspace...');
  stopPRPolling();
  await flushSave();
  await killAllSessions();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[shutdown] SIGINT received, saving workspace...');
  stopPRPolling();
  await flushSave();
  await killAllSessions();
  process.exit(0);
});
