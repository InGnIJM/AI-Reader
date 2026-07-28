import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { createLogger } from '@ai-reader/shared';

const log = createLogger('llm:config');

export interface LLMProviderConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface LoadLLMConfigOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

function findWorkspaceEnv(startDir: string): string | null {
  let current = resolve(startDir);

  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(current, '.env');
    if (existsSync(candidate)) return candidate;

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

function parseEnvFile(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const rawValue = trimmed.slice(eqIndex + 1).trim();
    values[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }

  return values;
}

export function loadLLMConfig(options: LoadLLMConfigOptions = {}): LLMProviderConfig {
  const cwd = options.cwd ?? process.cwd();
  const runtimeEnv = options.env ?? process.env;
  const envPath = findWorkspaceEnv(cwd);
  const fileEnv = envPath ? parseEnvFile(envPath) : {};
  const mergedEnv = { ...fileEnv, ...runtimeEnv };

  const apiKey = mergedEnv.LLM_API_KEY;
  const model = mergedEnv.LLM_MODEL || 'gpt-4o-mini';
  const baseUrl = mergedEnv.LLM_BASE_URL || 'https://api.openai.com/v1';

  if (!apiKey) {
    log.warn('LLM_API_KEY not set, AI features will be unavailable');
  }

  return { apiKey: apiKey || '', model, baseUrl };
}
