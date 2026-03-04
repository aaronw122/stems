import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { AskUserQuestionPayload } from '../../../shared/types.ts';

interface QuestionOptionsProps {
  payload: AskUserQuestionPayload;
  onAnswer: (answer: string) => void;
}

const BORDER_DEFAULT = '1px solid rgba(255, 255, 255, 0.15)';
const BORDER_SELECTED = '1px solid rgba(100, 160, 255, 0.6)';
const BORDER_HOVER = '1px solid rgba(255, 255, 255, 0.28)';

export function QuestionOptions({ payload, onAnswer }: QuestionOptionsProps) {
  const [selections, setSelections] = useState<Map<number, Set<number>>>(new Map());
  const [otherActive, setOtherActive] = useState(false);
  const [otherText, setOtherText] = useState('');
  const otherInputRef = useRef<HTMLInputElement>(null);

  const questions = useMemo(() => payload.questions ?? [], [payload]);

  // Focus the "Other" input when activated
  useEffect(() => {
    if (otherActive) {
      requestAnimationFrame(() => otherInputRef.current?.focus());
    }
  }, [otherActive]);

  const handleClick = useCallback(
    (qIndex: number, optIndex: number, multiSelect: boolean) => {
      // Selecting a real option deactivates "Other"
      setOtherActive(false);
      setOtherText('');
      setSelections((prev) => {
        const next = new Map(prev);
        if (multiSelect) {
          const current = new Set(prev.get(qIndex) ?? []);
          if (current.has(optIndex)) current.delete(optIndex);
          else current.add(optIndex);
          next.set(qIndex, current);
        } else {
          next.set(qIndex, new Set([optIndex]));
        }
        return next;
      });
    },
    [],
  );

  const handleOtherClick = useCallback(() => {
    // Clear all selections and activate "Other"
    setSelections(new Map());
    setOtherActive(true);
  }, []);

  const handleSubmit = useCallback(() => {
    // "Other" mode — submit typed text
    if (otherActive) {
      const trimmed = otherText.trim();
      if (trimmed) onAnswer(trimmed);
      return;
    }
    // Normal mode — submit selected option labels
    const answers: string[] = [];
    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi]!;
      const sel = selections.get(qi);
      if (!sel || sel.size === 0) continue;
      const labels = Array.from(sel)
        .sort((a, b) => a - b)
        .map((i) => q.options[i]!.label);
      answers.push(labels.join(', '));
    }
    if (answers.length === 0) return;
    onAnswer(answers.length === 1 ? answers[0]! : answers.join('\n'));
  }, [otherActive, otherText, selections, questions, onAnswer]);

  if (questions.length === 0) return null;

  const hasSelection = Array.from(selections.values()).some((s) => s.size > 0);
  const canSubmit = hasSelection || (otherActive && otherText.trim().length > 0);

  return (
    <div className="my-2">
      {questions.map((q, qi) => {
        const opts = q.options ?? [];
        if (opts.length === 0) return null;
        const qSel = selections.get(qi) ?? new Set<number>();

        return (
          <div key={qi} className={qi > 0 ? 'mt-3' : ''}>
            {q.header && (
              <div
                className="text-xs font-mono mb-1.5 ml-0.5"
                style={{ color: 'var(--term-text-dim)' }}
              >
                {q.header}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              {opts.map((opt, oi) => {
                const isSelected = qSel.has(oi);
                return (
                  <button
                    key={oi}
                    onClick={() => handleClick(qi, oi, q.multiSelect)}
                    className="flex items-start gap-2.5 py-2 px-2.5 rounded-md text-left transition-all cursor-pointer"
                    style={{
                      border: isSelected ? BORDER_SELECTED : BORDER_DEFAULT,
                      backgroundColor: 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.border = BORDER_HOVER;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.border = isSelected ? BORDER_SELECTED : BORDER_DEFAULT;
                    }}
                  >
                    <span
                      className="flex-none flex items-center justify-center mt-0.5"
                      style={{ width: '16px', height: '16px' }}
                    >
                      {q.multiSelect ? (
                        <svg width="14" height="14" viewBox="0 0 14 14">
                          <rect
                            x="1" y="1" width="12" height="12" rx="2"
                            fill={isSelected ? 'rgba(100, 160, 255, 0.8)' : 'none'}
                            stroke={isSelected ? 'rgba(100, 160, 255, 0.8)' : 'rgba(255, 255, 255, 0.35)'}
                            strokeWidth="1.5"
                          />
                          {isSelected && (
                            <path d="M4 7.5L6 9.5L10 4.5" stroke="var(--term-bg)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                          )}
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 14 14">
                          <circle
                            cx="7" cy="7" r="5.5"
                            fill="none"
                            stroke={isSelected ? 'rgba(100, 160, 255, 0.8)' : 'rgba(255, 255, 255, 0.35)'}
                            strokeWidth="1.5"
                          />
                          {isSelected && (
                            <circle cx="7" cy="7" r="3" fill="rgba(100, 160, 255, 0.8)" />
                          )}
                        </svg>
                      )}
                    </span>
                    <div className="flex-1 min-w-0 leading-5">
                      <span className="text-sm" style={{ color: 'var(--term-text)' }}>
                        {opt.label}
                      </span>
                      {opt.description && (
                        <span className="text-xs ml-1.5" style={{ color: 'var(--term-text-dim)' }}>
                          — {opt.description}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}

              {/* Other — inline text input option */}
              <button
                onClick={handleOtherClick}
                className="flex items-start gap-2.5 py-2 px-2.5 rounded-md text-left transition-all cursor-pointer"
                style={{
                  border: otherActive ? BORDER_SELECTED : BORDER_DEFAULT,
                  backgroundColor: 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!otherActive) e.currentTarget.style.border = BORDER_HOVER;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.border = otherActive ? BORDER_SELECTED : BORDER_DEFAULT;
                }}
              >
                <span
                  className="flex-none flex items-center justify-center mt-0.5"
                  style={{ width: '16px', height: '16px' }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14">
                    <circle
                      cx="7" cy="7" r="5.5"
                      fill="none"
                      stroke={otherActive ? 'rgba(100, 160, 255, 0.8)' : 'rgba(255, 255, 255, 0.35)'}
                      strokeWidth="1.5"
                    />
                    {otherActive && (
                      <circle cx="7" cy="7" r="3" fill="rgba(100, 160, 255, 0.8)" />
                    )}
                  </svg>
                </span>
                <div className="flex-1 min-w-0 leading-5">
                  {otherActive ? (
                    <input
                      ref={otherInputRef}
                      type="text"
                      value={otherText}
                      onChange={(e) => setOtherText(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && otherText.trim()) {
                          e.preventDefault();
                          handleSubmit();
                        }
                      }}
                      placeholder="Type something"
                      className="w-full bg-transparent text-sm outline-none"
                      style={{ color: 'var(--term-text)' }}
                    />
                  ) : (
                    <span className="text-sm" style={{ color: 'var(--term-text-dim)' }}>
                      Type something
                    </span>
                  )}
                </div>
              </button>
            </div>
          </div>
        );
      })}

      {canSubmit && (
        <button
          onClick={handleSubmit}
          className="mt-2 ml-0.5 rounded-md px-3 py-1 text-xs font-medium transition-all"
          style={{
            border: '1px solid rgba(255, 255, 255, 0.15)',
            backgroundColor: 'transparent',
            color: 'var(--term-text)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.border = '1px solid rgba(255, 255, 255, 0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.border = '1px solid rgba(255, 255, 255, 0.15)';
          }}
        >
          Submit ↵
        </button>
      )}
    </div>
  );
}
