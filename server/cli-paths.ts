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
