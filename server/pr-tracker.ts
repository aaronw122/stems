import { updateNode, broadcast } from './state.ts';
import { autoMoveIfComplete } from './completion.ts';
import { GH_BIN } from './cli-paths.ts';

// ── Types ────────────────────────────────────────────────────────────

interface TrackedPR {
  nodeId: string;
  url: string;
  owner: string;
  repo: string;
  number: number;
  state: 'open' | 'merged' | 'closed';
}

// ── State ────────────────────────────────────────────────────────────

const trackedPRs: Map<string, TrackedPR> = new Map(); // nodeId -> PR
let pollInterval: ReturnType<typeof setInterval> | null = null;

const POLL_INTERVAL_MS = 30_000;

// ── PR URL parsing ───────────────────────────────────────────────────

const PR_URL_REGEX = /https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

export function parsePRUrl(url: string): { owner: string; repo: string; number: number } | null {
  const match = url.match(PR_URL_REGEX);
  if (!match) return null;
  return {
    owner: match[1]!,
    repo: match[2]!,
    number: parseInt(match[3]!, 10),
  };
}

/**
 * Extract PR URLs from a line of terminal output.
 * Returns all PR URLs found in the line.
 */
export function extractPRUrls(text: string): string[] {
  const matches = text.match(new RegExp(PR_URL_REGEX.source, 'g'));
  return matches ?? [];
}

// ── Track a PR ───────────────────────────────────────────────────────

export function trackPR(nodeId: string, prUrl: string): void {
  const parsed = parsePRUrl(prUrl);
  if (!parsed) {
    console.error(`[pr-tracker] Could not parse PR URL: ${prUrl}`);
    return;
  }

  // Don't re-track the same PR
  const existing = trackedPRs.get(nodeId);
  if (existing && existing.url === prUrl) return;

  const tracked: TrackedPR = {
    nodeId,
    url: prUrl,
    owner: parsed.owner,
    repo: parsed.repo,
    number: parsed.number,
    state: 'open',
  };

  trackedPRs.set(nodeId, tracked);
  console.log(`[pr-tracker] Tracking PR #${parsed.number} for node ${nodeId}: ${prUrl}`);

  // Update the node with PR info
  const updated = updateNode(nodeId, {
    prUrl,
    prState: 'open',
  });
  if (updated) {
    broadcast({ type: 'node_updated', node: updated });
  }

  // Ensure polling is running
  ensurePolling();
}

// ── Stop tracking ────────────────────────────────────────────────────

export function stopTracking(nodeId: string): void {
  trackedPRs.delete(nodeId);

  // Stop polling if nothing left to track
  if (trackedPRs.size === 0 && pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ── Polling ──────────────────────────────────────────────────────────

function ensurePolling(): void {
  if (pollInterval) return;
  pollInterval = setInterval(pollAllPRs, POLL_INTERVAL_MS);
}

async function pollAllPRs(): Promise<void> {
  for (const [nodeId, pr] of trackedPRs) {
    // Skip already-resolved PRs
    if (pr.state === 'merged' || pr.state === 'closed') continue;

    try {
      const newState = await fetchPRState(pr.owner, pr.repo, pr.number);
      if (newState && newState !== pr.state) {
        pr.state = newState;

        const updated = updateNode(nodeId, { prState: newState });
        if (updated) {
          broadcast({ type: 'node_updated', node: updated });
          console.log(`[pr-tracker] PR #${pr.number} state changed to: ${newState}`);

          // When merged, check if node is now completable
          if (newState === 'merged') {
            autoMoveIfComplete(nodeId);
          }
        }

        // Stop tracking merged/closed PRs
        if (newState === 'merged' || newState === 'closed') {
          trackedPRs.delete(nodeId);
        }
      }
    } catch (err) {
      console.error(`[pr-tracker] Failed to poll PR #${pr.number}:`, err);
    }
  }

  // Stop polling if nothing left
  if (trackedPRs.size === 0 && pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

async function fetchPRState(
  owner: string,
  repo: string,
  number: number,
): Promise<'open' | 'merged' | 'closed' | null> {
  try {
    const proc = Bun.spawn(
      [GH_BIN, 'pr', 'view', String(number), '--repo', `${owner}/${repo}`, '--json', 'state,merged'],
      {
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env },
      },
    );

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      console.error(`[pr-tracker] gh pr view failed: ${stderr.trim()}`);
      return null;
    }

    const stdout = await new Response(proc.stdout).text();
    const data = JSON.parse(stdout) as { state: string; merged: boolean };

    if (data.merged) return 'merged';
    if (data.state === 'CLOSED') return 'closed';
    if (data.state === 'OPEN') return 'open';

    // Fallback
    return 'open';
  } catch (err) {
    console.error(`[pr-tracker] Error fetching PR state:`, err);
    return null;
  }
}

// ── Cleanup ──────────────────────────────────────────────────────────

export function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  trackedPRs.clear();
}

export function startPolling(): void {
  ensurePolling();
}

export function getTrackedPR(nodeId: string): TrackedPR | undefined {
  return trackedPRs.get(nodeId);
}
