import { getTerminalLines, getNode } from './state.ts';

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

  // Get the parent's terminal buffer (last ~100 lines)
  const lines = getTerminalLines(parentNodeId, 100);

  // If there's no terminal output, fall back to the raw prompt
  if (lines.length === 0) {
    return rawFallback
      ? `Context from parent task:\n${rawFallback}`
      : '';
  }

  const sessionOutput = lines.join('\n');
  const prompt = `Summarize the following agent session output into a concise 2-3 sentence context block for a child task. Focus on: what was accomplished, what files were modified, current state. Output ONLY the summary, no preamble.\n\n<session>\n${sessionOutput}\n</session>`;

  try {
    const summary = await withTimeout(
      runClaudeSummarize(prompt),
      SUMMARIZE_TIMEOUT_MS,
    );
    return summary.trim() || rawFallback;
  } catch (err) {
    console.error(`[context-summary] Summarization failed for ${parentNodeId}:`, err);
    return rawFallback
      ? `Context from parent task:\n${rawFallback}`
      : '';
  }
}

async function runClaudeSummarize(prompt: string): Promise<string> {
  const proc = Bun.spawn(
    ['claude', '-p', '--dangerously-skip-permissions', prompt],
    {
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`claude -p exited with code ${exitCode}: ${stderr.trim()}`);
  }

  return await new Response(proc.stdout).text();
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
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
