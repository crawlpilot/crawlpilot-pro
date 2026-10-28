import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

describe('crawler image', () => {
    it('installs the versions the worker was built and tested with', () => {
        const lock = JSON.parse(read('package-lock.json')).packages as Record<string, { version: string }>;
        const runtime = JSON.parse(read('deploy/crawler/package.json')).dependencies as Record<string, string>;
        for (const [name, version] of Object.entries(runtime)) expect(version, name).toBe(lock[`node_modules/${name}`].version);
    });

    it('runs on the Playwright image of that Playwright version, so its browsers match, as a user', () => {
        const runtime = JSON.parse(read('deploy/crawler/package.json')).dependencies as Record<string, string>;
        const dockerfile = read('deploy/crawler/Dockerfile');
        expect(dockerfile).toContain(`FROM mcr.microsoft.com/playwright:v${runtime.playwright}-`);
        expect(dockerfile).toMatch(/\nUSER pwuser\n/);
    });
});
