import { describe, expect, test } from 'bun:test';
import { resolveResumeCompatibility } from './provider-metadata.ts';

describe('resolveResumeCompatibility', () => {
  test('promotes legacy sessionId to resumeToken for Claude nodes', () => {
    const result = resolveResumeCompatibility('claude', null, 'legacy-session-id');

    expect(result).toEqual({
      sessionId: 'legacy-session-id',
      resumeToken: 'legacy-session-id',
      source: 'legacy-session-id',
    });
  });

  test('prefers runtime resumeToken when both values exist on Claude nodes', () => {
    const result = resolveResumeCompatibility('claude', 'runtime-token', 'legacy-session-id');

    expect(result).toEqual({
      sessionId: 'runtime-token',
      resumeToken: 'runtime-token',
      source: 'runtime',
    });
  });

  test('does not promote legacy sessionId for non-Claude providers', () => {
    const result = resolveResumeCompatibility('codex', null, 'legacy-session-id');

    expect(result).toEqual({
      sessionId: 'legacy-session-id',
      resumeToken: null,
      source: 'none',
    });
  });
});
