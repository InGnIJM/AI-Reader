import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseClient } from '../../../db/client';
import { AnalysisBranchService } from '../branch-service';

describe('AnalysisBranchService', () => {
  let db: DatabaseClient;
  let service: AnalysisBranchService;

  beforeEach(() => {
    db = createDatabase(':memory:');
    service = new AnalysisBranchService(db);

    // Seed: session + main branch with 2 turns + forked branch
    // Insert order matters due to triggers: session (no pointers) -> branches -> documents -> update pointers
    const now = new Date().toISOString();
    db.db.exec(`
      INSERT INTO code_projects (id, name, root_path, root_path_hash, created_at, updated_at)
      VALUES ('project-1', 'Test', '/test', 'hash', '${now}', '${now}');

      INSERT INTO analysis_sessions (id, project_id, title, status, created_at, updated_at)
      VALUES ('session-1', 'project-1', 'Test Session', 'active', '${now}', '${now}');

      INSERT INTO analysis_branches (id, session_id, name, created_at, updated_at)
      VALUES ('branch-main', 'session-1', '主分支', '${now}', '${now}');

      INSERT INTO analysis_documents (id, session_id, branch_id, goal, content_markdown, status, tool_call_count, created_at, updated_at)
      VALUES ('turn-1', 'session-1', 'branch-main', 'First question', '# First answer', 'completed', 0, '${now}', '${now}');

      INSERT INTO analysis_documents (id, session_id, branch_id, parent_document_id, goal, content_markdown, status, tool_call_count, created_at, updated_at)
      VALUES ('turn-2', 'session-1', 'branch-main', 'turn-1', 'Second question', '# Second answer', 'completed', 0, '${now}', '${now}');

      UPDATE analysis_branches SET head_document_id = 'turn-2' WHERE id = 'branch-main';

      INSERT INTO analysis_branches (id, session_id, name, parent_branch_id, forked_from_document_id, created_at, updated_at)
      VALUES ('branch-fork', 'session-1', '分支 2', 'branch-main', 'turn-1', '${now}', '${now}');

      INSERT INTO analysis_documents (id, session_id, branch_id, parent_document_id, goal, content_markdown, status, tool_call_count, created_at, updated_at)
      VALUES ('turn-fork', 'session-1', 'branch-fork', 'turn-1', 'Fork question', '# Fork answer', 'completed', 0, '${now}', '${now}');

      UPDATE analysis_branches SET head_document_id = 'turn-fork' WHERE id = 'branch-fork';

      UPDATE analysis_sessions SET active_branch_id = 'branch-main', active_document_id = 'turn-2' WHERE id = 'session-1';
    `);
  });

  afterEach(() => {
    db.close();
  });

  describe('list', () => {
    it('returns branches for a session ordered by created_at', async () => {
      const branches = await service.list('session-1');
      expect(branches).toHaveLength(2);
      expect(branches[0].name).toBe('主分支');
      expect(branches[1].name).toBe('分支 2');
    });
  });

  describe('resolvePath', () => {
    it('returns root-to-head turn IDs for main branch', async () => {
      const path = await service.resolvePath('session-1', 'branch-main');
      expect(path.map((t) => t.id)).toEqual(['turn-1', 'turn-2']);
    });

    it('returns root-to-head for forked branch with shared ancestor', async () => {
      const path = await service.resolvePath('session-1', 'branch-fork');
      expect(path.map((t) => t.id)).toEqual(['turn-1', 'turn-fork']);
    });

    it('returns empty array for branch with no head', async () => {
      const now = new Date().toISOString();
      db.db.prepare(
        "INSERT INTO analysis_branches (id, session_id, name, created_at, updated_at) VALUES ('branch-empty', 'session-1', 'Empty', ?, ?)"
      ).run(now, now);

      const path = await service.resolvePath('session-1', 'branch-empty');
      expect(path).toEqual([]);
    });
  });

  describe('checkout', () => {
    it('changes session active pointers', async () => {
      await service.checkout({
        sessionId: 'session-1',
        branchId: 'branch-main',
        documentId: 'turn-1',
      });

      const session = db.db.prepare(
        'SELECT active_branch_id, active_document_id FROM analysis_sessions WHERE id = ?'
      ).get('session-1') as { active_branch_id: string; active_document_id: string };

      expect(session.active_branch_id).toBe('branch-main');
      expect(session.active_document_id).toBe('turn-1');
    });

    it('rejects document not in branch path', async () => {
      await expect(
        service.checkout({
          sessionId: 'session-1',
          branchId: 'branch-main',
          documentId: 'turn-fork', // belongs to branch-fork, not branch-main
        })
      ).rejects.toThrow('not in the requested branch path');
    });

    it('rejects cross-session document', async () => {
      const now = new Date().toISOString();
      db.db.exec(`
        INSERT INTO analysis_sessions (id, title, status, created_at, updated_at)
        VALUES ('session-2', 'Other', 'active', '${now}', '${now}');
        INSERT INTO analysis_branches (id, session_id, name, head_document_id, created_at, updated_at)
        VALUES ('branch-other', 'session-2', 'Main', NULL, '${now}', '${now}');
        INSERT INTO analysis_documents (id, session_id, branch_id, goal, content_markdown, status, tool_call_count, created_at, updated_at)
        VALUES ('turn-other', 'session-2', 'branch-other', 'Q', 'A', 'completed', 0, '${now}', '${now}');
      `);

      await expect(
        service.checkout({
          sessionId: 'session-1',
          branchId: 'branch-main',
          documentId: 'turn-other',
        })
      ).rejects.toThrow();
    });
  });

  describe('switchBranch', () => {
    it('updates session active_branch_id to branch head', async () => {
      await service.switchBranch({
        sessionId: 'session-1',
        branchId: 'branch-fork',
      });

      const session = db.db.prepare(
        'SELECT active_branch_id, active_document_id FROM analysis_sessions WHERE id = ?'
      ).get('session-1') as { active_branch_id: string; active_document_id: string };

      expect(session.active_branch_id).toBe('branch-fork');
      expect(session.active_document_id).toBe('turn-fork');
    });

    it('rejects cross-session branch', async () => {
      const now = new Date().toISOString();
      db.db.exec(`
        INSERT INTO analysis_sessions (id, title, status, created_at, updated_at)
        VALUES ('session-2', 'Other', 'active', '${now}', '${now}');
        INSERT INTO analysis_branches (id, session_id, name, created_at, updated_at)
        VALUES ('branch-other', 'session-2', 'Main', '${now}', '${now}');
      `);

      await expect(
        service.switchBranch({
          sessionId: 'session-1',
          branchId: 'branch-other',
        })
      ).rejects.toThrow();
    });
  });

  describe('rename', () => {
    it('updates branch name', async () => {
      const branch = await service.rename('session-1', 'branch-main', 'New Name');
      expect(branch.name).toBe('New Name');
    });

    it('rejects empty name', async () => {
      await expect(
        service.rename('session-1', 'branch-main', '')
      ).rejects.toThrow();
    });

    it('rejects name over 80 chars', async () => {
      await expect(
        service.rename('session-1', 'branch-main', 'a'.repeat(81))
      ).rejects.toThrow();
    });
  });

  describe('decideWrite', () => {
    it('returns append when parent is branch head', async () => {
      const result = await service.decideWrite('session-1', 'turn-2');
      expect(result.action).toBe('append');
      expect(result.branchId).toBe('branch-main');
    });

    it('returns fork when parent is not branch head', async () => {
      const result = await service.decideWrite('session-1', 'turn-1');
      expect(result.action).toBe('fork');
    });

    it('returns fork when forceFork=true even if parent is head', async () => {
      const result = await service.decideWrite('session-1', 'turn-2', true);
      expect(result.action).toBe('fork');
    });
  });
});
