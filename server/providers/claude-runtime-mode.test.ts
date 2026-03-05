import { describe, expect, it } from 'bun:test';
import { resolveClaudeRuntimeMode } from './claude-runtime-mode.ts';

describe('resolveClaudeRuntimeMode', () => {
  it('defaults to adapter mode', () => {
    expect(resolveClaudeRuntimeMode({})).toBe('adapter');
  });

  it('switches to legacy mode when adapter flag is disabled', () => {
    expect(resolveClaudeRuntimeMode({ STEMS_PROVIDER_CLAUDE_ADAPTER_ENABLED: 'false' })).toBe('legacy');
    expect(resolveClaudeRuntimeMode({ STEMS_PROVIDER_CLAUDE_ADAPTER_ENABLED: '0' })).toBe('legacy');
  });

  it('treats invalid values as default adapter mode', () => {
    expect(resolveClaudeRuntimeMode({ STEMS_PROVIDER_CLAUDE_ADAPTER_ENABLED: 'maybe' })).toBe('adapter');
  });
});
