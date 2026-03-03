import { query, AbortError } from '@anthropic-ai/claude-agent-sdk';
import type { Query, Options, SlashCommand, SDKSystemMessage } from '@anthropic-ai/claude-agent-sdk';
import { updateNode, getNode, broadcast, broadcastTerminal } from './state.ts';
import { createMessageProcessor } from './message-processor.ts';
import { autoMoveIfComplete } from './completion.ts';
import { expandSlashCommand } from './slash-expand.ts';

// ── Session tracking ────────────────────────────────────────────────
// Each session persists across multiple turns. Between turns, no query
// is active — the session just holds the SDK session_id for resumption.

interface Session {
  nodeId: string;
  sessionId: string | null;  // captured from SDK init message, used for resume
  repoPath: string;
  baseOptions: Omit<Options, 'abortController' | 'resume'>;
  processor: ReturnType<typeof createMessageProcessor>;
  abortController: AbortController | null;  // non-null only during an active turn
  slashCommands: SlashCommand[] | null;  // captured from SDK init, used for autocomplete
  pendingInputs: string[];  // queued user messages waiting for current turn to complete
}

const sessions = new Map<string, Session>();

// ── Clean env — strip CLAUDECODE so child Claude processes don't refuse to start

function getCleanEnv(): Record<string, string | undefined> {
  const { CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, ...clean } = process.env;
  return clean;
}

// ── Lightweight title generation ─────────────────────────────────────
// Fires a small SDK query to generate a smart feature title from the
// user's first message.  Called fire-and-forget — updates the node
// title when the response arrives.

export async function generateFeatureTitle(
  nodeId: string,
  userMessage: string,
  repoPath: string,
): Promise<void> {
  try {
    const titleQuery = query({
      prompt: `In exactly 2-3 words, name the feature or task described below. Output ONLY the title, nothing else. No quotes, no punctuation, no explanation. Maximum 3 words.\n\n${userMessage}`,
      options: {
        cwd: repoPath,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        env: getCleanEnv(),
      },
    });

    let responseText = '';
    for await (const msg of titleQuery) {
      if (
        msg.type === 'assistant' &&
        msg.message?.content &&
        Array.isArray(msg.message.content)
      ) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && 'text' in block) {
            responseText += String(block.text);
          }
        }
      }
    }

    const title = responseText.trim().replace(/^["']|["']$/g, '');
    if (title && title.length >= 3 && title.length <= 60) {
      const updated = updateNode(nodeId, { title });
      if (updated) {
        broadcast({ type: 'node_updated', node: updated });
      }
    }
  } catch (err) {
    console.error(`[title-gen:${nodeId}] failed:`, err);
    // Fallback: keep the extractTitle-derived placeholder
  }
}

// ── Spawn a session via SDK query() ─────────────────────────────────

export async function spawnSession(
  nodeId: string,
  repoPath: string,
  prompt: string,
  appendSystemPrompt?: string,
): Promise<void> {
  // Build shared options (reused across turns)
  const baseOptions: Omit<Options, 'abortController' | 'resume'> = {
    cwd: repoPath,
    model: 'claude-opus-4-6',
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    includePartialMessages: true,
    env: getCleanEnv(),
  };

  if (appendSystemPrompt) {
    baseOptions.systemPrompt = {
      type: 'preset',
      preset: 'claude_code',
      append: appendSystemPrompt,
    };
  }

  const processor = createMessageProcessor(nodeId);

  const session: Session = {
    nodeId,
    sessionId: null,
    repoPath,
    baseOptions,
    processor,
    abortController: null,
    slashCommands: null,
    pendingInputs: [],
  };
  sessions.set(nodeId, session);

  // Update node state to running
  const updated = updateNode(nodeId, { nodeState: 'running' });
  if (updated) {
    broadcast({ type: 'node_updated', node: updated });
  }

  console.log(`[session:${nodeId}] spawning SDK query, cwd: ${repoPath}, prompt: ${prompt.slice(0, 80)}...`);

  // Expand slash commands in the initial prompt
  let effectivePrompt = prompt;
  const expansion = expandSlashCommand(prompt, repoPath);
  if (expansion) {
    broadcastTerminal(nodeId, [{ type: 'system', text: `Expanding /${expansion.name}...` }]);
    effectivePrompt = expansion.expanded;
  } else if (/^\/[a-zA-Z][a-zA-Z0-9:-]*(?:\s|$)/.test(prompt)) {
    broadcastTerminal(nodeId, [{ type: 'system', text: `Unknown command: ${prompt.split(/\s/)[0]}` }]);
  }

  // Run the first turn
  runTurn(session, effectivePrompt);
}

// ── Run a single turn (prompt → response) ───────────────────────────

function runTurn(session: Session, prompt: string): void {
  const { nodeId } = session;
  const abortController = new AbortController();
  session.abortController = abortController;

  // Build turn-specific options
  const options: Options = {
    ...session.baseOptions,
    abortController,
  };

  // Resume the session for follow-up turns
  if (session.sessionId) {
    options.resume = session.sessionId;
    // System prompt only needed on first turn
    delete options.systemPrompt;
  }

  console.log(`[session:${nodeId}] running turn, resume=${session.sessionId ?? 'none'}, prompt: ${prompt.slice(0, 80)}...`);

  const queryInstance = query({ prompt, options });

  // Consume the query stream in the background
  consumeTurn(session, queryInstance).catch((err) => {
    console.error(`[session:${nodeId}] consumeTurn rejected unexpectedly:`, err);
  });
}

// ── Consume a single turn's query stream ────────────────────────────

async function consumeTurn(session: Session, queryInstance: Query): Promise<void> {
  const { nodeId, processor } = session;

  try {
    for await (const msg of queryInstance) {
      processor.processMessage(msg);

      // Capture session_id from init message for future resume calls
      if (msg.type === 'system' && 'subtype' in msg && msg.subtype === 'init') {
        session.sessionId = msg.session_id;

        // Capture slash commands and emit session banner from initialization result
        queryInstance.initializationResult().then(async (initResult) => {
          session.slashCommands = initResult.commands;
          console.log(`[session:${nodeId}] captured ${initResult.commands.length} slash commands`);

          // Capture init fields needed for the banner
          const systemMsg = msg as SDKSystemMessage;
          const claudeCodeVersion = systemMsg.claude_code_version;
          const rawModel = systemMsg.model;
          const cwd = systemMsg.cwd;

          // Resolve display name from SDK's authoritative ModelInfo list
          const activeModel = initResult.models.find(m => m.value === rawModel);
          const displayName = activeModel?.displayName ?? rawModel;

          // Check for upgrade (non-blocking, cached)
          const { checkForUpdate } = await import('./version-check.ts');
          const upgrade = await checkForUpdate(claudeCodeVersion);

          // Emit the completed banner as a one-shot terminal message
          broadcastTerminal(nodeId, [{
            type: 'session_banner',
            text: '',
            bannerData: {
              claudeCodeVersion,
              model: rawModel,
              modelDisplayName: displayName,
              subscriptionType: initResult.account?.subscriptionType,
              cwd,
              upgradeAvailable: upgrade.available,
              latestVersion: upgrade.latest,
            },
          }]);

          console.log(`[session:${nodeId}] emitted session_banner: ${displayName}, ${initResult.account?.subscriptionType ?? 'unknown plan'}`);
        }).catch((err) => {
          console.warn(`[session:${nodeId}] failed to build session banner:`, err);
        });
      }
    }
  } catch (err: unknown) {
    const isAbort = err instanceof AbortError;

    if (!isAbort) {
      console.error(`[session:${nodeId}] query stream error:`, err);

      const node = getNode(nodeId);
      if (node && node.nodeState !== 'completed') {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const updated = updateNode(nodeId, {
          nodeState: 'crashed',
          errorInfo: { type: 'query_error', message: errorMessage },
        });
        if (updated) {
          broadcast({ type: 'node_updated', node: updated });
        }
      }
    }

    // On error/abort, clean up the session entirely
    session.abortController = null;
    processor.cleanup();
    sessions.delete(nodeId);
    return;
  }

  // Turn completed successfully — decide next state based on node type
  session.abortController = null;

  const node = getNode(nodeId);
  if (!node) return;

  if (node.type === 'subtask') {
    if (session.pendingInputs.length > 0) {
      // User sent follow-up messages — keep the subtask alive for another turn
      processPendingInputs(session);
    } else {
      // Subtasks are autonomous — complete after their query finishes
      const updated = updateNode(nodeId, {
        nodeState: 'completed',
        needsHuman: false,
        humanNeededType: null,
        humanNeededPayload: null,
      });
      if (updated) {
        broadcast({ type: 'node_updated', node: updated });
        autoMoveIfComplete(nodeId);
      }
      processor.cleanup();
      sessions.delete(nodeId);
      console.log(`[session:${nodeId}] subtask completed, session removed`);
    }
  } else {
    if (session.pendingInputs.length > 0) {
      // Process queued messages from the user
      processPendingInputs(session);
    } else {
      // Features are interactive — stay running for more user input
      const updated = updateNode(nodeId, { nodeState: 'running' });
      if (updated) {
        broadcast({ type: 'node_updated', node: updated });
      }
      console.log(`[session:${nodeId}] turn completed, session alive for more input`);
    }
  }
}

// ── Process queued messages ──────────────────────────────────────────

function processPendingInputs(session: Session): void {
  const { nodeId } = session;
  const pending = session.pendingInputs.splice(0);
  const combinedPrompt = pending.join('\n\n');

  // Broadcast each queued message as a regular user_message (they now appear
  // in the conversation above the new thinking indicator)
  for (const text of pending) {
    broadcastTerminal(nodeId, [{ type: 'user_message', text }]);
  }

  // Clear the queue on the client
  broadcast({ type: 'queue_update', nodeId, messages: [] });

  console.log(`[session:${nodeId}] turn completed, processing ${pending.length} queued message(s)`);

  // Expand slash commands on the combined prompt
  let effectiveText = combinedPrompt;
  const expansion = expandSlashCommand(combinedPrompt, session.repoPath);
  if (expansion) {
    broadcastTerminal(nodeId, [{ type: 'system', text: `Expanding /${expansion.name}...` }]);
    effectiveText = expansion.expanded;
  }

  const updated = updateNode(nodeId, { nodeState: 'running' });
  if (updated) {
    broadcast({ type: 'node_updated', node: updated });
  }

  runTurn(session, effectiveText);
}

// ── Send input to a session ─────────────────────────────────────────

export function sendInput(nodeId: string, text: string): 'sent' | 'queued' | 'dropped' {
  const session = sessions.get(nodeId);
  if (!session) {
    console.warn(`[sendInput:${nodeId}] no session found — input dropped`);
    return 'dropped';
  }

  if (session.abortController) {
    // Queue the message — will be sent when the current turn finishes
    session.pendingInputs.push(text);
    console.log(`[sendInput:${nodeId}] turn in progress — queued (${session.pendingInputs.length} pending)`);
    broadcast({ type: 'queue_update', nodeId, messages: [...session.pendingInputs] });
    return 'queued';
  }

  console.log(`[sendInput:${nodeId}] starting new turn: ${text.slice(0, 120)}`);

  // Expand slash commands
  let effectiveText = text;
  const expansion = expandSlashCommand(text, session.repoPath);
  if (expansion) {
    broadcastTerminal(nodeId, [{ type: 'system', text: `Expanding /${expansion.name}...` }]);
    effectiveText = expansion.expanded;
  } else if (/^\/[a-zA-Z][a-zA-Z0-9:-]*(?:\s|$)/.test(text)) {
    broadcastTerminal(nodeId, [{ type: 'system', text: `Unknown command: ${text.split(/\s/)[0]}` }]);
  }

  // Update node state to running (may have been idle between turns)
  const updated = updateNode(nodeId, { nodeState: 'running' });
  if (updated) {
    broadcast({ type: 'node_updated', node: updated });
  }

  runTurn(session, effectiveText);
  return 'sent';
}

// ── Query session busy state ─────────────────────────────────────────

export function isSessionBusy(nodeId: string): boolean {
  const session = sessions.get(nodeId);
  return session?.abortController != null;
}

// ── Dequeue pending inputs ───────────────────────────────────────────

export function dequeueInput(nodeId: string, action: 'pop_last' | 'clear_all'): string[] {
  const session = sessions.get(nodeId);
  if (!session || session.pendingInputs.length === 0) return [];

  let removed: string[];
  if (action === 'pop_last') {
    removed = [session.pendingInputs.pop()!];
  } else {
    removed = session.pendingInputs.splice(0);
  }

  // Broadcast the updated queue to clients
  broadcast({ type: 'queue_update', nodeId, messages: [...session.pendingInputs] });
  console.log(`[dequeue:${nodeId}] ${action}: removed ${removed.length}, ${session.pendingInputs.length} remaining`);
  return removed;
}

// ── Query session state ─────────────────────────────────────────────

export function hasSession(nodeId: string): boolean {
  return sessions.has(nodeId);
}

// ── Query slash commands ─────────────────────────────────────────────

export function getSlashCommands(nodeId: string): SlashCommand[] | null {
  const session = sessions.get(nodeId);
  return session?.slashCommands ?? null;
}

// ── Kill a session ──────────────────────────────────────────────────

export async function killSession(nodeId: string): Promise<void> {
  const session = sessions.get(nodeId);
  if (!session) return;

  console.log(`[session:${nodeId}] killing session`);

  if (session.abortController) {
    try {
      session.abortController.abort();
    } catch {
      // Abort may throw if already aborted
    }
  }

  session.processor.cleanup();
  sessions.delete(nodeId);
}

// ── Kill all sessions ───────────────────────────────────────────────

export async function killAllSessions(): Promise<void> {
  for (const [nodeId, session] of sessions) {
    console.log(`[session:${nodeId}] killing session (shutdown)`);
    if (session.abortController) {
      try {
        session.abortController.abort();
      } catch {
        // Ignore
      }
    }
    session.processor.cleanup();
  }
  sessions.clear();
}
