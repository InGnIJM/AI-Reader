/**
 * E2E tests for the full analysis workflow through Electron IPC.
 *
 * Covers: session creation, multi-turn conversation, branch forking,
 * branch switching, annotation creation, AI reply, and JSON export.
 *
 * Prerequisites: the Electron app must be built (`pnpm build`) before running.
 * A mock LLM server replaces the real LLM so tests are deterministic and offline.
 */

import { test, expect, _electron as electron } from '@playwright/test';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { mkdtempSync, realpathSync, rmSync } from 'fs';
import { MockLLMServer, MOCK_LLM_CONTENT } from './support/mock-llm-server';

let mockServer: MockLLMServer;
let userDataDir: string;

test.beforeAll(async () => {
  mockServer = new MockLLMServer();
  await mockServer.start();
});

test.afterAll(async () => {
  await mockServer.stop();
});

test.beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'ai-reader-e2e-'));
  mockServer.requests.length = 0;
});

test.afterEach(() => {
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch {
    // Cleanup failures are non-fatal.
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RunTurnResult {
  session: { id: string; title: string; activeBranchId: string; activeDocumentId: string };
  branch: { id: string; name: string; headDocumentId: string };
  turn: { id: string; goal: string; contentMarkdown: string; status: string; branchId: string };
}

interface AnnotationData {
  id: string;
  analysisDocumentId: string;
  anchorExactText: string;
  question: string;
  status: string;
}

interface SessionDetail {
  session: { id: string; activeBranchId: string; activeDocumentId: string };
  branches: Array<{ id: string; name: string; headDocumentId: string; parentBranchId?: string }>;
  turns: Array<{ id: string; branchId: string; goal: string; contentMarkdown: string }>;
}

async function runTurn(
  page: any,
  payload: {
    sessionId?: string;
    projectId?: string | null;
    parentDocumentId?: string;
    goal: string;
    forceFork?: boolean;
  },
): Promise<RunTurnResult> {
  return page.evaluate(
    (p: typeof payload) => (window as any).api.codeAnalysis.runTurn(p),
    payload,
  );
}

async function getSession(page: any, sessionId: string): Promise<SessionDetail | null> {
  return page.evaluate(
    (id: string) => (window as any).api.codeAnalysis.getSession(id),
    sessionId,
  );
}

async function listBranches(page: any, sessionId: string) {
  return page.evaluate(
    (id: string) => (window as any).api.codeAnalysis.listBranches(id),
    sessionId,
  );
}

async function switchBranch(page: any, sessionId: string, branchId: string) {
  return page.evaluate(
    (p: { sessionId: string; branchId: string }) =>
      (window as any).api.codeAnalysis.switchBranch(p),
    { sessionId, branchId },
  );
}

async function checkoutTurn(
  page: any,
  sessionId: string,
  branchId: string,
  documentId: string,
) {
  return page.evaluate(
    (p: { sessionId: string; branchId: string; documentId: string }) =>
      (window as any).api.codeAnalysis.checkoutTurn(p),
    { sessionId, branchId, documentId },
  );
}

async function createAnnotation(
  page: any,
  payload: {
    analysisDocumentId: string;
    selectedText: string;
    question: string;
  },
): Promise<AnnotationData> {
  return page.evaluate(
    (p: typeof payload) => (window as any).api.codeAnalysis.createAnnotation(p),
    payload,
  );
}

async function listAnnotations(page: any, documentId: string): Promise<AnnotationData[]> {
  return page.evaluate(
    (id: string) => (window as any).api.codeAnalysis.listAnnotations(id),
    documentId,
  );
}

async function replyToAnnotation(page: any, annotationId: string) {
  return page.evaluate(
    (id: string) => (window as any).api.codeAnalysis.replyToAnnotation(id),
    annotationId,
  );
}

async function exportJson(page: any, documentId: string) {
  return page.evaluate(
    async (id: string) => {
      const artifact = await (window as any).api.codeAnalysis.exportDocument(id, 'json');
      return JSON.parse(artifact.content);
    },
    documentId,
  );
}

async function exportMarkdown(page: any, documentId: string): Promise<string> {
  return page.evaluate(
    async (id: string) => {
      const artifact = await (window as any).api.codeAnalysis.exportDocument(id, 'markdown');
      return artifact.content;
    },
    documentId,
  );
}

/** Launch the Electron app pointing at the mock LLM server. */
async function launchApp() {
  return electron.launch({
    args: [process.cwd(), `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      LLM_API_KEY: 'test-e2e-key',
      LLM_BASE_URL: mockServer.baseUrl,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('E2E: Session -> Branch -> Annotation -> Export', () => {
  test('should isolate Electron user data in the per-test temporary directory', async () => {
    const app = await launchApp();

    try {
      const actualUserDataDir = await app.evaluate(({ app: electronApp }) =>
        electronApp.getPath('userData'),
      );
      expect(realpathSync.native(resolve(actualUserDataDir))).toBe(
        realpathSync.native(resolve(userDataDir)),
      );
    } finally {
      await app.close();
    }
  });

  test('should keep project folders visible when recent sessions overflow', async () => {
    const app = await launchApp();
    const page = await app.firstWindow();

    try {
      await app.evaluate(
        ({ BrowserWindow, dialog }, selectedPath) => {
          BrowserWindow.getAllWindows()[0]?.setSize(1000, 600);
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [selectedPath],
          });
        },
        userDataDir,
      );

      const selectedDirectory = await page.evaluate(() =>
        (window as any).api.dialog.openDirectory(),
      );
      const project = await page.evaluate(
        (rootPath: string) => (window as any).api.codeAnalysis.createProject(rootPath),
        selectedDirectory.filePaths[0],
      );

      for (let index = 0; index < 20; index += 1) {
        await runTurn(page, { goal: `Recent session ${index + 1}` });
      }

      await page.reload();
      await page.locator(`[data-testid="project-${project.id}"]`).waitFor();

      const layout = await page.evaluate((projectId: string) => {
        const sidebar = document.querySelector('aside');
        const projectFolder = document.querySelector(`[data-testid="project-${projectId}"]`);
        const projectSection = projectFolder?.closest('section');
        const recentSection = Array.from(sidebar?.querySelectorAll('section') ?? []).find(
          (section) => section !== projectSection,
        );
        const recentList = recentSection?.querySelector('div');
        if (!sidebar || !recentList || !recentSection || !projectFolder || !projectSection) {
          throw new Error('Sidebar layout elements were not rendered');
        }

        const sidebarRect = sidebar.getBoundingClientRect();
        const projectRect = projectFolder.getBoundingClientRect();
        const projectSectionRect = projectSection.getBoundingClientRect();
        const recentSectionRect = recentSection.getBoundingClientRect();
        return {
          recentClientHeight: recentList.clientHeight,
          recentScrollHeight: recentList.scrollHeight,
          sidebarTop: sidebarRect.top,
          sidebarBottom: sidebarRect.bottom,
          projectTop: projectRect.top,
          projectBottom: projectRect.bottom,
          projectSectionTop: projectSectionRect.top,
          recentSectionTop: recentSectionRect.top,
        };
      }, project.id);

      expect(layout.recentScrollHeight).toBeGreaterThan(layout.recentClientHeight);
      expect(layout.projectTop).toBeGreaterThanOrEqual(layout.sidebarTop);
      expect(layout.projectBottom).toBeLessThanOrEqual(layout.sidebarBottom);
      expect(layout.projectSectionTop).toBeLessThan(layout.recentSectionTop);
    } finally {
      await app.close();
    }
  });

  test('should manage a session through rename, archive, restore, and delete UI', async () => {
    const app = await launchApp();
    const page = await app.firstWindow();

    try {
      // The app defaults to zh-CN on a fresh profile; pin English so the
      // accessible-name assertions below are language-deterministic.
      await page.evaluate(() => (window as any).api.settings.setLanguage('en-US'));
      await page.reload();

      const created = await runTurn(page, { goal: 'Session management flow' });
      await page.reload();

      await page
        .getByRole('button', { name: 'Manage session: Session management flow' })
        .click();
      await page.getByRole('menuitem', { name: 'Rename' }).click();
      const titleInput = page.getByRole('textbox', { name: 'Session title' });
      await titleInput.fill('Managed session');
      await titleInput.press('Enter');
      await expect(page.getByRole('button', { name: 'Managed session', exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'Manage session: Managed session' }).click();
      await page.getByRole('menuitem', { name: 'Archive' }).click();
      await expect(page.getByRole('button', { name: 'Managed session', exact: true })).toHaveCount(0);

      await page.getByRole('button', { name: 'Archived', exact: true }).click();
      await page.getByRole('button', { name: 'No Project', exact: true }).click();
      await page.getByRole('button', { name: 'Managed session', exact: true }).click();
      await expect(
        page.getByText('Archived sessions are read-only. Restore this session to continue.'),
      ).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Analysis goal' })).toHaveCount(0);

      await page.getByRole('button', { name: 'Manage session: Managed session' }).click();
      await page.getByRole('menuitem', { name: 'Restore' }).click();
      await expect(page.getByRole('textbox', { name: 'Analysis goal' })).toBeVisible();

      await page.getByRole('button', { name: 'Manage session: Managed session' }).click();
      await page.getByRole('menuitem', { name: 'Delete' }).click();
      await page.getByRole('button', { name: 'Delete permanently' }).click();

      await expect
        .poll(() => getSession(page, created.session.id))
        .toBeNull();
      await expect(page.getByRole('button', { name: 'Managed session', exact: true })).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test('should create a session and run the first turn', async () => {
    const app = await launchApp();
    const page = await app.firstWindow();

    try {
      const result = await runTurn(page, {
        goal: 'Analyze the project structure',
      });

      expect(result.session.id).toBeTruthy();
      expect(result.session.title).toBeTruthy();
      expect(result.branch.id).toBeTruthy();
      expect(result.branch.name).toBe('主分支');
      expect(result.turn.id).toBeTruthy();
      expect(result.turn.goal).toBe('Analyze the project structure');
      expect(result.turn.status).toBe('completed');
      expect(result.turn.contentMarkdown).toContain('ML Basics');
      expect(result.turn.contentMarkdown).toContain('Machine learning');

      // The LLM should have been called once (non-streaming, since runLocalDocument uses chat())
      const chatRequests = mockServer.requests.filter(
        (r) => r.path === '/v1/chat/completions',
      );
      expect(chatRequests.length).toBeGreaterThanOrEqual(1);
    } finally {
      await app.close();
    }
  });

  test('should append a second turn to the same branch', async () => {
    const app = await launchApp();
    const page = await app.firstWindow();

    try {
      const first = await runTurn(page, { goal: 'First analysis' });
      mockServer.requests.length = 0;

      const second = await runTurn(page, {
        sessionId: first.session.id,
        goal: 'Continue the analysis',
      });

      // Same session and branch
      expect(second.session.id).toBe(first.session.id);
      expect(second.branch.id).toBe(first.branch.id);

      // New turn with different goal
      expect(second.turn.id).not.toBe(first.turn.id);
      expect(second.turn.goal).toBe('Continue the analysis');
      expect(second.turn.status).toBe('completed');

      // Branch head should now point to the second turn
      expect(second.branch.headDocumentId).toBe(second.turn.id);

      // Session should have exactly 2 turns
      const detail = await getSession(page, first.session.id);
      expect(detail).not.toBeNull();
      expect(detail!.turns).toHaveLength(2);
      expect(detail!.branches).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  test('should fork a new branch when sending from a non-head turn', async () => {
    const app = await launchApp();
    const page = await app.firstWindow();

    try {
      // Turn 1 -> Turn 2 on main branch
      const turn1 = await runTurn(page, { goal: 'Root analysis' });
      const turn2 = await runTurn(page, {
        sessionId: turn1.session.id,
        goal: 'Second perspective',
      });

      // Turn 3: fork from turn 1 (not the current head)
      const turn3 = await runTurn(page, {
        sessionId: turn1.session.id,
        parentDocumentId: turn1.turn.id,
        goal: 'Alternative approach',
      });

      // New branch should be created
      expect(turn3.branch.id).not.toBe(turn1.branch.id);
      expect(turn3.turn.branchId).toBe(turn3.branch.id);
      expect(turn3.turn.goal).toBe('Alternative approach');

      // Session should now have 2 branches and 3 turns
      const detail = await getSession(page, turn1.session.id);
      expect(detail).not.toBeNull();
      expect(detail!.branches).toHaveLength(2);
      expect(detail!.turns).toHaveLength(3);

      // The new branch's parent should be the main branch
      const newBranch = detail!.branches.find((b) => b.id === turn3.branch.id);
      expect(newBranch).toBeDefined();
      expect(newBranch!.parentBranchId).toBe(turn1.branch.id);
    } finally {
      await app.close();
    }
  });

  test('should switch between branches', async () => {
    const app = await launchApp();
    const page = await app.firstWindow();

    try {
      // Create a session with two branches
      const turn1 = await runTurn(page, { goal: 'Main branch root' });
      const turn2 = await runTurn(page, {
        sessionId: turn1.session.id,
        goal: 'Main branch continuation',
      });
      const turn3 = await runTurn(page, {
        sessionId: turn1.session.id,
        parentDocumentId: turn1.turn.id,
        goal: 'Fork branch content',
      });

      // Active branch should be the fork (last written)
      let detail = await getSession(page, turn1.session.id);
      expect(detail!.session.activeBranchId).toBe(turn3.branch.id);

      // Switch to main branch
      await switchBranch(page, turn1.session.id, turn1.branch.id);

      detail = await getSession(page, turn1.session.id);
      expect(detail!.session.activeBranchId).toBe(turn1.branch.id);
      // Active document should be the main branch head (turn2)
      expect(detail!.session.activeDocumentId).toBe(turn2.turn.id);

      // Switch back to fork branch
      await switchBranch(page, turn1.session.id, turn3.branch.id);

      detail = await getSession(page, turn1.session.id);
      expect(detail!.session.activeBranchId).toBe(turn3.branch.id);
      expect(detail!.session.activeDocumentId).toBe(turn3.turn.id);
    } finally {
      await app.close();
    }
  });

  test('should create an annotation and get an AI reply', async () => {
    const app = await launchApp();
    const page = await app.firstWindow();

    try {
      const result = await runTurn(page, { goal: 'Document for annotation' });

      // The mock LLM returns MOCK_LLM_CONTENT which contains "Machine learning"
      const annotation = await createAnnotation(page, {
        analysisDocumentId: result.turn.id,
        selectedText: 'Machine learning',
        question: 'What exactly is machine learning?',
      });

      expect(annotation.id).toBeTruthy();
      expect(annotation.analysisDocumentId).toBe(result.turn.id);
      expect(annotation.anchorExactText).toBe('Machine learning');
      expect(annotation.question).toBe('What exactly is machine learning?');
      expect(annotation.status).toBe('pending');

      // Annotation should appear in the document's list
      const annotations = await listAnnotations(page, result.turn.id);
      expect(annotations).toHaveLength(1);
      expect(annotations[0].id).toBe(annotation.id);

      // Reply to annotation -- calls LLM streaming endpoint
      mockServer.requests.length = 0;
      const messages = await replyToAnnotation(page, annotation.id);

      // Should have at least 2 messages: user question + AI reply
      expect(messages.length).toBeGreaterThanOrEqual(2);
      expect(messages[0].role).toBe('user');
      expect(messages[messages.length - 1].role).toBe('assistant');
      expect(messages[messages.length - 1].content).toBeTruthy();

      // The streaming endpoint should have been called
      const streamRequests = mockServer.requests.filter(
        (r) => r.path === '/v1/chat/completions',
      );
      expect(streamRequests.length).toBeGreaterThanOrEqual(1);
    } finally {
      await app.close();
    }
  });

  test('should export analysis as JSON', async () => {
    const app = await launchApp();
    const page = await app.firstWindow();

    try {
      const result = await runTurn(page, { goal: 'Export test analysis' });

      // Create an annotation with reply
      const annotation = await createAnnotation(page, {
        analysisDocumentId: result.turn.id,
        selectedText: 'Machine learning',
        question: 'Explain this concept',
      });
      await replyToAnnotation(page, annotation.id);

      // Export as JSON
      const exported = await exportJson(page, result.turn.id);

      expect(exported).toBeDefined();
      expect((exported as any).schemaVersion).toBe(1);
      expect((exported as any).type).toBe('code-analysis-document');
      expect((exported as any).sessionTitle).toBeTruthy();
      expect((exported as any).analysisGoal).toBe('Export test analysis');
      expect((exported as any).analysisMarkdown).toContain('ML Basics');
      expect((exported as any).modelInfo.modelId).toBe('mock-model');
      expect((exported as any).createdAt).toBeTruthy();
      expect((exported as any).exportedAt).toBeTruthy();

      // Annotations should be included
      expect((exported as any).annotations.length).toBeGreaterThanOrEqual(1);
      expect((exported as any).annotations[0].anchorExactText).toBe('Machine learning');

      // Discussion messages should be included
      expect((exported as any).discussionMessages.length).toBeGreaterThanOrEqual(1);
    } finally {
      await app.close();
    }
  });

  test('should export analysis as Markdown', async () => {
    const app = await launchApp();
    const page = await app.firstWindow();

    try {
      const result = await runTurn(page, { goal: 'Markdown export test' });

      const md = await exportMarkdown(page, result.turn.id);

      expect(md).toContain('Markdown export test');
      expect(md).toContain('ML Basics');
    } finally {
      await app.close();
    }
  });

  test('should complete the full end-to-end workflow', async () => {
    const app = await launchApp();
    const page = await app.firstWindow();

    try {
      // 1. First turn: create session
      const turn1 = await runTurn(page, {
        goal: 'Full workflow analysis',
      });
      const sessionId = turn1.session.id;
      const mainBranchId = turn1.branch.id;
      expect(turn1.turn.status).toBe('completed');

      // 2. Second turn: append to same branch
      const turn2 = await runTurn(page, {
        sessionId,
        goal: 'Deep dive into patterns',
      });
      expect(turn2.branch.id).toBe(mainBranchId);
      expect(turn2.turn.id).not.toBe(turn1.turn.id);

      // 3. Fork: send from turn 1, creating a new branch
      const turn3 = await runTurn(page, {
        sessionId,
        parentDocumentId: turn1.turn.id,
        goal: 'Alternative perspective',
      });
      const forkBranchId = turn3.branch.id;
      expect(forkBranchId).not.toBe(mainBranchId);

      // 4. Verify branch structure
      const branches = await listBranches(page, sessionId);
      expect(branches).toHaveLength(2);
      const mainBranch = branches.find((b: any) => b.id === mainBranchId);
      const forkBranch = branches.find((b: any) => b.id === forkBranchId);
      expect(mainBranch).toBeDefined();
      expect(forkBranch).toBeDefined();
      expect(forkBranch.parentBranchId).toBe(mainBranchId);

      // 5. Switch to main branch
      await switchBranch(page, sessionId, mainBranchId);
      let detail = await getSession(page, sessionId);
      expect(detail!.session.activeBranchId).toBe(mainBranchId);

      // 6. Checkout turn 1 on main branch
      await checkoutTurn(page, sessionId, mainBranchId, turn1.turn.id);
      detail = await getSession(page, sessionId);
      expect(detail!.session.activeDocumentId).toBe(turn1.turn.id);

      // 7. Create annotation on turn 1
      const annotation = await createAnnotation(page, {
        analysisDocumentId: turn1.turn.id,
        selectedText: 'Machine learning',
        question: 'What are the key concepts here?',
      });
      expect(annotation.id).toBeTruthy();

      // 8. Get AI reply
      const messages = await replyToAnnotation(page, annotation.id);
      expect(messages.length).toBeGreaterThanOrEqual(2);

      // 9. Export as JSON
      const jsonExport = await exportJson(page, turn1.turn.id);
      expect((jsonExport as any).analysisGoal).toBe('Full workflow analysis');
      expect((jsonExport as any).annotations.length).toBeGreaterThanOrEqual(1);
      expect((jsonExport as any).discussionMessages.length).toBeGreaterThanOrEqual(1);

      // 10. Export as Markdown
      const mdExport = await exportMarkdown(page, turn1.turn.id);
      expect(mdExport).toContain('Full workflow analysis');
      expect(mdExport).toContain('ML Basics');

      // 11. Verify final session state
      detail = await getSession(page, sessionId);
      expect(detail!.branches).toHaveLength(2);
      expect(detail!.turns).toHaveLength(3);
    } finally {
      await app.close();
    }
  });
});
