import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { ThemeId, ThemeTokens } from './types.ts';
import { themes } from './themes.ts';
import { ThemePicker } from './ThemePicker.tsx';

const STORAGE_KEY = 'stems-theme';
const CHOSEN_KEY = 'stems-theme-chosen';
const DEFAULT_THEME: ThemeId = 'dark';

interface ThemeContextValue {
  themeId: ThemeId;
  setTheme: (id: ThemeId) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  themeId: DEFAULT_THEME,
  setTheme: () => {},
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

function applyTokens(tokens: ThemeTokens): void {
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(tokens)) {
    root.style.setProperty(prop, value);
  }
}

function getInitialTheme(): ThemeId {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored in themes) {
      return stored as ThemeId;
    }
  } catch {
    // localStorage unavailable — use default
  }
  return DEFAULT_THEME;
}

function hasChosen(): boolean {
  try {
    return localStorage.getItem(CHOSEN_KEY) !== null;
  } catch {
    return true; // If localStorage is broken, skip the picker
  }
}

interface ThemeProviderProps {
  children: React.ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [themeId, setThemeId] = useState<ThemeId>(getInitialTheme);
  const [showPicker, setShowPicker] = useState(() => !hasChosen());

  // Apply CSS custom properties whenever theme changes
  useEffect(() => {
    applyTokens(themes[themeId].tokens);
  }, [themeId]);

  const setTheme = useCallback((id: ThemeId) => {
    setThemeId(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // localStorage unavailable — theme still applies for this session
    }
  }, []);

  const handlePickerSelect = useCallback(
    (id: ThemeId) => {
      setTheme(id);
      setShowPicker(false);
      try {
        localStorage.setItem(CHOSEN_KEY, '1');
      } catch {
        // localStorage unavailable
      }
    },
    [setTheme],
  );

  const handlePickerDismiss = useCallback(() => {
    setShowPicker(false);
    try {
      localStorage.setItem(CHOSEN_KEY, '1');
    } catch {
      // localStorage unavailable
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ themeId, setTheme }}>
      {children}
      {showPicker && (
        <ThemePicker
          currentThemeId={themeId}
          onSelect={handlePickerSelect}
          onDismiss={handlePickerDismiss}
        />
      )}
    </ThemeContext.Provider>
  );
}
