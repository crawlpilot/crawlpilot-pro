import { useEffect, useRef, useState } from 'react';
import { DEFAULT_FILTERS, type ImageFilters } from '../components/images/imageFilters';

/** The Image Downloader's filters, kept per site (`chrome.storage.local`), so a site you return to opens filtered as you left it. */

type Stored = { [K in keyof ImageFilters]: ImageFilters[K] extends Set<infer T> ? T[] : ImageFilters[K] };
const SET_KEYS = ['fileTypes', 'sizeCategories', 'aspects', 'domains'] as const;
const keyFor = (site: string) => `imageDownloader.filters.${site}`;

function toStored(f: ImageFilters): Stored {
    const out: Record<string, unknown> = { ...f, searchQuery: '' };
    for (const k of SET_KEYS) out[k] = [...f[k]];
    return out as Stored;
}

function fromStored(s: Partial<Stored>): ImageFilters {
    const out: Record<string, unknown> = { ...DEFAULT_FILTERS, ...s };
    for (const k of SET_KEYS) out[k] = new Set(s[k] ?? DEFAULT_FILTERS[k]);
    return out as unknown as ImageFilters;
}

export function useImageFilters(site: string) {
    const [filters, setFilters] = useState<ImageFilters>(DEFAULT_FILTERS);
    const loaded = useRef<string | null>(null);

    useEffect(() => {
        if (!site) return;
        loaded.current = null;
        void chrome.storage.local.get(keyFor(site)).then(r => {
            const saved = r[keyFor(site)] as Partial<Stored> | undefined;
            setFilters(saved ? fromStored(saved) : DEFAULT_FILTERS);
            loaded.current = site;
        }).catch(() => { loaded.current = site; });
    }, [site]);

    useEffect(() => {
        if (!site || loaded.current !== site) return;
        void chrome.storage.local.set({ [keyFor(site)]: toStored(filters) }).catch(() => undefined);
    }, [filters, site]);

    const update = <K extends keyof ImageFilters>(key: K, value: ImageFilters[K]) => setFilters(f => ({ ...f, [key]: value }));
    const toggle = (key: (typeof SET_KEYS)[number], value: string) => setFilters(f => {
        const next = new Set<string>(f[key] as Set<string>);
        if (next.has(value)) next.delete(value); else next.add(value);
        return { ...f, [key]: next };
    });
    const reset = () => setFilters(DEFAULT_FILTERS);

    return { filters, update, toggle, reset };
}
