---
title: "Claude Terminal Theming"
author: "human:aaron"
version: 1
created: 2026-02-28
---

# Claude Terminal Theming

## WANT

Make the Stems mini terminals (TerminalPeek) visually identical to Claude Code running in the default macOS Terminal. Specifically:

- **Message differentiation:** User messages, Claude responses, tool calls, thinking/cogitation indicators each rendered with their distinct visual treatment — exactly as Claude Code displays them
- **Dark/light/colorblind modes:** Match Claude Code's own theme options (dark, dark-high-contrast, light, light-high-contrast, and colorblind variants)
- **First-boot theme selection:** When a user first opens Stems, prompt them to choose their theme preference (same flow as Claude Code's initial setup)
- **Persistent preference:** Save the chosen theme so future sessions use it automatically
- **Terminal-faithful rendering:** This is Claude Code in the terminal, not the desktop app. ANSI colors, block formatting, status indicators, tool call bullets, the thinking asterisk — all of it

Visual reference: Claude Code running in macOS Terminal.app with dark theme — user messages in highlighted blocks, Claude text as plain output, green/pink tool call indicators, status bar with context remaining.

## DON'T

- **No custom theme editor.** Ship Claude Code's exact themes — users pick from the preset list, they don't customize colors
- **No scope creep into terminal emulation features.** This is about visual rendering of Claude session output, not building a general-purpose terminal (no shell access, no arbitrary command execution through this UI)

## LIKE

- Claude Code terminal running in default macOS Terminal.app — the sole visual reference. Match it faithfully.

## FOR

- Multi-user tool — anyone familiar with Claude Code should look at the mini terminal and feel at home
- Environment: browser-based React app (Stems) rendering agent session output
- Stack: React + TypeScript + Tailwind, consuming Claude CLI output via WebSocket

## ENSURE

- **Visual parity:** Side-by-side with a real Claude Code terminal session, the mini terminal's coloring and layout should be indistinguishable
- **Message differentiation:** User messages, Claude responses, tool calls, and thinking indicators are each clearly distinct — you never confuse who said what
- **Dark/light mode correctness:** Each theme mode produces correct colors matching Claude Code's actual theme for that mode
- **Colorblind mode correctness:** Colorblind theme variants use Claude Code's actual colorblind-accessible palette
- **First-boot prompt works:** New users see a theme selection prompt on first launch
- **Preference persistence:** Chosen theme is saved and restored across sessions without re-prompting

## TRUST

- [autonomous] CSS/component architecture, file organization, class naming conventions
- [autonomous] How to extract/replicate Claude Code's color values (inspecting source, theme files, etc.)
- [autonomous] Implementation of the JSON-to-styled-output rendering pipeline
- [autonomous] Choice of persistence mechanism for theme preference (localStorage, etc.)
- [ask] Any change to the existing WebSocket protocol or Claude CLI spawn flags (e.g., if we need raw output alongside JSON streaming)
- [ask] Anything that changes the visual result beyond matching Claude Code's existing look
- [ask] Architecture decisions that affect the DAG/node system (if theming requires node-level changes)
