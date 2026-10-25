import { useCallback, useRef, useState } from 'react';
import type { FoundImage } from '../../shared/images/types';
import { browserDeps } from '../services/images/save';
import { pixelHash } from '../services/images/pixels';
import { hostKey, runPool } from '../services/images/pool';

/**
 * Pixel hashes for finding look-alikes: the same picture under unrelated URLs. On request only: it
 * reads every image (mostly from the browser's cache, since the grid has shown them). Hashes are kept
 * for the session, so a second run only reads new images.
 */
export function useLookalikes(tabId: number | null) {
    const [hashes, setHashes] = useState<ReadonlyMap<string, string>>(new Map());
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const known = useRef(new Map<string, string>());

    const run = useCallback(async (images: FoundImage[]) => {
        const todo = images.filter(i => !known.current.has(i.src));
        if (!todo.length) return;
        const deps = browserDeps(tabId);
        const signal = new AbortController().signal;
        let done = 0;
        setProgress({ done, total: todo.length });
        await runPool(todo, i => hostKey(i.src), async image => {
            try {
                known.current.set(image.src, await pixelHash(await deps.fetch(image.src, signal)));
            } catch {
                // Unreadable: it simply isn't compared.
            }
            setProgress({ done: ++done, total: todo.length });
        });
        setHashes(new Map(known.current));
        setProgress(null);
    }, [tabId]);

    return { hashes, progress, run };
}
