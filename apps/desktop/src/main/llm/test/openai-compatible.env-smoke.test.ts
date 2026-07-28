import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { OpenAICompatibleProvider } from '../openai-compatible';

function findWorkspaceEnv(startDir: string): string | null {
  let current = resolve(startDir);

  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(current, '.env');
    if (existsSync(candidate)) return candidate;

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

function loadLocalEnv(): void {
  const envPath = findWorkspaceEnv(process.cwd());
  if (!envPath) return;

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const rawValue = trimmed.slice(eqIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, '');
    process.env[key] ??= value;
  }
}

const runRealLlmTest = process.env.RUN_REAL_LLM_TEST === '1';
const describeRealLlm = runRealLlmTest ? describe : describe.skip;

describeRealLlm('OpenAICompatibleProvider real .env smoke test', () => {
  it(
    'calls the configured OpenAI-compatible chat completions endpoint',
    async () => {
      loadLocalEnv();

      const apiKey = process.env.LLM_API_KEY;
      const baseUrl = process.env.LLM_BASE_URL;
      const model = process.env.LLM_MODEL;

      expect(apiKey, 'LLM_API_KEY must be set in .env').toBeTruthy();
      expect(apiKey, 'LLM_API_KEY must not be the example placeholder').not.toBe(
        'your_api_key_here',
      );
      expect(baseUrl, 'LLM_BASE_URL must be set in .env').toBeTruthy();
      expect(model, 'LLM_MODEL must be set in .env').toBeTruthy();

      const provider = new OpenAICompatibleProvider({
        apiKey: apiKey!,
        baseUrl: baseUrl!,
        defaultModel: model!,
        timeout: 60_000,
        maxRetries: 0,
      });

      const response = await provider.chat({
        messages: [
          {
            role: 'user',
            content:
              'Return only this exact sentence as the final answer: AI-Reader real LLM smoke test passed',
          },
        ],
        temperature: 0,
        maxTokens: 256,
      });

      expect(response.model).toBeTruthy();
      expect(response.content).toContain('AI-Reader real LLM smoke test passed');
      expect(response.usage.totalTokens).toBeGreaterThan(0);
    },
    75_000,
  );
});
