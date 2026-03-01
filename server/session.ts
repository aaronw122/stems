import type { Subprocess } from 'bun';
import { updateNode, broadcast, broadcastTerminal } from './state.ts';
import { createStreamParser } from './stream-parser.ts';
import { CLAUDE_BIN } from './cli-paths.ts';

// ── Session tracking ─────────────────────────────────────────────────

interface Session {
  process: Subprocess;
  nodeId: string;
  interactive: boolean;
}

const sessions = new Map<string, Session>();

const PID_FILE = 'stems.pids';

// ── Clean env — strip CLAUDECODE so child Claude processes don't refuse to start
function getCleanEnv(): Record<string, string | undefined> {
  const { CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, ...clean } = process.env;
  return clean;
}

// ── PID file management ──────────────────────────────────────────────

async function writePidFile(): Promise<void> {
  const pids: number[] = [];
  for (const [, session] of sessions) {
    if (session.process.pid != null) {
      pids.push(session.process.pid);
    }
  }
  await Bun.write(PID_FILE, pids.join('\n'));
}

async function readPidFile(): Promise<number[]> {
  try {
    const file = Bun.file(PID_FILE);
    const exists = await file.exists();
    if (!exists) return [];
    const content = await file.text();
    return content
      .split('\n')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !Number.isNaN(n));
  } catch {
    return [];
  }
}

// ── Spawn a Claude CLI session ───────────────────────────────────────

export async function spawnSession(
  nodeId: string,
  repoPath: string,
  prompt: string,
  appendSystemPrompt?: string,
): Promise<void> {
  const interactive = !prompt;

  // Always use -p with --verbose for stream-json I/O and partial message streaming
  const args = [
    CLAUDE_BIN,
    '-p',
    '--verbose',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--include-partial-messages',
    '--dangerously-skip-permissions',
  ];

  if (appendSystemPrompt) {
    args.push('--append-system-prompt', appendSystemPrompt);
  }

  const proc = Bun.spawn(args, {
    cwd: repoPath,
    stdout: 'pipe',
    stdin: 'pipe',
    stderr: 'pipe',
    env: getCleanEnv(),
  });

  sessions.set(nodeId, { process: proc, nodeId, interactive });

  // One-shot mode: send the prompt as a stream-json user_message on stdin
  if (!interactive && prompt) {
    const stdinStream = proc.stdin;
    if (stdinStream && typeof stdinStream === 'object' && 'write' in stdinStream) {
      const sink = stdinStream as { write(data: Uint8Array | string): number };
      const msg = JSON.stringify({ type: 'user_message', content: prompt });
      sink.write(msg + '\n');
    }
  }

  // Update PID file
  await writePidFile();

  // Update node state to running
  const updated = updateNode(nodeId, { nodeState: 'running' });
  if (updated) {
    broadcast({ type: 'node_updated', node: updated });
  }

  // Create stream parser and pipe stdout
  const parser = createStreamParser(nodeId);

  if (proc.stdout) {
    parser.pipeFrom(proc.stdout).catch((err) => {
      console.error(`[session:${nodeId}] stdout pipe error:`, err);
    });
  }

  // Drain stderr and broadcast errors to terminal
  if (proc.stderr) {
    drainStderr(nodeId, proc.stderr);
  }

  // Handle process exit
  proc.exited.then(async (code) => {
    sessions.delete(nodeId);
    await writePidFile();

    if (code !== 0) {
      const updated = updateNode(nodeId, {
        nodeState: 'crashed',
        errorInfo: { type: 'process_exit', message: `Process exited with code ${code}` },
      });
      if (updated) {
        broadcast({ type: 'node_updated', node: updated });
      }
    }
  });
}

// ── Drain stderr to terminal ────────────────────────────────────────

async function drainStderr(nodeId: string, stream: ReadableStream<Uint8Array>): Promise<void> {
  try {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true }).trim();
      if (text) {
        console.error(`[session:${nodeId}] stderr: ${text}`);
        broadcastTerminal(nodeId, [`[stderr] ${text}`]);
      }
    }
  } catch {
    // Stream closed
  }
}

// ── Kill a session ───────────────────────────────────────────────────

export async function killSession(nodeId: string): Promise<void> {
  const session = sessions.get(nodeId);
  if (!session) return;

  try {
    session.process.kill();
  } catch {
    // Process may have already exited
  }

  sessions.delete(nodeId);
  await writePidFile();
}

// ── Kill all sessions ────────────────────────────────────────────────

export async function killAllSessions(): Promise<void> {
  for (const [nodeId, session] of sessions) {
    try {
      session.process.kill();
    } catch {
      // Ignore
    }
    sessions.delete(nodeId);
  }
  await writePidFile();
}

// ── Send input to a session ──────────────────────────────────────────

export function sendInput(nodeId: string, text: string): void {
  const session = sessions.get(nodeId);
  if (!session) return;

  const stdinStream = session.process.stdin;
  if (stdinStream && typeof stdinStream === 'object' && 'write' in stdinStream) {
    const sink = stdinStream as { write(data: Uint8Array | string): number };
    // All sessions now use --input-format stream-json
    const msg = JSON.stringify({ type: 'user_message', content: text });
    sink.write(msg + '\n');
  }
}

// ── Cleanup stale processes from previous runs ───────────────────────

export async function cleanupStaleProcesses(): Promise<void> {
  const pids = await readPidFile();
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`[cleanup] Killed stale process ${pid}`);
    } catch {
      // Process already dead — ignore
    }
  }
  // Clear the PID file
  await Bun.write(PID_FILE, '');
}
