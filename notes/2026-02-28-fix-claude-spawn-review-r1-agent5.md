# Security & Reliability Review: Fix Claude CLI spawn ENOENT

**Reviewer role:** Security & Reliability Engineer
**Plan:** `/Users/aaron/weft-flow/plans/fix-claude-spawn.md`
**Date:** 2026-02-28

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| Must-fix | 3 |
| Medium | 1 |
| Low | 1 |
| Impl-note | 3 |

The plan addresses a real ENOENT bug with a reasonable approach (resolve binary path at startup, pass env), but has significant gaps around failure handling, input safety, and completeness. The most serious issues: the fallback path silently masks a missing binary (leading to a deferred, harder-to-debug crash), the plan omits `pr-tracker.ts` which has the same `Bun.spawn` bare-command problem with `gh`, and an existing command injection vulnerability in `context-summary.ts` goes unaddressed by the plan.

---

## Issues

### [Critical] Command injection via prompt passed as positional argument in context-summary.ts

**Section:** In `context-summary.ts` (existing code the plan touches but doesn't fix)

**Description:** In `context-summary.ts:44`, the prompt string — which is constructed from terminal output of a previous session — is passed as a positional argument directly in the spawn args array:

```ts
['claude', '-p', '--dangerously-skip-permissions', prompt]
```

The `prompt` variable contains raw session output (`lines.join('\n')`). While `Bun.spawn` uses `execve`-style semantics (not shell expansion), the prompt is passed as a bare positional arg rather than via stdin. This means the entire terminal buffer (up to 100 lines) is jammed into a single argv entry. On most systems `ARG_MAX` is ~256KB, but this is fragile and untested. More critically, if `claude`'s CLI parser interprets any content in the prompt as flags (e.g., a session output line starting with `--`), it could alter CLI behavior. The plan says to swap `'claude'` for `CLAUDE_BIN` here but doesn't address this input handling.

For comparison, `session.ts` correctly separates CLI flags from the prompt as a final positional argument. But `context-summary.ts` intermixes the prompt with flags in the same args array without a `--` separator.

**Suggested fix:** Add a `--` separator before the prompt argument to prevent flag injection:

```ts
[CLAUDE_BIN, '-p', '--dangerously-skip-permissions', '--', prompt]
```

Or better, pipe the prompt via stdin instead of argv, which also avoids `ARG_MAX` limits for large terminal buffers. This is an architectural-level input safety issue — discovering it during implementation would likely mean reworking the spawn interface.

---

### [Must-fix] Silent fallback to hardcoded path masks startup failure

**Section:** Fix — `session.ts` helper

**Description:** The plan's resolver:

```ts
const CLAUDE_BIN = (() => {
  try {
    return execSync('which claude', { encoding: 'utf-8' }).trim();
  } catch {
    return '/opt/homebrew/bin/claude';
  }
})();
```

If `which claude` fails (claude not installed, PATH completely wrong), this silently falls back to `/opt/homebrew/bin/claude`. That path may also not exist, but the error won't surface until the first `Bun.spawn` call — at which point you get the same ENOENT, now with a misleading hardcoded path in the error. Worse, on a Linux system or Intel Mac, `/opt/homebrew/bin/` doesn't exist at all, making the fallback platform-specific and wrong.

This turns a clear startup-time error ("claude binary not found") into a deferred runtime error ("ENOENT on `/opt/homebrew/bin/claude`") that's harder to diagnose.

**Suggested fix:** After resolution (including fallback), validate that the resolved path actually exists. If it doesn't, throw at startup with a clear message:

```ts
const CLAUDE_BIN = (() => {
  try {
    const resolved = execSync('which claude', { encoding: 'utf-8' }).trim();
    if (resolved) return resolved;
  } catch { /* fall through */ }

  // Check common locations
  const fallbacks = ['/opt/homebrew/bin/claude', '/usr/local/bin/claude'];
  for (const p of fallbacks) {
    if (existsSync(p)) return p;
  }

  throw new Error(
    'Could not find claude binary. Ensure claude CLI is installed and in PATH.'
  );
})();
```

Failing fast at server startup is vastly better than failing silently at first user interaction.

---

### [Must-fix] Plan omits pr-tracker.ts — same bare-command problem with `gh`

**Section:** Files to Modify

**Description:** The plan lists only `session.ts` and `context-summary.ts`, stating "Three files spawn `claude` with bare command names" but then only listing two. Examining the codebase, `pr-tracker.ts` spawns `gh` (not `claude`) via `Bun.spawn(['gh', ...])` at line 146 with the same bare-command pattern. While the plan's note says "PR tracker (`gh` is a separate issue, likely works already)", this is the same class of bug — `gh` may also not be in `Bun.spawn`'s PATH.

If the root cause is that `Bun.spawn` doesn't inherit the shell's PATH, then `gh` will break exactly the same way. The plan's dismissal of this ("likely works already") isn't justified by any evidence, and the `{ ...process.env }` fix proposed for `session.ts` is not applied to `pr-tracker.ts`.

**Suggested fix:** Either (a) apply the same `env: { ...process.env }` fix to `pr-tracker.ts`'s spawn call for consistency, or (b) explicitly document why `gh` is not affected with evidence. Don't leave it as "likely works."

---

### [Must-fix] No env passthrough for context-summary.ts spawn

**Section:** In `context-summary.ts`

**Description:** The plan says to replace `'claude'` with `CLAUDE_BIN` in `context-summary.ts`, but doesn't mention adding `env: { ...process.env }` to its spawn call (line 43-49). Currently `context-summary.ts` spawns with no `env` option at all:

```ts
const proc = Bun.spawn(
  ['claude', '-p', '--dangerously-skip-permissions', prompt],
  { stdout: 'pipe', stderr: 'pipe' },
);
```

The plan explicitly calls out adding `env: { ...process.env }` in `session.ts` "so that `claude` itself can find its dependencies (git, gh, etc.)" — but doesn't do the same for `context-summary.ts`. The summarization `claude` call may also need access to git, configuration, or other tools.

**Suggested fix:** Apply the same `env: { ...process.env }` to the `context-summary.ts` spawn call. State this explicitly in the plan.

---

### [Medium] `execSync('which claude')` at import time — unhandled edge cases

**Section:** Fix — `session.ts` helper

**Description:** Running `execSync` at module import time has several edge cases:

1. **`which` is not POSIX-guaranteed to exit non-zero on failure** on all platforms. Some implementations print nothing but exit 0. The plan doesn't check for an empty return value.
2. **`execSync` inherits the Bun process's env**, but if the server is started via a process manager (systemd, launchd, PM2) that strips PATH, `which` itself may not find `claude` even though it exists. The plan doesn't address this.
3. **Import-time side effects** mean a failure here crashes the entire server module graph, not just session spawning. This may be fine (fail-fast), but is worth noting.

**Suggested fix:** Trim and validate the output is non-empty:

```ts
const resolved = execSync('which claude', { encoding: 'utf-8' }).trim();
if (!resolved) throw new Error('which returned empty');
return resolved;
```

And document that the server must be started from a shell with `claude` in PATH (relevant for deployment/process managers).

---

### [Low] `execSync` without timeout

**Section:** Fix — `session.ts` helper

**Description:** `execSync('which claude')` runs synchronously with no timeout. In pathological cases (NFS-mounted PATH directories, hung filesystem), this could block the server's event loop indefinitely at startup. This is low severity because `which` is typically instantaneous, but the plan should note that a `timeout` option exists:

```ts
execSync('which claude', { encoding: 'utf-8', timeout: 5000 })
```

**Suggested fix:** Add a short timeout (e.g., 5 seconds) to the `execSync` call.

---

### [Impl-note] Process cleanup on timeout in context-summary.ts

**Section:** Existing code (`context-summary.ts`)

**Description:** The `withTimeout` wrapper in `context-summary.ts` rejects after `SUMMARIZE_TIMEOUT_MS` but does not kill the spawned `claude` process. If summarization times out, the child process continues running as an orphan, consuming resources. The plan doesn't introduce this bug — it exists today — but since the plan is touching this file, it's worth noting for implementation.

**Suggested fix:** When timeout fires, call `proc.kill()` on the spawned process. This requires the `proc` reference to be accessible from the timeout handler (minor restructuring of `runClaudeSummarize` and the timeout wrapper).

---

### [Impl-note] `--dangerously-skip-permissions` in all spawn calls

**Section:** Existing code (both files)

**Description:** Both `session.ts` and `context-summary.ts` use `--dangerously-skip-permissions`. This is a Claude CLI flag that bypasses permission prompts, meaning the spawned Claude sessions can execute arbitrary file system operations, run commands, etc. without confirmation. The plan doesn't introduce this — it's existing behavior — but it's worth flagging from a security posture perspective. The spawned sessions run with the full privileges of the server process user.

**Suggested fix:** Implementation-time consideration. Evaluate whether `context-summary.ts` (which only needs to summarize text) actually needs `--dangerously-skip-permissions`, or whether it could run without it for a reduced attack surface.

---

### [Impl-note] No validation of `repoPath` before passing to `cwd`

**Section:** Existing code (`session.ts`)

**Description:** `spawnSession` receives `repoPath` from the WebSocket message chain (ultimately from user input via `add_repo`). This path is passed directly as `cwd` to `Bun.spawn` with no validation that it's an existing directory, not a symlink to a sensitive location, etc. While `Bun.spawn` will fail with an error if the path doesn't exist, there's no path traversal or allowlist check. The plan doesn't change this behavior, so this is an implementation-time concern for hardening.

**Suggested fix:** Validate that `repoPath` exists and is a directory before spawning. Consider an allowlist of permitted base directories if the server is exposed beyond localhost.
