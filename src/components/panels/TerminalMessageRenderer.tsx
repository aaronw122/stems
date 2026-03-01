import { useMemo } from 'react';
import type { TerminalMessage } from '../../../shared/types.ts';

// ── Lightweight markdown → HTML for assistant text ─────────────────
// Runs inside a <pre> with whitespace-pre-wrap, so newlines are
// already line breaks.  We only need inline formatting + headings.

function markdownToHtml(text: string): string {
  let html = text;

  // 1. Escape HTML entities
  html = html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 2. Fenced code blocks (```...```) — distinct block style
  html = html.replace(/```\w*\n([\s\S]*?)```/g, (_, code) =>
    `<code style="display:block;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:4px;padding:8px;margin:4px 0;font-size:0.9em">${code.trimEnd()}</code>`
  );

  // 3. Inline code (`...`) — cyan-ish color
  html = html.replace(
    /`([^`]+)`/g,
    '<code style="background:rgba(255,255,255,0.08);padding:0 3px;border-radius:2px;color:#7dd3fc">$1</code>',
  );

  // 4. Bold (**...**)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // 5. Italic (*...*) — negative lookbehind to avoid matching inside bold
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

  // 6. Headings (# at start of line → bold with blue color)
  html = html.replace(/^(#{1,3})\s+(.+)$/gm, (_, hashes: string, heading: string) => {
    const level = hashes.length;
    const size = level === 1 ? '1.15em' : level === 2 ? '1.05em' : '1em';
    const color = level <= 2 ? 'color:#60a5fa;' : '';
    return `<strong style="font-size:${size};${color}">${heading}</strong>`;
  });

  // 7. Unordered list items (- ...)
  html = html.replace(/^[-*]\s+(.+)$/gm, '  • $1');

  // 8. Tables — parse pipe-delimited markdown tables
  html = html.replace(
    /^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)+)/gm,
    (match) => {
      const lines = match.trim().split('\n');
      if (lines.length < 3) return match;

      const parseRow = (row: string) =>
        row.split('|').slice(1, -1).map(cell => cell.trim());

      const headers = parseRow(lines[0]!);
      const dataRows = lines.slice(2).map(parseRow);

      const cellStyle = 'padding:2px 8px;border:1px solid rgba(255,255,255,0.1)';
      const headerStyle = `${cellStyle};font-weight:bold;background:rgba(255,255,255,0.06)`;

      let table = '<table style="border-collapse:collapse;margin:4px 0;font-size:0.9em"><thead><tr>';
      for (const h of headers) {
        table += `<th style="${headerStyle}">${h}</th>`;
      }
      table += '</tr></thead><tbody>';
      for (const row of dataRows) {
        table += '<tr>';
        for (const cell of row) {
          table += `<td style="${cellStyle}">${cell}</td>`;
        }
        table += '</tr>';
      }
      table += '</tbody></table>';
      return table;
    }
  );

  return html;
}

// ── Component ──────────────────────────────────────────────────────

interface TerminalMessageRendererProps {
  message: TerminalMessage;
}

export function TerminalMessageRenderer({ message }: TerminalMessageRendererProps) {
  const assistantHtml = useMemo(
    () => (message.type === 'assistant_text' ? markdownToHtml(message.text) : ''),
    [message.type, message.text],
  );

  switch (message.type) {
    case 'user_message':
      return (
        <div
          className="my-1 rounded px-2 py-1"
          style={{
            backgroundColor: 'var(--term-user-bg)',
            borderLeft: '3px solid var(--term-user-border)',
            color: 'var(--term-user-text)',
          }}
        >
          {message.text}
        </div>
      );

    case 'assistant_text':
      return (
        <div
          style={{ color: 'var(--term-text)' }}
          dangerouslySetInnerHTML={{ __html: assistantHtml }}
        />
      );

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

    case 'tool_result': {
      const bulletColor = message.isSuccess === false
        ? 'var(--term-tool-error)'
        : 'var(--term-text-dim)';

      return (
        <div className="my-0.5 flex items-start gap-1.5 pl-4">
          <span style={{ color: 'var(--term-text-dim)' }}>└</span>
          <span style={{ color: bulletColor }}>{message.text || '(No output)'}</span>
        </div>
      );
    }

    case 'human_needed':
      return (
        <div
          className="my-1 rounded px-2 py-1"
          style={{
            backgroundColor: 'var(--term-human-needed-bg)',
            borderLeft: '3px solid var(--term-human-needed-border)',
            color: 'var(--term-human-needed-text)',
          }}
        >
          {message.text}
        </div>
      );

    case 'system':
      return (
        <div style={{ color: 'var(--term-system-text)' }}>
          {message.text}
        </div>
      );

    case 'error':
      return (
        <div style={{ color: 'var(--term-error-text)' }}>
          {message.text}
        </div>
      );

    default:
      return (
        <div style={{ color: 'var(--term-text)' }}>
          {message.text}
        </div>
      );
  }
}
