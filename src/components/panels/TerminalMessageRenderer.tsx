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

  // 2. Fenced code blocks (```...```) — preserve contents, strip lang tag
  html = html.replace(/```\w*\n([\s\S]*?)```/g, (_, code) =>
    `<code style="background:rgba(255,255,255,0.08);padding:2px 4px;border-radius:3px">${code.trimEnd()}</code>`
  );

  // 3. Inline code (`...`)
  html = html.replace(
    /`([^`]+)`/g,
    '<code style="background:rgba(255,255,255,0.08);padding:0 3px;border-radius:2px">$1</code>',
  );

  // 4. Bold (**...**)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // 5. Italic (*...*) — negative lookbehind to avoid matching inside bold
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

  // 6. Headings (# at start of line → bold with slight size bump)
  html = html.replace(/^(#{1,3})\s+(.+)$/gm, (_, hashes: string, heading: string) => {
    const level = hashes.length;
    const size = level === 1 ? '1.15em' : level === 2 ? '1.05em' : '1em';
    return `<strong style="font-size:${size}">${heading}</strong>`;
  });

  // 7. Unordered list items (- ...)
  html = html.replace(/^[-*]\s+(.+)$/gm, '  • $1');

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
        <div>
          <div className="my-0.5 flex items-start gap-1.5">
            <span style={{ color: 'var(--term-tool-success)' }}>&#9679;</span>
            <span>
              {message.toolName && (
                <span style={{ color: 'var(--term-tool-name)' }}>
                  {message.toolName}
                </span>
              )}
              {message.text && (
                <span style={{ color: 'var(--term-text-dim)' }}>
                  ({message.text})
                </span>
              )}
            </span>
          </div>
          {(message.diffRemoved || message.diffAdded) && (
            <div
              className="ml-5 mt-1 rounded px-2 py-1 text-xs leading-4"
              style={{ backgroundColor: 'var(--term-input-bg)', fontFamily: 'monospace' }}
            >
              {message.diffRemoved && (
                <div style={{
                  backgroundColor: 'rgba(248, 81, 73, 0.15)',
                  color: 'var(--term-text)',
                  whiteSpace: 'pre-wrap',
                  padding: '2px 4px',
                  borderRadius: '2px',
                }}>
                  {message.diffRemoved}
                </div>
              )}
              {message.diffAdded && (
                <div style={{
                  backgroundColor: 'rgba(63, 185, 80, 0.15)',
                  color: 'var(--term-text)',
                  whiteSpace: 'pre-wrap',
                  padding: '2px 4px',
                  borderRadius: '2px',
                }}>
                  {message.diffAdded}
                </div>
              )}
            </div>
          )}
        </div>
      );

    case 'tool_result': {
      const bulletColor = message.isSuccess === false
        ? 'var(--term-tool-error)'
        : 'var(--term-tool-success)';

      return (
        <div className="my-0.5 flex items-start gap-1.5 pl-4">
          <span style={{ color: bulletColor }}>&#9679;</span>
          <span style={{ color: 'var(--term-text-dim)' }}>{message.text}</span>
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
