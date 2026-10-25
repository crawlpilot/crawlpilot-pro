import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { minify } from 'terser';
import { readFile, writeFile } from 'fs/promises';
import manifest from './manifest.json';
import path from 'path';

/** Page hooks copied from public/ as they are: minified like the bundle, their comments dropped. */
const PUBLIC_SCRIPTS = ['net-hook.js', 'visible-shim.js'];

function minifyPublicScripts(): Plugin {
    return {
        name: 'minify-public-scripts',
        apply: 'build',
        async closeBundle() {
            for (const name of PUBLIC_SCRIPTS) {
                const file = path.resolve(__dirname, 'dist', name);
                const { code } = await minify(await readFile(file, 'utf8'), {
                    compress: { drop_debugger: true, passes: 2 },
                    mangle: true,
                    format: { comments: false },
                });
                if (!code) throw new Error(`Could not minify ${name}`);
                await writeFile(file, code);
            }
        },
    };
}

export default defineConfig({
    plugins: [
        react(),
        crx({ manifest }),
        minifyPublicScripts(),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    define: {
        // Force React production mode — eliminates dev-only warnings and reduces bundle size
        'process.env.NODE_ENV': '"production"',
    },
    build: {
        // Target Chrome 111+ (stable MV3 support, ES2022)
        chunkSizeWarningLimit: 1000,
        minify: 'terser',
        sourcemap: false,
        terserOptions: {
            compress: {
                drop_console: true,
                drop_debugger: true,
                // Belt-and-suspenders: also mark every console method as pure
                pure_funcs: [
                    'console.log', 'console.info', 'console.debug',
                    'console.warn', 'console.error', 'console.trace',
                    'console.group', 'console.groupEnd', 'console.time',
                    'console.timeEnd',
                ],
                ecma: 2020,
                module: true,
                passes: 3,
                unsafe: true,
                
                pure_getters: true,
                collapse_vars: true,
                reduce_vars: true,
                dead_code: true,
            },
            mangle: {
                toplevel: true,
                module: true,
                keep_classnames: false,
                keep_fnames: false,
            },
            format: {
                comments: false,
                ecma: 2020,
            },
        },
        rollupOptions: {
            input: {
                sidepanel: 'sidepanel.html',
            },
            output: {
                manualChunks(id) {
                    if (id.includes('node_modules')) {
                        // Separate large libraries into their own chunks for better caching
                        // Readability gets its own chunk so the injected summarizer
                        // extraction script doesn't pull the whole vendor bundle into pages.
                        if (id.includes('@mozilla/readability')) return 'vendor-readability';
                        if (id.includes('ag-grid')) return 'vendor-aggrid';
                        // Keep react, react-dom, and scheduler together to avoid init order issues.
                        // Use path-segment matching so react-i18next, react-query, etc. don't end up
                        // in this chunk (they depend on i18next/other vendor libs, which would create
                        // a vendor-react -> vendor -> vendor-react circular chunk cycle).
                        if (
                            id.includes('/node_modules/react/') ||
                            id.includes('/node_modules/react-dom/') ||
                            id.includes('/node_modules/scheduler/')
                        ) return 'vendor-react';
                        // Other libraries go where they are used: one only a lazy view needs
                        // (react-markdown, …) loads with that view, not at start.
                        return undefined;
                    }
                }
            }
        },
    },
});
