export type ThemeId =
  | 'dark'
  | 'light'
  | 'dark-daltonized'
  | 'light-daltonized'
  | 'dark-ansi'
  | 'light-ansi';

/**
 * All CSS custom property values for a terminal theme.
 * Every token must have a concrete value — no undefined allowed.
 */
export interface ThemeTokens {
  '--term-bg': string;
  '--term-text': string;
  '--term-text-dim': string;

  '--term-user-bg': string;
  '--term-user-text': string;
  '--term-user-border': string;

  '--term-tool-success': string;
  '--term-tool-error': string;
  '--term-tool-name': string;

  '--term-thinking-indicator': string;
  '--term-thinking-text': string;

  '--term-system-text': string;
  '--term-error-text': string;

  '--term-human-needed-bg': string;
  '--term-human-needed-text': string;
  '--term-human-needed-border': string;

  '--term-input-bg': string;
  '--term-input-border': string;
  '--term-input-text': string;

  '--term-btn-bg': string;
  '--term-btn-text': string;

  '--term-border': string;
  '--term-shadow': string;

  '--term-bash-border': string;
}

export interface ThemePreset {
  id: ThemeId;
  name: string;
  tokens: ThemeTokens;
}
