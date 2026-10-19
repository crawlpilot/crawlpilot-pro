/**
 * Light or dark: the user's Appearance setting (light by default), applied as `data-theme` on <html>
 * for the CSS variables and returned for the MUI theme. A copy in localStorage lets the panel paint
 * in the right colours before chrome.storage answers.
 */
import { useEffect, useState } from 'react';
import { storage, type Appearance } from '@/shared/storage';
import type { ColorMode } from './muiTheme';

const CACHE = 'crawlpilot.appearance';
const DEFAULT: Appearance = 'light';

function systemMode(): ColorMode {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveMode(appearance: Appearance): ColorMode {
    return appearance === 'system' ? systemMode() : appearance;
}

export function cachedAppearance(): Appearance {
    try {
        const v = localStorage.getItem(CACHE);
        if (v === 'light' || v === 'dark' || v === 'system') return v;
    } catch { /* storage blocked */ }
    return DEFAULT;
}

/** Sets the CSS colour set on the page (call before the first render too). */
export function applyMode(mode: ColorMode) {
    document.documentElement.dataset.theme = mode;
}

export async function setAppearance(appearance: Appearance): Promise<void> {
    try { localStorage.setItem(CACHE, appearance); } catch { /* storage blocked */ }
    await storage.set('appearance', appearance);
}

/** The current colour mode, following the setting (from any panel) and, for "system", the OS. */
export function useColorMode(): { mode: ColorMode; appearance: Appearance } {
    const [appearance, setLocal] = useState<Appearance>(cachedAppearance);
    const [system, setSystem] = useState<ColorMode>(systemMode);

    useEffect(() => {
        void storage.get('appearance').then(v => {
            if (!v) return;
            setLocal(v);
            try { localStorage.setItem(CACHE, v); } catch { /* storage blocked */ }
        });
        const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
            const v = changes.appearance?.newValue;
            if (area === 'local' && (v === 'light' || v === 'dark' || v === 'system')) setLocal(v);
        };
        chrome.storage.onChanged.addListener(onChanged);
        const media = window.matchMedia?.('(prefers-color-scheme: dark)');
        const onMedia = () => setSystem(systemMode());
        media?.addEventListener('change', onMedia);
        return () => {
            chrome.storage.onChanged.removeListener(onChanged);
            media?.removeEventListener('change', onMedia);
        };
    }, []);

    const mode = appearance === 'system' ? system : appearance;
    useEffect(() => applyMode(mode), [mode]);
    return { mode, appearance };
}
