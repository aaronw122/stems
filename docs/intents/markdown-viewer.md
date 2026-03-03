---
title: "Markdown Viewer"
author: "human:aaron"
version: 1
created: 2026-03-03
---

# Markdown Viewer

## WANT
An in-app markdown viewer for Stems. When Claude outputs a `.md` file path in session output, the path is clickable. Clicking it opens a modal overlay that renders the markdown file with proper formatting — headers, tables, lists, code blocks, bold/italic, links. The file is read from disk via the server and displayed in the browser.

## DON'T
- No editing — read-only viewer only
- No heavy features — no TOC generation, no search within the document, no syntax highlighting for code blocks
- No new browser window/tab — stays within the Stems UI (extensible later)
- Keep it simple

## LIKE
- VS Code markdown preview pane — `# Title` renders as a styled large heading, tables render as actual tables, everything renders as formatted content rather than raw text

## FOR
- Any Stems user viewing any `.md` file that Claude references during a session
- Runs in the Stems browser UI (localhost)
- File paths are local filesystem paths served by the Bun backend

## ENSURE
- Clicking a `.md` file path in Claude's session output opens a modal with rendered markdown
- All common markdown elements render correctly: headers (h1–h6), bold, italic, lists (ordered/unordered), tables, code blocks (inline and fenced), links
- Modal is dismissible (click outside, Escape key, close button)
- Non-existent file paths show a clear error state

## TRUST
- [autonomous] Choice of markdown rendering library
- [autonomous] Modal component design and styling
- [autonomous] File path detection regex/parsing approach
- [autonomous] Server endpoint design for reading .md files
- [autonomous] All implementation decisions — just make it work and look good
