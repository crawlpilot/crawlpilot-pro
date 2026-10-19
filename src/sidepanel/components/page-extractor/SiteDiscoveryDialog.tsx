import { useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Dialog, Notice, Progress, Stack, Text, TextField } from '../../ui';
import { discoverSiteUrls, DiscoveryProgress, DiscoveryResult } from '../../services/discovery';
import { groupByPattern, matchesFilters } from '../../../shared/discovery/sitemap';
import { hasAllUrlsPermission, requestAllUrlsPermission, openSiteAccessSettings } from '../../../shared/utils/hostPermissions';

interface Props {
    open: boolean;
    onClose: () => void;
    onUse: (urls: string[]) => void;
}

const MAX_SELECT = 5000;

export default function SiteDiscoveryDialog({ open, onClose, onUse }: Props) {
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState<DiscoveryProgress | null>(null);
    const [result, setResult] = useState<DiscoveryResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [include, setInclude] = useState('');
    const [exclude, setExclude] = useState('');
    const [picked, setPicked] = useState<Set<string>>(new Set());
    const [site, setSite] = useState('');
    const abortRef = useRef<AbortController | null>(null);

    const run = async () => {
        setError(null);
        setResult(null);
        setPicked(new Set());
        try {
            if (!(await hasAllUrlsPermission())) {
                const r = await requestAllUrlsPermission();
                if (r === 'unavailable') openSiteAccessSettings();
                if (r !== 'granted') throw new Error('CrawlPilot needs access to the site to read its sitemaps.');
            }
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab?.url || !/^https?:/.test(tab.url)) throw new Error('Open a page of the site you want to scrape first.');
            setSite(new URL(tab.url).host);
            setRunning(true);
            abortRef.current = new AbortController();
            const res = await discoverSiteUrls(tab.url, tab.id, { signal: abortRef.current.signal, onProgress: setProgress });
            setResult(res);
            if (res.urls.length === 0) setError('No URLs found: the site lists no sitemap and the page has no links to the same site.');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setRunning(false);
        }
    };

    const filtered = useMemo(() => (result ? result.urls.filter(u => matchesFilters(u, include, exclude)) : []), [result, include, exclude]);
    const groups = useMemo(() => groupByPattern(filtered), [filtered]);
    const selectedUrls = useMemo(() => groups.filter(g => picked.has(g.pattern)).flatMap(g => g.urls), [groups, picked]);

    const toggle = (pattern: string) => {
        const next = new Set(picked);
        if (next.has(pattern)) next.delete(pattern); else next.add(pattern);
        setPicked(next);
    };

    return (
        <Dialog open={open} onClose={onClose} size="lg" title={`Discover pages${site ? ` on ${site}` : ''}`}
            description="Reads the site's sitemaps (from robots.txt) and the links on the open page, then groups the URLs by path so you can pick, for example, all product pages."
            actions={<>
                {result && <Button variant="ghost" className="mr-auto" onClick={run} disabled={running}>Search again</Button>}
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button variant="primary" disabled={selectedUrls.length === 0} onClick={() => { onUse(selectedUrls.slice(0, MAX_SELECT)); onClose(); }}>
                    {selectedUrls.length > MAX_SELECT ? `Use first ${MAX_SELECT.toLocaleString()} URLs` : `Use ${selectedUrls.length.toLocaleString()} URLs`}
                </Button>
            </>}>
            <Stack gap={3}>
                {!result && <Button variant="primary" onClick={run} loading={running}>{running ? 'Reading sitemaps…' : 'Find pages on this site'}</Button>}
                {running && (
                    <Stack gap={1.5}>
                        <Progress label="Reading sitemaps" />
                        <div className="flex items-center justify-between">
                            <Text size="caption" tone="muted">{progress ? `${progress.sitemapsRead} sitemaps · ${progress.urls.toLocaleString()} URLs` : 'Starting…'}</Text>
                            <Button size="sm" variant="ghost" onClick={() => abortRef.current?.abort()}>Stop</Button>
                        </div>
                    </Stack>
                )}
                {error && <Notice tone="warning">{error}</Notice>}

                {result && result.urls.length > 0 && (
                    <>
                        <Text size="caption" tone="muted">
                            {result.urls.length.toLocaleString()} URLs from {result.sitemaps.length} sitemap{result.sitemaps.length !== 1 ? 's' : ''}{result.fromPage ? ` and ${result.fromPage} page links` : ''}.
                            {result.errors.length > 0 ? ` ${result.errors.length} sitemap${result.errors.length > 1 ? 's' : ''} could not be read.` : ''}
                        </Text>
                        <div className="flex gap-2">
                            <TextField size="sm" className="flex-1" label="Only URLs like" placeholder="/products/*" value={include} onChange={e => setInclude(e.target.value)} />
                            <TextField size="sm" className="flex-1" label="Skip URLs like" placeholder="*?color=*" value={exclude} onChange={e => setExclude(e.target.value)} />
                        </div>
                        <div className="max-h-80 overflow-auto rounded-field border border-line">
                            {groups.slice(0, 200).map(g => (
                                <div key={g.pattern} onClick={() => toggle(g.pattern)} className="flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-1.5 last:border-b-0 hover:bg-ink/4">
                                    <span onClick={e => e.stopPropagation()}><Checkbox checked={picked.has(g.pattern)} onChange={() => toggle(g.pattern)} aria-label={g.pattern} /></span>
                                    <div className="min-w-0 flex-1">
                                        <Text size="caption" mono>{g.pattern}</Text>
                                        <Text size="caption" tone="faint" truncate>{g.urls[0]}</Text>
                                    </div>
                                    <Text size="caption" weight="bold">{g.urls.length.toLocaleString()}</Text>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </Stack>
        </Dialog>
    );
}
