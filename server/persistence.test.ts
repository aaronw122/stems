import { describe, expect, test } from 'bun:test';
import type { WeftNode } from '../shared/types.ts';
import { toPersistedNode, toWeftNodeWithBackfill, type PersistedNode } from './persistence.ts';

function makeBaseNode(): WeftNode {
  return {
    id: 'node-1',
    type: 'feature',
    parentId: null,
    title: 'Feature',
    nodeState: 'idle',
    displayStage: 'planning',
    needsHuman: false,
    humanNeededType: null,
    humanNeededPayload: null,
    providerId: 'claude',
    runtime: {
      runtimeId: 'claude-agent-sdk',
      modelId: 'claude-opus-4-6',
      resumeToken: null,
    },
    sessionId: null,
    errorInfo: null,
    overlap: { hasOverlap: false, overlappingNodes: [] },
    prUrl: null,
    prState: null,
    costUsd: 0,
    tokenUsage: { input: 0, output: 0 },
    contextPercent: null,
    x: 0,
    y: 0,
  };
}

describe('persistence backfill', () => {
  test('backfills legacy nodes missing provider/runtime metadata', () => {
    const legacyNode: PersistedNode = {
      id: 'legacy-1',
      type: 'feature',
      parentId: null,
      title: 'Legacy Feature',
      prUrl: null,
      prState: null,
      costUsd: 0,
      tokenUsage: { input: 0, output: 0 },
      sessionId: 'legacy-session-id',
    };

    const restored = toWeftNodeWithBackfill(legacyNode);

    expect(restored.node.providerId).toBe('claude');
    expect(restored.node.runtime.runtimeId).toBe('claude-agent-sdk');
    expect(restored.node.runtime.resumeToken).toBe('legacy-session-id');
    expect(restored.node.sessionId).toBe('legacy-session-id');
    expect(restored.backfill).toEqual({
      providerDefaulted: true,
      runtimeDefaulted: true,
      legacySessionIdPromoted: true,
    });
  });

  test('keeps codex legacy sessionId out of resumeToken', () => {
    const codexNode: PersistedNode = {
      id: 'codex-1',
      type: 'feature',
      parentId: null,
      title: 'Codex Feature',
      prUrl: null,
      prState: null,
      costUsd: 0,
      tokenUsage: { input: 0, output: 0 },
      providerId: 'codex',
      sessionId: 'legacy-session-id',
    };

    const restored = toWeftNodeWithBackfill(codexNode);

    expect(restored.node.providerId).toBe('codex');
    expect(restored.node.runtime.runtimeId).toBe('codex-cli');
    expect(restored.node.runtime.resumeToken).toBeNull();
    expect(restored.node.sessionId).toBe('legacy-session-id');
  });
});

describe('persistence serialization', () => {
  test('writes sessionId alias from runtime resumeToken for Claude nodes', () => {
    const node = makeBaseNode();
    node.runtime.resumeToken = 'runtime-token';
    node.sessionId = null;

    const persisted = toPersistedNode(node);

    expect(persisted.sessionId).toBe('runtime-token');
    expect(persisted.runtime?.resumeToken).toBe('runtime-token');
  });
});
