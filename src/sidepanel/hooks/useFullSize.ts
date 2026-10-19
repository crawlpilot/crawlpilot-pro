import { useEffect, useRef, useState } from 'react';
import type { FoundImage, FullSize } from '../../shared/images/types';
import { candidatesFor, findFullSize } from '../services/images/fullSize';
import { probeImage } from '../services/images/probe';
import { hostKey, runPool } from '../services/images/pool';

const ENABLED_KEY = 'crawlpilot.images.fullSize';

/**
 * Full-size originals for the scanned images, searched in the background as images arrive (only
 * images with a candidate: a link to an image, or a CDN URL a rule knows). `apply` attaches what
 * was found when the option is on.
 */
export function useFullSize(images: FoundImage[]) {
    const [enabled, setEnabledState] = useState(() => { try { return localStorage.getItem(ENABLED_KEY) !== 'off'; } catch { return true; } });
    const [found, setFound] = useState<Map<string, FullSize>>(new Map());
    const [pending, setPending] = useState(0);
    const asked = useRef(new Set<string>());
    const abortRef = useRef(new AbortController());

    useEffect(() => () => abortRef.current.abort(), []);

    useEffect(() => {
        if (!enabled) return;
        const todo = images.filter(i => !asked.current.has(i.src) && candidatesFor(i).length > 0);
        if (!todo.length) return;
        for (const i of todo) asked.current.add(i.src);
        const signal = abortRef.current.signal;
        setPending(n => n + todo.length);
        void runPool(todo, i => hostKey(i.src), async image => {
            const full = await findFullSize(image, url => probeImage(url, signal)).catch(() => null);
            if (full && !signal.aborted) setFound(prev => new Map(prev).set(image.src, full));
            setPending(n => n - 1);
        }, { concurrency: 4, perKey: 2, signal });
    }, [images, enabled]);

    const setEnabled = (on: boolean) => {
        setEnabledState(on);
        try { localStorage.setItem(ENABLED_KEY, on ? 'on' : 'off'); } catch { /* storage blocked */ }
    };

    /** The images with their originals attached (when on). */
    const apply = (list: FoundImage[]): FoundImage[] => enabled && found.size
        ? list.map(i => (found.has(i.src) ? { ...i, full: found.get(i.src) } : i))
        : list;

    return { enabled, setEnabled, found: found.size, pending, apply };
}
