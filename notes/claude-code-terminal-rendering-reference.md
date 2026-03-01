# Claude Code Terminal Rendering Reference

> How the Claude Code CLI renders tool calls, markdown, status indicators, subagents, and all other UI elements. Reference for making Stems' TerminalPeek match Claude Code exactly.

---

## Architecture

Claude Code's terminal UI is built with **React 18.2 + Ink 3.2** (React renderer for CLIs) and **Yoga** (WebAssembly Flexbox layout). Rendering capped at 30fps. Ships as a single ~8MB bundled `cli.js` (or native Mach-O binary on macOS ARM64). Uses **chalk** internally for terminal string styling.

---

## Tool Call Rendering

### General Pattern

Every tool call follows:

```
● ToolName(key input summary)
  └ output or result
  (ctrl+o to expand)
```

- **Running state**: Braille spinner replaces the `●`
- **Completed state**: Green `●` (success) or red `●` (error)
- **Output**: Indented with `└` connector, collapsed by default
- `Ctrl+O` toggles verbose/expanded view

### Per-Tool Format

#### Bash
```
● Bash(gh pr create --base main --head feat/floating-terminal-integration --title "feat: floating dragg...)
     ## Summary...)
  └ https://github.com/aaronw122/stems/pull/9
```
```
● Bash(gh pr merge 9 --merge)
  └ (No output)
```
```
● Bash(git pull origin main)
  └ From github.com:aaronw122/stems
     * branch          main       -> FETCH_HEAD
     5df40d1..78a36b9  main       -> origin/main
  ... +2 lines (ctrl+o to expand)
```
- Shows `$` prefix in some views
- Long commands truncate with `...`
- Exit codes shown for non-zero returns
- Output truncated at ~30,000 chars

#### Read
```
● Read(server/message-processor.ts)
  └ 385 lines
```
- Shows file path (shortened: last 2-3 segments)
- Line count in result
- Content collapsed by default

#### Edit
```
● Edit(src/components/TerminalPeek.tsx)
  └ [diff of changes]
```
- Shows file path
- Diff of old/new content with syntax highlighting

#### Write
```
● Write(shared/types.ts)
  └ 102 lines
```
- Shows file path and line count

#### Glob
```
● Glob(**/*.tsx)
  └ [matching file paths]
```
- Shows the glob pattern
- Lists matching files sorted by modification time

#### Grep
```
● Grep(createMessageProcessor)
  └ [matching files or content lines]
```
- Shows the search pattern
- Output depends on mode: file paths, content with context, or counts

#### Agent / Subagent
```
● Explore(Explore folder picker and WS patterns)
  └ Done (9 tool uses · 41.4k tokens · 29s)
  (ctrl+o to expand)
```
- **Display name is the `subagent_type`**, not "Agent" — shows `Explore`, `Plan`, `general-purpose`, etc.
- **Summary is the `description` field**
- While running: spinner + thinking verb text
- Completion line: `Done (N tool uses · Xk tokens · Ns)`
- Each subagent can have a custom background color

#### WebFetch
```
● WebFetch(https://docs.example.com/api)
  └ [processed content summary]
```
- Shows URL being fetched

#### WebSearch
```
● WebSearch(Claude CLI stream format 2026)
  └ [search results]
```
- Shows search query

#### TaskCreate / TaskUpdate
```
● TaskCreate(Fix authentication bug)
```
```
● TaskUpdate(3 → completed)
```
- Task list visible via `Ctrl+T`

#### NotebookEdit
```
● NotebookEdit(analysis.ipynb)
  └ [cell modification]
```

#### AskUserQuestion
Not shown as a tool call — renders as a human-needed prompt instead.

---

## Markdown Rendering

Claude Code uses chalk for terminal markdown. Since Stems is browser-based, we can use HTML/CSS equivalents.

### Text Formatting

| Markdown | Claude Code (chalk) | Stems equivalent (HTML/CSS) |
|----------|--------------------|-----------------------------|
| `**bold**` | `chalk.bold()` | `<strong>` |
| `*italic*` | `chalk.italic()` | `<em>` |
| `` `code` `` | `chalk.cyan()` | `<code>` with `color: cyan; background: rgba(255,255,255,0.08)` |

### Headings

| Markdown | Claude Code | Stems |
|----------|------------|-------|
| `# H1` | `chalk.bold.underline.blue()` | `<strong style="font-size:1.15em; color: blue; text-decoration: underline">` |
| `## H2` | `chalk.bold.blue()` | `<strong style="font-size:1.05em; color: blue">` |
| `### H3+` | `chalk.bold()` | `<strong>` |

### Lists

| Markdown | Claude Code | Stems |
|----------|------------|-------|
| `- item` | `chalk.dim('*') + text` | `  • item` (dim bullet) |

### Code Blocks

Claude Code renders fenced code blocks with box-drawing borders:

```
┏━━━━━━━━━━━━━━━━━━━━┓
┃ typescript
┃ const x = 1;
┃ console.log(x);
┗━━━━━━━━━━━━━━━━━━━━┛
```

- Border characters (`┏ ┓ ┗ ┛ ┃ ━`) in `chalk.dim()` (gray)
- Language tag in `chalk.bold.blue()`
- Basic syntax highlighting:
  - Keywords (`function`, `const`, `if`, `return`): blue
  - Numbers: yellow
  - Strings: green
  - Comments: gray

**Stems equivalent:** A `<code>` block with `border: 1px solid var(--term-text-dim); background: rgba(255,255,255,0.05); border-radius: 4px; padding: 8px`. Better than terminal since we have proper CSS.

### Tables

Claude Code **does not render tables well** — raw pipe characters show through. This is an open issue (#13600, #26390). Stems can do better since we're in a browser — parse pipe-delimited tables into `<table>` elements.

### What Claude Code Does NOT Render

- Horizontal rules (`---`) — raw text
- Blockquotes (`>`) — not styled
- Links `[text](url)` — sometimes OSC 8 hyperlinks, often raw
- Checkbox lists `- [ ]` — may strip brackets

---

## Status Indicators

### Spinner (Running State)

Braille pattern characters cycling:
```
⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏
```
- **Color**: Cyan
- **Verbs**: Rotating text like "Considering...", "Analyzing...", "Thinking..."
- Customizable via `spinnerVerbs` setting

### Completion Indicators

| State | Symbol | Color |
|-------|--------|-------|
| Success | `●` or `✓` | Green — `rgb(78,186,101)` |
| Error | `●` or `✗` | Red — `rgb(255,107,128)` |
| Warning | `⚠` | Yellow — `rgb(255,193,7)` |
| Info | `ℹ` | Blue |

### Reduced Motion

`prefersReducedMotion: true` disables spinner/shimmer/flash animations.

---

## Subagent Display

### Lifecycle

1. **Spawn**: `● Explore(task description)` with spinner
2. **Running**: Spinner + thinking verb + token counter
3. **Complete**: `└ Done (N tool uses · Xk tokens · Ns)`

### Built-in Subagent Types

| Type | Model | Purpose |
|------|-------|---------|
| Explore | Haiku (fast) | Read-only codebase search |
| Plan | Inherits | Architecture during plan mode |
| general-purpose | Inherits | Full tool access |
| statusline-setup | Sonnet | Status line config |
| claude-code-guide | Haiku | Feature questions |

### Background Agents

- `Ctrl+B` backgrounds a running task
- `Ctrl+F` kills all background agents (press twice within 3s)
- Bulk kill sends aggregate notification

---

## Cost / Token Display

### Turn Duration
```
Cooked for 1m 6s
```
- Shown after each response
- Verb customizable via spinner verbs
- Toggle: `showTurnDuration: true/false`

### Token Counter
Real-time counter during generation showing current token consumption.

### Commands
- `/cost` — Token usage statistics
- `/usage` — Plan usage limits and rate limits
- `/context` — Context usage as colored grid

---

## Color Scheme

### Dark Theme (Default)

| Element | Color | Value |
|---------|-------|-------|
| Text | White | `rgb(255,255,255)` |
| Secondary/dim text | Gray | `rgb(153,153,153)` |
| Claude accent | Orange-brown | `rgb(215,119,87)` |
| Success | Green | `rgb(78,186,101)` |
| Error | Red-pink | `rgb(255,107,128)` |
| Warning | Yellow | `rgb(255,193,7)` |
| Permission/suggestion | Lavender | `rgb(177,185,249)` |
| Plan mode | Teal | `rgb(72,150,140)` |
| Auto-accept | Purple | `rgb(175,135,255)` |
| Bash border | Pink | `rgb(253,93,177)` |
| Secondary border | Gray | `rgb(136,136,136)` |
| Background | Near-black | `rgb(14,14,14)` |

### Chalk Color Mappings

| Element | Chalk call |
|---------|-----------|
| Inline code, spinner, commands | `chalk.cyan()` |
| H1 headers | `chalk.bold.underline.blue()` |
| H2 headers | `chalk.bold.blue()` |
| H3+ headers | `chalk.bold()` |
| Code block borders | `chalk.dim()` |
| Code block language tag | `chalk.bold.blue()` |
| List bullets | `chalk.dim('*')` |
| Success | `chalk.green()` |
| Error | `chalk.red()` |
| Warning | `chalk.yellow()` |
| Syntax: keywords | `chalk.blue()` |
| Syntax: numbers | `chalk.yellow()` |
| Syntax: strings | `chalk.green()` |
| Syntax: comments | `chalk.gray()` |

### Theme Variants

6 themes: dark, light, dark-daltonized, light-daltonized, dark-ansi, light-ansi. Toggle via `/theme` command. All extracted color values in `plans/claude-terminal-theming.md`.

---

## Key Unicode Symbols

| Symbol | Unicode | Usage |
|--------|---------|-------|
| `●` | U+25CF | Tool status (success=green, error=red) |
| `⏵` | U+23F5 | Permission prompts |
| `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` | U+280x | Spinner animation |
| `✓` | U+2713 | Success check |
| `✗` | U+2717 | Error cross |
| `⚠` | U+26A0 | Warning |
| `ℹ` | U+2139 | Info |
| `┏┓┗┛┃━` | U+250x | Code block borders |
| `•` | U+2022 | List bullets |
| `└` | U+2514 | Result connector |

---

## Keyboard Shortcuts (Display)

| Shortcut | Action |
|----------|--------|
| `Ctrl+O` | Toggle verbose/collapsed tool output |
| `Ctrl+T` | Toggle task list |
| `Ctrl+L` | Clear screen (keeps conversation) |
| `Ctrl+B` | Background current task |
| `Ctrl+F` | Kill background agents (2x to confirm) |

---

## Collapse / Expand Behavior

- Most tool outputs **collapsed by default**
- `Ctrl+O` toggles verbose mode globally
- Collapsed view: brief summary (file path, line count, match count)
- Expanded view: full output
- Hint text: `(ctrl+o to expand)` shown after collapsed results
- Long output: `... +N lines (ctrl+o to expand)`

---

## Sources

- [Claude Code GitHub](https://github.com/anthropics/claude-code)
- [Claude Code Docs](https://code.claude.com/docs/en/overview)
- [Reverse Engineering Claude Code (Reid Barber)](https://www.reidbarber.com/blog/reverse-engineering-claude-code)
- [Southbridge Dependencies Analysis](https://www.southbridge.ai/blog/claude-code-an-analysis-dependencies)
- [Claude Code Deobfuscation (ghuntley)](https://github.com/ghuntley/claude-code-source-code-deobfuscation)
- [Claude Code Internals (kotrotsos)](https://kotrotsos.medium.com/claude-code-internals-part-11-terminal-ui-542fe17db016)
- Screenshots from local Claude Code sessions (2026-03-01)
