# Plan Review: Fix Claude CLI spawn ENOENT

**Reviewer role:** Product Manager
**Plan:** `/Users/aaron/weft-flow/plans/fix-claude-spawn.md`
**Date:** 2026-02-28

## Summary

| Severity | Count |
|----------|-------|
| Must-fix | 2 |
| Medium | 2 |
| Low | 1 |
| Impl-note | 2 |

The plan correctly identifies the root cause and proposes a reasonable fix. The scope is tight and appropriate for a bug fix -- no feature creep. However, there are two factual inconsistencies in the plan that could cause confusion during implementation, and the success criteria are too thin to confidently declare the fix complete.

---

### [Must-fix] Plan claims three files but only lists two

**Section:** Files to Modify / Context (line 6)

**Description:** The Context section states "Three files spawn `claude` with bare command names. All need fixing." But the Files to Modify section only lists two files: `session.ts` and `context-summary.ts`. Grep confirms only two files in `server/` actually spawn `claude`. The third file (`pr-tracker.ts`) spawns `gh`, not `claude`, so it's irrelevant here. This mismatch means either the plan has a phantom third file that doesn't exist, or there's a real third spawn site that wasn't listed. Either way, someone implementing from this plan will waste time hunting for the missing third file or, worse, assume the plan is incomplete and go looking for problems that aren't there.

**Suggested fix:** Change the Context line to "Two files spawn `claude` with bare command names. Both need fixing." Remove any implication of a third file. If a third file genuinely exists somewhere outside `server/`, name it explicitly.

---

### [Must-fix] No env passthrough for context-summary.ts

**Section:** In `context-summary.ts`

**Description:** The plan correctly identifies that `session.ts` needs `env: { ...process.env }` to pass the shell's PATH to the subprocess. But the fix instructions for `context-summary.ts` only say "Import `CLAUDE_BIN` from `session.ts` and replace `'claude'` in the spawn args." They don't mention adding `env: { ...process.env }` to the `context-summary.ts` spawn call. Looking at the current source, `context-summary.ts` (line 43-49) also has no `env` option on its `Bun.spawn` call. If `CLAUDE_BIN` resolves correctly this might not matter for finding the binary, but the spawned claude process itself may still lack PATH entries it needs (e.g., to find `git` or other tools it invokes internally). The same fix should be applied consistently to both spawn sites, and the plan should say so explicitly.

**Suggested fix:** Add explicit instructions under the `context-summary.ts` section to also pass `env: { ...process.env }` in the spawn options, matching the `session.ts` pattern.

---

### [Medium] Verification criteria are insufficient to confirm the fix

**Section:** Verification

**Description:** The verification section is a four-step manual smoke test: restart server, add repo, click feature, check terminal output. This is fine for a "did the crash go away" check, but it doesn't verify the fix actually works in the second spawn site (`context-summary.ts`). Context summarization only fires when spawning a subtask from a parent node. If the implementer only tests the primary flow, the `context-summary.ts` fix could be broken and no one would know until someone tries to spawn a subtask.

More importantly, the verification doesn't include a failure mode check: what happens if `claude` isn't installed at all, or `which claude` fails AND the Homebrew fallback path doesn't exist? The plan has a hardcoded fallback to `/opt/homebrew/bin/claude` which will silently produce a different ENOENT if the user isn't on macOS/Homebrew. The verification should confirm the error path produces a useful message, not a cryptic crash.

**Suggested fix:** Add verification steps:
- Step 5: From a running parent session, spawn a subtask to verify `context-summary.ts` also resolves correctly.
- Step 6: (Optional but recommended) Temporarily rename the claude binary and confirm the server starts with a clear error message rather than crashing on first feature click.

---

### [Medium] No user-facing error handling when claude binary is not found

**Section:** Fix (CLAUDE_BIN resolution)

**Description:** The plan's IIFE resolves the binary path at import time. If `which claude` fails and `/opt/homebrew/bin/claude` doesn't exist, `CLAUDE_BIN` silently gets set to a nonexistent path. The ENOENT error will then occur on first spawn rather than at startup, producing the exact same user experience as the current bug (a crash with no actionable message). From a product perspective, the whole point of this fix is to eliminate a confusing crash. If the fix can still produce the same crash under a different condition, it hasn't fully solved the user's problem.

**Suggested fix:** Add a startup validation step: after resolving `CLAUDE_BIN`, check that the file actually exists (e.g., `existsSync(CLAUDE_BIN)`). If not, log a clear error message at startup: "Claude CLI not found. Install it or set CLAUDE_BIN environment variable." This turns a runtime crash into a startup diagnostic.

---

### [Low] Circular dependency risk from exporting CLAUDE_BIN from session.ts

**Section:** In `session.ts` / In `context-summary.ts`

**Description:** The plan says to export `CLAUDE_BIN` from `session.ts` and import it into `context-summary.ts`. This creates a dependency from a utility module (`context-summary.ts`) on a session management module (`session.ts`). If `session.ts` ever imports from `context-summary.ts` (or from anything that does), you get a circular import. This isn't broken today, but it's an architectural smell. A more natural home for a shared binary resolution helper would be a small utility module (e.g., `server/claude-bin.ts`).

**Suggested fix:** Consider extracting the `CLAUDE_BIN` resolution into a dedicated `server/claude-bin.ts` module that both files import from. This is a minor structural improvement, not blocking.

---

### [Impl-note] Bun.spawn may inherit process.env by default

**Section:** Fix (env passthrough)

**Description:** Bun's documentation states that `Bun.spawn` inherits the parent process's environment by default when no `env` option is provided. If that's the case, explicitly passing `env: { ...process.env }` is harmless but redundant -- the real fix is just resolving the binary path. Worth verifying during implementation whether the `env` spread is actually needed, or if the bare command name was the only issue all along.

---

### [Impl-note] `execSync('which claude')` behavior on non-macOS platforms

**Section:** Fix (CLAUDE_BIN resolution)

**Description:** `which` is a POSIX utility but behaves differently across platforms. On some Linux distributions, `which` may not be installed by default, or may return different exit codes. If this tool is ever run on Linux or in a container, the resolution logic may need adjustment. Not a plan-level issue since the current target is clearly macOS, but worth noting during implementation.

---

## Overall Assessment

The plan is well-scoped and solves the right problem. The fix is minimal and non-invasive, which is exactly right for a bug fix -- no unnecessary refactoring or feature additions mixed in. The "What stays the same" section is a nice touch for communicating blast radius.

The two must-fix items are both about internal consistency: the plan contradicts itself on file count, and it applies the env fix inconsistently across the two spawn sites. These are easy to correct. The medium items around verification and error handling are about ensuring the fix actually delivers on its promise from the user's perspective -- eliminating a confusing crash should mean eliminating it in all cases, not just the happy path.
