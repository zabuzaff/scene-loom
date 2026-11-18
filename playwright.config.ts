import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4319',
    channel: 'chrome',
    viewport: { width: 1440, height: 960 },
    permissions: ['clipboard-read', 'clipboard-write'],
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:4319',
    reuseExistingServer: false,
    env: {
      SCENE_LOOM_PORT: '4319',
      MESH_FOUNDRY_DATA_DIR:
        '/private/tmp/scene-loom-browser-tests/foundry-fixture',
      SCENE_REHEARSAL_DATA_DIR:
        '/private/tmp/scene-loom-browser-tests/rehearsal-fixture',
      SCENE_LOOM_DATA_DIR: '/private/tmp/scene-loom-browser-tests',
    },
    timeout: 30000,
  },
});
