import type { ElectronAPI } from '../preload/index';

declare global {
  interface Window {
    api: ElectronAPI;
  }
}

/* CSS Modules */
declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

declare module '*.module.scss' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
