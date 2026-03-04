Review the following implementation plan for a local single-user CLI-mimic app adding Claude+Codex provider support.

Task:
- Perform a critical architecture review.
- Focus on risks, missing steps, regressions, and unclear assumptions.
- Keep feedback actionable and concise.

Output format:
- Markdown with sections: Findings (by severity), Gaps, Recommended plan edits, Go/No-Go.

Plan:

# Provider-Agnostic Local CLI-Mimic Plan

## Intent Alignment
- Keep Stems local and single-user.
- Preserve current CLI-mimic UX and DAG flow.
- Add provider support for Claude and Codex with minimal disruption.
- Avoid multi-user/cloud scope.

## Architecture Decision
- Keep current session orchestration in one core.
- Introduce a provider adapter seam for runtime integration.
- Normalize provider events before they hit message processing/state/UI.
- Keep websocket contract mostly stable to avoid a frontend rewrite.

## Phases

### M0 - Contracts and defaults (no behavior change)
1. Add `ProviderId` + provider metadata to shared contracts in [shared/types.ts](/Users/aaron/Projects/stems/shared/types.ts).
2. Add provider defaults (`claude`) to node/session runtime shape in [server/session.ts](/Users/aaron/Projects/stems/server/session.ts) and [server/index.ts](/Users/aaron/Projects/stems/server/index.ts).
3. Add provider-neutral banner fields while preserving compatibility with existing `claudeCodeVersion` readers in [src/components/panels/TerminalMessageRenderer.tsx](/Users/aaron/Projects/stems/src/components/panels/TerminalMessageRenderer.tsx).

Deliverable:
- Type-safe compile with no runtime behavior changes.

### M1 - Extract Claude adapter baseline
1. Create `server/providers/claude-adapter.ts`.
2. Move Anthropic SDK query wiring, Claude env/bin logic, and init parsing from [server/session.ts](/Users/aaron/Projects/stems/server/session.ts) into adapter.
3. Keep session core responsible only for queueing, turn lifecycle, state transitions, and abort semantics.

Deliverable:
- Claude behavior parity vs current mainline flow.

### M2 - Normalized provider event bridge
1. Define normalized internal event union (init, assistant text deltas, tool calls/results, human-needed, usage, result).
2. Add translation from adapter output -> existing message processor inputs in [server/message-processor.ts](/Users/aaron/Projects/stems/server/message-processor.ts).
3. Remove Anthropic SDK types from non-adapter modules where possible.

Deliverable:
- Message processor consumes provider-agnostic event shape.

### M3 - UI/protocol neutralization
1. Update banner rendering in [src/components/panels/TerminalMessageRenderer.tsx](/Users/aaron/Projects/stems/src/components/panels/TerminalMessageRenderer.tsx) to display provider-neutral runtime metadata.
2. Replace tool-name-specific assumptions with capability/data-based rendering for file links and summaries.
3. Keep current stores and websocket flows unchanged in [src/hooks/useWebSocket.ts](/Users/aaron/Projects/stems/src/hooks/useWebSocket.ts), [src/hooks/useGraph.ts](/Users/aaron/Projects/stems/src/hooks/useGraph.ts), and [src/hooks/useTerminal.ts](/Users/aaron/Projects/stems/src/hooks/useTerminal.ts).

Deliverable:
- Existing UI continues to render for Claude and can support Codex events.

### M4 - Add Codex adapter (feature-flagged)
1. Create `server/providers/codex-adapter.ts` using codex runtime integration (local, single-user mode).
2. Implement start/resume/abort + command exposure mapping to normalized events.
3. Add provider selection path (initially config/default-driven; can be promoted to per-node UI later).

Deliverable:
- End-to-end Codex session support behind a safe toggle while Claude remains default.

### M5 - Parity hardening and fallback paths
1. Ensure unknown/unmappable events degrade to visible `system`/`error` terminal output.
2. Normalize human-needed flows so [src/components/panels/QuestionOptions.tsx](/Users/aaron/Projects/stems/src/components/panels/QuestionOptions.tsx) keeps working.
3. Validate subagent and usage behavior parity in [server/message-processor.ts](/Users/aaron/Projects/stems/server/message-processor.ts) and [src/components/panels/SubagentSummary.tsx](/Users/aaron/Projects/stems/src/components/panels/SubagentSummary.tsx).

Deliverable:
- Stable cross-provider runtime behavior for primary workflows.

### M6 - Cleanup and deprecation
1. Remove deprecated Claude-only alias fields once both providers pass acceptance matrix.
2. Move provider-specific version checks out of generic flow (e.g., [server/version-check.ts](/Users/aaron/Projects/stems/server/version-check.ts)).
3. Resolve `context-summary` provider policy in [server/context-summary.ts](/Users/aaron/Projects/stems/server/context-summary.ts) (provider-aware summarizer or explicit fallback).

Deliverable:
- Cleaner provider-neutral core with provider-specific logic isolated.

## ENSURE Matrix (Acceptance)
1. ENSURE-1: Same core node lifecycle works on Claude and Codex.
2. ENSURE-2: Turn queueing and resume behavior remain correct under rapid inputs.
3. ENSURE-3: Deferred spawn behavior remains intact.
4. ENSURE-4: Terminal replay/reconnect remains stable across providers.
5. ENSURE-5: Human-needed question/permission flow works end-to-end.
6. ENSURE-6: Commands endpoint returns stable shape across providers.
7. ENSURE-7: Usage/cost/context fields degrade safely when missing.
8. ENSURE-8: Stop/abort + restart input flow remains resilient.
9. ENSURE-9: Existing persisted workspaces remain loadable.
10. ENSURE-10: Context summary route has a safe non-Claude path.

## First Implementation Slice
1. M0 + M1 only.
2. Ship behind unchanged default (`claude`).
3. Validate parity manually with existing local workflow before touching UI or adding Codex.

## Open Decisions
1. Provider selection UX location: global default vs per-node override.
2. Codex resume token durability expectations for long-lived sessions.
3. Command metadata depth needed for autocomplete parity.
4. Whether to keep `context-summary` Claude-only initially or build provider-aware now.
