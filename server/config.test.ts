import { describe, expect, it } from 'bun:test';
import {
  bootstrapServerConfig,
  getProviderRolloutFlagSnapshot,
  loadProviderRolloutFlags,
} from './config.ts';

describe('loadProviderRolloutFlags', () => {
  it('uses plan defaults when env vars are missing', () => {
    const flags = loadProviderRolloutFlags({});
    expect(flags).toEqual({
      bridgeEnabled: false,
      claudeAdapterEnabled: true,
      codexEnabled: false,
    });
  });

  it('accepts explicit true/false env overrides', () => {
    const flags = loadProviderRolloutFlags({
      STEMS_PROVIDER_BRIDGE_ENABLED: 'true',
      STEMS_PROVIDER_CLAUDE_ADAPTER_ENABLED: '0',
      STEMS_PROVIDER_CODEX_ENABLED: 'yes',
    });
    expect(flags).toEqual({
      bridgeEnabled: true,
      claudeAdapterEnabled: false,
      codexEnabled: true,
    });
  });

  it('falls back to defaults for invalid values and emits warnings', () => {
    const warnings: string[] = [];
    const flags = loadProviderRolloutFlags(
      {
        STEMS_PROVIDER_BRIDGE_ENABLED: 'maybe',
        STEMS_PROVIDER_CLAUDE_ADAPTER_ENABLED: 'enabled',
      },
      (message) => warnings.push(message),
    );

    expect(flags).toEqual({
      bridgeEnabled: false,
      claudeAdapterEnabled: true,
      codexEnabled: false,
    });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('STEMS_PROVIDER_BRIDGE_ENABLED');
    expect(warnings[1]).toContain('STEMS_PROVIDER_CLAUDE_ADAPTER_ENABLED');
  });
});

describe('bootstrapServerConfig', () => {
  it('captures a startup snapshot with restart semantics', () => {
    const logs: string[] = [];

    const config = bootstrapServerConfig(
      { STEMS_PROVIDER_CODEX_ENABLED: '1' },
      {
        log: (message) => logs.push(message),
        now: () => new Date('2026-03-04T18:00:00.000Z'),
      },
    );

    expect(config.loadedAt).toBe('2026-03-04T18:00:00.000Z');
    expect(getProviderRolloutFlagSnapshot(config.providerRollout)).toEqual({
      STEMS_PROVIDER_BRIDGE_ENABLED: false,
      STEMS_PROVIDER_CLAUDE_ADAPTER_ENABLED: true,
      STEMS_PROVIDER_CODEX_ENABLED: true,
    });
    expect(logs[0]).toContain('server restart required');
  });
});
