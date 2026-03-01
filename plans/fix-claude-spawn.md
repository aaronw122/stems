# Fix: Claude CLI spawn ENOENT
revision: 3

## Context
Clicking a feature node crashes with `ENOENT: no such file or directory, posix_spawn 'claude'`. The Bun server uses `Bun.spawn(['claude', ...])` but `claude` isn't resolvable in the server process's PATH — it exists as both a shell function and a binary at `/opt/homebrew/bin/claude`, neither of which Bun can find.

Three files spawn external CLIs with bare command names. All need fixing.

## Files to Modify

1. **`server/session.ts`** (line 51) — main session spawning (`claude`)
2. **`server/context-summary.ts`** (line 43) — context summary generation (`claude`)
3. **`server/pr-tracker.ts`** — PR status checks (`gh`)

## Fix

Resolve all external CLI binary paths at server startup via a shared module, validate they exist, and use them in all spawn calls.

### New file: `server/cli-paths.ts`

Create a dedicated module that resolves and validates binary paths. Both `session.ts` and `context-summary.ts` import `CLAUDE_BIN` from here; `pr-tracker.ts` imports `GH_BIN`.

```ts
import { execSync } from 'child_process';
import { existsSync } from 'fs';

function resolveBin(name: string, envVar: string, fallback: string): string {
  // 1. Env var override takes priority
  const fromEnv = process.env[envVar];
  if (fromEnv) {
    if (!existsSync(fromEnv)) {
      throw new Error(`${envVar} is set to "${fromEnv}" but the file does not exist`);
    }
    return fromEnv;
  }

  // 2. Try which
  try {
    const resolved = execSync(`which ${name}`, { encoding: 'utf-8' }).trim();
    if (resolved && existsSync(resolved)) return resolved;
  } catch {}

  // 3. Hardcoded fallback — validate before returning
  if (existsSync(fallback)) return fallback;

  throw new Error(
    `Could not find "${name}" binary. Tried: $${envVar} env var, which ${name}, ${fallback}. ` +
    `Install ${name} or set ${envVar} to the full path.`
  );
}

export const CLAUDE_BIN = resolveBin('claude', 'CLAUDE_BIN', '/opt/homebrew/bin/claude');
export const GH_BIN = resolveBin('gh', 'GH_BIN', '/opt/homebrew/bin/gh');
```

This ensures:
- `CLAUDE_BIN` / `GH_BIN` env vars can override resolution (useful for CI or non-Homebrew installs).
- If `which` fails and the fallback doesn't exist, the server throws immediately at startup with a clear message — no deferred ENOENT at runtime.

### In `session.ts`

Import `CLAUDE_BIN` from `./cli-paths` (not exported from this file). Replace `'claude'` with `CLAUDE_BIN` in the args array (line 51).

Pass the current shell's environment to the subprocess so `claude` can find its own dependencies (git, gh, etc.):

```ts
const proc = Bun.spawn(args, {
  cwd: repoPath,
  stdout: 'pipe',
  stdin: 'pipe',
  stderr: 'pipe',
  env: { ...process.env },
});
```

### In `context-summary.ts`

Import `CLAUDE_BIN` from `./cli-paths` and replace `'claude'` in the spawn args.

Add `--` before the prompt argument in the spawn args array to prevent raw terminal output (which may contain lines starting with `--`) from being interpreted as CLI flags:

```ts
// Before (vulnerable to flag injection):
const args = [CLAUDE_BIN, '-p', '--dangerously-skip-permissions', prompt];
// After:
const args = [CLAUDE_BIN, '-p', '--dangerously-skip-permissions', '--', prompt];
```

Pass `env: { ...process.env }` in the spawn options (same as `session.ts`).

Additionally, fix the orphaned subprocess on timeout. Restructure `runClaudeSummarize` to return both the result promise and the process handle so the caller can kill the subprocess on timeout:

```ts
function runClaudeSummarize(prompt: string): { promise: Promise<string>; proc: ReturnType<typeof Bun.spawn> } {
  const args = [CLAUDE_BIN, '-p', '--dangerously-skip-permissions', '--', prompt];
  const proc = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe', env: { ...process.env } });

  const promise = new Response(proc.stdout).text();
  return { promise, proc };
}

// At the call site:
const { promise, proc } = runClaudeSummarize(prompt);
const result = await withTimeout(promise, TIMEOUT_MS, () => {
  proc.kill();
});
```

Extend `withTimeout` to accept an optional cleanup callback `onTimeout?: () => void` that fires before rejecting. This keeps the pattern simple and avoids introducing `AbortController` complexity.

### In `pr-tracker.ts`

Import `GH_BIN` from `./cli-paths` and replace the bare `'gh'` command in spawn calls. Pass `env: { ...process.env }` in spawn options.

## What stays the same
- All WebSocket message handling
- Frontend flow (add repo → add feature → prompt editor)
- Stream parsing, terminal buffering

## Verification

### Session spawn (happy path)
1. Restart the Bun dev server
2. Add a repo path
3. Click to add a feature with a prompt
4. Terminal peek should open and show Claude output instead of crashing

### Context summarization spawn
5. Create a session and spawn a subtask that triggers context summarization
6. Verify the context summary completes without error and the subprocess exits cleanly
7. Verify that if the summary exceeds `TIMEOUT_MS`, the subprocess is killed (not left orphaned)

### Startup fail-fast validation
8. Set `CLAUDE_BIN` env var to a nonexistent path (e.g., `CLAUDE_BIN=/tmp/no-such-binary bun run dev`)
9. Verify the server fails immediately at startup with a clear error message referencing the bad path
10. Unset the override and confirm the server starts normally again
