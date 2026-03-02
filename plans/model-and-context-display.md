# Plan: Model & Context Remaining Display

## Goal

Show the active model name and context remaining percentage for each agent node, similar to the Claude Code status line:

```
Opus 4.6 | Context remaining: [████████░░] 26.0%
```

## Data Sources (Already Available)

All the data we need is already flowing through the SDK message stream — just not being captured.

### Model Name

**Source:** `SDKSystemMessage` (type `system`, subtype `init`)
- Field: `msg.model` → e.g. `"claude-opus-4-6"`
- Arrives once at session start
- Currently ignored in `handleSystemInit()` (only captures `session_id`)

```typescript
// sdk.d.ts — SDKSystemMessage
{
  type: 'system';
  subtype: 'init';
  model: string;              // ← "claude-opus-4-6"
  claude_code_version: string;
  cwd: string;
  tools: string[];
  mcp_servers: { name: string; status: string }[];
  permissionMode: PermissionMode;
  fast_mode_state?: FastModeState;
  session_id: string;
  // ... more fields
}
```

### Context Window Size + Per-Turn Token Usage

**Source:** `SDKResultSuccess` (type `result`, subtype `success`)
- Field: `msg.modelUsage` → `Record<string, ModelUsage>`
- Each key is a model ID, value has `contextWindow`, token counts, cost
- Arrives after every completed turn
- Currently we only extract `total_cost_usd` and `usage.input_tokens`/`output_tokens`

```typescript
// sdk.d.ts — ModelUsage
{
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;        // ← total context window size
  maxOutputTokens: number;
}
```

### Context Compaction Events

**Source:** `SDKCompactBoundaryMessage` (type `system`, subtype `compact_boundary`)
- Field: `msg.compact_metadata.pre_tokens` → token count before compaction
- Currently in the ignored-messages list in `processMessage()`

```typescript
// sdk.d.ts — SDKCompactBoundaryMessage
{
  type: 'system';
  subtype: 'compact_boundary';
  compact_metadata: {
    trigger: 'manual' | 'auto';
    pre_tokens: number;         // ← how full context was before compaction
  };
  session_id: string;
}
```

## Implementation

### 1. Extend `WeftNode` type

**File:** `shared/types.ts`

Add three fields to `WeftNode`:

```typescript
export interface WeftNode {
  // ... existing fields ...

  /** Model ID from session init (e.g. "claude-opus-4-6") */
  model: string | null;

  /** Total context window size for this model */
  contextWindow: number | null;

  /** Most recent turn's input_tokens — already includes the full conversation history, so this is a snapshot, not cumulative */
  latestInputTokens: number;
}
```

**Why `latestInputTokens` instead of a percentage:** Store the raw number, derive the percentage on the client. More flexible, avoids floating point drift from repeated division.

**Note on token semantics:** Each turn's `usage.input_tokens` already includes the full conversation history (system prompt, all prior messages, tool definitions, etc.), not just the new user message. So the latest value is the best approximation of current context usage — no accumulation needed.

### 2. Capture model from init message

**File:** `server/message-processor.ts` → `handleSystemInit()`

```typescript
function handleSystemInit(msg: SDKSystemMessage): void {
  const updated = updateNode(nodeId, {
    sessionId: msg.session_id,
    model: msg.model,         // ← add this
  });
  if (updated) {
    broadcast({ type: 'node_updated', node: updated });
  }
}
```

### 3. Capture context window from result message

**File:** `server/message-processor.ts` → `handleResultSuccess()`

Extract `contextWindow` from `modelUsage` using `node.model` as the key, and overwrite `latestInputTokens` with the current turn's value:

```typescript
function handleResultSuccess(msg: SDKResultSuccess): TerminalMessage[] {
  // ... existing code ...

  const node = getNode(nodeId);
  if (node) {
    // Extract contextWindow from modelUsage using the node's known model
    let contextWindow = node.contextWindow;
    if (msg.modelUsage && node.model && msg.modelUsage[node.model]) {
      contextWindow = msg.modelUsage[node.model].contextWindow;
    }

    const updated = updateNode(nodeId, {
      costUsd: node.costUsd + msg.total_cost_usd,
      tokenUsage: {
        input: node.tokenUsage.input + msg.usage.input_tokens,
        output: node.tokenUsage.output + msg.usage.output_tokens,
      },
      contextWindow,
      // Overwrite, don't accumulate — input_tokens already includes full conversation history
      latestInputTokens: msg.usage.input_tokens,
    });
    if (updated) {
      broadcast({ type: 'node_updated', node: updated });
    }
  }

  return messages;
}
```

**Known gap:** Fast mode can switch models mid-session, which would change the primary model key in `modelUsage`. When that happens, `node.model` should be updated to the new primary model so the keyed lookup stays correct. Deferred to a follow-up.

### 4. Handle compact_boundary messages

**File:** `server/message-processor.ts` → `processMessage()`

When compaction happens, `pre_tokens` tells us how full the context was. After compaction, the context is significantly smaller. Since we use `latestInputTokens` (overwritten each turn, not accumulated), the next `SDKResultSuccess` will automatically reflect the reduced context size.

Simplest approach: emit a terminal message noting compaction, and let the next result's `input_tokens` naturally reflect the smaller context.

```typescript
case 'system': {
  if ('subtype' in msg && msg.subtype === 'init') {
    handleSystemInit(msg as SDKSystemMessage);
  } else if ('subtype' in msg && msg.subtype === 'compact_boundary') {
    // Context was compacted — next result's input_tokens will reflect the reduced context
    // Emit a terminal message so the user knows
    const compactMsg = msg as SDKCompactBoundaryMessage;
    broadcastTerminal(nodeId, [{
      type: 'system',
      text: `Context compacted (was ${compactMsg.compact_metadata.pre_tokens.toLocaleString()} tokens)`,
    }]);
  }
  break;
}
```

### 5. Model name display mapping

Map model IDs to human-readable names for the UI:

```typescript
// shared/model-display.ts (or inline in a component)
const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'claude-opus-4-6': 'Opus 4.6',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-sonnet-4-5-20250514': 'Sonnet 4.5',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
};

export function getModelDisplayName(modelId: string): string {
  if (MODEL_DISPLAY_NAMES[modelId]) return MODEL_DISPLAY_NAMES[modelId];
  // Fallback: parse the ID into something readable
  // "claude-opus-4-6" → "Opus 4.6"
  const match = modelId.match(/claude-(\w+)-(\d+)-(\d+)/);
  if (match) {
    const [, family, major, minor] = match;
    return `${family.charAt(0).toUpperCase() + family.slice(1)} ${major}.${minor}`;
  }
  return modelId;
}
```

### 6. Frontend display

Two places to show this information:

#### a) On the node card itself (compact)

Add a small status line below existing node info showing model + context bar:

```
Opus 4.6 | ████████░░ 26%
```

This should be subtle — small text, muted colors. Only appears after the init message sets the model.

#### b) In the detail/terminal panel (expanded)

Show full stats when a node's terminal panel is open:
- Model name
- Context bar with percentage
- Token breakdown (input / output / cache)
- Cost

### 7. Initialize defaults

**File:** wherever nodes are created (likely `server/state.ts` or `server/index.ts`)

New nodes should initialize with:

```typescript
model: null,
contextWindow: null,
latestInputTokens: 0,
```

## Context Remaining Calculation

On the client side:

```typescript
function contextRemainingPercent(node: WeftNode): number | null {
  if (!node.contextWindow || !node.latestInputTokens) return null;
  const remaining = Math.max(0, node.contextWindow - node.latestInputTokens) / node.contextWindow;
  return Math.round(remaining * 1000) / 10; // one decimal place
}
```

**Caveat:** This is an approximation. `latestInputTokens` includes the full conversation history but doesn't account for output tokens still in the response buffer or cache token nuances. It should track directionally with what Claude Code shows in its own status line, but may not match exactly.

**Future improvements:**
- Use `modelUsage[model].inputTokens` (per-model) instead of `usage.input_tokens` (aggregate across models) for multi-model sessions
- Track `cacheReadInputTokens` + `cacheCreationInputTokens` for a more precise context usage picture

## Files to Change

| File | Change |
|------|--------|
| `shared/types.ts` | Add `model`, `contextWindow`, `latestInputTokens` to `WeftNode` |
| `server/message-processor.ts` | Capture model from init, contextWindow from result, handle compact_boundary |
| `server/state.ts` (or wherever nodes are created) | Initialize new fields |
| `src/hooks/useGraph.ts` | Bump `NODE_HEIGHT` / `SUBTASK_HEIGHT` to accommodate new status line |
| `src/components/nodes/*` | Add model + context bar to node cards |
| `src/components/panels/*` | Add expanded stats to terminal panel |
| `shared/model-display.ts` (new) | Model ID → display name mapping |

## Open Questions

1. **Where on the node card?** The node cards are already dense. Need to decide if model/context goes on the card face or only in the expanded panel.
2. **Context bar style?** Simple percentage text, progress bar, or color-coded (green → yellow → red)?
