import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        crx({ manifest }),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            'optimal-select': path.resolve(__dirname, 'node_modules/optimal-select/lib/index.js')
        },
    },
    build: {
        // Use terser for better minification and obfuscation
        minify: 'terser',
        terserOptions: {
            compress: {
                drop_console: false,     // Allow console.* calls
                drop_debugger: false,    // Allow debugger statements
                ecma: 2020,
                module: true,
                passes: 3,              // Run compression 3 times for better results
                unsafe: true,           // Apply unsafe transformations
                pure_getters: true,
            },
            mangle: {
                toplevel: true,         // Mangle variables in top-level scope
                module: true,
            },
            format: {
                comments: false,        // Remove all comments
                ecma: 2020,
            },
        },
        rollupOptions: {
            input: {
                sidepanel: 'sidepanel.html',
            },
        },
    },
});
