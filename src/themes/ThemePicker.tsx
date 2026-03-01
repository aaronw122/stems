import type { ThemeId } from './types.ts';
import { themes } from './themes.ts';

const THEME_ORDER: ThemeId[] = [
  'dark',
  'light',
  'dark-daltonized',
  'light-daltonized',
  'dark-ansi',
  'light-ansi',
];

interface ThemePickerProps {
  currentThemeId: ThemeId;
  onSelect: (id: ThemeId) => void;
  onDismiss: () => void;
}

/**
 * Color swatch showing 5 key colors from a theme.
 * Gives users a quick visual preview before selecting.
 */
function ThemeSwatch({ themeId }: { themeId: ThemeId }) {
  const t = themes[themeId].tokens;
  const colors = [
    t['--term-bg'],
    t['--term-text'],
    t['--term-user-border'],    // claude color
    t['--term-tool-success'],
    t['--term-tool-error'],
  ];

  return (
    <div className="flex gap-1">
      {colors.map((color, i) => (
        <div
          key={i}
          className="h-4 w-4 rounded-sm border border-zinc-600"
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

export function ThemePicker({ currentThemeId, onSelect, onDismiss }: ThemePickerProps) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[480px] rounded-lg border border-zinc-700 bg-zinc-800 p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-100">Choose Terminal Theme</h2>
          <button
            onClick={onDismiss}
            className="rounded-md p-1 text-zinc-400 hover:text-zinc-200 transition-colors"
            aria-label="Dismiss theme picker"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M5 5l8 8M13 5l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <p className="mb-5 text-sm text-zinc-400">
          Select a terminal color scheme. You can change this later.
        </p>

        {/* Theme cards — 2 columns */}
        <div className="grid grid-cols-2 gap-3">
          {THEME_ORDER.map((id) => {
            const preset = themes[id];
            const isSelected = id === currentThemeId;

            return (
              <button
                key={id}
                onClick={() => onSelect(id)}
                className={`flex flex-col gap-2 rounded-md border p-3 text-left transition-colors ${
                  isSelected
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-zinc-600 bg-zinc-900 hover:border-zinc-400'
                }`}
              >
                <span className="text-sm font-medium text-zinc-100">{preset.name}</span>
                <ThemeSwatch themeId={id} />
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-5 flex justify-end">
          <button
            onClick={onDismiss}
            className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Keep default
          </button>
        </div>
      </div>
    </div>
  );
}
