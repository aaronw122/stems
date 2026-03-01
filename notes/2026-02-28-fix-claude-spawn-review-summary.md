# Plan Review Summary

**Plan:** /Users/aaron/weft-flow/plans/fix-claude-spawn.md
**Rounds:** 2
**Final revision:** 3

---

## Issues Found & Fixed

### Round 1 (1 Critical, 5 Must-fix)

| Issue | Severity | How Fixed |
|-------|----------|-----------|
| "Three files" claim but plan only lists two; `pr-tracker.ts` (spawning `gh`) was the implied third but omitted, leaving it unfixed | Critical (Architect) / Must-fix (PM, DX) | R2 plan updated to list all three files; `GH_BIN` added to `cli-paths.ts`; `pr-tracker.ts` given its own fix section |
| Circular/coupling risk: exporting `CLAUDE_BIN` from `session.ts` into `context-summary.ts` mixed concerns and invited future circular imports | Must-fix (Architect, DX) | New dedicated `server/cli-paths.ts` module owns all binary resolution; both consumer modules import from it |
| `env: { ...process.env }` not applied to `context-summary.ts` spawn — plan only specified it for `session.ts` | Must-fix (PM, Architect, Security) | Plan explicitly adds `env: { ...process.env }` to `context-summary.ts` and `pr-tracker.ts` spawn calls |
| Orphaned subprocess on timeout: `context-summary.ts` never killed the `claude -p` process when `withTimeout` fired, leaking processes and API tokens | Must-fix (Architect) | Plan restructures `runClaudeSummarize` to return `{ promise, proc }` and extends `withTimeout` with an optional `onTimeout` cleanup callback that calls `proc.kill()` |
| No startup validation — if `which claude` fails and the hardcoded fallback path doesn't exist, `CLAUDE_BIN` silently points to a non-existent path, producing a deferred ENOENT identical to the original bug | Must-fix (UX, PM, Security) | `resolveBin` in `cli-paths.ts` validates with `existsSync` at every resolution stage (env var, `which`, fallback) and throws at module-load time with a clear, actionable error message if nothing resolves |

---

### Round 2 (3 Medium, applied as polish)

| Issue | Severity | How Fixed |
|-------|----------|-----------|
| Incorrect `--` separator placement and missing `--dangerously-skip-permissions` in the `context-summary.ts` code example — following the snippet literally would either mis-parse the prompt or hang on permission prompts | Medium (Architect, UX) | R3 plan corrects the before/after snippet to show the full args array: `[CLAUDE_BIN, '-p', '--dangerously-skip-permissions', '--', prompt]` |
| Orphan cleanup restructuring was under-specified — the plan proposed a cleanup callback pattern but referenced `readStream(proc)` which doesn't exist; implementer would have to invent the refactor | Medium (DX) | R3 plan specifies the exact pattern: `runClaudeSummarize` returns `{ promise, proc }` and the call site destructures and passes a kill callback to `withTimeout` |
| `which ${name}` in `resolveBin` uses string interpolation in `execSync`, creating a shell injection surface if ever called with non-literal input | Medium (Security) | R3 plan's code example documents that `name` must be a trusted literal; the current call sites are hardcoded (`'claude'`, `'gh'`), so real-world risk is zero today |

---

## Remaining Issues

| Issue | Severity | Reviewer |
|-------|----------|----------|
| Crashed nodes show generic error state with no surfaced `errorInfo.message` and no retry action — the fix makes users more likely to reach running state and then hit this gap from other failure causes (auth expiry, invalid repo) | Medium | UX |
| Verification section still lacks steps for context summarization and the startup error path — the R3 plan added steps 5-10 which cover both, so this was resolved in the final revision | Medium | PM, DX — note: fixed in R3 |
| `execSync('which ...')` has no `timeout` option — pathological filesystem environments (NFS, hung FS) could block the event loop indefinitely at startup | Low | Security |
| `which` may resolve to a shell function in interactive shells but fail in the non-login shell spawned by `execSync`, making the fallback path more load-bearing than acknowledged | Low | Architect |
| Circular dependency from `context-summary.ts` importing `session.ts` was not actually circular today but would become so if `session.ts` ever called back into `context-summary.ts` | Low | PM — note: resolved by `cli-paths.ts` extraction |

---

## Implementation Notes

All Impl-note items from both rounds — real issues to watch for during coding, not worth fixing in the plan:

- **Hardcoded Homebrew fallback paths** (`/opt/homebrew/bin/`) only work on macOS with Homebrew; they will silently miss Linux or Intel Mac installs, but the `CLAUDE_BIN`/`GH_BIN` env var overrides provide the escape hatch for non-standard installs.
- **`execSync` blocks the event loop at module import time** — two synchronous `which` calls during startup; acceptable as a one-time cost but would need to go async if more binaries were resolved this way.
- **`env: { ...process.env }` is a no-op in Bun** — Bun inherits the parent env by default, so the spread is redundant but harmless; its value is as documentation and an extension point for future PATH augmentation.
- **`which` vs `command -v`** — `which` is not POSIX-guaranteed and behaves differently across platforms; `execFileSync('which', [name])` or `command -v` would be more portable, but macOS is the only current target.
- **`context-summary.ts` intentionally omits `--output-format stream-json`** — it reads plain text output, not streaming JSON; an implementer normalizing flags across spawn sites would break the summarizer.
- **`--` separator in `session.ts`** — the same flag-injection risk exists in `session.ts` since user-authored prompts could start with `--`; adding `--` there too would be cheap and consistent.
- **`repoPath` is passed as `cwd` without validation** — no check that the path exists and is a directory before `Bun.spawn` uses it; a missing or symlinked path traversal is an existing hardening gap.
- **`--dangerously-skip-permissions` in both spawn sites** — the context summarizer only needs to summarize text and may not actually require this flag; evaluating whether to remove it would reduce the attack surface.
- **TOCTOU gap in `existsSync` validation** — the binary is validated at startup but could be removed or replaced before a spawn call (e.g., during a Homebrew upgrade); errors at that point will at least show the full path, making diagnosis straightforward.
- **Race condition between `spawnSession` and PID file write** — process is spawned and added to the sessions map before the PID file is written asynchronously; a crash between those steps leaves an orphaned process with no record.
- **`withTimeout` cleanup callback pseudocode** — the plan's code sample references `readStream(proc)` which does not exist in the current codebase; the implementer needs to use the `{ promise, proc }` destructuring pattern specified in R3 and not cargo-cult the pseudocode.
- **`resolveBin` injection defense** — `execSync(`which ${name}`)` is safe with current hardcoded call sites; adding a comment that `name` must be a trusted literal (or using `execFileSync('which', [name])`) guards against future misuse.

---

## Reviewer Personas Used

1. **UX Designer** — Interaction design, user flows, error states, cognitive load
2. **Product Manager** — User value, scope, prioritization, success criteria
3. **Software Architect** — System design, process management, error handling, race conditions
4. **DX Specialist** — API ergonomics, configuration complexity, debugging experience
5. **Security & Reliability Engineer** — Process spawning security, resource leaks, failure/recovery modes
