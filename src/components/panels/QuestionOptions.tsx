import { useState, useCallback, useMemo } from 'react';
import type { AskUserQuestionPayload } from '../../../shared/types.ts';

interface QuestionOptionsProps {
  payload: AskUserQuestionPayload;
  onAnswer: (answer: string) => void;
}

/**
 * Renders AskUserQuestion options as clickable buttons,
 * mirroring Claude CLI's multiple-choice UI.
 *
 * Only renders the first question in the `questions` array —
 * Claude typically sends one question per AskUserQuestion call.
 */
export function QuestionOptions({ payload, onAnswer }: QuestionOptionsProps) {
  // Track selected options for multiSelect questions
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // Derive question data — safe to use before early return since useMemo is always called
  const question = useMemo(() => payload.questions?.[0] ?? null, [payload]);
  const options = question?.options ?? [];
  const multiSelect = question?.multiSelect ?? false;

  const handleClick = useCallback(
    (index: number) => {
      if (multiSelect) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(index)) next.delete(index);
          else next.add(index);
          return next;
        });
      } else {
        // Single select — send immediately
        onAnswer(options[index]!.label);
      }
    },
    [multiSelect, options, onAnswer],
  );

  const handleSubmitMulti = useCallback(() => {
    if (selected.size === 0) return;
    const labels = Array.from(selected)
      .sort((a, b) => a - b)
      .map((i) => options[i]!.label);
    onAnswer(labels.join(', '));
  }, [selected, options, onAnswer]);

  // Early return AFTER all hooks
  if (!question || options.length === 0) return null;

  return (
    <div
      className="mx-4 my-2 rounded-md overflow-hidden"
      style={{
        border: '1px solid var(--term-human-needed-border)',
        backgroundColor: 'var(--term-human-needed-bg)',
      }}
    >
      {/* Question header */}
      {question.header && (
        <div
          className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide"
          style={{
            color: 'var(--term-human-needed-text)',
            borderBottom: '1px solid var(--term-human-needed-border)',
            opacity: 0.7,
          }}
        >
          {question.header}
        </div>
      )}

      {/* Options */}
      <div className="flex flex-col">
        {options.map((opt, i) => {
          const isSelected = selected.has(i);
          return (
            <button
              key={i}
              onClick={() => handleClick(i)}
              className="flex items-start gap-2.5 px-3 py-2 text-left transition-colors"
              style={{
                backgroundColor: isSelected
                  ? 'color-mix(in srgb, var(--term-human-needed-border) 30%, transparent)'
                  : 'transparent',
                borderBottom:
                  i < options.length - 1
                    ? '1px solid color-mix(in srgb, var(--term-human-needed-border) 40%, transparent)'
                    : 'none',
                color: 'var(--term-text)',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor =
                  'color-mix(in srgb, var(--term-human-needed-border) 20%, transparent)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = isSelected
                  ? 'color-mix(in srgb, var(--term-human-needed-border) 30%, transparent)'
                  : 'transparent';
              }}
            >
              {/* Number badge */}
              <span
                className="flex-none w-5 h-5 rounded text-xs flex items-center justify-center font-mono mt-0.5"
                style={{
                  backgroundColor: isSelected
                    ? 'var(--term-human-needed-border)'
                    : 'color-mix(in srgb, var(--term-human-needed-border) 40%, transparent)',
                  color: isSelected ? 'var(--term-bg)' : 'var(--term-text-dim)',
                }}
              >
                {multiSelect ? (isSelected ? '✓' : ' ') : i + 1}
              </span>

              {/* Label + description */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium" style={{ color: 'var(--term-text)' }}>
                  {opt.label}
                </div>
                {opt.description && (
                  <div className="text-xs mt-0.5" style={{ color: 'var(--term-text-dim)' }}>
                    {opt.description}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Submit button for multiSelect */}
      {multiSelect && (
        <div
          className="px-3 py-2"
          style={{ borderTop: '1px solid var(--term-human-needed-border)' }}
        >
          <button
            onClick={handleSubmitMulti}
            disabled={selected.size === 0}
            className="rounded px-3 py-1 text-xs font-medium transition-colors"
            style={{
              backgroundColor:
                selected.size > 0
                  ? 'var(--term-human-needed-border)'
                  : 'color-mix(in srgb, var(--term-human-needed-border) 30%, transparent)',
              color: selected.size > 0 ? 'var(--term-bg)' : 'var(--term-text-dim)',
              cursor: selected.size > 0 ? 'pointer' : 'default',
            }}
          >
            Submit ({selected.size} selected)
          </button>
        </div>
      )}

      {/* Hint: user can also type in the input below */}
      <div
        className="px-3 py-1.5 text-xs"
        style={{
          color: 'var(--term-text-dim)',
          borderTop: '1px solid color-mix(in srgb, var(--term-human-needed-border) 40%, transparent)',
          opacity: 0.6,
        }}
      >
        Or type a custom response below
      </div>
    </div>
  );
}
