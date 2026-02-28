import type { Subprocess } from 'bun';
import { updateNode, broadcast } from './state.ts';
import { createStreamParser } from './stream-parser.ts';

// ── Session tracking ─────────────────────────────────────────────────

interface Session {
  process: Subprocess;
  nodeId: string;
}

const sessions = new Map<string, Session>();

const PID_FILE = 'weft-flow.pids';

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
  const args = ['claude', '-p', '--output-format', 'stream-json', '--dangerously-skip-permissions'];

  if (appendSystemPrompt) {
    args.push('--append-system-prompt', appendSystemPrompt);
  }

  // Add the prompt as the final positional argument
  args.push(prompt);

  const proc = Bun.spawn(args, {
    cwd: repoPath,
    stdout: 'pipe',
    stdin: 'pipe',
    stderr: 'pipe',
  });

  sessions.set(nodeId, { process: proc, nodeId });

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
    // Bun's FileSink has a .write() method
    const sink = stdinStream as { write(data: Uint8Array | string): number };
    sink.write(text + '\n');
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
