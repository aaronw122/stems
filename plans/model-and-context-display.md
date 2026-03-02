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

**server/session.ts** — On `system/init`, capture additional fields:

```ts
// In consumeTurn, alongside existing sessionId capture:
if (msg.type === 'system' && msg.subtype === 'init') {
  session.sessionId = msg.session_id;
  session.meta = {
    claudeCodeVersion: msg.claude_code_version,
    model: msg.model,
  };

  // Also grab account info from initializationResult
  queryInstance.initializationResult().then((initResult) => {
    session.slashCommands = initResult.commands;
    session.meta.subscriptionType = initResult.account.subscriptionType;
    // Broadcast updated meta to subscribers
  });
}
```

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

**server/message-processor.ts** — Emit a `session_banner` message from `handleSystemInit`:

```ts
function handleSystemInit(msg: SDKSystemMessage): TerminalMessage[] {
  // existing: updateNode with sessionId
  return [{
    type: 'session_banner',
    text: '',
    bannerData: {
      claudeCodeVersion: msg.claude_code_version,
      model: msg.model,
      modelDisplayName: prettyModelName(msg.model),
      cwd: msg.cwd,
    },
  }];
}
```

Model name mapping helper:
```ts
function prettyModelName(model: string): string {
  // "claude-opus-4-6" → "Opus 4.6"
  // "claude-sonnet-4-6" → "Sonnet 4.6"
  // "claude-haiku-4-5-20251001" → "Haiku 4.5"
  const match = model.match(/claude-(\w+)-(\d+)-(\d+)/);
  if (!match) return model;
  const [, family, major, minor] = match;
  return `${family.charAt(0).toUpperCase() + family.slice(1)} ${major}.${minor}`;
}
```

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
| `shared/types.ts` | Add `session_banner` type, `bannerData` field |
| `server/session.ts` | Capture version/model/account from init |
| `server/message-processor.ts` | Emit `session_banner` message, add `prettyModelName` helper |
| `server/version-check.ts` | **NEW** — npm registry latest version check |
| `src/components/panels/TerminalMessageRenderer.tsx` | Render banner |
| `src/styles/flow.css` | Banner styles |

---

## Scope Notes

- The pixel art mascot can be a simple CSS grid (no image assets needed) — or we skip it for v1 and just show the text info
- The banner replaces the current "Waiting for output..." placeholder as the first thing you see
- `subscriptionType` arrives async (from `initializationResult`) — banner renders immediately with version/model, then updates with plan info when it arrives (or we wait the ~100ms for both)
- Upgrade check is non-blocking and cached — zero impact on session startup time
