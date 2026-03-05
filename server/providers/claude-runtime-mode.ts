import { loadProviderRolloutFlags } from '../config.ts';

export type ClaudeRuntimeMode = 'adapter' | 'legacy';

export function resolveClaudeRuntimeMode(
  env: Record<string, string | undefined> = process.env,
): ClaudeRuntimeMode {
  return loadProviderRolloutFlags(env).claudeAdapterEnabled ? 'adapter' : 'legacy';
}
