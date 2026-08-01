import type { BrowserWindowConstructorOptions } from 'electron';

export type TitleBarTheme = 'white' | 'black-gold';

export function createTitleBarOverlay(theme: TitleBarTheme) {
  return theme === 'white'
    ? {
        color: '#F4F2EE',
        symbolColor: '#1E252C',
        height: 48,
      }
    : {
        color: '#10100F',
        symbolColor: '#F2EAD8',
        height: 48,
      };
}

export function createMainWindowOptions(
  preload: string,
  platform: NodeJS.Platform = process.platform,
): BrowserWindowConstructorOptions {
  const options: BrowserWindowConstructorOptions = {
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  };

  if (platform === 'win32') {
    return {
      ...options,
      titleBarStyle: 'hidden',
      titleBarOverlay: createTitleBarOverlay('black-gold'),
    };
  }

  return {
    ...options,
    titleBarStyle: 'hiddenInset',
  };
}
