import type { ProviderId, RuntimeMetadata } from '../shared/types.ts';

export const DEFAULT_PROVIDER_ID: ProviderId = 'claude';

const DEFAULT_RUNTIME_ID: Record<ProviderId, string> = {
  claude: 'claude-agent-sdk',
  codex: 'codex-cli',
};

export function isProviderId(value: unknown): value is ProviderId {
  return value === 'claude' || value === 'codex';
}

export function normalizeOpaqueToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function createDefaultRuntimeMetadata(providerId: ProviderId = DEFAULT_PROVIDER_ID): RuntimeMetadata {
  return {
    runtimeId: DEFAULT_RUNTIME_ID[providerId],
    modelId: null,
    resumeToken: null,
  };
}

export function normalizeRuntimeMetadata(
  providerId: ProviderId,
  runtime: Partial<RuntimeMetadata> | null | undefined,
): RuntimeMetadata {
  const defaults = createDefaultRuntimeMetadata(providerId);
  if (!runtime || typeof runtime !== 'object') {
    return defaults;
  }

  return {
    runtimeId:
      typeof runtime.runtimeId === 'string' && runtime.runtimeId.trim().length > 0
        ? runtime.runtimeId
        : defaults.runtimeId,
    modelId: normalizeOpaqueToken(runtime.modelId),
    resumeToken: normalizeOpaqueToken(runtime.resumeToken),
  };
}

export type ResumeTokenSource = 'runtime' | 'legacy-session-id' | 'none';

export interface ResumeCompatibilityResult {
  sessionId: string | null;
  resumeToken: string | null;
  source: ResumeTokenSource;
}

/**
 * Compatibility policy:
 * 1) runtime.resumeToken is canonical.
 * 2) sessionId remains as a legacy Claude alias for websocket/persistence compatibility.
 * 3) For Claude, if only one value exists we mirror it into both fields.
 * 4) For non-Claude providers, legacy sessionId is never promoted to resumeToken.
 */
export function resolveResumeCompatibility(
  providerId: ProviderId,
  runtimeResumeToken: unknown,
  legacySessionId: unknown,
): ResumeCompatibilityResult {
  const normalizedRuntimeToken = normalizeOpaqueToken(runtimeResumeToken);
  const normalizedSessionId = normalizeOpaqueToken(legacySessionId);

  if (providerId === 'claude') {
    if (normalizedRuntimeToken) {
      return {
        sessionId: normalizedRuntimeToken,
        resumeToken: normalizedRuntimeToken,
        source: 'runtime',
      };
    }
    if (normalizedSessionId) {
      return {
        sessionId: normalizedSessionId,
        resumeToken: normalizedSessionId,
        source: 'legacy-session-id',
      };
    }
    return { sessionId: null, resumeToken: null, source: 'none' };
  }

  return {
    sessionId: normalizedSessionId,
    resumeToken: normalizedRuntimeToken,
    source: normalizedRuntimeToken ? 'runtime' : 'none',
  };
}
