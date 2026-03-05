# Normalized Event Schema v1

This document implements M0.5 tasks 1-3:
1. normalized event schema v1 (required and optional fields),
2. canonical IDs (`turnId`, `messageId`, `toolCallId`, `taskId`, `questionId`),
3. ordering, replay semantics, and idempotency expectations.

## Compatibility Guardrails

- This schema is an internal provider-bridge contract.
- Existing websocket envelopes stay additive and unchanged: `terminal_data`, `terminal_replay`, and `node_updated`.
- Normalized events are projected into existing `TerminalMessage[]` buffers.

## Event Envelope

```ts
export type ProviderId = 'claude' | 'codex';

export type NormalizedEventKind =
  | 'session.started'
  | 'session.resumed'
  | 'turn.started'
  | 'turn.completed'
  | 'turn.failed'
  | 'message.user'
  | 'message.assistant.delta'
  | 'message.assistant.final'
  | 'tool.call.started'
  | 'tool.call.completed'
  | 'task.started'
  | 'task.progress'
  | 'task.completed'
  | 'task.failed'
  | 'human.needed'
  | 'human.response'
  | 'system.info'
  | 'system.error';

export interface NormalizedEventV1 {
  // Required on all events
  schemaVersion: '1.0';
  eventId: string;           // idempotency key, stable across replay
  sequence: number;          // strictly increasing per node stream (1, 2, 3...)
  occurredAt: string;        // ISO-8601 UTC timestamp
  nodeId: string;
  provider: ProviderId;
  kind: NormalizedEventKind;
  sessionId: string;

  // Canonical IDs (required by event kind; see matrix below)
  turnId?: string;
  messageId?: string;
  toolCallId?: string;
  taskId?: string;
  questionId?: string;

  // Content and metadata
  role?: 'user' | 'assistant' | 'system' | 'tool';
  text?: string;
  payload?: Record<string, unknown>;

  // Source traceability for debugging/mapping
  providerRaw?: {
    type: string;
    subtype?: string;
    id?: string;
  };

  // True only when event was emitted from persisted history/replay
  replayed?: boolean;
}
```

## Required vs Optional Field Matrix

| Event kind | Required canonical IDs | Required content fields | Optional fields |
| --- | --- | --- | --- |
| `session.started`, `session.resumed` | none | none | `payload`, `providerRaw` |
| `turn.started`, `turn.completed`, `turn.failed` | `turnId` | none | `payload`, `text` |
| `message.user`, `message.assistant.delta`, `message.assistant.final` | `turnId`, `messageId` | `role`, `text` | `payload`, `providerRaw` |
| `tool.call.started`, `tool.call.completed` | `turnId`, `messageId`, `toolCallId` | none | `text`, `payload`, `providerRaw` |
| `task.started`, `task.progress`, `task.completed`, `task.failed` | `turnId`, `toolCallId`, `taskId` | none | `text`, `payload`, `providerRaw` |
| `human.needed` | `turnId`, `messageId`, `questionId` | `text`, `payload` | `providerRaw` |
| `human.response` | `turnId`, `questionId` | `payload` | `text`, `providerRaw` |
| `system.info`, `system.error` | `turnId` (if turn-scoped) | `text` | `messageId`, `payload`, `providerRaw` |

## Canonical ID Definitions

All canonical IDs are strings. IDs must be deterministic and stable across reconnect/replay.

- `turnId`
  - Definition: a unique turn scope within a session.
  - Format: `<sessionId>:t<turnCounter>`.
  - Counter rule: `turnCounter` is 1-based and increments when a new accepted user input starts a turn.

- `messageId`
  - Definition: a unique message within a turn.
  - Format: `<turnId>:m<messageCounter>`.
  - Counter rule: `messageCounter` is 1-based and scoped to `turnId`.

- `toolCallId`
  - Definition: a unique tool invocation tied to a message.
  - Preferred source: provider-native tool call ID when available.
  - Fallback format: `<messageId>:u<toolCounter>`.

- `taskId`
  - Definition: a unique subagent/task run tied to a tool call.
  - Preferred source: provider-native task ID when available.
  - Fallback format: `<toolCallId>:k<taskCounter>`.

- `questionId`
  - Definition: a unique human-needed prompt expecting user input.
  - Preferred source: provider-native question/request ID when available.
  - Fallback format: `<turnId>:q<questionCounter>`.

Additional ID rules:
- `eventId` is always `<nodeId>:e<sequence>`.
- Once emitted, IDs are immutable.
- Re-emitted/replayed events must keep the exact same IDs.

## Ordering Semantics

Ordering is per node stream.

- `sequence` is strictly increasing with no gaps for emitted events.
- Event order is authoritative. Consumers must treat lower `sequence` as older.
- A turn is bounded by `turn.started` and exactly one terminal event: `turn.completed` or `turn.failed`.
- `message.assistant.delta` events are in-order chunks for a single `messageId`.
- `human.needed` pauses progress for that turn until a matching `human.response` arrives.

## Replay Semantics

- Server persists the projected terminal timeline and replays it through existing `terminal_replay` envelope on subscription/reconnect.
- Replay order is ascending by original `sequence`.
- Replay is a snapshot baseline; new live events continue via `terminal_data`.
- Replay must preserve canonical IDs so downstream logic (including dedupe) remains stable.

## Idempotency Expectations

- `eventId` is the idempotency key for all normalized events.
- Consumers must ignore duplicates with an already-applied `eventId`.
- If an event is retried with the same `eventId`, payload must be semantically identical.
- Side effects (`node_updated`, queue transitions, human-needed state) must be applied at most once per `eventId`.

## Fixtures

- Replay fixture: `docs/provider-agnostic/fixtures/replay-fixture-v1.json`
- Human-needed fixture: `docs/provider-agnostic/fixtures/human-needed-fixture-v1.json`
