# DX Review: Fix Claude CLI spawn ENOENT

**Reviewer role:** Developer Experience (DX) Specialist
**Plan:** `/Users/aaron/weft-flow/plans/fix-claude-spawn.md`
**Date:** 2026-02-28

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Must-fix | 2 |
| Medium | 2 |
| Low | 1 |
| Impl-note | 3 |

The plan correctly identifies the root cause and proposes a reasonable fix direction. However, it has two structural issues that would cause rework: a factual inconsistency in scope (claims three files, fixes two, misses a real third), and a module coupling problem with the export strategy. It also lacks startup validation, meaning the ENOENT error would be deferred from a crash into a silent fallback to a possibly-nonexistent path, trading one bad failure mode for another.

---

## Issues

### [Must-fix] Plan claims three files but only addresses two, and the actual third file has the same `gh` problem

**Section:** Files to Modify

**Description:** The plan opens with "Three files spawn `claude` with bare command names. All need fixing." but then lists only two files (`session.ts` and `context-summary.ts`). Looking at the actual codebase, the third `Bun.spawn` call is in `pr-tracker.ts` at line 146, which spawns `gh` (not `claude`). The plan later hand-waves this with "PR tracker (`gh` is a separate issue, likely works already)."

This is a self-contradiction: the plan says "three files, all need fixing," then only lists two, then dismisses the third. If `gh` has the same PATH-resolution problem as `claude` (it does -- both are Homebrew-installed binaries), this fix will leave `pr-tracker.ts` broken. If `gh` genuinely is not affected, the plan should say "Two files spawn `claude`" and explain why `gh` is different.

**Suggested fix:** Either (a) change the opening to "Two files spawn `claude`" and add a brief note about why `gh` is not affected, or (b) extend the `CLAUDE_BIN` pattern to also resolve `gh` and fix `pr-tracker.ts` in the same pass. The latter is preferable since the PATH problem affects all binaries equally.

---

### [Must-fix] Exporting `CLAUDE_BIN` from `session.ts` creates a circular-dependency-prone coupling

**Section:** In `context-summary.ts`

**Description:** The plan says to export `CLAUDE_BIN` from `session.ts` and import it in `context-summary.ts`. This works today, but `session.ts` is a domain module with session lifecycle responsibilities (spawn, kill, PID tracking). Making it also the canonical source of binary path resolution mixes concerns and creates a coupling that will grow. If a fourth file needs `CLAUDE_BIN`, it must import from `session.ts`, which may pull in session types or state. If `context-summary.ts` ever needs to import session utilities, you risk a circular import.

This matters at the plan level because it determines module boundaries. Fixing it after implementation means moving the export, updating all import paths, and re-testing.

**Suggested fix:** Create a small utility module (e.g., `server/cli-paths.ts` or `server/resolve-bin.ts`) that owns the binary resolution logic. Both `session.ts` and `context-summary.ts` import from it. This is ~10 lines, adds no complexity, and keeps module responsibilities clean. It also becomes the natural home for resolving `gh` if `pr-tracker.ts` needs the same fix.

---

### [Medium] Silent fallback to a hardcoded path masks the real problem

**Section:** In `session.ts` (the `CLAUDE_BIN` IIFE)

**Description:** The plan's `CLAUDE_BIN` resolution uses a try/catch with a fallback to `/opt/homebrew/bin/claude`. If `which claude` fails (e.g., `claude` is not installed at all, or PATH is truly broken), the server will start up with a hardcoded path that may not exist, and the ENOENT error will just happen later when a session is spawned. The developer gets the same cryptic crash, just delayed.

This is especially problematic because `which` returning a non-zero exit code can mean either "not found" or "which itself errored." The fallback silently assumes the former.

**Suggested fix:** After resolution (whether via `which` or fallback), validate the path actually exists. If neither resolves, fail at startup with a clear message:

```
Error: Could not find 'claude' binary.
  - 'which claude' failed
  - Fallback path /opt/homebrew/bin/claude does not exist

Install claude: npm install -g @anthropic-ai/claude-cli
Or set CLAUDE_BIN=/path/to/claude in your environment.
```

Failing fast at startup is dramatically better DX than a deferred ENOENT on first session spawn. This also naturally supports a `CLAUDE_BIN` environment variable override, which is a one-line addition and the standard escape hatch for this class of problem.

---

### [Medium] `env: { ...process.env }` is redundant in Bun and obscures intent

**Section:** In `session.ts` (spawn options)

**Description:** The plan adds `env: { ...process.env }` to the Bun.spawn options to "pass the current shell's PATH to the subprocess so that `claude` itself can find its dependencies (git, gh, etc.)." However, `Bun.spawn` already inherits `process.env` by default -- this is standard POSIX behavior that Bun follows. The spread creates a shallow copy that is functionally identical to the default.

If the actual goal is to ensure PATH is correct (because the Bun server was started from a context with a stripped PATH), spreading `process.env` won't help -- you'd need to explicitly augment PATH. If the goal is documentation ("yes, we do want env inherited"), a comment is clearer than a no-op spread.

**Suggested fix:** Either remove the `env` option entirely (it's the default) and add a comment explaining that env is inherited by default, or if there is a genuine PATH augmentation needed, explicitly add the directories:

```ts
env: {
  ...process.env,
  PATH: `/opt/homebrew/bin:${process.env.PATH}`,
},
```

The current plan's version does nothing but add a false sense of security.

---

### [Low] Verification section lacks a failure-case test

**Section:** Verification

**Description:** The verification steps only cover the happy path (spawn succeeds, terminal shows output). There is no step to verify the fix actually handles the failure case -- e.g., what happens if `claude` is not installed, or if `CLAUDE_BIN` points to a bad path. For a fix that is specifically about error handling, testing the error path matters.

**Suggested fix:** Add a verification step:

```
5. (Optional) Temporarily set CLAUDE_BIN to a bad path and restart --
   server should fail at startup with a clear error message, not crash
   on first session spawn.
```

---

### [Impl-note] `which` vs `command -v` portability

**Section:** In `session.ts` (the `CLAUDE_BIN` IIFE)

**Description:** `which` is not POSIX-standard and behaves inconsistently across shells (some `which` implementations print error messages to stdout, some to stderr, some exit 1, some exit 2). `command -v` is the POSIX-portable alternative. In practice, since this runs via `execSync` in a default shell on macOS, `which` will work fine. But `command -v claude` is strictly more correct.

**Suggested fix:** Use `execSync('command -v claude', ...)` instead of `which claude`. Minor but costs nothing.

---

### [Impl-note] `execSync` at import time blocks the event loop

**Section:** In `session.ts` (the `CLAUDE_BIN` IIFE)

**Description:** The IIFE runs `execSync` synchronously at module import time. This blocks the event loop during server startup. For a single `which` call this is effectively instant (<10ms), so it's a non-issue in practice. But it's worth noting that if this pattern were extended to resolve multiple binaries, it should switch to async resolution during an init phase.

---

### [Impl-note] The `context-summary.ts` spawn is missing `--output-format stream-json`

**Section:** In `context-summary.ts`

**Description:** The context summary spawn at line 44 uses `['claude', '-p', '--dangerously-skip-permissions', prompt]` without `--output-format stream-json`. This is actually correct for its use case (it reads the full stdout as text, not streaming JSON), but the plan doesn't mention this difference. During implementation, someone might try to "normalize" the flags across both spawn sites and break the summarizer. A brief note in the plan that the two spawn calls intentionally use different flags would prevent this.

**Suggested fix:** Add a note to the plan clarifying that `context-summary.ts` intentionally omits `--output-format stream-json` because it consumes plain text output.
