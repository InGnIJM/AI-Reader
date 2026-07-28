import log from 'electron-log';
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