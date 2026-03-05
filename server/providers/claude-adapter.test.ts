import { describe, expect, it } from 'bun:test';
import {
  buildClaudeEnv,
  createClaudeBaseOptions,
  handleClaudeInitMessage,
} from './claude-adapter.ts';
import type { ClaudeQuery, ClaudeSlashCommand } from './claude-adapter.ts';

describe('buildClaudeEnv', () => {
  it('removes CLAUDECODE markers and maps STEMS_OAUTH_TOKEN', () => {
    const env = buildClaudeEnv({
      PATH: '/usr/bin',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: '/tmp/entrypoint',
      STEMS_OAUTH_TOKEN: 'oauth-token',
      OTHER_VAR: 'kept',
    });

    expect(env.PATH).toBe('/usr/bin');
    expect(env.OTHER_VAR).toBe('kept');
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-token');
  });
});

describe('createClaudeBaseOptions', () => {
  it('uses claude_code preset and supports append system prompt', () => {
    const defaultOptions = createClaudeBaseOptions('/tmp/repo');
    expect(defaultOptions.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code' });

    const appended = createClaudeBaseOptions('/tmp/repo', 'Extra context');
    expect(appended.systemPrompt).toEqual({
      type: 'preset',
      preset: 'claude_code',
      append: 'Extra context',
    });
  });
});

describe('handleClaudeInitMessage', () => {
  it('returns null for non-init messages', () => {
    const result = handleClaudeInitMessage({
      nodeId: 'node-1',
      providerId: 'claude',
      legacySessionId: null,
      msg: { type: 'assistant' } as any,
      queryInstance: { initializationResult: async () => ({}) } as ClaudeQuery,
      onSlashCommands: () => {},
    });

    expect(result).toBeNull();
  });

  it('extracts resume/session tokens and captures slash commands on init', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = ((async () =>
        new Response(JSON.stringify({ version: '9.9.9' }), {
          headers: { 'content-type': 'application/json' },
        })) as unknown) as typeof fetch;

      let capturedCommands: ClaudeSlashCommand[] | null = null;

      const result = handleClaudeInitMessage({
        nodeId: 'node-2',
        providerId: 'claude',
        legacySessionId: null,
        msg: {
          type: 'system',
          subtype: 'init',
          session_id: 'session-123',
          claude_code_version: '0.0.1',
          model: 'claude-opus-4-6',
          cwd: '/tmp/repo',
        } as any,
        queryInstance: {
          initializationResult: async () => ({
            commands: [{ name: '/foo', description: 'Foo command', argumentHint: '' }],
            models: [{ value: 'claude-opus-4-6', displayName: 'Opus 4.6' }],
            account: { subscriptionType: 'pro' },
          }),
        } as ClaudeQuery,
        onSlashCommands: (commands) => {
          capturedCommands = commands;
        },
      });

      expect(result).toEqual({
        sessionId: 'session-123',
        resumeToken: 'session-123',
      });

      // Allow async initializationResult side effects to settle.
      await Bun.sleep(0);
      await Bun.sleep(0);

      expect(capturedCommands!).toEqual([{ name: '/foo', description: 'Foo command', argumentHint: '' }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
