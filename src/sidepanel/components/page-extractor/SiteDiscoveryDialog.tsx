import { useMemo, useRef, useState } from 'react';
import {
    Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Stack, TextField, Typography,
} from '@mui/material';
import { Compass } from 'lucide-react';
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
        <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Compass size={18} /> Discover pages{site ? ` on ${site}` : ''}
            </DialogTitle>
            <DialogContent dividers>
                <Stack spacing={1.5}>
                    <Typography variant="body2" color="text.secondary">
                        Reads the site's sitemaps (from robots.txt) and the links on the open page, then groups the URLs by path so you can pick, for example, all product pages.
                    </Typography>
                    {!result && (
                        <Button variant="contained" onClick={run} disabled={running}>{running ? 'Reading sitemaps…' : 'Find pages on this site'}</Button>
                    )}
                    {running && (
                        <Box>
                            <LinearProgress />
                            <Typography variant="caption" color="text.secondary">
                                {progress ? `${progress.sitemapsRead} sitemaps · ${progress.urls.toLocaleString()} URLs` : 'Starting…'}
                            </Typography>
                            <Button size="small" onClick={() => abortRef.current?.abort()}>Stop</Button>
                        </Box>
                    )}
                    {error && <Alert severity="warning" variant="outlined">{error}</Alert>}

                    {result && result.urls.length > 0 && (
                        <>
                            <Typography variant="caption" color="text.secondary">
                                {result.urls.length.toLocaleString()} URLs from {result.sitemaps.length} sitemap{result.sitemaps.length !== 1 ? 's' : ''}{result.fromPage ? ` and ${result.fromPage} page links` : ''}.
                                {result.errors.length > 0 ? ` ${result.errors.length} sitemap${result.errors.length > 1 ? 's' : ''} could not be read.` : ''}
                            </Typography>
                            <Stack direction="row" spacing={1}>
                                <TextField size="small" fullWidth label="Only URLs like" placeholder="/products/*" value={include} onChange={e => setInclude(e.target.value)} />
                                <TextField size="small" fullWidth label="Skip URLs like" placeholder="*?color=*" value={exclude} onChange={e => setExclude(e.target.value)} />
                            </Stack>
                            <Box sx={{ maxHeight: 320, overflow: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                                {groups.slice(0, 200).map(g => (
                                    <Box key={g.pattern} onClick={() => toggle(g.pattern)}
                                        sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.25, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}>
                                        <Checkbox size="small" checked={picked.has(g.pattern)} sx={{ p: 0.5 }} />
                                        <Box sx={{ flex: 1, minWidth: 0 }}>
                                            <Typography variant="caption" sx={{ fontFamily: 'monospace', display: 'block' }}>{g.pattern}</Typography>
                                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.urls[0]}</Typography>
                                        </Box>
                                        <Typography variant="caption" fontWeight={700}>{g.urls.length.toLocaleString()}</Typography>
                                    </Box>
                                ))}
                            </Box>
                        </>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                {result && <Button onClick={run} disabled={running} sx={{ mr: 'auto' }}>Search again</Button>}
                <Button onClick={onClose}>Cancel</Button>
                <Button variant="contained" disabled={selectedUrls.length === 0}
                    onClick={() => { onUse(selectedUrls.slice(0, MAX_SELECT)); onClose(); }}>
                    {selectedUrls.length > MAX_SELECT ? `Use first ${MAX_SELECT.toLocaleString()} URLs` : `Use ${selectedUrls.length.toLocaleString()} URLs`}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
