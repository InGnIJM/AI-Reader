import log from 'electron-log';

const isTestProcess =
  process.env.NODE_ENV === 'test' ||
  process.env.VITEST === 'true' ||
  process.env.npm_lifecycle_event?.includes('test');
const isNonElectronNodeProcess = process.versions.electron == null;

if ((isTestProcess || isNonElectronNodeProcess) && log.transports?.file) {
  log.transports.file.level = false;
}

export interface Logger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  scope(name: string): Logger;
}

export function createLogger(scope: string): Logger {
  const scopedLog = log.scope(scope);

  return {
    info: (msg, ...args) => scopedLog.info(msg, ...args),
    warn: (msg, ...args) => scopedLog.warn(msg, ...args),
    error: (msg, ...args) => scopedLog.error(msg, ...args),
    debug: (msg, ...args) => scopedLog.debug(msg, ...args),
    scope: (name) => createLogger(`${scope}:${name}`),
  };
}

export const logger = createLogger('app');
