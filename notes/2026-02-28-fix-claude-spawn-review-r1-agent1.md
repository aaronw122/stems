# UX Review: fix-claude-spawn.md

**Reviewer:** UX Designer
**Date:** 2026-02-28
**Plan:** `/Users/aaron/weft-flow/plans/fix-claude-spawn.md`

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Must-fix | 1 |
| Medium | 2 |
| Low | 1 |
| Impl-note | 3 |

The plan fixes a blocking ENOENT crash that prevents the core feature-spawning flow from working at all. The binary resolution approach is sound. This review focuses on what the user experiences when things go wrong -- both with the current crash, and with failure modes the plan introduces or leaves unaddressed.

---

## Issues

### [Must-fix] No user-visible feedback when CLAUDE_BIN resolution fails at startup

**Section:** Fix > In `session.ts` (CLAUDE_BIN helper)

**Description:** The plan resolves `claude` once at import time via `execSync('which claude')`, with a silent fallback to `/opt/homebrew/bin/claude`. If `which` fails AND the hardcoded path doesn't exist (e.g., claude isn't installed, or the user is on Linux where the path would be different), the server boots normally but every spawn call will fail with a confusing ENOENT at runtime -- the same class of error the plan is trying to fix. The user's experience would be identical to the current bug: click a feature node, watch it crash, get no useful information about why.

The problem is architectural because it creates a silent, delayed failure that the user cannot diagnose. The server appears healthy (the `/api/health` endpoint would return `ok`), the WebSocket connects, the UI loads -- everything looks fine until the user tries to do the one thing the app is for.

**Suggested fix:** Validate that `CLAUDE_BIN` actually points to an executable file at startup. If it doesn't, either:
1. Log a clear startup error and refuse to start (fail fast -- the server is useless without `claude`), or
2. Broadcast a persistent banner/warning to connected clients indicating that Claude CLI was not found, so the user sees the problem before they try to spawn.

Option 1 is simpler and more honest. A server that can't spawn sessions shouldn't pretend it can.

---

### [Medium] Crashed nodes from spawn failure show a generic error with no recovery path

**Section:** Fix (implicitly -- the plan doesn't change error handling)

**Description:** When `Bun.spawn` fails (whether from the current ENOENT or from a future path resolution failure), `session.ts` line 88-101 handles process exit by setting `nodeState: 'crashed'` with `errorInfo: { type: 'process_exit', message: 'Process exited with code ${code}' }`. The user sees a red-bordered node with an `!` badge and the label "Error" via the `HumanFlash` component. But there is no mechanism to:

1. See the actual error message (the `errorInfo.message` text is stored on the node but never rendered in any component -- `FeatureNode.tsx` doesn't display it, and the `TerminalPeek` would show "Waiting for output..." since no stream data arrived before the crash).
2. Retry the spawn without manually closing the node, re-opening the prompt editor, and re-entering the prompt.
3. Understand what went wrong -- "Process exited with code 1" tells the user nothing actionable.

This isn't caused by the plan, but the plan doesn't address it either, and the ENOENT scenario is exactly when these UX gaps bite hardest. After the fix, the most common spawn failure will shift from "binary not found" to things like "invalid repo path" or "claude auth expired" -- all of which will hit these same dead ends.

**Suggested fix:** At minimum, note in the plan that a follow-up should surface `errorInfo.message` in the crashed node's UI (tooltip on the error badge, or inline text below the title). A retry button would be ideal but is a larger scope addition. The plan should acknowledge this gap since the fix will make users actually reach the "session running" state for the first time, and they'll immediately encounter these rough edges.

---

### [Medium] Context summary spawns (`context-summary.ts`) fail silently with the same user-facing issue

**Section:** Fix > In `context-summary.ts`

**Description:** The plan correctly identifies that `context-summary.ts` needs the same `CLAUDE_BIN` fix. However, the current error handling in `summarizeContext` (lines 34-39) catches the spawn failure and falls back to the parent's raw prompt. This means if the binary path is wrong, the subtask prompt editor will:

1. Show the "Summarizing parent context..." spinner for up to 15 seconds (the `SUMMARIZE_TIMEOUT_MS`).
2. Then silently fall back to the raw prompt with no indication that summarization failed.

After the fix, if `CLAUDE_BIN` is correctly resolved, this becomes a non-issue. But the plan introduces a coupling: `context-summary.ts` now imports `CLAUDE_BIN` from `session.ts`. If that import fails or the module initialization throws, it could break the entire context-summary module rather than just the spawn call.

**Suggested fix:** The plan should note that the fallback behavior in `context-summary.ts` is intentionally graceful (the user gets a pre-filled prompt either way), and the 15-second spinner wait is acceptable since it's bounded. No structural change needed, but the plan should explicitly state that the coupling is acceptable because both files need the same resolved path, and module-level initialization errors would also prevent session spawning (so the user would hit the must-fix issue above first).

---

### [Low] Plan says "Three files spawn claude" but only lists two

**Section:** Files to Modify

**Description:** The Context section says "Three files spawn `claude` with bare command names. All need fixing." The Files to Modify section only lists two files: `session.ts` and `context-summary.ts`. Either the count is wrong, or there's a third file that was forgotten. Reviewing the codebase, I only found two files that spawn `claude` (`session.ts` line 51 and `context-summary.ts` line 44), so the "three" appears to be a mistake in the plan text. This is a minor consistency issue, but in a plan document, stale counts erode trust in accuracy.

**Suggested fix:** Change "Three files" to "Two files" in the Context section.

---

### [Impl-note] Hardcoded fallback path is macOS/Homebrew-specific

**Section:** Fix > In `session.ts` (CLAUDE_BIN helper)

**Description:** The fallback `/opt/homebrew/bin/claude` only works on macOS with Homebrew. If this tool is ever used on Linux or with a different package manager, the fallback is useless. During implementation, consider whether the fallback is even needed -- if `which claude` fails, the binary probably isn't installed, and failing clearly is better than trying a path that almost certainly won't exist.

---

### [Impl-note] `execSync` at module import time blocks the event loop

**Section:** Fix > In `session.ts` (CLAUDE_BIN helper)

**Description:** `execSync('which claude')` runs synchronously at import time, blocking the Bun event loop during server startup. For `which`, this is typically <50ms and occurs once, so it's negligible in practice. But if the shell environment is slow to initialize (e.g., heavy `.zshrc`), it could delay startup noticeably. During implementation, verify that `which` runs fast in the target environment.

---

### [Impl-note] `env: { ...process.env }` may not be sufficient for all PATH scenarios

**Section:** Fix > In `session.ts` (env passing)

**Description:** The plan adds `env: { ...process.env }` to pass the server's environment to the spawned process. If the Bun server is launched from a context with a limited PATH (e.g., a systemd service, a Docker container, or launched via a desktop app), `process.env.PATH` might not include the directories that `claude` needs to find its own dependencies (git, gh, node, etc.). During implementation, verify that the PATH in the spawned process is sufficient by checking that `claude` can actually run its tools.
