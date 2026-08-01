import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import AppTitleBar from '../AppTitleBar';

describe('AppTitleBar', () => {
  it('renders its brand and current breadcrumb as non-clickable state', () => {
    render(
      <AppTitleBar
        appName="AI 学习助手"
        tagline="深度学习空间"
        navigationLabel="当前上下文"
        breadcrumbs={[
          { id: 'workspace', label: '学习空间' },
          { id: 'project', label: '项目：AI-Reader' },
          { id: 'session', label: '会话：新分析', current: true },
        ]}
      />,
    );

    expect(screen.getByText('AI 学习助手')).toBeInTheDocument();
    expect(screen.getByText('深度学习空间')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '当前上下文' })).toHaveTextContent(
      '会话：新分析',
    );
    expect(screen.queryByRole('button', { name: '会话：新分析' })).not.toBeInTheDocument();
  });

  it('makes an available ancestor navigable without rendering missing segments', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(
      <AppTitleBar
        appName="AI 学习助手"
        tagline="深度学习空间"
        navigationLabel="当前上下文"
        breadcrumbs={[
          { id: 'workspace', label: '学习空间', onNavigate },
          { id: 'session', label: '会话：草稿', current: true },
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: '学习空间' }));

    expect(onNavigate).toHaveBeenCalledOnce();
    expect(screen.queryByText('项目：')).not.toBeInTheDocument();
  });
});
