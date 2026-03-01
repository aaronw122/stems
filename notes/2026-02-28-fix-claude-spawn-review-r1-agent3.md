# Review: fix-claude-spawn plan
**Reviewer:** Software Architect (Agent 3)
**Date:** 2026-02-28
**Plan:** `/Users/aaron/weft-flow/plans/fix-claude-spawn.md`

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| Must-fix | 3 |
| Medium | 2 |
| Low | 1 |
| Impl-note | 3 |

The plan correctly identifies the root cause (bare `claude` command unresolvable in Bun's spawn environment) and proposes a reasonable fix. However, it has several architectural-level issues: a file count discrepancy that leaves one spawn site unaddressed, a circular dependency created by the proposed module structure, a missing env propagation for the second spawn site, and a process lifecycle gap where the context-summary subprocess can be orphaned on timeout.

---

## Issues

### [Critical] Plan claims three files but only lists two -- `pr-tracker.ts` spawns `gh` with the same bare-command pattern

**Section:** Files to Modify

**Description:** The plan opens with "Three files spawn `claude` with bare command names. All need fixing." but then only lists two files: `session.ts` and `context-summary.ts`. Examining the codebase confirms only two files spawn `claude`. However, `pr-tracker.ts` (line 146) spawns `gh` using the identical bare-command `Bun.spawn(['gh', ...])` pattern, which is subject to the exact same ENOENT failure if `gh` is not on Bun's PATH. The plan explicitly states the PR tracker "likely works already" but provides no evidence for this -- it is vulnerable to the same PATH resolution failure.

More importantly, the "three files" claim creates ambiguity: a developer following the plan will look for a third `claude` spawn site, not find it, and wonder what was missed. If the plan meant to include `pr-tracker.ts` (for `gh`), it should say so. If the count is wrong, it should be corrected to two.

**Suggested fix:** Either:
1. Correct the count to "Two files spawn `claude`" and explicitly note that `pr-tracker.ts` spawns `gh` and should be evaluated for the same fix (resolve `gh` binary path via `which gh`), OR
2. Expand the scope to include `pr-tracker.ts` as a third file, resolving `gh` the same way.

Option 2 is strongly recommended -- the same environmental conditions that cause `claude` to be unresolvable will affect `gh`.

---

### [Must-fix] Circular dependency: `context-summary.ts` importing from `session.ts`

**Section:** In `context-summary.ts`

**Description:** The plan proposes exporting `CLAUDE_BIN` from `session.ts` and importing it in `context-summary.ts`. However, `session.ts` already has no dependency on `context-summary.ts`, and `context-summary.ts` currently has no dependency on `session.ts`. Examining the actual import graph:

- `index.ts` imports from both `session.ts` and `context-summary.ts`
- `session.ts` imports from `state.ts` and `stream-parser.ts`
- `context-summary.ts` imports from `state.ts`

Adding an import from `context-summary.ts` to `session.ts` does not create a circular dependency in this specific case. However, it creates a conceptual coupling between two modules that are currently independent: `session.ts` (process lifecycle management) becomes the owner of binary resolution, and `context-summary.ts` (a utility for summarizing context) becomes dependent on the session layer.

If a future change makes `session.ts` import from `context-summary.ts` (e.g., to auto-summarize on session completion), a hard circular dependency would result. The coupling is architecturally wrong: binary path resolution is infrastructure, not session management.

**Suggested fix:** Extract `CLAUDE_BIN` resolution into a dedicated module (e.g., `server/cli-paths.ts` or `server/config.ts`) that both `session.ts` and `context-summary.ts` import from. This module would also be the natural home for a `GH_BIN` resolution if `pr-tracker.ts` is brought into scope.

```ts
// server/cli-paths.ts
import { execSync } from 'child_process';

function resolveBin(name: string, fallback: string): string {
  try {
    return execSync(`which ${name}`, { encoding: 'utf-8' }).trim();
  } catch {
    return fallback;
  }
}

export const CLAUDE_BIN = resolveBin('claude', '/opt/homebrew/bin/claude');
export const GH_BIN = resolveBin('gh', '/opt/homebrew/bin/gh');
```

---

### [Must-fix] `env` propagation missing from `context-summary.ts` spawn

**Section:** In `context-summary.ts` (and overall plan structure)

**Description:** The plan correctly identifies that `env: { ...process.env }` should be passed to the spawn call in `session.ts` so that `claude` itself can find its dependencies (git, gh, etc.). However, the plan does not mention applying the same `env` fix to the spawn call in `context-summary.ts` (line 43). The `runClaudeSummarize` function spawns `claude -p` without passing any env options, meaning it will hit the same PATH issue for `claude`'s own subprocess calls.

Currently `context-summary.ts` spawns:
```ts
const proc = Bun.spawn(
  ['claude', '-p', '--dangerously-skip-permissions', prompt],
  { stdout: 'pipe', stderr: 'pipe' },
);
```

Without `env: { ...process.env }`, even after resolving the binary path, the spawned `claude` process may not have the PATH needed to find git, node, or other tools it invokes internally.

**Suggested fix:** The plan should explicitly include `env: { ...process.env }` in the spawn options for `context-summary.ts`, not just `session.ts`.

---

### [Must-fix] `context-summary.ts` spawns a subprocess on timeout but never kills it

**Section:** In `context-summary.ts` (not addressed in plan, but structurally related)

**Description:** The `summarizeContext` function uses a `withTimeout` wrapper (15 seconds). When the timeout fires, the promise rejects with a timeout error, and the caller falls back to the raw prompt. However, the actual `claude -p` subprocess spawned by `runClaudeSummarize` is never killed on timeout -- it continues running as an orphaned process.

This is an existing bug, not introduced by the plan, but the plan is explicitly modifying this file and the fix is architecturally intertwined with the spawn changes. Since the plan is already touching the spawn call in `context-summary.ts`, this is the right time to address the orphaned process.

The risk is concrete: if context summarization is called frequently (e.g., spawning multiple subtasks), orphaned `claude` processes accumulate, each consuming API tokens and system resources.

**Suggested fix:** Refactor `runClaudeSummarize` to accept an `AbortSignal` or return the process handle alongside the promise, so that `withTimeout` (or a replacement) can kill the subprocess when the timeout fires:

```ts
async function runClaudeSummarize(prompt: string, signal?: AbortSignal): Promise<string> {
  const proc = Bun.spawn([CLAUDE_BIN, '-p', '--dangerously-skip-permissions', prompt], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  });

  signal?.addEventListener('abort', () => {
    try { proc.kill(); } catch {}
  });

  const exitCode = await proc.exited;
  // ...
}
```

---

### [Medium] `which claude` can resolve to a shell function, not a binary -- `execSync` in a non-login shell may not find it

**Section:** In `session.ts` (CLAUDE_BIN resolution)

**Description:** The plan uses `execSync('which claude')` to resolve the binary path. Two concerns:

1. `which` in a non-login, non-interactive shell (which is what `execSync` spawns) may not find `claude` if it was added to PATH via `.zshrc`, `.bashrc`, or other interactive-shell config files. The `execSync` call inherits `process.env`, but if the Bun server itself was started from a context without the full shell PATH (e.g., launched from a desktop launcher, launchd, or a process manager), `which` will fail, and the fallback `/opt/homebrew/bin/claude` will be used.

2. If `claude` is defined as a shell function (the plan itself notes this possibility), `which` may or may not find it depending on the shell. In zsh, `which` does report shell functions, but `execSync` spawns `/bin/sh` by default, not zsh.

The fallback to `/opt/homebrew/bin/claude` mitigates both issues for the common case on macOS with Homebrew, but this is brittle. On Linux or non-Homebrew macOS setups, the fallback will point to a nonexistent path and the error will be a confusing ENOENT on the fallback path rather than a clear "claude binary not found" message.

**Suggested fix:** Add validation that the resolved path actually exists:

```ts
import { existsSync } from 'fs';

const CLAUDE_BIN = (() => {
  const candidates = [
    () => execSync('which claude', { encoding: 'utf-8' }).trim(),
    () => '/opt/homebrew/bin/claude',
    () => '/usr/local/bin/claude',
  ];
  for (const resolve of candidates) {
    try {
      const path = resolve();
      if (path && existsSync(path)) return path;
    } catch {}
  }
  throw new Error('Could not find claude binary. Ensure claude CLI is installed and on PATH.');
})();
```

Failing fast at startup with a clear error message is far better than an ENOENT at runtime when a user clicks a button.

---

### [Medium] `context-summary.ts` missing `cwd` in spawn -- summary runs in server's cwd, not repo directory

**Section:** In `context-summary.ts` (not addressed in plan)

**Description:** The spawn call in `context-summary.ts` does not pass a `cwd` option. This means the `claude -p` summarization subprocess runs in the server's working directory rather than in the repo directory. Currently the summarize prompt doesn't reference files directly, so this is not actively broken, but it means the spawned claude has no repo context if it needs it. More importantly, it's an inconsistency with `session.ts` which explicitly passes `cwd: repoPath`.

Since the plan is already modifying this spawn call, aligning the behavior is low cost.

**Suggested fix:** Pass `cwd` through to `runClaudeSummarize` if a repo path is available. This requires threading the repo path through `summarizeContext`, but the caller in `index.ts` (line 285) has access to the node and could look up the repo path.

---

### [Low] No startup validation or user-visible error if `claude` binary is not found

**Section:** Verification

**Description:** The plan's verification section says to restart the server and click to add a feature. If the `CLAUDE_BIN` resolution fails silently (the `catch` block returns the hardcoded fallback, but that path doesn't exist), the error won't surface until the user clicks a feature node. The server should validate at startup that the resolved binary exists and log a clear warning or error.

**Suggested fix:** Add a startup check in `server/index.ts` (or the proposed `cli-paths.ts`) that validates the resolved path exists and logs a warning:

```ts
if (!existsSync(CLAUDE_BIN)) {
  console.error(`[startup] WARNING: Claude binary not found at ${CLAUDE_BIN}`);
}
```

---

### [Impl-note] `execSync` is synchronous and blocks the event loop at import time

**Section:** In `session.ts` (CLAUDE_BIN resolution)

**Description:** The IIFE using `execSync` runs at module import time, blocking the event loop. For a one-time startup cost of a `which` call (typically <50ms), this is acceptable. However, if additional binaries are resolved this way (gh, git, etc.), the cumulative blocking time could become noticeable. Worth noting for implementation but not a plan-level issue.

---

### [Impl-note] The `Bun.spawn` env default behavior may already inherit `process.env`

**Section:** In `session.ts` (env propagation)

**Description:** Bun's `spawn` documentation indicates that by default, child processes inherit the parent's environment. The explicit `env: { ...process.env }` may be redundant. However, the plan's approach is defensive and correct -- explicit is better than relying on runtime default behavior that could change. Implementation should verify this against the Bun version in use.

---

### [Impl-note] Race condition window between session spawn and PID file write

**Section:** In `session.ts` (existing code, not introduced by plan)

**Description:** In `spawnSession`, the process is spawned (line 60), added to the sessions map (line 67), and then the PID file is written asynchronously (line 70). If the server crashes between spawn and PID file write, the process becomes orphaned with no record. This is an existing issue not introduced by the plan and doesn't affect the plan's correctness. Worth noting for future hardening.
