# Review: fix-claude-spawn plan (Round 2)
**Reviewer:** Software Architect (Agent 3)
**Date:** 2026-02-28
**Plan:** `/Users/aaron/weft-flow/plans/fix-claude-spawn.md` (revision 2)

## Round 1 Issue Status

| # | Severity | Issue | Status |
|---|----------|-------|--------|
| 1 | Critical | Plan claims three files but only lists two -- `pr-tracker.ts` unaddressed | **Fixed.** Plan now explicitly lists `pr-tracker.ts` as the third file (line 13), scopes `GH_BIN` resolution into `cli-paths.ts`, and describes the fix for `pr-tracker.ts` (lines 105-107). The "Three files" claim is now accurate. |
| 2 | Must-fix | Circular dependency: `context-summary.ts` importing from `session.ts` | **Fixed.** Plan introduces a dedicated `server/cli-paths.ts` module (lines 19-54). Both `session.ts` and `context-summary.ts` import from `cli-paths.ts` rather than from each other. No coupling between the two consumer modules. Clean dependency graph. |
| 3 | Must-fix | `env` propagation missing from `context-summary.ts` spawn | **Fixed.** Plan explicitly includes `env: { ...process.env }` for `context-summary.ts` (line 89) and `pr-tracker.ts` (line 107). |
| 4 | Must-fix | `context-summary.ts` orphaned subprocess on timeout | **Fixed.** Plan adds a cleanup callback pattern (lines 91-103) where `proc.kill()` is called when the timeout fires. The plan also correctly notes that `withTimeout` may need to be extended to accept a cleanup callback, or an `AbortController` pattern used instead. |
| 5 | Medium | `which` may not resolve in non-login shell / fallback validation missing | **Fixed.** The `resolveBin` function now validates every candidate with `existsSync` (lines 31, 40, 44) and throws a clear error with all attempted paths if none exist (lines 46-49). The env var override is also validated. |
| 6 | Medium | `context-summary.ts` missing `cwd` in spawn | **Not fixed.** The plan does not mention adding `cwd` to the `context-summary.ts` spawn call. See assessment below. |
| 7 | Low | No startup validation if binary not found | **Fixed.** The `resolveBin` function throws at module load time if the binary cannot be found (line 46). Since `cli-paths.ts` exports `CLAUDE_BIN` and `GH_BIN` at the top level, the throw happens at server startup when the module is first imported. This is exactly the fail-fast behavior recommended. |
| 8 | Impl-note | `execSync` blocks event loop at import time | Still applies. Acceptable tradeoff. |
| 9 | Impl-note | `Bun.spawn` may already inherit `process.env` | Still applies. Defensive approach is correct. |
| 10 | Impl-note | Race between spawn and PID file write | Still applies. Existing issue, not in scope. |

### Assessment of Issue #6 (cwd)

The missing `cwd` in `context-summary.ts` was rated Medium in Round 1. The plan still does not address it. However, re-evaluating against the scope test: the summarization prompt is self-contained text (it passes terminal output inline in the prompt string), so `claude -p` does not need repo context to produce the summary. The lack of `cwd` is not functionally broken today and would not cause rework during implementation. **Downgrading to Impl-note** -- the implementer should consider adding `cwd` for consistency with `session.ts`, but it is not a plan-level issue.

---

## New Issues

### [Medium] `--` separator placement is incorrect -- will be parsed as a flag to `claude`, not as an end-of-options marker

**Section:** In `context-summary.ts` (lines 82-87)

**Description:** The plan shows:
```ts
// After:
const args = [CLAUDE_BIN, '-p', '--', prompt];
```

The intent is to prevent the prompt content from being interpreted as CLI flags. However, this changes the semantics of the command. The `claude` CLI uses `-p` as a flag that takes the next positional argument as the prompt. The `--` end-of-options marker tells the argument parser "everything after this is positional." But `-p` expects its argument immediately after it -- inserting `--` between `-p` and `prompt` means `-p` receives no argument (or receives `--` as its argument, depending on the parser).

Looking at the existing spawn in `session.ts` (line 51), the pattern is:
```ts
['claude', '-p', '--output-format', 'stream-json', '--dangerously-skip-permissions']
// prompt is pushed last as a positional arg
```

And in the current `context-summary.ts` (line 44):
```ts
['claude', '-p', '--dangerously-skip-permissions', prompt]
```

In both cases, `-p` is a standalone flag (meaning "pipe mode" / non-interactive), NOT a flag that takes the prompt as its argument. The prompt is the final positional argument. So the correct placement of `--` would be:

```ts
const args = [CLAUDE_BIN, '-p', '--dangerously-skip-permissions', '--', prompt];
```

This places `--` after all flags and before the positional prompt argument, which is the standard POSIX convention. The plan's current placement (`-p`, `--`, `prompt`) omits `--dangerously-skip-permissions` entirely from the args array, which is a separate bug -- but even if that flag were included, the `--` must come after ALL flags, not between `-p` and the prompt.

**Why this is plan-level:** Getting the argument order wrong will cause the `claude` CLI to either error out or misinterpret arguments. The implementer needs clear guidance on where `--` goes relative to the other flags.

**Suggested fix:** Show the complete args array with `--` in the correct position:
```ts
const args = [CLAUDE_BIN, '-p', '--dangerously-skip-permissions', '--', prompt];
```

---

### [Low] `--dangerously-skip-permissions` is missing from the plan's `context-summary.ts` code snippet

**Section:** In `context-summary.ts` (lines 83-87)

**Description:** The plan's "before/after" snippet for the `--` separator fix shows:
```ts
// Before (vulnerable to flag injection):
const args = [CLAUDE_BIN, '-p', prompt];
// After:
const args = [CLAUDE_BIN, '-p', '--', prompt];
```

The actual current code (line 44) is:
```ts
['claude', '-p', '--dangerously-skip-permissions', prompt]
```

The plan's snippet drops `--dangerously-skip-permissions` from the args. This is likely an illustrative simplification, but an implementer following the plan literally would remove the `--dangerously-skip-permissions` flag, causing the spawned `claude` process to pause for permission prompts that nobody can answer (since this is a non-interactive `-p` invocation). The process would hang until the 15-second timeout kills it.

**Suggested fix:** Show the full args array in the before/after:
```ts
// Before:
const args = [CLAUDE_BIN, '-p', '--dangerously-skip-permissions', prompt];
// After:
const args = [CLAUDE_BIN, '-p', '--dangerously-skip-permissions', '--', prompt];
```

---

### [Impl-note] `resolveBin` uses `which` with unsanitized `name` parameter

**Section:** New file: `server/cli-paths.ts` (line 39)

**Description:** The `resolveBin` function passes the `name` parameter directly into an `execSync` shell command:
```ts
const resolved = execSync(`which ${name}`, { encoding: 'utf-8' }).trim();
```

Since `resolveBin` is only called with hardcoded string literals (`'claude'` and `'gh'`), this is not exploitable in practice. However, if the function were ever extended to accept user input or env-var-derived names, this would be a command injection vector. Implementation should either add a comment noting that `name` must be a trusted value, or use `execFileSync('which', [name])` to avoid shell interpretation entirely.

---

### [Impl-note] `withTimeout` cleanup callback architecture needs specification

**Section:** In `context-summary.ts` (lines 91-103)

**Description:** The plan proposes:
```ts
const result = await withTimeout(
  readStream(proc),
  TIMEOUT_MS,
  () => { proc.kill(); }  // cleanup callback
);
```

But then says "If `withTimeout` doesn't currently accept a cleanup callback, extend it to do so, or use an `AbortController` / `AbortSignal` pattern instead." The current `withTimeout` (lines 60-76 of `context-summary.ts`) takes `(promise, ms)` -- no cleanup callback.

This is fine as an implementation detail -- the implementer can choose the pattern. But there is a subtlety worth noting: the plan calls `readStream(proc)` which doesn't exist in the current code. The current flow is:
1. `runClaudeSummarize` spawns the process
2. `await proc.exited` waits for exit
3. Reads stdout

The plan needs the process handle to be accessible in the scope where `withTimeout` is called (`summarizeContext`), but currently `proc` is local to `runClaudeSummarize`. The implementer will need to restructure so that either:
- `runClaudeSummarize` returns both the promise and the process handle, or
- The spawn and timeout logic are combined in a single function, or
- An `AbortSignal` is threaded through

Any of these work. Not a plan-level issue since the plan already acknowledges the need for restructuring, but the `readStream(proc)` reference in the pseudocode may confuse an implementer looking for that function.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Must-fix | 0 |
| Medium | 1 |
| Low | 1 |
| Impl-note | 4 (2 new + 2 carried from R1) |

The plan is substantially improved from Round 1. All Critical and Must-fix issues have been addressed. The `cli-paths.ts` module design is clean -- single responsibility, fail-fast validation, env var overrides for flexibility. The orphaned process cleanup is properly scoped.

The remaining Medium issue (incorrect `--` placement) is a real bug in the plan's code snippet that would cause the command to malfunction. It needs one more pass to get the argument ordering right and to restore the missing `--dangerously-skip-permissions` flag in the example. These are closely related and should be fixed together.

Overall: the plan is close to ready. Fix the `--` placement and the truncated args snippet, and it is good to implement.
