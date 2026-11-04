/**
 * The crawler worker's builds, apart from the extension's (`src/pro/crawler`), into `src/pro/crawler/dist`
 * so the extension's `dist` and its zip never carry them:
 * - default: `inPage.ts` as one script a worker injects into each page;
 * - `--mode worker`: the Node worker and its command line;
 * - `--mode mock`: the mock backend as a local server (`npm run pro:mock`).
 */
import { defineConfig } from 'vite';
import path from 'path';

const outDir = path.resolve(__dirname, 'src/pro/crawler/dist');

const node = (name: string, entry: string) => ({
    publicDir: false as const,
    build: {
        outDir,
        emptyOutDir: false,
        ssr: true,
        target: 'node20',
        minify: false,
        rollupOptions: {
            input: { [name]: path.resolve(__dirname, entry) },
            output: { format: 'es' as const, entryFileNames: '[name].mjs' },
            external: ['playwright', /^node:/],
        },
    },
});

export default defineConfig(({ mode }) => mode === 'worker' ? node('worker', 'src/pro/crawler/cli.ts')
    : mode === 'mock' ? node('mock-backend', 'src/pro/backend/mockServerCli.ts')
    : {
        publicDir: false,
        define: { 'process.env.NODE_ENV': '"production"' },
        build: {
            outDir,
            emptyOutDir: false,
            target: 'chrome111',
            minify: 'terser',
            lib: { entry: path.resolve(__dirname, 'src/pro/crawler/inPage.ts'), formats: ['iife'], name: 'crawlpilotInPage', fileName: () => 'inpage.js' },
        },
    });
