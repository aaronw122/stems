import { query, AbortError } from '@anthropic-ai/claude-agent-sdk';
import type { Query, Options, SlashCommand } from '@anthropic-ai/claude-agent-sdk';
import { updateNode, getNode, broadcast } from './state.ts';
import { createMessageProcessor } from './message-processor.ts';
import { autoMoveIfComplete } from './completion.ts';

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
}

const sessions = new Map<string, Session>();

// ── Clean env — strip CLAUDECODE so child Claude processes don't refuse to start

function getCleanEnv(): Record<string, string | undefined> {
  const { CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, ...clean } = process.env;
  return clean;
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
  };
  sessions.set(nodeId, session);

  // Update node state to running
  const updated = updateNode(nodeId, { nodeState: 'running' });
  if (updated) {
    broadcast({ type: 'node_updated', node: updated });
  }

  console.log(`[session:${nodeId}] spawning SDK query, cwd: ${repoPath}, prompt: ${prompt.slice(0, 80)}...`);

  // Run the first turn
  runTurn(session, prompt);
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

        // Capture slash commands from initialization result for autocomplete
        queryInstance.initializationResult().then((initResult) => {
          session.slashCommands = initResult.commands;
          console.log(`[session:${nodeId}] captured ${initResult.commands.length} slash commands`);
        }).catch((err) => {
          console.warn(`[session:${nodeId}] failed to capture slash commands:`, err);
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
  } else {
    // Features are interactive — stay running for more user input
    const updated = updateNode(nodeId, { nodeState: 'running' });
    if (updated) {
      broadcast({ type: 'node_updated', node: updated });
    }
    console.log(`[session:${nodeId}] turn completed, session alive for more input`);
  }
}

// ── Send input to a session ─────────────────────────────────────────

export function sendInput(nodeId: string, text: string): void {
  const session = sessions.get(nodeId);
  if (!session) {
    console.warn(`[sendInput:${nodeId}] no session found — input dropped`);
    return;
  }

  if (session.abortController) {
    // A turn is already running — this shouldn't happen in normal flow
    // (user shouldn't be able to send input while Claude is responding)
    console.warn(`[sendInput:${nodeId}] turn already in progress — input dropped`);
    return;
  }

  console.log(`[sendInput:${nodeId}] starting new turn: ${text.slice(0, 120)}`);

  // Update node state to running (may have been idle between turns)
  const updated = updateNode(nodeId, { nodeState: 'running' });
  if (updated) {
    broadcast({ type: 'node_updated', node: updated });
  }

  runTurn(session, text);
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
