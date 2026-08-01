import { describe, expect, it } from 'vitest';

import { createMainWindowOptions } from '../window-options';

describe('createMainWindowOptions', () => {
  it('uses the approved black-gold Windows title-bar overlay', () => {
    expect(createMainWindowOptions('C:/app/preload.js', 'win32')).toMatchObject({
      width: 1400,
      height: 900,
      minWidth: 1024,
      minHeight: 768,
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#10100F',
        symbolColor: '#F2EAD8',
        height: 48,
      },
      webPreferences: {
        preload: 'C:/app/preload.js',
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
  });

  it('keeps hidden-inset title bars on non-Windows platforms', () => {
    const options = createMainWindowOptions('/app/preload.js', 'darwin');

    expect(options.titleBarStyle).toBe('hiddenInset');
    expect(options.titleBarOverlay).toBeUndefined();
  });
});
