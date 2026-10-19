import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { initI18n } from '../i18n';
// Bundled fonts: titles and numbers, text, selectors and code. No font requests, works offline.
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './index.css';
import { applyMode, cachedAppearance, resolveMode } from './theme/colorMode';

// Paint in the user's colours from the first frame.
applyMode(resolveMode(cachedAppearance()));

// Platform density: Windows renders larger due to DPI scaling
const isWindows = navigator.userAgent.includes('Windows');
if (isWindows) {
    document.documentElement.classList.add('platform-windows');
}

initI18n().then(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <ErrorBoundary>
                <App />
            </ErrorBoundary>
        </React.StrictMode>,
    );
});
