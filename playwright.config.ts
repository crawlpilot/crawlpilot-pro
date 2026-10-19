import { defineConfig } from '@playwright/test';

/** End-to-end tests: the built extension (`dist/`) loaded into Chromium. Run `npm run e2e` (builds first). */
export default defineConfig({
    testDir: 'e2e',
    timeout: 60_000,
    // One browser profile per worker; the extension's state (storage, IndexedDB) is per profile.
    workers: 1,
    fullyParallel: false,
    reporter: [['list']],
    use: { trace: 'retain-on-failure' },
});
