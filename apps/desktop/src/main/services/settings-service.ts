import type { AppLanguage } from '@ai-reader/shared';

import type { DatabaseClient } from '../db/client';

const LANGUAGE_KEY = 'app.language';
const DEFAULT_LANGUAGE: AppLanguage = 'zh-CN';

function isAppLanguage(value: unknown): value is AppLanguage {
  return value === 'zh-CN' || value === 'en-US';
}

export class SettingsService {
  constructor(private readonly db: DatabaseClient) {}

  getLanguage(): AppLanguage {
    const row = this.db.db
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .get(LANGUAGE_KEY) as { value: string } | undefined;
    return isAppLanguage(row?.value) ? row.value : DEFAULT_LANGUAGE;
  }

  setLanguage(language: AppLanguage): AppLanguage {
    if (!isAppLanguage(language)) {
      throw new Error(`Unsupported language: ${String(language)}`);
    }

    this.db.db
      .prepare(
        `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `,
      )
      .run(LANGUAGE_KEY, language, new Date().toISOString());
    return language;
  }
}
