import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/** 应用主题：白色（白主蓝辅）/ 黑金（深炭黑 + 香槟金） */
export type AppTheme = 'white' | 'black-gold';

const STORAGE_KEY = 'ai-reader-theme';
const DEFAULT_THEME: AppTheme = 'black-gold';

export interface ThemeContextValue {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isAppTheme(value: string | null): value is AppTheme {
  return value === 'white' || value === 'black-gold';
}

function getInitialTheme(): AppTheme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isAppTheme(stored)) return stored;
  } catch {
    // localStorage 不可用（隐私模式等）时静默回退默认主题
  }
  return DEFAULT_THEME;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // 持久化失败不影响当前会话的主题切换
    }
  }, [theme]);

  const setTheme = useCallback((next: AppTheme) => {
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => (current === 'black-gold' ? 'white' : 'black-gold'));
  }, []);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}
