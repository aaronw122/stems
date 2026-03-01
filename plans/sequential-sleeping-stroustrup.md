# Plan: Match Claude Code Terminal Rendering in Stems

## Context

The Stems terminal peek window currently shows tool events as "Glob Glob", "Agent Agent" — repeating the tool name with no useful info. The real Claude Code UI shows rich, structured output like `Bash(git status)` with indented results, `Explore(task description)` with completion summaries, and properly formatted markdown in assistant text. This plan makes the Stems terminal rendering match Claude Code's actual display as closely as possible in a browser context.

## Reference: How Claude Code Renders Each Element

### Tool Calls — Format: `ToolName(summary)`

Every tool call shows a green `●` indicator, tool name, and a parenthesized summary of the key input parameter. Results appear indented below with `└` connector.

| Tool | Summary source | Example display |
|------|---------------|-----------------|
| **Bash** | `input.command` | `Bash(git status)` |
| **Read** | `input.file_path` | `Read(server/message-processor.ts)` |
| **Edit** | `input.file_path` | `Edit(src/components/TerminalPeek.tsx)` |
| **Write** | `input.file_path` | `Write(shared/types.ts)` |
| **Glob** | `input.pattern` | `Glob(**/*.tsx)` |
| **Grep** | `input.pattern` | `Grep(createMessageProcessor)` |
| **Agent** | `input.description` | `Explore(Explore folder picker and WS patterns)` |
| **WebFetch** | `input.url` | `WebFetch(https://example.com)` |
| **WebSearch** | `input.query` | `WebSearch(Claude CLI stream format)` |
| **NotebookEdit** | `input.notebook_path` | `NotebookEdit(analysis.ipynb)` |
| **TaskCreate** | `input.subject` | `TaskCreate(Fix auth bug)` |
| **TaskUpdate** | `input.taskId` + `input.status` | `TaskUpdate(3 → completed)` |

**Agent tool specifics:** The tool name displayed is the `subagent_type` (Explore, Plan, general-purpose), not "Agent". The summary is the `description` field. On completion, shows:
```
● Explore(Explore folder picker and WS patterns)
  └ Done (9 tool uses · 41.4k tokens · 29s)
  (ctrl+o to expand)
```

**Bash tool specifics:** Shows command in parens, then output indented:
```
● Bash(gh pr create --base main --head feat/floating-terminal-integration --title "feat: floating dragg...)
  └ https://github.com/aaronw122/stems/pull/9
```

**File path shortening:** When a file path is very long, show the last 2-3 path segments. `server/message-processor.ts` not `/Users/aaron/Projects/stems/server/message-processor.ts`.

**Truncation:** Summaries truncate at ~80 chars with `...`.

### Tool Results

Indented below the tool call with `└` connector:
```
● Bash(gh pr merge 9 --merge)
  └ (No output)
```

Long results show truncated with `(ctrl+o to expand)` or `... +2 lines (ctrl+o to expand)`.

### Assistant Text — Markdown Rendering

Claude Code renders these markdown elements in terminal text:

| Element | Claude Code rendering | Stems equivalent (HTML/CSS) |
|---------|----------------------|----------------------------|
| `**bold**` | `chalk.bold()` | `<strong>` |
| `*italic*` | `chalk.italic()` | `<em>` |
| `` `inline code` `` | Cyan text | `<code>` with subtle bg + cyan-ish color |
| `# H1` | Bold, underline, blue | `<strong>` larger font, blue |
| `## H2` | Bold, blue | `<strong>` blue |
| `### H3+` | Bold | `<strong>` |
| `- list item` | Dim bullet `•` | `  • item` |
| Code blocks | Box-drawn border (`┏━┓┃┗━┛`) | `<code>` block with border + bg |
| Tables | Raw pipes (not well-rendered) | Can do better in HTML — use `<table>` |
| `file.ts:42` | Plain text (sometimes OSC 8 link) | Plain text |

### Status Indicators

| State | Indicator |
|-------|-----------|
| Running | Braille spinner: `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` (cyan) |
| Success | Green filled circle `●` |
| Error | Red filled circle `●` |

### Colors (Dark Theme)

| Element | Color |
|---------|-------|
| Tool name | `secondaryText` — `rgb(153,153,153)` |
| Tool success dot | `success` — `rgb(78,186,101)` |
| Tool error dot | `error` — `rgb(255,107,128)` |
| Assistant text | `text` — `rgb(255,255,255)` |
| Dim/secondary | `secondaryText` — `rgb(153,153,153)` |
| User message border | `claude` — `rgb(215,119,87)` |
| Inline code | Cyan-ish |
| Headers | Blue-ish |
| Code block border | Dim gray |

---

## Root Cause of Current Bug

`server/message-processor.ts:190`:
```ts
messages.push({ type: 'tool_use', text: name, toolName: name });
```

Both `text` and `toolName` = tool name. Renderer shows both → "Glob Glob".

---

## Implementation

### 1. Add `extractToolSummary()` — `server/message-processor.ts`

New function that extracts a human-readable summary from each tool's input:

```ts
function extractToolSummary(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const inp = input as Record<string, unknown>;

  switch (name) {
    case 'Bash':
      return truncate(String(inp.command ?? ''), 80);
    case 'Read':
    case 'Edit':
    case 'Write':
      return shortenPath(String(inp.file_path ?? inp.path ?? ''));
    case 'Glob':
      return String(inp.pattern ?? '');
    case 'Grep':
      return String(inp.pattern ?? '');
    case 'Agent': {
      // Display subagent_type as the tool name, description as summary
      return truncate(String(inp.description ?? inp.prompt ?? ''), 60);
    }
    case 'WebFetch':
      return truncate(String(inp.url ?? ''), 80);
    case 'WebSearch':
      return truncate(String(inp.query ?? ''), 60);
    case 'NotebookEdit':
      return shortenPath(String(inp.notebook_path ?? ''));
    case 'TaskCreate':
      return truncate(String(inp.subject ?? ''), 60);
    case 'TaskUpdate':
      return inp.status ? `${inp.taskId} → ${inp.status}` : String(inp.taskId ?? '');
    default:
      return '';
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

function shortenPath(p: string): string {
  const segments = p.split('/');
  return segments.length > 3 ? segments.slice(-3).join('/') : p;
}
```

Then update the tool_use message creation:

```ts
// For Agent tool, use subagent_type as display name
const displayName = name === 'Agent'
  ? String((input as Record<string, unknown>)?.subagent_type ?? name)
  : name;
const summary = extractToolSummary(name, input);
messages.push({ type: 'tool_use', text: summary, toolName: displayName });
```

### 2. Update `TerminalMessageRenderer.tsx` — tool_use case

Change from showing `toolName text` to `ToolName(summary)` format:

```tsx
case 'tool_use':
  return (
    <div className="my-0.5 flex items-start gap-1.5">
      <span style={{ color: 'var(--term-tool-success)' }}>●</span>
      <span>
        <span style={{ color: 'var(--term-tool-name)' }}>
          {message.toolName}
        </span>
        {message.text && (
          <span style={{ color: 'var(--term-text-dim)' }}>
            ({message.text})
          </span>
        )}
      </span>
    </div>
  );
```

### 3. Update `TerminalMessageRenderer.tsx` — tool_result case

Add `└` connector and better formatting:

```tsx
case 'tool_result':
  return (
    <div className="my-0.5 flex items-start gap-1.5 pl-4">
      <span style={{ color: 'var(--term-text-dim)' }}>└</span>
      <span style={{ color: bulletColor }}>{message.text || '(No output)'}</span>
    </div>
  );
```

### 4. Improve markdown rendering — `TerminalMessageRenderer.tsx`

Upgrade `markdownToHtml()` to better match Claude Code:

- **Inline code**: Use a cyan-ish color (not just subtle bg)
- **Headers**: Blue color for H1/H2, bold for all
- **Code blocks**: Add a visible border/background block instead of just inline code styling
- **Tables**: Parse pipe-delimited tables into `<table>` elements (we can do better than Claude Code's terminal since we're in a browser)

---

## Files to Modify

1. **`server/message-processor.ts`** — Add `extractToolSummary()`, `truncate()`, `shortenPath()`. Update tool_use message creation at line ~190. Update Agent display name.
2. **`src/components/panels/TerminalMessageRenderer.tsx`** — Update `tool_use` case to `Name(summary)` format. Update `tool_result` case with `└` connector. Improve `markdownToHtml()` with better code/header/table styling.

## Verification

1. `bun run dev`
2. Spawn a feature node, send a prompt that triggers tool use
3. Confirm tool events show like:
   - `● Glob(**/*.tsx)` not "Glob Glob"
   - `● Bash(git status)` with output on next line as `└ ...`
   - `● Explore(Explore folder picker and WS patterns)` for subagents
4. Confirm assistant text renders markdown (bold, code, headers)
5. Visual comparison with real Claude Code terminal for the same operations
