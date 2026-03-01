# DX Review: Fix Claude CLI spawn ENOENT (Round 2)

**Reviewer role:** Developer Experience (DX) Specialist
**Plan:** `/Users/aaron/weft-flow/plans/fix-claude-spawn.md` (revision 2)
**Date:** 2026-02-28

---

## Round 1 Issue Status

| R1 Issue | Severity | Status | Notes |
|----------|----------|--------|-------|
| Plan claims three files but only addresses two (`pr-tracker.ts` missing) | Must-fix | **Fixed** | `pr-tracker.ts` is now listed in scope (line 13) and addressed in its own section (lines 105-107). `GH_BIN` is resolved through the same `cli-paths.ts` module. Clean. |
| Exporting `CLAUDE_BIN` from `session.ts` creates coupling | Must-fix | **Fixed** | New `server/cli-paths.ts` module owns all binary resolution. `session.ts` and `context-summary.ts` import `CLAUDE_BIN`; `pr-tracker.ts` imports `GH_BIN`. This is exactly the fix I suggested — module boundaries are clean. |
| Silent fallback to hardcoded path masks the real problem | Medium | **Fixed** | `resolveBin` now validates with `existsSync` at every stage: env var path, `which` result, and fallback. Throws at startup with a clear error message listing what was tried and how to fix it. This is excellent DX — fail-fast with actionable guidance. |
| `env: { ...process.env }` is redundant | Medium | **Acknowledged / Kept intentionally** | The plan still includes `env: { ...process.env }` in all three files. My R1 concern was that this is a no-op since Bun inherits env by default. The plan now frames it as defensive ("so that claude itself can find its dependencies"). I'll downgrade this to Impl-note — it's harmless, and having it explicit makes the intent visible. Not worth fighting over. |
| Verification section lacks a failure-case test | Low | **Not addressed** | Verification section (lines 116-119) is unchanged — still only happy-path steps. See new issue below. |
| `which` vs `command -v` portability | Impl-note | **Not addressed** | Plan still uses `which`. Acceptable — this is macOS-only in practice. |
| `execSync` at import time blocks event loop | Impl-note | **Resolved by design** | Now in a dedicated module (`cli-paths.ts`) that runs at import time. Two `execSync` calls (one for `claude`, one for `gh`) — still fast, and the module boundary makes it clear this is startup-only work. |
| `context-summary.ts` spawn intentionally omits `--output-format stream-json` | Impl-note | **Not addressed** | No clarifying note added. Minor. |

**Summary:** Both Must-fix issues are cleanly resolved. The Medium issues are either fixed or acceptably mitigated. The plan is substantially improved.

---

## New Issues (Round 2)

### Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Must-fix | 0 |
| Medium | 1 |
| Low | 1 |
| Impl-note | 3 |

---

### [Medium] Orphan subprocess cleanup requires restructuring that the plan doesn't specify

**Section:** In `context-summary.ts` (lines 91-103)

**Description:** The plan proposes killing the subprocess on timeout via a cleanup callback:

```ts
const proc = Bun.spawn(args, { /* ... */ });
const result = await withTimeout(
  readStream(proc),
  TIMEOUT_MS,
  () => { proc.kill(); }
);
```

But the current code encapsulates the spawn inside `runClaudeSummarize`:

```ts
// Current (context-summary.ts lines 29-32):
const summary = await withTimeout(
  runClaudeSummarize(prompt),  // proc is created inside here, not accessible
  SUMMARIZE_TIMEOUT_MS,
);
```

The `proc` handle is local to `runClaudeSummarize` and invisible to `withTimeout`. Implementing the plan's pattern requires either: (a) restructuring `runClaudeSummarize` to return both a promise and a process handle, (b) hoisting the spawn logic out of `runClaudeSummarize` into the caller, or (c) using `AbortSignal` (which the plan mentions as an alternative). All three are straightforward, but none are trivial refactors — the current function signature has to change.

The plan says "If `withTimeout` doesn't currently accept a cleanup callback, extend it to do so, or use an `AbortController` / `AbortSignal` pattern instead" (line 103). This acknowledges the gap but leaves the implementer to figure out the refactoring. For a plan-level document, this is borderline — someone implementing this will need to make an architectural micro-decision about which pattern to use, and the wrong choice (e.g., a hacky closure that captures a mutable `proc` variable) could be worse than the current orphan bug.

**Suggested fix:** Pick one pattern and specify it. The simplest is to have `runClaudeSummarize` return `{ promise: Promise<string>, proc: Subprocess }`, then destructure in the caller:

```ts
const { promise, proc } = spawnClaudeSummarize(prompt);
const summary = await withTimeout(promise, SUMMARIZE_TIMEOUT_MS, () => proc.kill());
```

This is a 5-line change to the plan that eliminates ambiguity.

---

### [Low] Verification section still lacks a failure-case test

**Section:** Verification (lines 116-119)

**Description:** Carried over from R1 — the verification steps only cover the happy path. For a fix whose entire purpose is better error handling, not testing the error path is a gap. This matters for DX because the startup error message (the best part of this plan) will never be verified unless someone thinks to test it.

**Suggested fix:** Add:

```
5. Set CLAUDE_BIN=/nonexistent and restart — server should fail at
   startup with a clear error, not start and crash later.
```

---

### [Impl-note] `--` separator for flag injection is only applied to `context-summary.ts`, not `session.ts`

**Section:** In `context-summary.ts` (lines 80-87)

**Description:** The plan adds `--` before the prompt argument in `context-summary.ts` to prevent flag injection from terminal output embedded in the prompt. The same risk exists in `session.ts` — the `prompt` is a user-authored string that gets `args.push(prompt)` (line 58 of session.ts). A user could type a prompt starting with `--` and it would be interpreted as a CLI flag.

The risk is lower in `session.ts` (user-authored content vs. raw terminal output), so this doesn't rise above Impl-note. But the `--` separator costs nothing and would be consistent. Worth adding during implementation.

---

### [Impl-note] `env: { ...process.env }` is a no-op but now serves as documentation

**Section:** In `session.ts`, `context-summary.ts`, `pr-tracker.ts`

**Description:** Downgraded from R1 Medium. Bun.spawn inherits `process.env` by default, so the spread is functionally redundant. However, making it explicit signals intent ("yes, we want env inherited") and provides a natural extension point if PATH augmentation is needed later. Acceptable as-is. A brief inline comment (`// explicit: ensure child inherits full env for PATH`) would make the intent even clearer.

---

### [Impl-note] `resolveBin` uses `which` inside `execSync` — the `name` argument is not sanitized

**Section:** `server/cli-paths.ts` (line 39)

**Description:** `execSync(`which ${name}`)` concatenates `name` into a shell command. Since `name` is hardcoded at the call sites (`'claude'`, `'gh'`), this is safe today. But if `resolveBin` were ever called with user-provided input, it would be a command injection vector. This is a non-issue in the current design — just worth a comment like `// name must be a trusted string` on the function signature.

---

## Overall Assessment

The plan is in good shape. The `cli-paths.ts` module is clean, well-separated, and the `resolveBin` function has a clear resolution hierarchy (env var -> which -> fallback) with validation at every stage. The error messages are actionable. The scope now covers all three spawn sites.

The only issue with architectural implications is the orphan cleanup pattern, which needs one more sentence of specificity to avoid implementation ambiguity. Everything else is polish.

**Verdict:** Ready to implement, with the Medium issue above addressed either in the plan or as the first implementation decision.
