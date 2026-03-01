# UX Review: fix-claude-spawn.md (Round 2)

**Reviewer:** UX Designer
**Date:** 2026-02-28
**Plan revision:** 2
**Plan:** `/Users/aaron/weft-flow/plans/fix-claude-spawn.md`

---

## Round 1 Issue Status

### [FIXED] [Must-fix] No user-visible feedback when CLAUDE_BIN resolution fails at startup

The new `cli-paths.ts` module validates binary existence with `existsSync` at module-level initialization. If the binary is not found, the server throws immediately with a clear, actionable error message:

> `Could not find "claude" binary. Tried: $CLAUDE_BIN env var, which claude, /opt/homebrew/bin/claude. Install claude or set CLAUDE_BIN to the full path.`

This is exactly what I asked for: fail fast, don't pretend the server is functional. Because `cli-paths.ts` is imported by `session.ts` and `context-summary.ts`, which are imported by `server/index.ts`, the throw happens before the HTTP server starts listening -- the user sees the error in their terminal immediately.

**Verdict: Fixed.** The error message is clear, names what was tried, and tells the user what to do. No UX gap remains.

---

### [FIXED] [Medium] Context summary spawns (`context-summary.ts`) fail silently with the same user-facing issue

The plan now decouples binary resolution into `cli-paths.ts` instead of importing from `session.ts`. This eliminates the coupling concern I raised. Both modules import from the same dedicated path-resolution module, which is architecturally cleaner and means a failure in `session.ts` won't cascade into `context-summary.ts` or vice versa.

Additionally, the plan now adds `env: { ...process.env }` to the `context-summary.ts` spawn, and addresses the orphaned subprocess on timeout by killing the process in a cleanup callback. These are meaningful improvements to the silent failure behavior.

**Verdict: Fixed.** The coupling concern is resolved. The graceful fallback behavior (user gets raw prompt if summarization fails) remains intact, which is correct.

---

### [FIXED] [Low] Plan says "Three files spawn claude" but only lists two

The Context section now correctly says "Three files spawn external CLIs with bare command names." The Files to Modify section lists all three: `session.ts` (claude), `context-summary.ts` (claude), and `pr-tracker.ts` (gh). The count and the list are now consistent.

**Verdict: Fixed.**

---

### [ACKNOWLEDGED] [Impl-note] Hardcoded fallback path is macOS/Homebrew-specific

The plan retains `/opt/homebrew/bin/claude` and `/opt/homebrew/bin/gh` as fallbacks, but now the error message when fallback fails is explicit about what was tried and suggests setting the env var. The env var override (`CLAUDE_BIN`, `GH_BIN`) provides a clean escape hatch for non-Homebrew installs. This is acceptable -- the fallback is a convenience for the common case, not a requirement.

**Verdict: Acceptable as-is.**

---

### [ACKNOWLEDGED] [Impl-note] `execSync` at module import time blocks the event loop

Still applies. The plan uses `execSync('which ...')` at module-level import time. Acceptable for startup, as noted in Round 1.

**Verdict: Acceptable as-is.**

---

### [ACKNOWLEDGED] [Impl-note] `env: { ...process.env }` may not be sufficient for all PATH scenarios

Still applies. The plan now consistently passes `env: { ...process.env }` across all three spawn sites, which is the right thing to do. The edge case of a limited PATH in the server process is an inherent deployment concern, not a plan-level issue.

**Verdict: Acceptable as-is.**

---

### [OPEN] [Medium] Crashed nodes from spawn failure show a generic error with no recovery path

This issue was not addressed by the Round 1 fixes, and the plan does not acknowledge it. Looking at the current code:

- `FeatureNode.tsx` renders a red border and dot for `crashed` state, but never displays `errorInfo.message` anywhere.
- `HumanFlash` only renders for `needsHuman === true` states, not for `crashed`.
- A crashed node shows no text explaining what went wrong and no retry action.

The plan's fix makes it *more likely* that users actually reach the running state and subsequently encounter crashes from other causes (auth expiry, invalid repo path, claude CLI errors). The "no repo path" crash in `server/index.ts` line 175-181 already sets a clear `errorInfo.message` ("Could not find repo path for this node"), but it's never surfaced to the user.

This remains a UX gap, but it was correctly classified as Medium in Round 1 -- it doesn't cause architectural rework. Acknowledging it in the plan as a known follow-up would be sufficient.

**Verdict: Still open. Recommend adding a one-line note to the plan: "Follow-up: surface `errorInfo.message` in crashed node UI."**

---

## New Issues

### [Medium] `--` separator placement in context-summary.ts may break `claude -p` invocation

**Section:** Fix > In `context-summary.ts`

**Description:** The plan shows the following change:

```ts
// After:
const args = [CLAUDE_BIN, '-p', '--', prompt];
```

The `--` convention signals "end of flags, everything after is positional." However, the current invocation in `context-summary.ts` line 44 also passes `--dangerously-skip-permissions`:

```ts
['claude', '-p', '--dangerously-skip-permissions', prompt]
```

The plan's code example omits `--dangerously-skip-permissions` entirely and places `--` between `-p` and the prompt. If the implementer follows the plan's "After" example literally, the `--dangerously-skip-permissions` flag gets dropped, and every context summarization call will block waiting for permission prompts that nobody can answer -- the process has no interactive terminal. The user sees a 15-second spinner on every subtask spawn, then gets the raw prompt fallback. Functional, but needlessly slow and confusing.

Even if the implementer preserves `--dangerously-skip-permissions`, the correct arg order needs to be explicit: `[CLAUDE_BIN, '-p', '--dangerously-skip-permissions', '--', prompt]`. The plan should show the full args array, not a simplified version that omits a critical flag.

**Why this is plan-level:** Getting the arg order wrong produces a subtle, silent degradation (15s delay on every subtask spawn) that would be hard to diagnose. The plan should be unambiguous about the full args array.

**Suggested fix:** Show the complete args array in the plan:
```ts
const args = [CLAUDE_BIN, '-p', '--dangerously-skip-permissions', '--', prompt];
```

---

### [Low] `which` command in `resolveBin` is not sanitized against binary name

**Section:** Fix > New file: `server/cli-paths.ts`

**Description:** The `resolveBin` function runs:

```ts
execSync(`which ${name}`, { encoding: 'utf-8' })
```

The `name` parameter comes from hardcoded strings (`'claude'`, `'gh'`) in the same file, so there is no actual injection risk in practice. However, if this utility were ever reused with user-provided input, it would be a command injection vector. This is a code hygiene note, not a real vulnerability given the current usage.

**Verdict:** Impl-note. During implementation, consider using `execFileSync('which', [name])` instead of `execSync` for defense in depth.

---

### [Impl-note] `withTimeout` cleanup callback pattern needs design decision

**Section:** Fix > In `context-summary.ts` (orphaned subprocess)

**Description:** The plan proposes extending `withTimeout` to accept a cleanup callback:

```ts
const result = await withTimeout(
  readStream(proc),
  TIMEOUT_MS,
  () => { proc.kill(); }
);
```

But the current code passes `runClaudeSummarize(prompt)` (a full Promise) to `withTimeout`, not a stream reader. The plan references `readStream(proc)` which doesn't exist in the current code. The implementer needs to decide whether to:

1. Restructure `runClaudeSummarize` to return both the process handle and the result promise separately, or
2. Capture the process handle in a closure outside `withTimeout` and kill it in the catch block.

Option 2 is simpler and doesn't require changing `withTimeout`'s signature:

```ts
let proc: Subprocess | null = null;
try {
  const summary = await withTimeout(
    (async () => {
      proc = Bun.spawn(args, { ... });
      // ... await and return result
    })(),
    SUMMARIZE_TIMEOUT_MS,
  );
  return summary.trim() || rawFallback;
} catch (err) {
  proc?.kill();
  // ... fallback
}
```

This is an implementation detail, not a plan-level issue. Noting it because the plan's pseudocode doesn't match the current code structure and may confuse the implementer.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Must-fix | 0 |
| Medium | 1 new, 1 carried |
| Low | 1 new |
| Impl-note | 1 new |

**Round 1 fixes are solid.** The `cli-paths.ts` module is well-designed: clean separation, env var overrides, `existsSync` validation, fail-fast at startup with actionable error messages. The decoupling from `session.ts` resolves the import chain concern. The `env: { ...process.env }` addition and orphan process cleanup are both good catches from the first round.

**One new medium issue:** The `--` separator example in `context-summary.ts` omits `--dangerously-skip-permissions`, which could cause a silent 15-second delay on every subtask spawn if the implementer follows the plan literally. The plan should show the full args array.

**One carried medium issue:** Crashed nodes still don't surface error messages to the user. Not caused by this plan, but worth a follow-up note.
