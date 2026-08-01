import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { ThemeProvider, useTheme } from '../ThemeContext';

function ThemeProbe() {
  const { theme, setTheme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme-value">{theme}</span>
      <button type="button" onClick={toggleTheme}>
        toggle
      </button>
      <button type="button" onClick={() => setTheme('white')}>
        set-white
      </button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  (window as any).api = {
    system: {
      setTitleBarOverlay: vi.fn(async () => undefined),
    },
  };
});

afterEach(() => {
  cleanup();
});

describe('ThemeContext', () => {
  it('defaults to black-gold when nothing is stored', () => {
    renderWithProvider();
    expect(screen.getByTestId('theme-value')).toHaveTextContent('black-gold');
    expect(document.documentElement.dataset.theme).toBe('black-gold');
    expect(window.api.system.setTitleBarOverlay).toHaveBeenCalledWith('black-gold');
  });

  it('restores the persisted white theme from localStorage', () => {
    window.localStorage.setItem('ai-reader-theme', 'white');
    renderWithProvider();
    expect(screen.getByTestId('theme-value')).toHaveTextContent('white');
    expect(document.documentElement.dataset.theme).toBe('white');
  });

  it('ignores invalid persisted values and falls back to black-gold', () => {
    window.localStorage.setItem('ai-reader-theme', 'neon-pink');
    renderWithProvider();
    expect(screen.getByTestId('theme-value')).toHaveTextContent('black-gold');
  });

  it('toggleTheme flips theme, updates document attribute and persists', () => {
    renderWithProvider();
    fireEvent.click(screen.getByText('toggle'));
    expect(screen.getByTestId('theme-value')).toHaveTextContent('white');
    expect(document.documentElement.dataset.theme).toBe('white');
    expect(window.localStorage.getItem('ai-reader-theme')).toBe('white');

    fireEvent.click(screen.getByText('toggle'));
    expect(screen.getByTestId('theme-value')).toHaveTextContent('black-gold');
    expect(document.documentElement.dataset.theme).toBe('black-gold');
    expect(window.localStorage.getItem('ai-reader-theme')).toBe('black-gold');
  });

  it('setTheme applies an explicit theme', () => {
    renderWithProvider();
    fireEvent.click(screen.getByText('set-white'));
    expect(screen.getByTestId('theme-value')).toHaveTextContent('white');
    expect(window.localStorage.getItem('ai-reader-theme')).toBe('white');
  });

  it('useTheme throws when used outside ThemeProvider', () => {
    // React 会将抛出的错误包装后抛出，这里只断言渲染失败
    expect(() => render(<ThemeProbe />)).toThrow();
  });

  it('falls back to default and keeps working when localStorage is unavailable', () => {
    const getSpy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('denied');
      });
    const setSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('denied');
      });

    renderWithProvider();
    expect(screen.getByTestId('theme-value')).toHaveTextContent('black-gold');

    // 持久化失败不影响切换
    fireEvent.click(screen.getByText('toggle'));
    expect(screen.getByTestId('theme-value')).toHaveTextContent('white');
    expect(document.documentElement.dataset.theme).toBe('white');

    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});
