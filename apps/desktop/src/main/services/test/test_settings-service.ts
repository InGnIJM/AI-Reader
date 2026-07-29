import type { DatabaseClient } from '../../db/client';
import { describe, expect, it } from 'vitest';

import { SettingsService } from '../settings-service';

function createSettingsDb(initialValue?: string): DatabaseClient {
  let value = initialValue;
  return {
    db: {
      prepare(sql: string) {
        return {
          get() {
            return value === undefined ? undefined : { value };
          },
          run(_key: string, nextValue: string) {
            if (sql.includes('INSERT INTO app_settings')) value = nextValue;
            return {};
          },
        };
      },
    },
  } as unknown as DatabaseClient;
}

describe('SettingsService', () => {
  it('defaults to Simplified Chinese when no language was saved', () => {
    expect(new SettingsService(createSettingsDb()).getLanguage()).toBe('zh-CN');
  });

  it('reads and updates a supported language', () => {
    const service = new SettingsService(createSettingsDb('en-US'));

    expect(service.getLanguage()).toBe('en-US');
    expect(service.setLanguage('zh-CN')).toBe('zh-CN');
    expect(service.getLanguage()).toBe('zh-CN');
  });

  it('ignores an invalid stored value and rejects invalid updates', () => {
    const service = new SettingsService(createSettingsDb('fr-FR'));

    expect(service.getLanguage()).toBe('zh-CN');
    expect(() => service.setLanguage('fr-FR' as 'zh-CN')).toThrow('Unsupported language');
  });
});
