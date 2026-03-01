import type { TerminalMessage } from '../../../shared/types.ts';

interface TerminalMessageRendererProps {
  message: TerminalMessage;
}

export function TerminalMessageRenderer({ message }: TerminalMessageRendererProps) {
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
        <div style={{ color: 'var(--term-text)' }}>
          {message.text}
        </div>
      );

    case 'tool_use':
      return (
        <div className="my-0.5 flex items-start gap-1.5">
          <span style={{ color: 'var(--term-tool-success)' }}>&#9679;</span>
          <span>
            {message.toolName && (
              <span
                className="mr-1.5"
                style={{ color: 'var(--term-tool-name)' }}
              >
                {message.toolName}
              </span>
            )}
            <span style={{ color: 'var(--term-text-dim)' }}>{message.text}</span>
          </span>
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
