# Security & Reliability Review: Fix Claude CLI spawn ENOENT — Round 2

**Reviewer role:** Security & Reliability Engineer
**Plan:** `/Users/aaron/weft-flow/plans/fix-claude-spawn.md` (revision 2)
**Date:** 2026-02-28
**Round:** 2 (verifying Round 1 fixes + checking for new issues)

---

## Round 1 Issue Status

| Round 1 Issue | Severity | Status | Notes |
|---|---|---|---|
| Command injection via prompt positional arg in context-summary.ts | Critical | **Fixed** | `--` separator added before prompt arg (line 86). Adequate mitigation. |
| Silent fallback to hardcoded path masks startup failure | Must-fix | **Fixed** | New `cli-paths.ts` validates with `existsSync` at each resolution step and throws at startup if nothing found. |
| Plan omits pr-tracker.ts (same bare-command problem with `gh`) | Must-fix | **Fixed** | `pr-tracker.ts` now listed in scope, imports `GH_BIN` from `cli-paths.ts`. |
| No env passthrough for context-summary.ts spawn | Must-fix | **Fixed** | Plan now explicitly states `env: { ...process.env }` for context-summary.ts (line 89). |
| `execSync('which claude')` edge cases (empty output, import-time) | Medium | **Fixed** | `resolveBin` checks `resolved && existsSync(resolved)` (line 40), handles empty `which` output. |
| `execSync` without timeout | Low | **Not addressed** | The `execSync('which ...')` call in `resolveBin` still has no timeout. Remains low severity. See residual below. |
| Process cleanup on timeout in context-summary.ts | Impl-note | **Fixed (promoted to plan)** | Plan now includes `proc.kill()` on timeout with a cleanup callback pattern (lines 91-103). Good call promoting this. |
| `--dangerously-skip-permissions` in all spawn calls | Impl-note | **Unchanged** | Still present. Remains an impl-note for security posture review. |
| No validation of `repoPath` before passing to `cwd` | Impl-note | **Unchanged** | Still unaddressed. Remains an impl-note. |

**Summary:** 6 of 6 actionable issues (Critical through Medium) are adequately fixed. The one Low issue remains. Both Impl-notes that were deferred are reasonably deferred. Good resolution.

---

## New Issues Introduced by Round 2 Changes

### [Medium] `which ${name}` in resolveBin is vulnerable to command injection via env var or caller

**Section:** `server/cli-paths.ts` — `resolveBin` function (line 39)

**Description:** The `resolveBin` function constructs a shell command via string interpolation:

```ts
const resolved = execSync(`which ${name}`, { encoding: 'utf-8' }).trim();
```

The `name` parameter comes from the hardcoded calls on lines 52-53 (`'claude'` and `'gh'`), so this is not exploitable today. However, if `resolveBin` is ever called with a user-supplied `name` or if someone adds a new binary with a name containing shell metacharacters, this becomes a shell injection vector. `execSync` runs through `/bin/sh -c`, so `name = "foo; rm -rf /"` would execute.

This passes the scope test narrowly: the function signature accepts arbitrary strings, creating an attractive nuisance for future callers. But since the current call sites are hardcoded string literals, the real-world risk is zero today.

**Suggested fix:** Either (a) validate `name` against `/^[a-zA-Z0-9._-]+$/` at the top of `resolveBin`, or (b) add a code comment noting that `name` must be a safe literal. Option (a) is trivial and eliminates the class of bug entirely:

```ts
if (!/^[a-zA-Z0-9._-]+$/)
  throw new Error(`Invalid binary name: ${name}`);
```

---

### [Low] `execSync('which ...')` still has no timeout

**Section:** `server/cli-paths.ts` — `resolveBin` function (line 39)

**Description:** Carried over from Round 1. The `execSync` call has no `timeout` option. In pathological environments (NFS-mounted PATH, hung filesystem), this blocks the event loop indefinitely at startup. Still low severity — `which` is near-instant in normal operation — but trivial to fix.

**Suggested fix:** Add `timeout: 5000`:

```ts
const resolved = execSync(`which ${name}`, { encoding: 'utf-8', timeout: 5000 }).trim();
```

---

### [Impl-note] TOCTOU gap between `existsSync` validation and `Bun.spawn` usage

**Section:** `server/cli-paths.ts` — all `existsSync` checks

**Description:** The plan validates binary existence at startup with `existsSync`, then the resolved path is used later at runtime by `Bun.spawn`. If the binary is removed, moved, or replaced between validation and use (e.g., a Homebrew upgrade runs mid-session), `Bun.spawn` will still fail with ENOENT. This is a classic TOCTOU (time-of-check-time-of-use) gap.

This does NOT pass the scope test for a plan-level issue: the validation is still valuable (it catches the 99% case of "binary was never there"), and no reasonable plan-level architecture change eliminates the gap — you'd need to re-validate on every spawn, which is overkill. The error message from `Bun.spawn` at that point would be clear enough (it would show the full path, not just `'claude'`). Noting for completeness only.

---

### [Impl-note] Cleanup callback pattern for `withTimeout` needs design decision

**Section:** `server/context-summary.ts` — timeout cleanup (lines 91-103)

**Description:** The plan shows this pattern:

```ts
const result = await withTimeout(
  readStream(proc),
  TIMEOUT_MS,
  () => { proc.kill(); }  // cleanup callback
);
```

But then hedges: "If `withTimeout` doesn't currently accept a cleanup callback, extend it to do so, or use an `AbortController` / `AbortSignal` pattern instead."

Looking at the current `withTimeout` implementation (context-summary.ts lines 60-76), it takes `(promise, ms)` with no cleanup parameter. The plan acknowledges this needs extending but doesn't commit to a pattern. This is fine for a plan — the implementer has two clear options (callback or AbortController) and either works. But the plan's code sample references `readStream(proc)` which doesn't exist in the current code (the current code does `await proc.exited` then reads stdout). The implementer will need to reconcile this.

Not a plan-level issue since the intent is clear and either approach works. Flagging so the implementer doesn't cargo-cult the pseudocode.

---

### [Impl-note] `env: { ...process.env }` shallow-copies but doesn't augment PATH

**Section:** All three files — spawn options

**Description:** The plan adds `env: { ...process.env }` to all spawn calls. This passes the server process's environment to child processes, which is the right fix for the immediate bug. However, if the server's own `process.env.PATH` is already incomplete (e.g., started via launchd, systemd, or a process manager that strips PATH), the child processes will inherit the same incomplete PATH.

This is already partially mitigated by using absolute paths for the binary itself (`CLAUDE_BIN`, `GH_BIN`). But the spawned `claude` process may in turn need to find `git`, `node`, `npm`, etc. on PATH. If those aren't in the server's PATH, they won't be in the child's either.

Not a plan-level issue — the plan correctly solves the immediate problem, and augmenting PATH is an environment/deployment concern. But worth noting for the "started via process manager" deployment scenario.

---

## Overall Assessment

**Round 2 verdict: Plan is ready for implementation.**

All Critical and Must-fix issues from Round 1 are adequately resolved. The new `cli-paths.ts` module is a clean design — single responsibility, fail-fast validation, env var overrides for flexibility. The `--` separator for flag injection mitigation is correct. The orphaned process cleanup is now in scope.

The one new Medium issue (shell metacharacter injection in `which ${name}`) is not exploitable with current call sites but is trivial to guard against. The remaining items are Low or Impl-note severity and can be handled during implementation without architectural impact.

| Severity | Count |
|----------|-------|
| Critical | 0 |
| Must-fix | 0 |
| Medium | 1 |
| Low | 1 |
| Impl-note | 3 |
