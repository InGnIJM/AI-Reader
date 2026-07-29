import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http';

/**
 * Deterministic mock LLM response content used across all tests.
 * Returned by every /v1/chat/completions call regardless of input.
 */
export const MOCK_LLM_CONTENT =
  '# ML Basics\n\nMachine learning is a subset of AI.\n\nNeural networks learn patterns from data.\n\nKey concepts include supervised and unsupervised learning.';

export interface MockRequest {
  path: string;
  body: unknown;
  timestamp: number;
}

/**
 * Lightweight HTTP server that mimics an OpenAI-compatible /v1/chat/completions endpoint.
 *
 * - Listens on a random available port (assigned by the OS).
 * - Records every request for later assertion.
 * - Returns deterministic content regardless of input messages.
 * - Supports both streaming (SSE) and non-streaming responses.
 */
export class MockLLMServer {
  private server: Server;
  private _port = 0;
  readonly requests: MockRequest[] = [];

  get port(): number {
    return this._port;
  }

  get baseUrl(): string {
    return `http://127.0.0.1:${this._port}/v1`;
  }

  constructor() {
    this.server = createServer((req, res) => this.handleRequest(req, res));
  }

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server.address();
        if (address && typeof address === 'object') {
          this._port = address.port;
        }
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
      return;
    }

    if (req.method !== 'POST' || !req.url?.startsWith('/v1/chat/completions')) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    let rawBody = '';
    req.on('data', (chunk: Buffer) => {
      rawBody += chunk.toString();
    });
    req.on('end', () => {
      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }

      this.requests.push({ path: req.url ?? '', body, timestamp: Date.now() });

      const parsed = body as { stream?: boolean } | undefined;
      if (parsed?.stream) {
        this.handleStreamingResponse(res);
      } else {
        this.handleNonStreamingResponse(res);
      }
    });
  }

  private handleNonStreamingResponse(res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'mock-completion-1',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'mock-model',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: MOCK_LLM_CONTENT },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
    );
  }

  private handleStreamingResponse(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const words = MOCK_LLM_CONTENT.split(/(\s+)/);
    for (const word of words) {
      res.write(
        `data: ${JSON.stringify({
          id: 'mock-stream-1',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: 'mock-model',
          choices: [
            { index: 0, delta: { content: word }, finish_reason: null },
          ],
        })}\n\n`,
      );
    }

    res.write(
      `data: ${JSON.stringify({
        id: 'mock-stream-1',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'mock-model',
        choices: [
          { index: 0, delta: {}, finish_reason: 'stop' },
        ],
      })}\n\n`,
    );

    res.write('data: [DONE]\n\n');
    res.end();
  }
}
