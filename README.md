# stems

i built this because i was sick of looking at too many terminals. 

stems is a tool you run locally to manage claude code sessions. repos at the root, features branching off, subtasks at the leaves. each node is a real Claude CLI session you can look into, spawn children from, and track to completion. 

**stack:** Bun + Vite + React + TypeScript + xyflow + Tailwind + Zustand

## prerequisites

- [Bun](https://bun.sh) (v1.2+)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (v2.1+)
- a Claude account (max, pro, or API key)

## setup

### 1. install dependencies

```bash
bun install
```

### 2. authenticate Claude Code

stems uses the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) to spawn sessions. the SDK needs auth from the Claude Code CLI — you need both installed.

#### option a: max/pro subscription (recommended)

by default, the agent SDK **bills against API credits** — not your max/pro subscription. to use your subscription instead, export your OAuth token:

```bash
claude setup-token
```

this outputs your OAuth token. add it to your shell config as `STEMS_OAUTH_TOKEN`:

```bash
echo 'export STEMS_OAUTH_TOKEN=<token from above>' >> ~/.zshrc
source ~/.zshrc
```

stems reads `STEMS_OAUTH_TOKEN` and injects it into spawned sessions automatically. this keeps the token scoped to stems — your normal `claude` CLI sessions stay on full OAuth so commands like `/usage` keep working.

tokens are valid for one year. if you hit auth errors after that, re-run `claude setup-token` and update the value in your `~/.zshrc`.

#### option b: API key

set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

this bills directly against your API credit balance. opus 4.6 sessions can burn through credits quickly.

## running

```bash
# to use prod app
# dist/ is not committed to git, so build first
bun run build
bun run start

# to run dev for client and server
bun run dev

# or run them separately
bun run dev:server   # bun backend (http + websocket)
bun run dev:client   # vite dev server
```

`bun run start` serves static files from `dist/`. since `dist/` is gitignored, run `bun run build` first on a fresh clone (and after frontend changes).

in production, the bun server serves everything at `http://localhost:7482`. in dev, open `http://localhost:7483` (vite dev server, proxies to the bun backend on `7482`). 

## provider rollout flags (startup only)

provider migration gates are loaded once when the server boots:

- `STEMS_PROVIDER_BRIDGE_ENABLED` (default `false`)
- `STEMS_PROVIDER_CLAUDE_ADAPTER_ENABLED` (default `true`)
- `STEMS_PROVIDER_CODEX_ENABLED` (default `false`)

check the active startup snapshot with:

```bash
curl -s http://localhost:7482/api/health
```

full rollout/rollback drills and phase smoke checks live in [`docs/provider-rollout-rollback.md`](docs/provider-rollout-rollback.md).

## usage

1. click **+ add repo** in the toolbar to add a repo node — picks a local git repository via native folder picker (multiple repos can run at once)
2. click the **+ feature** button on a repo card — type a prompt to start a Claude session
3. feature sessions can spawn **subtask nodes** automatically when Claude uses subagents
4. click any node to peek into its terminal output, send follow-up messages, or stop the session

## architecture

```
src/
  components/     → react components (FlowCanvas, nodes, panels)
  hooks/          → zustand stores and custom hooks
  themes/         → theme system and presets
  styles/         → css
server/           → bun server (http API + websocket + session management)
shared/           → types shared between client and server
```

## license

MIT
