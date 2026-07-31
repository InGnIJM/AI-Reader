import log from 'electron-log';
const isTestProcess = process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true' ||
    process.env.npm_lifecycle_event?.includes('test');
const isNonElectronNodeProcess = process.versions.electron == null;
if ((isTestProcess || isNonElectronNodeProcess) && log.transports?.file) {
    log.transports.file.level = false;
}
export function createLogger(scope) {
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
//# sourceMappingURL=index.js.map
