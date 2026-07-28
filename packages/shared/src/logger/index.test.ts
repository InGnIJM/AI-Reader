import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockScopedLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const mockLog = {
  scope: vi.fn().mockReturnValue(mockScopedLog),
};

vi.mock('electron-log', () => ({
  default: mockLog,
}));

const { createLogger, logger } = await import('./index');

beforeEach(() => {
  vi.clearAllMocks();
  mockLog.scope.mockReturnValue(mockScopedLog);
});

describe('createLogger', () => {
  it('should call electron-log.scope with the given scope name', () => {
    createLogger('my-scope');
    expect(mockLog.scope).toHaveBeenCalledWith('my-scope');
  });

  it('should return an object with all log methods', () => {
    const log = createLogger('test');
    expect(log.info).toBeTypeOf('function');
    expect(log.warn).toBeTypeOf('function');
    expect(log.error).toBeTypeOf('function');
    expect(log.debug).toBeTypeOf('function');
    expect(log.scope).toBeTypeOf('function');
  });

  describe('info', () => {
    it('should delegate to scopedLog.info', () => {
      const log = createLogger('test');
      log.info('hello');
      expect(mockScopedLog.info).toHaveBeenCalledOnce();
      expect(mockScopedLog.info).toHaveBeenCalledWith('hello');
    });

    it('should forward extra arguments', () => {
      const log = createLogger('test');
      const obj = { key: 'value' };
      log.info('msg', 1, 'two', obj);
      expect(mockScopedLog.info).toHaveBeenCalledWith('msg', 1, 'two', obj);
    });
  });

  describe('warn', () => {
    it('should delegate to scopedLog.warn', () => {
      const log = createLogger('test');
      log.warn('warning');
      expect(mockScopedLog.warn).toHaveBeenCalledOnce();
      expect(mockScopedLog.warn).toHaveBeenCalledWith('warning');
    });

    it('should forward extra arguments', () => {
      const log = createLogger('test');
      log.warn('msg', 42, [1, 2]);
      expect(mockScopedLog.warn).toHaveBeenCalledWith('msg', 42, [1, 2]);
    });
  });

  describe('error', () => {
    it('should delegate to scopedLog.error', () => {
      const log = createLogger('test');
      log.error('fail');
      expect(mockScopedLog.error).toHaveBeenCalledOnce();
      expect(mockScopedLog.error).toHaveBeenCalledWith('fail');
    });

    it('should forward Error objects', () => {
      const log = createLogger('test');
      const err = new Error('boom');
      log.error('caught', err);
      expect(mockScopedLog.error).toHaveBeenCalledWith('caught', err);
    });
  });

  describe('debug', () => {
    it('should delegate to scopedLog.debug', () => {
      const log = createLogger('test');
      log.debug('trace');
      expect(mockScopedLog.debug).toHaveBeenCalledOnce();
      expect(mockScopedLog.debug).toHaveBeenCalledWith('trace');
    });

    it('should forward extra arguments', () => {
      const log = createLogger('test');
      log.debug('detail', { a: 1 });
      expect(mockScopedLog.debug).toHaveBeenCalledWith('detail', { a: 1 });
    });
  });

  describe('scope', () => {
    it('should create child logger with colon-separated scope', () => {
      const parent = createLogger('parent');
      mockLog.scope.mockClear();

      const child = parent.scope('child');
      expect(mockLog.scope).toHaveBeenCalledWith('parent:child');
      expect(child).toBeDefined();
      expect(child.info).toBeTypeOf('function');
    });

    it('should support nested scopes', () => {
      const app = createLogger('app');
      mockLog.scope.mockClear();

      const service = app.scope('service');
      expect(mockLog.scope).toHaveBeenCalledWith('app:service');

      mockLog.scope.mockClear();
      const db = service.scope('db');
      expect(mockLog.scope).toHaveBeenCalledWith('app:service:db');

      expect(db.info).toBeTypeOf('function');
      expect(db.error).toBeTypeOf('function');
    });
  });
});

describe('default logger', () => {
  it('should export a default logger instance', () => {
    expect(logger).toBeDefined();
    expect(logger.info).toBeTypeOf('function');
    expect(logger.warn).toBeTypeOf('function');
    expect(logger.error).toBeTypeOf('function');
    expect(logger.debug).toBeTypeOf('function');
    expect(logger.scope).toBeTypeOf('function');
  });

  it('should have been created with scope "app"', () => {
    mockLog.scope.mockClear();
    const sub = logger.scope('sub');
    expect(mockLog.scope).toHaveBeenCalledWith('app:sub');
    expect(sub).toBeDefined();
  });
});
