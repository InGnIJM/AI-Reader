import { createLogger } from '@ai-reader/shared';

const log = createLogger('llm:config');

export interface LLMProviderConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export function loadLLMConfig(): LLMProviderConfig {
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';
  const baseUrl = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';

  if (!apiKey) {
    log.warn('LLM_API_KEY not set, AI features will be unavailable');
  }

  return { apiKey: apiKey || '', model, baseUrl };
}
