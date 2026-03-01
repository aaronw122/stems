import { getTerminalMessages, getNode } from './state.ts';
import { CLAUDE_BIN } from './cli-paths.ts';

const SUMMARIZE_TIMEOUT_MS = 15_000;

/**
 * Summarize the parent node's session context for a child task.
 * Spawns a quick `claude -p` call to distill the terminal buffer into
 * a 2-3 sentence context block. Falls back to the parent's raw prompt
 * if summarization fails or times out.
 */
export async function summarizeContext(parentNodeId: string): Promise<string> {
  const parentNode = getNode(parentNodeId);
  const rawFallback = parentNode?.prompt ?? '';

  // Get the parent's terminal buffer (last ~100 messages)
  const messages = getTerminalMessages(parentNodeId, 100);

  // If there's no terminal output, fall back to the raw prompt
  if (messages.length === 0) {
    return rawFallback
      ? `Context from parent task:\n${rawFallback}`
      : '';
  }

  const sessionOutput = messages.map(m => m.text).join('\n');
  const prompt = `Summarize the following agent session output into a concise 2-3 sentence context block for a child task. Focus on: what was accomplished, what files were modified, current state. Output ONLY the summary, no preamble.\n\n<session>\n${sessionOutput}\n</session>`;

  try {
    const { promise, proc } = runClaudeSummarize(prompt);
    const summary = await withTimeout(promise, SUMMARIZE_TIMEOUT_MS, () => {
      proc.kill();
    });
    return summary.trim() || rawFallback;
  } catch (err) {
    console.error(`[context-summary] Summarization failed for ${parentNodeId}:`, err);
    return rawFallback
      ? `Context from parent task:\n${rawFallback}`
      : '';
  }
}

function runClaudeSummarize(prompt: string): { promise: Promise<string>; proc: ReturnType<typeof Bun.spawn> } {
  const args = [CLAUDE_BIN, '-p', '--dangerously-skip-permissions', '--', prompt];
  const { CLAUDECODE, CLAUDE_CODE_ENTRYPOINT, ...cleanEnv } = process.env;
  const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe', env: cleanEnv });

  const promise = new Response(proc.stdout).text();
  return { promise, proc };
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`Timed out after ${ms}ms`));
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
