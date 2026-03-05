# M0.5 Unknown Event Policy and Provider Mapping Tables (v1)

This document implements M0.5 tasks 4-5 from the provider-agnostic implementation plan:

1. Define unknown/unmappable event policy.
2. Publish Claude -> normalized and Codex -> normalized mapping tables.

## Terminology (Aligned With M0.5 Schema v1)

- Canonical IDs: `turnId`, `messageId`, `toolCallId`, `taskId`, `questionId`
- Normalized event names:
  - `init`
  - `assistant_text_delta`
  - `tool_call`
  - `tool_result`
  - `task_started`
  - `task_progress`
  - `task_completed`
  - `task_failed`
  - `human_needed`
  - `usage`
  - `result`
  - `system`
  - `error`

## Unknown/Unmappable Event Policy (Normative)

1. Adapters MUST NOT silently drop unknown or unmappable provider events.
2. If a provider event cannot be mapped to a normalized event, the adapter MUST emit a visible fallback event:
   - Emit `error` when the event indicates failure, invalid shape, required-field loss, or ID-correlation failure.
   - Emit `system` when the event is informational/unsupported but non-fatal.
3. Fallback events MUST include:
   - Provider metadata: `provider`, `sourceEventType`
   - `reasonCode` from: `unknown_event_type`, `missing_required_field`, `unsupported_payload_shape`, `id_linkage_failure`
   - Raw payload snippet (truncated/redacted) for debugging
   - Any canonical IDs that can be recovered (`turnId`, `messageId`, `toolCallId`, `taskId`, `questionId`)
4. If no canonical IDs are recoverable, adapters MUST mint a deterministic `messageId` for the fallback event and continue stream processing.
5. Unknown/unmappable handling MUST be terminal-visible on first occurrence in a run.
6. Adapter processing SHOULD continue after fallback emission unless the provider marks the event as terminal/fatal.

## Claude -> Normalized Mapping (SDK Stream)

| Claude source event | Normalized event | ID mapping | Notes |
| --- | --- | --- | --- |
| `system` + `subtype=init` | `init` | `messageId` generated if absent | Session bootstrap metadata |
| `stream_event` + `content_block_delta.text_delta` | `assistant_text_delta` | `turnId`/`messageId` from active turn context | Streaming assistant text |
| `assistant.content[].tool_use` | `tool_call` | `toolCallId <- block.id`, `messageId <- assistant message id` | Tool invocation |
| `assistant.content[].tool_result` (or equivalent tool result block) | `tool_result` | `toolCallId <- block.tool_use_id` | Tool completion payload |
| `system` + `subtype=task_started` | `task_started` | `taskId <- task_id`, `toolCallId <- tool_use_id` | Subagent/task lifecycle start |
| `system` + `subtype=task_progress` | `task_progress` | `taskId <- task_id` | Subagent/task progress updates |
| `system` + `subtype=task_notification` + `status in {completed, stopped}` | `task_completed` | `taskId <- task_id` | Terminal task success/stop |
| `system` + `subtype=task_notification` + `status=failed` | `task_failed` | `taskId <- task_id` | Terminal task failure |
| `assistant.content[].tool_use` + `name=AskUserQuestion` | `human_needed` | `questionId` from payload when present, else generated | Human input required |
| `result` + `subtype=success` | `usage` then `result` | `turnId` from active turn | Emit usage before result close |
| `result` + `subtype=error_*` or assistant-level API error | `error` then `result` | `turnId`/`messageId` from context | Error is visible and terminal |
| Any other Claude event not mapped above | `system`/`error` fallback | Best-effort canonical IDs | Must follow unknown-event policy |

## Codex -> Normalized Mapping (Adapter Contract)

Codex mapping is defined at the adapter contract boundary (event names below are adapter input events and may aggregate lower-level runtime events).

| Codex adapter source event | Normalized event | ID mapping | Notes |
| --- | --- | --- | --- |
| `session_started` | `init` | `messageId` generated if absent | Session bootstrap metadata |
| `text_delta` | `assistant_text_delta` | `turnId` + `messageId` from adapter turn context | Streaming assistant text |
| `tool_call_started` | `tool_call` | `toolCallId <- source.toolCallId` | Tool invocation start |
| `tool_call_completed` | `tool_result` | `toolCallId <- source.toolCallId` | Tool output/result |
| `task_started` | `task_started` | `taskId <- source.taskId`, optional `toolCallId` | Subagent/task lifecycle start |
| `task_progress` | `task_progress` | `taskId <- source.taskId` | Subagent/task progress |
| `task_completed` | `task_completed` | `taskId <- source.taskId` | Terminal task completion |
| `task_failed` | `task_failed` | `taskId <- source.taskId` | Terminal task failure |
| `human_input_required` | `human_needed` | `questionId <- source.questionId` (generate if absent) | Question/approval required |
| `usage_reported` | `usage` | `turnId <- source.turnId` | Usage/cost/token snapshot |
| `run_completed` | `result` | `turnId <- source.turnId` | Turn complete |
| `run_failed` | `error` then `result` | `turnId <- source.turnId` | Error must be visible |
| Any other Codex adapter event not mapped above | `system`/`error` fallback | Best-effort canonical IDs | Must follow unknown-event policy |

## Negative-Case Examples (Unmappable Events)

### Example A: Unknown Claude stream subtype

- Input (Claude): `stream_event` with delta subtype not recognized by schema
- Problem: `unsupported_payload_shape`
- Required output: visible `system` fallback including `provider=claude`, `sourceEventType=stream_event`, raw payload snippet, generated `messageId`

### Example B: Claude tool result missing `tool_use_id`

- Input (Claude): tool result block without `tool_use_id`
- Problem: `missing_required_field` and no reliable tool correlation
- Required output: visible `error` fallback with recovered `turnId`/`messageId` (if present) and reason code

### Example C: Codex tool result references unknown tool call

- Input (Codex): `tool_call_completed` with `toolCallId` not seen in prior `tool_call_started`
- Problem: `id_linkage_failure`
- Required output: visible `error` fallback including offending `toolCallId`, plus continued processing of later events

### Example D: Unknown Codex adapter event

- Input (Codex): unrecognized adapter event name (for example `checkpoint_hint`)
- Problem: `unknown_event_type`
- Required output: visible `system` fallback (not silent drop), provider/source metadata attached

