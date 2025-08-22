import '@types/jest';

/**
 * Global Jest configuration
 */

// Electron mock for tests
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(() => '/mock/path'),
    on: jest.fn(),
    quit: jest.fn(),
  },
  BrowserWindow: jest.fn(() => ({
    loadFile: jest.fn(),
    on: jest.fn(),
    webContents: {
      on: jest.fn(),
      send: jest.fn(),
    },
  })),
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
  },
  contextBridge: {
    exposeInMainWorld: jest.fn(),
  },
}));

// Browser API mocks for React components
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});
