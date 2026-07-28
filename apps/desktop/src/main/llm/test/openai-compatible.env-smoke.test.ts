import { describe, expect, it } from 'vitest';
import { loadLLMConfig } from '../config';
import { OpenAICompatibleProvider } from '../openai-compatible';

const runRealLlmTest = process.env.RUN_REAL_LLM_TEST === '1';
const describeRealLlm = runRealLlmTest ? describe : describe.skip;

describeRealLlm('OpenAICompatibleProvider real .env smoke test', () => {
  it(
    'calls the configured OpenAI-compatible chat completions endpoint',
    async () => {
      const config = loadLLMConfig();

      expect(config.apiKey, 'LLM_API_KEY must be set in .env').toBeTruthy();
      expect(config.apiKey, 'LLM_API_KEY must not be the example placeholder').not.toBe(
        'your_api_key_here',
      );
      expect(config.baseUrl, 'LLM_BASE_URL must be set in .env').toBeTruthy();
      expect(config.model, 'LLM_MODEL must be set in .env').toBeTruthy();

      const provider = new OpenAICompatibleProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        defaultModel: config.model,
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
