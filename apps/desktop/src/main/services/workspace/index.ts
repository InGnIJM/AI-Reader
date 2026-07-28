import type { DatabaseClient } from '../../db/client';
import { createLogger } from '@ai-reader/shared';
import { randomUUID } from 'crypto';

const log = createLogger('workspace');

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export class WorkspaceService {
  constructor(private db: DatabaseClient) {}

  async create(name: string, description?: string): Promise<Workspace> {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.db
      .prepare(
        'INSERT INTO workspaces (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, name, description || null, now, now);

    log.info(`Workspace created: ${id} - ${name}`);
    return { id, name, description, createdAt: now, updatedAt: now };
  }

  async list(): Promise<Workspace[]> {
    return this.db.db
      .prepare('SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt FROM workspaces ORDER BY created_at DESC')
      .all() as Workspace[];
  }

  async getById(id: string): Promise<Workspace | null> {
    return (
      (this.db.db
        .prepare('SELECT id, name, description, created_at AS createdAt, updated_at AS updatedAt FROM workspaces WHERE id = ?')
        .get(id) as Workspace) || null
    );
  }
}
