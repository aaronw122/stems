import type { ThemeId, ThemeTokens, ThemePreset } from './types.ts';

/**
 * Helper: convert an RGB string like "rgb(215,119,87)" to "rgba(215,119,87,0.15)"
 * for background tints.
 */
function rgbToRgba(rgb: string, alpha: number): string {
  const match = rgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) return rgb;
  return `rgba(${match[1]},${match[2]},${match[3]},${alpha})`;
}

// ── Raw Claude Code source tokens per theme ─────────────────────────

// Dark (Xo9) — 13 tokens
const darkTokens = {
  text: 'rgb(255,255,255)',
  secondaryText: 'rgb(153,153,153)',
  claude: 'rgb(215,119,87)',
  success: 'rgb(78,186,101)',
  error: 'rgb(255,107,128)',
  warning: 'rgb(255,193,7)',
  permission: 'rgb(177,185,249)',
  suggestion: 'rgb(177,185,249)',
  remember: 'rgb(177,185,249)',
  planMode: 'rgb(72,150,140)',
  autoAccept: 'rgb(175,135,255)',
  bashBorder: 'rgb(253,93,177)',
  secondaryBorder: 'rgb(136,136,136)',
};

// Light (Yo9) — 9 tokens
const lightTokens = {
  text: 'rgb(0,0,0)',
  secondaryText: 'rgb(102,102,102)',
  claude: 'rgb(215,119,87)',
  success: 'rgb(44,122,57)',
  error: 'rgb(171,43,63)',
  warning: 'rgb(150,108,30)',
  permission: 'rgb(87,105,247)',
  suggestion: 'rgb(87,105,247)',
  secondaryBorder: 'rgb(153,153,153)',
};

// Dark Daltonized (Vo9) — 8 tokens
const darkDaltonizedTokens = {
  text: 'rgb(255,255,255)',
  secondaryText: 'rgb(153,153,153)',
  claude: 'rgb(255,153,51)',
  success: 'rgb(51,153,255)',
  error: 'rgb(255,102,102)',
  warning: 'rgb(255,204,0)',
  permission: 'rgb(153,204,255)',
  suggestion: 'rgb(153,204,255)',
};

// Light Daltonized (Fo9) — 6 tokens
const lightDaltonizedTokens = {
  text: 'rgb(0,0,0)',
  secondaryText: 'rgb(102,102,102)',
  claude: 'rgb(255,153,51)',
  success: 'rgb(0,102,153)',
  error: 'rgb(204,0,0)',
  warning: 'rgb(255,153,0)',
};

// Standard ANSI 16-color approximations
const darkAnsiTokens = {
  text: 'rgb(255,255,255)',
  secondaryText: 'rgb(128,128,128)',
  claude: 'rgb(255,128,0)',       // ANSI bright red/orange
  success: 'rgb(0,255,0)',        // ANSI green
  error: 'rgb(255,0,0)',          // ANSI red
  warning: 'rgb(255,255,0)',      // ANSI yellow
  permission: 'rgb(128,128,255)', // ANSI bright blue
  suggestion: 'rgb(128,128,255)',
  bashBorder: 'rgb(255,0,255)',   // ANSI magenta
  secondaryBorder: 'rgb(128,128,128)',
};

const lightAnsiTokens = {
  text: 'rgb(0,0,0)',
  secondaryText: 'rgb(128,128,128)',
  claude: 'rgb(128,0,0)',         // ANSI dark red
  success: 'rgb(0,128,0)',        // ANSI dark green
  error: 'rgb(128,0,0)',          // ANSI dark red
  warning: 'rgb(128,128,0)',      // ANSI dark yellow
  permission: 'rgb(0,0,128)',     // ANSI dark blue
  suggestion: 'rgb(0,0,128)',
  secondaryBorder: 'rgb(128,128,128)',
};

// ── Resolve all CSS variables per theme ─────────────────────────────

type SourceTokens = {
  text: string;
  secondaryText: string;
  claude: string;
  success: string;
  error: string;
  warning: string;
  permission?: string;
  suggestion?: string;
  remember?: string;
  planMode?: string;
  autoAccept?: string;
  bashBorder?: string;
  secondaryBorder?: string;
};

function resolveTokens(
  src: SourceTokens,
  variant: 'dark' | 'light',
): ThemeTokens {
  const isDark = variant === 'dark';

  // Fallback chains (resolved at definition time)
  const thinkingIndicator = src.planMode ?? src.claude;
  const humanNeededColor = src.permission ?? src.suggestion ?? src.claude;
  const borderColor = src.secondaryBorder ?? src.secondaryText;
  const bashBorderColor = src.bashBorder ?? src.secondaryBorder ?? src.secondaryText;

  return {
    '--term-bg': isDark ? 'rgb(14,14,14)' : 'rgb(245,245,245)',
    '--term-text': src.text,
    '--term-text-dim': src.secondaryText,

    '--term-user-bg': rgbToRgba(src.claude, 0.15),
    '--term-user-text': src.text,
    '--term-user-border': src.claude,

    '--term-tool-success': src.success,
    '--term-tool-error': src.error,
    '--term-tool-name': src.secondaryText,

    '--term-thinking-indicator': thinkingIndicator,
    '--term-thinking-text': src.secondaryText,

    '--term-system-text': src.secondaryText,
    '--term-error-text': src.error,

    '--term-human-needed-bg': rgbToRgba(humanNeededColor, 0.15),
    '--term-human-needed-text': humanNeededColor,
    '--term-human-needed-border': humanNeededColor,

    '--term-input-bg': isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    '--term-input-border': borderColor,
    '--term-input-text': src.text,

    '--term-btn-bg': src.claude,
    '--term-btn-text': src.text,

    '--term-border': borderColor,
    '--term-shadow': isDark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.15)',

    '--term-bash-border': bashBorderColor,
  };
}

// ── Theme presets ───────────────────────────────────────────────────

export const themes: Record<ThemeId, ThemePreset> = {
  dark: {
    id: 'dark',
    name: 'Dark',
    tokens: resolveTokens(darkTokens, 'dark'),
  },
  light: {
    id: 'light',
    name: 'Light',
    tokens: resolveTokens(lightTokens, 'light'),
  },
  'dark-daltonized': {
    id: 'dark-daltonized',
    name: 'Dark Daltonized',
    tokens: resolveTokens(darkDaltonizedTokens, 'dark'),
  },
  'light-daltonized': {
    id: 'light-daltonized',
    name: 'Light Daltonized',
    tokens: resolveTokens(lightDaltonizedTokens, 'light'),
  },
  'dark-ansi': {
    id: 'dark-ansi',
    name: 'Dark ANSI',
    tokens: resolveTokens(darkAnsiTokens, 'dark'),
  },
  'light-ansi': {
    id: 'light-ansi',
    name: 'Light ANSI',
    tokens: resolveTokens(lightAnsiTokens, 'light'),
  },
};
