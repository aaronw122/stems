type EnvMap = Record<string, string | undefined>;
type LogFn = (message: string) => void;
type WarnFn = (message: string) => void;

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

export interface ProviderRolloutFlags {
  bridgeEnabled: boolean;
  claudeAdapterEnabled: boolean;
  codexEnabled: boolean;
}

export interface ServerConfig {
  loadedAt: string;
  providerRollout: ProviderRolloutFlags;
}

export interface ConfigBootstrapOptions {
  log?: LogFn;
  warn?: WarnFn;
  now?: () => Date;
}

export interface ProviderRolloutFlagSnapshot {
  STEMS_PROVIDER_BRIDGE_ENABLED: boolean;
  STEMS_PROVIDER_CLAUDE_ADAPTER_ENABLED: boolean;
  STEMS_PROVIDER_CODEX_ENABLED: boolean;
}

function parseBooleanFlag(
  env: EnvMap,
  envVar: string,
  defaultValue: boolean,
  warn: WarnFn,
): boolean {
  const rawValue = env[envVar];
  if (rawValue === undefined) return defaultValue;

  const normalized = rawValue.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;

  warn(
    `[config] Invalid boolean for ${envVar}="${rawValue}". ` +
    `Using default ${String(defaultValue)}. ` +
    'Accepted values: 1/0, true/false, yes/no, on/off.'
  );
  return defaultValue;
}

export function loadProviderRolloutFlags(
  env: EnvMap = process.env,
  warn: WarnFn = console.warn,
): ProviderRolloutFlags {
  return {
    bridgeEnabled: parseBooleanFlag(env, 'STEMS_PROVIDER_BRIDGE_ENABLED', false, warn),
    claudeAdapterEnabled: parseBooleanFlag(env, 'STEMS_PROVIDER_CLAUDE_ADAPTER_ENABLED', true, warn),
    codexEnabled: parseBooleanFlag(env, 'STEMS_PROVIDER_CODEX_ENABLED', false, warn),
  };
}

export function getProviderRolloutFlagSnapshot(flags: ProviderRolloutFlags): ProviderRolloutFlagSnapshot {
  return {
    STEMS_PROVIDER_BRIDGE_ENABLED: flags.bridgeEnabled,
    STEMS_PROVIDER_CLAUDE_ADAPTER_ENABLED: flags.claudeAdapterEnabled,
    STEMS_PROVIDER_CODEX_ENABLED: flags.codexEnabled,
  };
}

export function bootstrapServerConfig(
  env: EnvMap = process.env,
  options: ConfigBootstrapOptions = {},
): Readonly<ServerConfig> {
  const warn = options.warn ?? console.warn;
  const log = options.log ?? console.log;
  const now = options.now ?? (() => new Date());

  const providerRollout = loadProviderRolloutFlags(env, warn);
  const loadedAt = now().toISOString();
  const snapshot = getProviderRolloutFlagSnapshot(providerRollout);

  log(
    '[config] Provider rollout flags loaded at startup (server restart required to apply changes): ' +
    `${JSON.stringify(snapshot)}`
  );

  return Object.freeze({
    loadedAt,
    providerRollout: Object.freeze(providerRollout),
  });
}
