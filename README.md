# stems

i built this because i was sick of getting context overload looking at too many terminals. needed a better way to manage my agents. this is a localhost GUI for visualizing and managing Claude Code agent sessions as a visual DAG. repos at the root, features branching off, subtasks at the leaves. each node is a real Claude CLI session you can peek into, spawn children from, and track to completion.

**stack:** Bun + Vite + React + TypeScript + React Flow + Tailwind + Zustand

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

stems uses the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) to spawn sessions. you need one of the following auth methods:

#### option a: max/pro subscription (recommended)

by default, the agent SDK bills against API credits — not your max/pro subscription. to use your subscription instead, export your OAuth token:

```bash
claude setup-token
```

this outputs your OAuth token. add it to your shell config so it persists across terminal sessions:

```bash
echo 'export CLAUDE_CODE_OAUTH_TOKEN=<token from above>' >> ~/.zshrc
source ~/.zshrc
```

tokens are valid for one year. if you hit auth errors after that, re-run `claude setup-token` and update the value in your `~/.zshrc`.

#### option b: API key

set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

this bills directly against your API credit balance. opus 4.6 sessions can burn through credits quickly.

## running

```bash
# start both server and client
bun run dev

# or run them separately
bun run dev:server   # bun websocket server
bun run dev:client   # vite dev server
```

the client opens at `http://localhost:7483` and the server runs on `http://localhost:7482`.

## usage

1. click the canvas to add a **repo node** — pick a local git repository
2. click a repo to spawn a **feature node** — type a prompt to start a Claude session
3. feature sessions can spawn **subtask nodes** automatically when Claude uses subagents
4. click any node to peek into its terminal output, send follow-up messages, or stop the session

## architecture

```
src/              → vite/react frontend (browser UI)
  components/     → react components (FlowCanvas, nodes, panels)
  hooks/          → zustand stores and custom hooks
  styles/         → css
server/           → bun websocket server (spawns/manages Claude sessions)
shared/           → types shared between client and server
```

## license

MIT
