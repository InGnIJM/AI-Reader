import type {
  LLMProvider,
  ChatMessage,
  ChatCompletionChunk,
} from '@ai-reader/core';
import { createLogger } from '@ai-reader/shared';

const log = createLogger('ai-reply');

export interface ReplyContext {
  selectedText: string;
  paragraphText: string;
  previousParagraph?: string;
  nextParagraph?: string;
  currentSection: string;
  question: string;
  discussionHistory: { role: 'user' | 'assistant'; content: string }[];
}

export class AIReplyService {
  constructor(private llm: LLMProvider) {}

  async *generateReply(context: ReplyContext): AsyncIterable<ChatCompletionChunk> {
    log.info(`Generating reply for question: ${context.question.substring(0, 50)}...`);

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `你是一个学习助手。用户正在阅读一篇 AI 生成的学习文档，并对其中的内容提出了问题。

请根据以下上下文回答用户的问题：
- 用户选中的文字
- 选中文字所在的段落
- 当前章节的完整内容
- 用户与你的历史对话

要求：
1. 回答要准确、清晰、有帮助
2. 如果问题涉及概念解释，请用简单易懂的语言
3. 如果问题需要举例，请给出具体的例子
4. 如果问题涉及推导，请给出清晰的步骤
5. 使用 Markdown 格式回答

注意：当前 AI 回答基于选中内容和当前章节，不支持跨章节语义检索。`,
      },
      {
        role: 'user',
        content: `## 选中的文字
${context.selectedText}

## 当前段落
${context.paragraphText}

${context.previousParagraph ? `## 上一段落\n${context.previousParagraph}\n` : ''}${context.nextParagraph ? `## 下一段落\n${context.nextParagraph}\n` : ''}
## 当前章节
${context.currentSection}

## 用户问题
${context.question}`,
      },
    ];

    // Add discussion history
    for (const msg of context.discussionHistory) {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    yield* this.llm.chatStream({ messages });
  }
}
