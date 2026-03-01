import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Query, SDKUserMessage, Options } from '@anthropic-ai/claude-agent-sdk';
import { updateNode, getNode, broadcast } from './state.ts';
import { createMessageProcessor } from './message-processor.ts';

// ── MessageChannel ──────────────────────────────────────────────────
// An AsyncIterable<SDKUserMessage> with push/close semantics.
// When the queue is empty, next() blocks until a message is pushed or
// the channel is closed.

class MessageChannel implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = [];
  private resolve: ((value: IteratorResult<SDKUserMessage>) => void) | null = null;
  private closed = false;

  push(msg: SDKUserMessage): void {
    if (this.closed) return;

    if (this.resolve) {
      // A consumer is already waiting — deliver immediately
      const r = this.resolve;
      this.resolve = null;
      r({ value: msg, done: false });
    } else {
      this.queue.push(msg);
    }
  }

  close(): void {
    this.closed = true;
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r({ value: undefined as unknown as SDKUserMessage, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        // Drain queued messages first
        if (this.queue.length > 0) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }

        // Channel already closed
        if (this.closed) {
          return Promise.resolve({ value: undefined as unknown as SDKUserMessage, done: true });
        }

        // Block until a message arrives or the channel closes
        return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          this.resolve = resolve;
        });
      },
    };
  }
}

// ── Session tracking ────────────────────────────────────────────────

interface Session {
  nodeId: string;
  channel: MessageChannel;
  abortController: AbortController;
  queryInstance: Query;
}

const sessions = new Map<string, Session>();

// ── Clean env — strip CLAUDECODE so child Claude processes don't refuse to start

function getCleanEnv(): Record<string, string | undefined> {
  const { CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, ...clean } = process.env;
  return clean;
}

// ── Helper to build an SDKUserMessage from text ─────────────────────

function makeUserMessage(text: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
    session_id: '',
  } as SDKUserMessage;
}

// ── Spawn a session via SDK query() ─────────────────────────────────

export async function spawnSession(
  nodeId: string,
  repoPath: string,
  prompt: string,
  appendSystemPrompt?: string,
): Promise<void> {
  const abortController = new AbortController();
  const channel = new MessageChannel();

  // Push the initial prompt as the first user message
  channel.push(makeUserMessage(prompt));

  // Build options
  const options: Options = {
    cwd: repoPath,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    includePartialMessages: true,
    abortController,
    env: getCleanEnv(),
  };

  // Append to the default Claude Code system prompt if provided
  if (appendSystemPrompt) {
    options.systemPrompt = {
      type: 'preset',
      preset: 'claude_code',
      append: appendSystemPrompt,
    };
  }

  console.log(`[session:${nodeId}] spawning SDK query, cwd: ${repoPath}, prompt: ${prompt.slice(0, 80)}...`);

  const queryInstance = query({ prompt: channel, options });

  const session: Session = { nodeId, channel, abortController, queryInstance };
  sessions.set(nodeId, session);

  // Update node state to running
  const updated = updateNode(nodeId, { nodeState: 'running' });
  if (updated) {
    broadcast({ type: 'node_updated', node: updated });
  }

  // Start consuming the query stream in the background
  consumeQuery(nodeId, queryInstance).catch((err) => {
    console.error(`[session:${nodeId}] consumeQuery rejected unexpectedly:`, err);
  });
}

// ── Consume the SDK query stream ────────────────────────────────────

async function consumeQuery(nodeId: string, queryInstance: Query): Promise<void> {
  const processor = createMessageProcessor(nodeId);

  try {
    for await (const msg of queryInstance) {
      processor.processMessage(msg);
    }
  } catch (err: unknown) {
    // AbortError is expected when we kill a session — don't crash the node
    const isAbort =
      err instanceof Error &&
      (err.name === 'AbortError' || err.message.includes('aborted'));

    if (!isAbort) {
      console.error(`[session:${nodeId}] query stream error:`, err);

      // Guard: don't overwrite 'completed' with 'crashed'
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
  } finally {
    processor.cleanup();
    sessions.delete(nodeId);
    console.log(`[session:${nodeId}] query stream ended, session removed`);
  }
}

// ── Send input to a session ─────────────────────────────────────────

export function sendInput(nodeId: string, text: string): void {
  const session = sessions.get(nodeId);
  if (!session) {
    console.warn(`[sendInput:${nodeId}] no session found — input dropped`);
    return;
  }

  console.log(`[sendInput:${nodeId}] pushing message: ${text.slice(0, 120)}`);
  session.channel.push(makeUserMessage(text));
}

// ── Query session state ─────────────────────────────────────────────

export function hasSession(nodeId: string): boolean {
  return sessions.has(nodeId);
}

// ── Kill a session ──────────────────────────────────────────────────

export async function killSession(nodeId: string): Promise<void> {
  const session = sessions.get(nodeId);
  if (!session) return;

  console.log(`[session:${nodeId}] killing session`);

  try {
    session.abortController.abort();
  } catch {
    // Abort may throw if already aborted
  }

  session.channel.close();
  sessions.delete(nodeId);
}

// ── Kill all sessions ───────────────────────────────────────────────

export async function killAllSessions(): Promise<void> {
  for (const [nodeId, session] of sessions) {
    console.log(`[session:${nodeId}] killing session (shutdown)`);
    try {
      session.abortController.abort();
    } catch {
      // Ignore
    }
    session.channel.close();
  }
  sessions.clear();
}
