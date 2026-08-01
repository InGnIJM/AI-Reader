import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import ThemeToggle from '../ThemeToggle';
import { ThemeProvider } from '../../../contexts/ThemeContext';

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  cleanup();
});

describe('ThemeToggle', () => {
  it('offers switching to white theme while black-gold is active', () => {
    renderToggle();
    const button = screen.getByRole('button', { name: '切换到白色主题' });
    expect(button).toBeInTheDocument();
    expect(button.querySelector('.material-symbols-rounded')).toHaveTextContent(
      'light_mode',
    );
  });

  it('toggles to white theme on click and updates the offered action', () => {
    renderToggle();
    fireEvent.click(screen.getByRole('button', { name: '切换到白色主题' }));

    expect(document.documentElement.dataset.theme).toBe('white');
    const button = screen.getByRole('button', { name: '切换到黑金主题' });
    expect(button.querySelector('.material-symbols-rounded')).toHaveTextContent(
      'dark_mode',
    );
  });

  it('starts from the persisted white theme and offers black-gold', () => {
    window.localStorage.setItem('ai-reader-theme', 'white');
    renderToggle();
    expect(screen.getByRole('button', { name: '切换到黑金主题' })).toBeInTheDocument();
  });
});
