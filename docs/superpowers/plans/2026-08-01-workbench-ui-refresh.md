# Workbench UI Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the desktop code-analysis workbench with an integrated Windows title bar, contextual breadcrumb navigation, soft-pill action controls, and the approved black-gold / warm-gray-mineral-blue themes.

**Architecture:** Keep the Electron title-bar configuration in a pure main-process options factory so it is unit-testable without booting Electron. Add a renderer-only `AppTitleBar` that receives already-selected project/session/branch context from `CodeAnalysisWorkbench`; it owns presentation, accessibility and drag-region boundaries, while the workbench continues to own business-state transitions. Retain the existing semantic CSS tokens and change their two theme mappings before styling each component through those tokens.

**Tech Stack:** Electron 33, React 19, TypeScript strict mode, CSS Modules, Material Symbols Rounded, Vitest, Testing Library, existing ThemeContext.

---

## File structure

| File | Responsibility |
| --- | --- |
| `apps/desktop/src/main/window-options.ts` | Pure `BrowserWindow` option factory with the Windows title-bar overlay decision. |
| `apps/desktop/src/main/test/test_window-options.ts` | Unit coverage for Windows and non-Windows options. |
| `apps/desktop/src/main/index.ts` | Creates the BrowserWindow from the factory without changing IPC/bootstrap behavior. |
| `apps/desktop/src/renderer/components/common/AppTitleBar.tsx` | Brand strip and contextual breadcrumb renderer; no persistence or domain state. |
| `apps/desktop/src/renderer/components/common/AppTitleBar.module.css` | Title-bar dimensions, drag/no-drag regions, breadcrumb truncation and responsive treatment. |
| `apps/desktop/src/renderer/components/common/test/test_AppTitleBar.tsx` | Accessibility, current-item and empty-context tests for the title bar. |
| `apps/desktop/src/renderer/pages/code-analysis-i18n.ts` | Bilingual labels for new workspace/project/session/branch path segments. |
| `apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.tsx` | Maps current project/session/branch state into `AppTitleBar` and wires valid breadcrumb actions. |
| `apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.module.css` | Places the two new header rows above the existing workbench grid. |
| `apps/desktop/src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx` | Integration coverage for header context updates when selecting a project/session. |
| `apps/desktop/src/renderer/styles/globals.css` | Approved semantic token values and shared soft-pill interaction tokens. |
| `apps/desktop/src/renderer/components/code-analysis/CodeAnalysisComponents.module.css` | Applies the soft-pill hierarchy to sidebar, export, comments and menu actions. |
| `apps/desktop/src/renderer/components/code-analysis/AnalysisPromptBox.tsx` | Adds an accessible Material Symbols send glyph without changing submit semantics. |
| `apps/desktop/src/renderer/components/code-analysis/test/test_AnalysisPromptBox.tsx` | Covers keyboard submission, disabled behavior and the new accessible submit affordance. |
| `apps/desktop/src/renderer/components/common/ThemeToggle.module.css` | Aligns theme toggle target/state with the soft-pill icon-button rule. |

## Task 1: Extract testable Electron window options

**Files:**
- Create: `apps/desktop/src/main/window-options.ts`
- Create: `apps/desktop/src/main/test/test_window-options.ts`
- Modify: `apps/desktop/src/main/index.ts:1-99`

- [ ] **Step 1: Write the failing option-factory tests**

```ts
// apps/desktop/src/main/test/test_window-options.ts
import { describe, expect, it, vi } from 'vitest';
import { createMainWindowOptions } from '../window-options';

describe('createMainWindowOptions', () => {
  it('uses the approved black-gold Windows overlay', () => {
    expect(createMainWindowOptions('C:/app/preload.js', 'win32')).toMatchObject({
      width: 1400,
      height: 900,
      minWidth: 1024,
      minHeight: 768,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#10100F', symbolColor: '#F2EAD8', height: 48 },
      webPreferences: { preload: 'C:/app/preload.js', contextIsolation: true, nodeIntegration: false },
    });
  });

  it('keeps the native hidden-inset behavior outside Windows', () => {
    const options = createMainWindowOptions('/app/preload.js', 'darwin');
    expect(options.titleBarStyle).toBe('hiddenInset');
    expect(options.titleBarOverlay).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ai-reader/desktop test -- test_window-options`

Expected: FAIL because `../window-options` does not exist.

- [ ] **Step 3: Implement the pure factory and consume it from `index.ts`**

```ts
// apps/desktop/src/main/window-options.ts
import type { BrowserWindowConstructorOptions } from 'electron';

export function createMainWindowOptions(
  preload: string,
  platform: NodeJS.Platform = process.platform,
): BrowserWindowConstructorOptions {
  const options: BrowserWindowConstructorOptions = {
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false },
    show: false,
  };

  return platform === 'win32'
    ? {
        ...options,
        titleBarStyle: 'hidden',
        titleBarOverlay: { color: '#10100F', symbolColor: '#F2EAD8', height: 48 },
      }
    : { ...options, titleBarStyle: 'hiddenInset' };
}
```

Replace the inline `new BrowserWindow({...})` literal in `index.ts` with:

```ts
mainWindow = new BrowserWindow(
  createMainWindowOptions(join(__dirname, '../preload/index.js')),
);
```

Import `createMainWindowOptions` after existing internal imports. Do not change database startup, IPC registration, menu setup, or development URL loading.

- [ ] **Step 4: Run focused verification**

Run: `pnpm --filter @ai-reader/desktop test -- test_window-options`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit the isolated window configuration change**

```bash
git add apps/desktop/src/main/window-options.ts apps/desktop/src/main/test/test_window-options.ts apps/desktop/src/main/index.ts
git commit -m "feat(desktop): add Windows title bar overlay"
```

## Task 2: Create the presentational title bar with T2 and C behavior

**Files:**
- Create: `apps/desktop/src/renderer/components/common/AppTitleBar.tsx`
- Create: `apps/desktop/src/renderer/components/common/AppTitleBar.module.css`
- Create: `apps/desktop/src/renderer/components/common/test/test_AppTitleBar.tsx`

- [ ] **Step 1: Write the failing component tests**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AppTitleBar from '../AppTitleBar';

describe('AppTitleBar', () => {
  it('renders the brand, tagline and current breadcrumb as non-clickable state', () => {
    render(<AppTitleBar appName="AI 学习助手" tagline="深度学习空间" breadcrumbs={[
      { id: 'workspace', label: '学习空间' },
      { id: 'project', label: '项目：AI-Reader' },
      { id: 'session', label: '会话：新分析', current: true },
    ]} />);
    expect(screen.getByText('AI 学习助手')).toBeInTheDocument();
    expect(screen.getByText('深度学习空间')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Current context' })).toHaveTextContent('会话：新分析');
    expect(screen.queryByRole('button', { name: '会话：新分析' })).not.toBeInTheDocument();
  });

  it('omits unavailable context segments and makes navigable ancestors buttons', () => {
    const onNavigate = vi.fn();
    render(<AppTitleBar appName="AI 学习助手" tagline="深度学习空间" breadcrumbs={[
      { id: 'workspace', label: '学习空间', onNavigate },
      { id: 'session', label: '会话：草稿', current: true },
    ]} />);
    expect(screen.getByRole('button', { name: '学习空间' })).toBeInTheDocument();
    expect(screen.queryByText('项目：')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the component test to verify it fails**

Run: `pnpm --filter @ai-reader/desktop test -- test_AppTitleBar`

Expected: FAIL because `AppTitleBar` does not exist.

- [ ] **Step 3: Implement the typed title bar**

```tsx
import { Fragment } from 'react';

export interface ContextBreadcrumb {
  id: 'workspace' | 'project' | 'session' | 'branch';
  label: string;
  current?: boolean;
  onNavigate?: () => void;
}

interface AppTitleBarProps {
  appName: string;
  tagline: string;
  breadcrumbs: ContextBreadcrumb[];
}

export default function AppTitleBar({ appName, tagline, breadcrumbs }: AppTitleBarProps) {
  return (
    <header className={styles.titleBar}>
      <div className={styles.brandStrip}>
        <span className={styles.brandMark} aria-hidden="true"><span className="material-symbols-rounded">auto_stories</span></span>
        <strong>{appName}</strong><span className={styles.tagline}>{tagline}</span>
      </div>
      <nav className={styles.contextBar} aria-label="Current context">
        {breadcrumbs.map((crumb, index) => (
          <Fragment key={crumb.id}>
            {index > 0 ? <span className={styles.separator} aria-hidden="true">chevron_right</span> : null}
            {crumb.current || !crumb.onNavigate ? <span data-current={crumb.current || undefined}>{crumb.label}</span> :
              <button type="button" onClick={crumb.onNavigate}>{crumb.label}</button>}
          </Fragment>
        ))}
      </nav>
    </header>
  );
}
```

Use `-webkit-app-region: drag` on `.brandStrip`; use `-webkit-app-region: no-drag` on every breadcrumb button. The CSS module must set rows to 48px and 40px, reserve the right edge with `env(titlebar-area-width, 138px)`, truncate intermediate labels with ellipsis, and preserve a visible 2px focus ring.

- [ ] **Step 4: Run focused verification**

Run: `pnpm --filter @ai-reader/desktop test -- test_AppTitleBar`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit the isolated renderer component**

```bash
git add apps/desktop/src/renderer/components/common/AppTitleBar.tsx apps/desktop/src/renderer/components/common/AppTitleBar.module.css apps/desktop/src/renderer/components/common/test/test_AppTitleBar.tsx
git commit -m "feat(desktop): add contextual application title bar"
```

## Task 3: Localize and integrate contextual state into the workbench

**Files:**
- Modify: `apps/desktop/src/renderer/pages/code-analysis-i18n.ts`
- Modify: `apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.tsx`
- Modify: `apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.module.css`
- Modify: `apps/desktop/src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx`

- [ ] **Step 1: Extend both language records before using any new label**

Add the same fields to the `zh-CN` and `en-US` records:

```ts
appName: 'AI 学习助手',
appTagline: '深度学习空间',
contextNavigation: '当前上下文',
contextWorkspace: '学习空间',
contextProject: '项目',
contextSession: '会话',
contextBranch: '分支',
```

Use the corresponding English values `AI Learning Assistant`, `Deep learning workspace`, `Current context`, `Workspace`, `Project`, `Session`, and `Branch`.

- [ ] **Step 2: Add the failing workbench integration test**

Add a test that resolves one project and one active session, renders the workbench, selects the session, then asserts the header navigation contains the selected project name, session title and active branch name. Also assert the visible sidebar does not render a second `AI Reader` brand label.

Run: `pnpm --filter @ai-reader/desktop test -- test_CodeAnalysisWorkbench`

Expected: FAIL because the workbench has no contextual application header.

- [ ] **Step 3: Integrate `AppTitleBar` and remove duplicate sidebar brand ownership**

Build breadcrumbs with `useMemo` in `CodeAnalysisWorkbench`:

```tsx
const activeBranch = branches.find((branch) => branch.id === activeBranchId) ?? null;
const contextBreadcrumbs = useMemo(() => [
  { id: 'workspace', label: text.contextWorkspace, onNavigate: () => startSessionDraft(null) },
  ...(project ? [{ id: 'project', label: `${text.contextProject}: ${project.name}`, onNavigate: () => void selectProject(project) }] : []),
  ...(session ? [{ id: 'session', label: `${text.contextSession}: ${session.title}`, current: !activeBranchId }] : []),
  ...(activeBranch ? [{ id: 'branch', label: `${text.contextBranch}: ${activeBranch.name}`, current: true }] : []),
], [activeBranch, project, session, startSessionDraft, text]);
```

Render `AppTitleBar` as the first child of `.workbench`. Remove the `brandRow` markup from `ProjectSidebar` while leaving its project/document/session controls unchanged. Move the ThemeToggle from the side panel into the title-bar action area only if it remains outside the drag region and continues to expose its existing aria label.

Change workbench grid rows to `48px 40px minmax(0, 1fr) auto`; place both side panels in rows `3 / 5`, the center panel in row `3`, and the prompt bar in row `4`. Update the two responsive media queries to preserve the same header rows before their existing one-column stacking behavior.

- [ ] **Step 4: Run integration verification**

Run: `pnpm --filter @ai-reader/desktop test -- test_CodeAnalysisWorkbench`

Expected: PASS with all prior session/branch/annotation tests still green.

- [ ] **Step 5: Commit in two file-limited commits**

```bash
git add apps/desktop/src/renderer/pages/code-analysis-i18n.ts
git commit -m "chore(desktop): add contextual navigation labels"

git add apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.tsx apps/desktop/src/renderer/pages/CodeAnalysisWorkbench.module.css apps/desktop/src/renderer/pages/test/test_CodeAnalysisWorkbench.tsx
git commit -m "feat(desktop): show workbench context navigation"
```

## Task 4: Apply the approved soft-pill action system

**Files:**
- Modify: `apps/desktop/src/renderer/components/code-analysis/AnalysisPromptBox.tsx`
- Modify: `apps/desktop/src/renderer/components/code-analysis/CodeAnalysisComponents.module.css`
- Create: `apps/desktop/src/renderer/components/code-analysis/test/test_AnalysisPromptBox.tsx`
- Modify: `apps/desktop/src/renderer/components/common/ThemeToggle.module.css`

- [ ] **Step 1: Write the failing prompt-box behavior test**

```tsx
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

it('keeps the submit control labelled, disabled for blank input, and keyboard-submittable', async () => {
  const onSubmit = vi.fn();
  const user = userEvent.setup();
  function PromptHarness() {
    const [value, setValue] = useState('');
    return <AnalysisPromptBox value={value} disabled={false} labels={{ ariaLabel: 'Goal', placeholder: 'Ask', submit: 'Run' }} onChange={setValue} onSubmit={onSubmit} />;
  }
  render(<PromptHarness />);
  expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  await user.type(screen.getByRole('textbox', { name: 'Goal' }), 'Inspect this file');
  await user.keyboard('{Control>}{Enter}{/Control}');
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(screen.getByText('arrow_upward', { selector: '.material-symbols-rounded' })).toBeInTheDocument();
});
```

Run: `pnpm --filter @ai-reader/desktop test -- test_AnalysisPromptBox`

Expected: FAIL because the test file and send glyph do not exist.

- [ ] **Step 2: Implement the accessible send affordance and soft-pill CSS**

Keep the existing submit label as the accessible button name and add the glyph with `aria-hidden="true"`:

```tsx
<button type="button" onClick={onSubmit} disabled={disabled || !value.trim()}>
  <span>{text.submit}</span>
  <span className="material-symbols-rounded" aria-hidden="true">arrow_upward</span>
</button>
```

In `CodeAnalysisComponents.module.css`, use token-only styles for all button families:

```css
--control-height: 36px;
--control-radius: var(--md-sys-shape-corner-full);
min-height: var(--control-height);
border-radius: var(--control-radius);
transition: background-color 160ms var(--md-sys-motion-easing-standard), color 160ms var(--md-sys-motion-easing-standard), box-shadow 160ms var(--md-sys-motion-easing-standard);
```

Apply this to `.primaryAction`, `.exportMenu button`, `.commentFooter button`, `.branchForkButton`, menu actions and session controls. Preserve danger actions as semantic error tokens. Apply the same 36px circular target, focus ring and hover state to `.toggle`; do not change its theme-switching TypeScript.

- [ ] **Step 3: Run focused verification**

Run: `pnpm --filter @ai-reader/desktop test -- test_AnalysisPromptBox test_ThemeToggle`

Expected: PASS; blank and externally disabled prompts remain non-submittable.

- [ ] **Step 4: Commit in file-limited commits**

```bash
git add apps/desktop/src/renderer/components/code-analysis/AnalysisPromptBox.tsx apps/desktop/src/renderer/components/code-analysis/test/test_AnalysisPromptBox.tsx apps/desktop/src/renderer/components/code-analysis/CodeAnalysisComponents.module.css
git commit -m "feat(desktop): standardize soft-pill analysis actions"

git add apps/desktop/src/renderer/components/common/ThemeToggle.module.css
git commit -m "style(desktop): align theme toggle with action controls"
```

## Task 5: Replace both theme token maps and verify theme behavior

**Files:**
- Modify: `apps/desktop/src/renderer/styles/globals.css`
- Modify: `apps/desktop/src/renderer/contexts/test/test_ThemeContext.tsx`
- Modify: `apps/desktop/src/renderer/components/common/test/test_ThemeToggle.tsx`

- [ ] **Step 1: Add failing theme assertions**

Add assertions that a rendered ThemeProvider still sets `data-theme="white"` after restoring the saved value and `data-theme="black-gold"` after toggling back. Retain the existing invalid-storage and storage-failure cases.

Run: `pnpm --filter @ai-reader/desktop test -- test_ThemeContext test_ThemeToggle`

Expected: PASS initially for behavior; record this baseline before replacing styles because the theme names and persistence contract must not change.

- [ ] **Step 2: Replace only the semantic value mappings in `globals.css`**

Set the approved values while retaining all existing token names consumed by component CSS:

```css
:root, [data-theme='white'] {
  --md-sys-color-primary: #285f8f;
  --md-sys-color-on-primary: #ffffff;
  --md-sys-color-surface: #f2f1ed;
  --md-sys-color-surface-container-lowest: #fbfaf7;
  --md-sys-color-surface-container: #e9e9e4;
  --md-sys-color-on-surface: #202523;
  --md-sys-color-on-surface-variant: #68716f;
  --md-sys-color-outline-variant: #deded7;
  --md-sys-color-accent-soft: rgba(40, 95, 143, 0.10);
}

[data-theme='black-gold'] {
  --md-sys-color-primary: #d4af4f;
  --md-sys-color-on-primary: #241d0d;
  --md-sys-color-surface: #080808;
  --md-sys-color-surface-container-lowest: #10100f;
  --md-sys-color-surface-container: #171510;
  --md-sys-color-on-surface: #f2ead8;
  --md-sys-color-on-surface-variant: #a69b89;
  --md-sys-color-outline-variant: #332b1c;
  --md-sys-color-accent-soft: rgba(212, 175, 79, 0.12);
}
```

Update the remaining primary-container, outline, mark, code, user-bubble and elevation tokens so they derive from the same approved tonal families. Do not rename `white` or `black-gold`, change localStorage keys, or add raw hex colors to component CSS.

- [ ] **Step 3: Run behavior and type verification**

Run: `pnpm --filter @ai-reader/desktop test -- test_ThemeContext test_ThemeToggle && pnpm --filter @ai-reader/desktop type-check`

Expected: PASS; existing localStorage behavior and typed imports remain unchanged.

- [ ] **Step 4: Commit the token-only theme refresh**

```bash
git add apps/desktop/src/renderer/styles/globals.css apps/desktop/src/renderer/contexts/test/test_ThemeContext.tsx apps/desktop/src/renderer/components/common/test/test_ThemeToggle.tsx
git commit -m "style(desktop): refine black-gold and mineral-blue themes"
```

## Task 6: Run end-to-end regression and visual acceptance

**Files:**
- Modify only if an actual regression is found: the smallest owning source file and its colocated test file.

- [ ] **Step 1: Run the complete desktop unit suite with coverage**

Run: `pnpm --filter @ai-reader/desktop test -- --coverage`

Expected: PASS with coverage output; investigate and repair any uncovered new TypeScript branches before marking the work complete.

- [ ] **Step 2: Run workspace regression checks**

Run: `pnpm test && pnpm --filter @ai-reader/desktop type-check`

Expected: PASS for all packages and TypeScript compilation.

- [ ] **Step 3: Perform visual acceptance in both stored themes**

Run: `pnpm --filter @ai-reader/desktop dev`

Check, at 1400×900 and 1024×768:

1. Windows title bar has the 48px branded strip and native controls remain clickable.
2. Every title-bar button and breadcrumb ancestor can be clicked despite the drag region.
3. Context paths omit unavailable project/session/branch data and retain the current label when narrow.
4. Light mode uses warm-gray surfaces and mineral-blue primary actions with no large pure-white canvas.
5. Dark mode uses `#080808` base surfaces and gold only for brand/current/primary focus.
6. Soft-pill controls have visible keyboard focus, non-shifting hover/pressed states, and clear disabled states.

- [ ] **Step 4: Commit only a verified regression fix, if needed**

```bash
git add <one-owner-source-file> <its-colocated-test-file>
git commit -m "fix(desktop): correct verified workbench UI regression"
```

Do not create this commit when all acceptance checks pass without a regression.

## Plan self-review

- **Spec coverage:** Tasks 1–3 implement the T2 title bar and C context navigation; Task 4 implements the approved soft-pill actions; Task 5 implements both approved theme maps; Task 6 validates accessibility, native controls and all existing workbench behavior.
- **No-placeholder scan:** All implementation files, test behavior, commands, option values and commit scopes are specified. The conditional Task 6 commit is intentionally constrained to a discovered regression and is not an implementation placeholder.
- **Type consistency:** `ContextBreadcrumb` is the only new renderer context type; `createMainWindowOptions` is the only new main-process factory and receives an explicit preload string plus platform argument.
