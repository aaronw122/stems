# Plan Review (Round 2): Fix Claude CLI spawn ENOENT

**Reviewer role:** Product Manager
**Plan:** `/Users/aaron/weft-flow/plans/fix-claude-spawn.md` (revision 2)
**Date:** 2026-02-28

---

## Round 1 Issue Status

| # | Round 1 Issue | Severity | Status | Notes |
|---|---------------|----------|--------|-------|
| 1 | Plan claims three files but only lists two | Must-fix | **Fixed** | Plan now correctly lists all three files (`session.ts`, `context-summary.ts`, `pr-tracker.ts`) and distinguishes that the third spawns `gh`, not `claude`. The context line (line 7) says "Three files spawn external CLIs with bare command names" -- accurate and clear. |
| 2 | No env passthrough for `context-summary.ts` | Must-fix | **Fixed** | Plan now explicitly calls out `env: { ...process.env }` for `context-summary.ts` (line 89) and `pr-tracker.ts` (line 107), matching `session.ts`. All three spawn sites treated consistently. |
| 3 | Verification criteria insufficient | Medium | **Partially fixed** | The verification section (lines 116-119) is unchanged from R1 -- still only four steps covering the primary happy-path flow. The plan does not include a step to verify context summarization (the second `claude` spawn site) or a step to verify the startup error path (binary not found). See new issue below. |
| 4 | No user-facing error handling when binary not found | Medium | **Fixed** | The new `cli-paths.ts` module uses `existsSync` at each resolution step and throws with a clear, actionable error message at server startup if neither env var, `which`, nor fallback path resolves. This is exactly what was requested. |
| 5 | Circular dependency risk from exporting CLAUDE_BIN from session.ts | Low | **Fixed** | New dedicated `server/cli-paths.ts` module eliminates the coupling concern entirely. Both `session.ts` and `context-summary.ts` import from `cli-paths.ts`, which has no dependencies on either. Clean separation. |
| 6 | Bun.spawn may inherit process.env by default (Impl-note) | Impl-note | **Acknowledged** | Plan now includes `env: { ...process.env }` across all three files. Still harmless if redundant -- belt-and-suspenders is fine for a fix like this. No action needed. |
| 7 | `which` behavior on non-macOS platforms (Impl-note) | Impl-note | **Unchanged** | Still applicable. Not a plan-level concern. |

**Summary:** 4 of 5 actionable issues are fully resolved. One (verification criteria) is partially addressed -- the fail-fast startup validation is in place, but the verification steps in the plan don't exercise it.

---

## New Issues

### [Medium] Verification still does not cover the second spawn site or the error path

**Section:** Verification (lines 116-119)

**Description:** The verification section remains a four-step happy-path smoke test. This was flagged in Round 1 as insufficient, and while the plan now has startup validation that makes the error path less dangerous, the verification steps still don't confirm two things:

1. **Context summarization works** -- `context-summary.ts` is the second `claude` spawn site. The happy-path verification only tests `session.ts` (clicking a feature fires the main session). Context summarization fires only when spawning a subtask from a parent node. If the implementer only tests the primary flow, a bug in the `context-summary.ts` changes (e.g., wrong `--` placement, missing env) would ship undetected.

2. **Startup validation actually fires** -- The new `cli-paths.ts` module is the key product improvement: a clear error at startup instead of a cryptic crash at runtime. But the verification doesn't include a step to confirm this works. If the `existsSync` check or the error message has a bug, the one scenario the plan is supposed to eliminate (confusing ENOENT crash) could still occur.

From a product perspective, the verification section is the "definition of done." If it doesn't cover the fix's two main value propositions (both spawn sites work, and failure is clear), the implementer may ship a partial fix.

**Suggested fix:** Add two verification steps:
- Step 5: From a running parent session, spawn a child/subtask to verify context summarization runs without ENOENT.
- Step 6: Temporarily set `CLAUDE_BIN` to a nonexistent path and confirm the server refuses to start with a clear error message.

---

### [Low] `--` separator placement may be incorrect in the code example

**Section:** In `context-summary.ts` (lines 82-87)

**Description:** The plan shows the fix as:

```ts
// After:
const args = [CLAUDE_BIN, '-p', '--', prompt];
```

The `--` separator conventionally means "end of flags, everything after is positional." For the Claude CLI, `-p` expects the next argument to be the prompt string. Placing `--` between `-p` and the prompt may cause the CLI to interpret `--` as the prompt value itself (since `-p` consumes the next argument), or it may cause `prompt` to be treated as an unrecognized positional argument.

The correct placement, if `--` is needed at all, depends on how the Claude CLI parses its arguments. If `-p` takes the next token as its value regardless, the `--` gets consumed as the prompt text and the actual prompt becomes an orphaned positional arg.

This passes the scope test ("would discovering this during implementation cause rework?") only marginally -- the implementer can test it in 30 seconds. But it's worth flagging because the plan presents it as a definitive fix with a "Before (vulnerable) / After" framing. If the "After" doesn't parse correctly, the implementer has to figure out the right invocation themselves, which undermines the plan's value.

**Suggested fix:** Verify the Claude CLI's actual behavior with `claude -p -- "some prompt"` before committing to this syntax in the plan. If `-p` consumes `--` as its argument, the separator needs to go elsewhere or the mitigation needs a different approach (e.g., ensuring the prompt doesn't start with `--`).

---

### [Impl-note] `withTimeout` cleanup callback is a design sketch, not a specification

**Section:** In `context-summary.ts` (lines 92-103)

**Description:** The plan proposes extending `withTimeout` to accept a cleanup callback that kills the subprocess on timeout. The current `withTimeout` implementation (visible in source at lines 60-76) is a straightforward promise race with no cleanup mechanism. The plan says "If `withTimeout` doesn't currently accept a cleanup callback, extend it to do so, or use an `AbortController` / `AbortSignal` pattern instead."

This is fine as implementation guidance -- the implementer has latitude to choose the approach. Just noting that the two alternatives (callback vs. AbortSignal) have different ergonomics, and the plan's code example only shows the callback approach. Not a plan-level issue since either approach works and the choice doesn't affect architecture.

---

## Overall Assessment

| Severity | Count |
|----------|-------|
| Medium | 1 |
| Low | 1 |
| Impl-note | 1 |

The plan improved substantially between R1 and R2. The biggest structural win is the dedicated `cli-paths.ts` module with startup validation -- this is the right architecture and eliminates the original user-facing problem (cryptic ENOENT) while also providing extensibility for future CLI dependencies. The scope is clean, the three-file inventory is now accurate, and the env passthrough is consistent across all spawn sites.

The remaining medium issue (verification gaps) is a "definition of done" problem, not an architecture problem. The fix itself is well-designed; the plan just doesn't tell the implementer how to confirm it works across both spawn sites. This is low-risk because a competent implementer will likely test both paths anyway, but the plan should be explicit about it since verification is the section an implementer uses to decide "am I done?"

The `--` separator question (low) is worth a quick sanity check before implementation but won't cause rework -- it's a 30-second terminal test.

**Recommendation:** Fixable in a quick pass. Add two verification steps and confirm the `--` placement with a manual CLI test. No architectural changes needed.
