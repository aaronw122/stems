# Plan: Model & Context Display (Terminal Banner)

## Goal

When a Claude session starts in the TerminalPeek mini-terminal, show a startup banner similar to Claude Code's native CLI banner — pixel art mascot, version, model, plan tier, working directory, and an upgrade nudge when applicable.

Screenshot reference: the Claude Code CLI startup shows:
```
🐷  Claude Code v2.1.63
    Opus 4.6 · Claude Max
    ~/Projects/musicMixer
```

We want something similar as the first thing you see in the TerminalPeek when a session spins up.

---

## Data Sources (Already Available)

The SDK `system/init` message (`SDKSystemMessage`) provides:
- `claude_code_version: string` — e.g. `"2.1.63"`
- `model: string` — e.g. `"claude-opus-4-6"`

The `initializationResult()` method provides:
- `account.subscriptionType` — e.g. `"claude_max"`, `"claude_pro"`, `"free"`

**Currently captured on init (session.ts:169-178):** `session_id`, `slashCommands`
**Currently discarded:** version, model, account info

---

## Implementation

### Phase 1: Capture & relay session metadata

**server/session.ts** — In `consumeTurn`, the `system/init` block already captures `session.sessionId` and slash commands. We extend the `.then()` callback on `initializationResult()` to also build and emit the completed `session_banner` terminal message. This is the **only** place the banner is emitted — it lives here because both `msg` (with version/model/cwd) and `initResult` (with subscriptionType, models list, and displayName) are available in this scope.

> **Import change:** Add `broadcastTerminal` to the existing import from `./state.ts`:
> ```ts
> import { updateNode, getNode, broadcast, broadcastTerminal } from './state.ts';
> ```

```ts
// In consumeTurn, alongside existing sessionId capture:
if (msg.type === 'system' && 'subtype' in msg && msg.subtype === 'init') {
  session.sessionId = msg.session_id;

  // Capture init fields needed for the banner
  const systemMsg = msg as SDKSystemMessage;
  const claudeCodeVersion = systemMsg.claude_code_version;
  const rawModel = systemMsg.model;
  const cwd = systemMsg.cwd;

  queryInstance.initializationResult().then((initResult) => {
    session.slashCommands = initResult.commands;

    // Resolve display name from SDK's authoritative ModelInfo list
    const activeModel = initResult.models.find(m => m.value === rawModel);
    const displayName = activeModel?.displayName ?? rawModel;

    // Emit the completed banner as a one-shot terminal message
    broadcastTerminal(nodeId, [{
      type: 'session_banner',
      text: '',
      bannerData: {
        claudeCodeVersion,
        model: rawModel,
        modelDisplayName: displayName,
        subscriptionType: initResult.account?.subscriptionType,
        cwd,
      },
    }]);

    console.log(`[session:${nodeId}] emitted session_banner: ${displayName}, ${initResult.account?.subscriptionType ?? 'unknown plan'}`);
  }).catch((err) => {
    console.warn(`[session:${nodeId}] failed to build session banner:`, err);
  });
}
```

> **Design choice:** The banner is emitted as a terminal message and stored in the terminal buffer alongside all other messages. There is no `session.meta` field — replay simply replays the terminal buffer, which already contains the banner. This avoids a second source of truth and keeps the `Session` interface unchanged.

**shared/types.ts** — Add a new `TerminalMessageType`:

```ts
export type TerminalMessageType =
  | 'assistant_text'
  | 'user_message'
  | 'tool_use'
  | 'tool_result'
  | 'human_needed'
  | 'system'
  | 'session_banner'   // ← NEW
  | 'error';

// Banner-specific fields on TerminalMessage
export interface TerminalMessage {
  // ...existing fields...
  bannerData?: {
    claudeCodeVersion: string;
    model: string;           // raw model ID like "claude-opus-4-6"
    modelDisplayName: string; // pretty name like "Opus 4.6"
    subscriptionType?: string;
    cwd: string;
    upgradeAvailable?: boolean;
    latestVersion?: string;
  };
}
```

**server/message-processor.ts** — `handleSystemInit` stays unchanged (returns `void`, updates the node with `sessionId`). No banner emission here — that responsibility lives in `session.ts` (see above).

The `case 'system'` block in `processMessage` also stays as-is — it calls `handleSystemInit(msg as SDKSystemMessage)` without expecting a return value, which matches the existing `void` signature.

No `prettyModelName()` helper is needed. The SDK provides `ModelInfo.displayName` (e.g. `"Opus 4.6"`) directly via `initializationResult().models`, and `session.ts` uses that authoritative value when building the banner (see Phase 1 above).

### Phase 1b: Pin `session_banner` during buffer trimming

Both the server and client buffers trim from the front (`merged.slice(merged.length - MAX)`), which means the banner — always the first message — is the first to be evicted on long sessions. Late-joining clients receiving `terminal_replay` would never see the model info.

**Fix:** When trimming, check if the first message is a `session_banner` and preserve it by slicing from index 1 instead of index 0, then prepending it back.

**server/state.ts** — In `appendTerminalMessages`, replace the trimming block:

```ts
// Current:
const trimmed = merged.length > MAX_SERVER_MESSAGES
  ? merged.slice(merged.length - MAX_SERVER_MESSAGES)
  : merged;

// Fixed — pin session_banner at index 0:
let trimmed: TerminalMessage[];
if (merged.length > MAX_SERVER_MESSAGES) {
  const hasBanner = merged[0]?.type === 'session_banner';
  if (hasBanner) {
    // Keep banner + newest (MAX - 1) messages
    trimmed = [merged[0]!, ...merged.slice(merged.length - (MAX_SERVER_MESSAGES - 1))];
  } else {
    trimmed = merged.slice(merged.length - MAX_SERVER_MESSAGES);
  }
} else {
  trimmed = merged;
}
```

**src/hooks/useTerminal.ts** — Same fix in both `appendMessages` and `setMessages`:

```ts
// In appendMessages — replace the trimming block:
let trimmed: TerminalMessage[];
if (merged.length > MAX_MESSAGES) {
  const hasBanner = merged[0]?.type === 'session_banner';
  if (hasBanner) {
    trimmed = [merged[0]!, ...merged.slice(merged.length - (MAX_MESSAGES - 1))];
  } else {
    trimmed = merged.slice(merged.length - MAX_MESSAGES);
  }
} else {
  trimmed = merged;
}

// In setMessages — replace the trimming block:
let trimmed: TerminalMessage[];
if (messages.length > MAX_MESSAGES) {
  const hasBanner = messages[0]?.type === 'session_banner';
  if (hasBanner) {
    trimmed = [messages[0]!, ...messages.slice(messages.length - (MAX_MESSAGES - 1))];
  } else {
    trimmed = messages.slice(messages.length - MAX_MESSAGES);
  }
} else {
  trimmed = messages;
}
```

> **Why not a separate field?** Storing the banner as a regular message in the buffer (rather than a side-channel `session.meta` field) was an explicit design choice in Phase 1 — it keeps `terminal_replay` simple. Buffer pinning preserves that simplicity while ensuring the banner survives long sessions.

### Phase 2: Render the banner in TerminalPeek

**src/components/panels/TerminalMessageRenderer.tsx** — Add a `session_banner` case:

```tsx
case 'session_banner': {
  const b = message.bannerData!;
  const planLabel = formatPlan(b.subscriptionType); // "Max" | "Pro" | "Free" | ""
  return (
    <div className="terminal-banner">
      <div className="terminal-banner-mascot">
        {/* Pixel art — small inline SVG or CSS grid of colored squares */}
      </div>
      <div className="terminal-banner-info">
        <div className="terminal-banner-title">
          Claude Code v{b.claudeCodeVersion}
        </div>
        <div className="terminal-banner-meta">
          {b.modelDisplayName}{planLabel && ` · Claude ${planLabel}`}
        </div>
        <div className="terminal-banner-cwd">
          {b.cwd}
        </div>
        {b.upgradeAvailable && (
          <div className="terminal-banner-upgrade">
            ↑ v{b.latestVersion} available — run `claude update`
          </div>
        )}
      </div>
    </div>
  );
}
```

**src/styles/flow.css** — Banner styling:

```css
.terminal-banner {
  display: flex;
  gap: 12px;
  padding: 8px 0 12px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--term-input-border);
}

.terminal-banner-mascot {
  /* 8x5 grid of colored CSS squares matching Claude's pixel pig */
  display: grid;
  grid-template-columns: repeat(8, 6px);
  grid-template-rows: repeat(5, 6px);
  gap: 1px;
  flex-shrink: 0;
}

.terminal-banner-title {
  font-weight: 600;
  color: var(--term-text);
}

.terminal-banner-meta {
  color: var(--term-text-dim);
  font-size: 0.9em;
}

.terminal-banner-cwd {
  color: var(--term-text-dim);
  font-size: 0.9em;
}

.terminal-banner-upgrade {
  color: var(--term-tool-error);
  font-size: 0.85em;
  margin-top: 2px;
}
```

### Phase 3: Upgrade detection

Two options (in order of preference):

**Option A: npm registry check (server-side, simple)**
On server startup (once), fetch the latest published version:
```ts
// server/version-check.ts
let latestVersion: string | null = null;

export async function checkForUpdate(currentVersion: string): Promise<{available: boolean; latest: string}> {
  if (!latestVersion) {
    try {
      const res = await fetch('https://registry.npmjs.org/@anthropic-ai/claude-code/latest');
      const data = await res.json();
      latestVersion = data.version;
    } catch {
      return { available: false, latest: currentVersion };
    }
  }
  return {
    available: latestVersion !== currentVersion && latestVersion !== null,
    latest: latestVersion ?? currentVersion,
  };
}
```

Inject the result into `bannerData` before broadcasting. Cache it — only check once per server lifecycle.

**Option B: Compare against a pinned known-good version**
Simpler but requires manual updates. Not recommended.

---

## Files Changed

| File | Change |
|------|--------|
| `shared/types.ts` | Add `session_banner` type, `bannerData` field on `TerminalMessage` |
| `server/state.ts` | Pin `session_banner` at index 0 during buffer trimming in `appendTerminalMessages` |
| `server/session.ts` | Build and emit `session_banner` terminal message in the `initializationResult()` `.then()` callback |
| `server/message-processor.ts` | No changes needed (banner is emitted from `session.ts`, not here) |
| `server/version-check.ts` | **NEW** — npm registry latest version check |
| `src/hooks/useTerminal.ts` | Pin `session_banner` at index 0 during buffer trimming in `appendMessages` and `setMessages` |
| `src/components/panels/TerminalMessageRenderer.tsx` | Render banner |
| `src/styles/flow.css` | Banner styles |

---

## Scope Notes

- The pixel art mascot can be a simple CSS grid (no image assets needed) — or we skip it for v1 and just show the text info
- The banner replaces the current "Waiting for output..." placeholder as the first thing you see
- Banner emission waits for `initializationResult()` to resolve (~100ms), so the banner arrives as a single complete message with version, model display name, and subscription type all present. No two-phase render needed
- Upgrade check is non-blocking and cached — zero impact on session startup time
