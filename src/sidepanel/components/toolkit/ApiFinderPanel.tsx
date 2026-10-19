import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, FormControlLabel, InputAdornment, IconButton, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { Circle, RotateCw, Square, Crosshair, Copy, Table2, Search, Trash2, Network, X, Code2, MapPin, ShieldAlert, Link2 } from 'lucide-react';
import type { NetEntry } from '../../../shared/network/types';
import { findValuePaths, formatPath, generalisePath, resolvePath, arrayPathOf, ValueHit } from '../../../shared/network/jsonSearch';
import { tableFromArray } from '../../../shared/network/arrayTable';
import { REQUEST_TARGET_LABELS, RequestTarget, toRequestSnippet, detectPagingParams, hasSensitiveHeaders } from '../../../shared/network/requestSnippets';
import { db } from '../../../shared/db';
import { on } from '../../../shared/messages';
import { copyText } from '../../services/clipboard';
import { startRecording, stopRecording, isRecordingRegistered } from './apiRecording';
import { useToolkit } from './context';
import { CodeBlock, CopyButton, DetailSection, Step, ToolIntro } from './ui';

const POLL_MS = 2000;
const LIST_MAX = 80;

function splitUrl(u: string): { host: string; path: string } {
    try {
        const url = new URL(u);
        return { host: url.host, path: `${url.pathname}${url.search}` || '/' };
    } catch {
        return { host: '', path: u };
    }
}

interface HitGroup {
    entry: NetEntry;
    hits: ValueHit[];
}

function ResponseRow({ e, hits, selected, onClick }: { e: NetEntry; hits?: ValueHit[]; selected: boolean; onClick: () => void }) {
    const { host, path } = splitUrl(e.url);
    return (
        <Box onClick={onClick} role="button" aria-pressed={selected}
            sx={{ border: 1, borderColor: selected ? 'primary.main' : hits ? 'rgba(16,185,129,0.4)' : 'divider', bgcolor: selected ? 'rgba(6,182,212,0.06)' : undefined, borderRadius: '10px', px: 1, py: 0.75, cursor: 'pointer', '&:hover': { borderColor: 'primary.main' } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Chip size="small" label={e.method} sx={{ height: 18, fontSize: '0.58rem', fontWeight: 800, bgcolor: e.method === 'GET' ? 'rgba(6,182,212,0.15)' : 'rgba(139,92,246,0.18)' }} />
                <Typography variant="caption" sx={{ fontFamily: 'monospace', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'text.primary' }} title={e.url}>{path}</Typography>
                <Typography variant="caption" sx={{ color: e.status >= 400 ? 'error.main' : 'text.secondary', fontWeight: 600 }}>{e.status}</Typography>
                <Typography variant="caption">{e.size >= 1024 ? `${(e.size / 1024).toFixed(0)} KB` : `${e.size} B`}</Typography>
            </Box>
            <Typography variant="caption" sx={{ fontSize: '0.6rem', display: 'block' }}>{host}</Typography>
            {hits && (
                <Typography variant="caption" sx={{ color: 'success.main', fontFamily: 'monospace', display: 'block', mt: 0.25 }}>
                    ✓ {formatPath(hits[0].path)}{hits.length > 1 ? `  (+${hits.length - 1} more)` : ''}
                </Typography>
            )}
        </Box>
    );
}

export default function ApiFinderPanel() {
    const { page, send } = useToolkit();
    const [recording, setRecording] = useState(false);
    const [entries, setEntries] = useState<NetEntry[]>([]);
    const [hookPresent, setHookPresent] = useState<boolean | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [picking, setPicking] = useState(false);
    const [selected, setSelected] = useState<number | null>(null);
    const [target, setTarget] = useState<RequestTarget>('curl');
    const [includeAuth, setIncludeAuth] = useState(false);
    const [cookie, setCookie] = useState<string | null>(null);
    const [savedNote, setSavedNote] = useState<string | null>(null);
    const parsedCache = useRef(new Map<number, unknown>());
    const pickingRef = useRef(false);

    const refresh = useCallback(async () => {
        if (!page.web) return;
        try {
            const res = await send('NET_LIST');
            setHookPresent(res.installed);
            setEntries(res.installed ? res.entries : []);
        } catch (e: any) {
            setError(e.message);
        }
    }, [send, page.web]);

    useEffect(() => {
        isRecordingRegistered().then(setRecording);
        refresh();
        // Selector Lab picks too: only a pick this tool asked for fills the search.
        return on('LAB_PICKED', picked => {
            if (!pickingRef.current) return;
            pickingRef.current = false;
            setPicking(false);
            if (picked?.text) setQuery(picked.text.split(/\s{2,}|\n/)[0].slice(0, 120));
        });
    }, [refresh]);

    useEffect(() => {
        if (!recording) return;
        const t = setInterval(refresh, POLL_MS);
        return () => clearInterval(t);
    }, [recording, refresh]);

    const start = async (reload: boolean) => {
        setError(null);
        try {
            await startRecording(reload, page.tab);
            parsedCache.current.clear();
            setRecording(true);
            setTimeout(refresh, reload ? 2500 : 300);
        } catch (e: any) {
            setError(e.message);
        }
    };

    const stop = async () => {
        await stopRecording();
        setRecording(false);
        refresh();
    };

    const clear = async () => {
        await send('NET_CLEAR').catch(() => undefined);
        parsedCache.current.clear();
        setEntries([]);
        setSelected(null);
    };

    const pickFromPage = async () => {
        setError(null);
        try {
            await send('LAB_PICK_START');
            pickingRef.current = true;
            setPicking(true);
        } catch (e: any) {
            setError(e.message);
        }
    };

    const parsed = useCallback((e: NetEntry): unknown => {
        const cache = parsedCache.current;
        if (!cache.has(e.seq)) {
            let v: unknown = undefined;
            try { v = JSON.parse(e.responseText); } catch { /* truncated or not JSON */ }
            cache.set(e.seq, v);
        }
        return cache.get(e.seq);
    }, []);

    const groups: HitGroup[] = useMemo(() => {
        if (!query.trim()) return [];
        return entries
            .map(entry => {
                const json = parsed(entry);
                return { entry, hits: json === undefined ? [] : findValuePaths(json, query) };
            })
            .filter(g => g.hits.length > 0)
            .sort((a, b) => a.hits[0].path.length - b.hits[0].path.length);
    }, [entries, query, parsed]);

    // A new search opens its most direct answer; closing it afterwards stays closed.
    const openedFor = useRef('');
    useEffect(() => {
        if (groups.length === 0 || openedFor.current === query) return;
        openedFor.current = query;
        setSelected(groups[0].entry.seq);
    }, [groups, query]);

    const selectedEntry = entries.find(e => e.seq === selected) ?? null;
    const selectedHits = groups.find(g => g.entry.seq === selected)?.hits ?? [];

    const loadCookie = async (want: boolean) => {
        if (!want) { setCookie(null); return; }
        try {
            const res = await send('PAGE_COOKIE');
            setCookie(res.cookie || '');
        } catch (e: any) {
            setError(e.message);
        }
    };

    const saveAsTable = async (entry: NetEntry, hit: ValueHit) => {
        const gen = generalisePath(hit.path);
        const arrPath = gen ? arrayPathOf(gen) : null;
        if (!arrPath) return;
        const items = resolvePath(parsed(entry), arrPath)[0];
        if (!Array.isArray(items)) return;
        const { columns, rows } = tableFromArray(items);
        const tableId = await db.tables.save({
            type: 'list',
            items: rows,
            columns: columns.map((c, i) => ({ id: c, name: c, type: 'text' as const, order: i })),
            source_url: entry.url,
            count: rows.length,
            timestamp: new Date().toISOString(),
        }, { name: `API · ${splitUrl(entry.url).host} ${formatPath(arrPath)}` });
        setSavedNote(`Saved ${rows.length} rows as a table.`);
        chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?view=data-table&tableId=${tableId}`) });
    };

    const list = query.trim() ? groups.map(g => g.entry) : [...entries].reverse();
    const captured = entries.length > 0;
    const snippet = selectedEntry ? toRequestSnippet(target, selectedEntry, { includeAuth, cookie: cookie || undefined }) : '';
    const paging = selectedEntry ? detectPagingParams(selectedEntry) : [];

    return (
        <Stack spacing={2}>
            {!captured && !recording && (
                <ToolIntro icon={<Network size={18} />} title="Skip the page, call its API"
                    text="Many sites load their data from a JSON API. Record the calls this page makes, point at a value you can see, and get the request that returns it."
                    points={['Works for infinite scroll and "Load more" lists', 'Finds the exact JSON path of a value, and the whole list it belongs to', 'Copy the call as cURL, fetch, Python… or save the list as a table']} />
            )}

            <Step n={1} title="Record the page's calls" done={captured}
                hint={recording ? undefined : captured ? undefined : '“Reload & record” catches the calls made while the page loads (most data). Use “Record from now” to keep the page as it is, then scroll or click “Load more”.'}>
                {!recording ? (
                    <Stack direction="row" spacing={1}>
                        <Button fullWidth variant={captured ? 'outlined' : 'contained'} color="warning" startIcon={<RotateCw size={14} />} onClick={() => start(true)} disabled={!page.web}
                            sx={captured ? undefined : { color: '#1a1205', fontWeight: 700 }}>Reload & record</Button>
                        <Button fullWidth variant="outlined" startIcon={<Circle size={12} />} onClick={() => start(false)} disabled={!page.web}>Record from now</Button>
                    </Stack>
                ) : (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, border: 1, borderColor: 'rgba(244,63,94,0.4)', bgcolor: 'rgba(244,63,94,0.06)', borderRadius: '12px', px: 1.25, py: 0.75 }}>
                        <Circle size={10} fill="#F43F5E" color="#F43F5E" style={{ animation: 'blink 1.2s ease-in-out infinite' }} />
                        <style>{'@keyframes blink { 50% { opacity: .25 } }'}</style>
                        <Typography variant="caption" sx={{ flex: 1, color: 'text.primary' }}>
                            Recording · <b>{entries.length}</b> JSON response{entries.length !== 1 ? 's' : ''}. Use the page now: scroll, filter, load more.
                        </Typography>
                        <Button size="small" variant="outlined" color="inherit" startIcon={<Square size={11} />} onClick={stop}>Stop</Button>
                    </Box>
                )}
                {!recording && captured && (
                    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mt: 0.75 }}>
                        <Typography variant="caption" sx={{ flex: 1 }}>{entries.length} JSON response{entries.length !== 1 ? 's' : ''} captured.</Typography>
                        <Button size="small" startIcon={<RotateCw size={12} />} onClick={refresh}>Refresh</Button>
                        <Button size="small" color="inherit" startIcon={<Trash2 size={12} />} onClick={clear}>Clear</Button>
                    </Stack>
                )}
                {!recording && hookPresent && !captured && (
                    <Typography variant="caption" display="block" sx={{ mt: 0.75 }}>No JSON calls seen yet. The data may be in the HTML itself (see Page Recon).</Typography>
                )}
            </Step>
            {error && <Alert severity="warning" variant="outlined" onClose={() => setError(null)}>{error}</Alert>}

            <Step n={2} title="Find a value you see on the page" done={groups.length > 0}
                hint={captured ? 'A price, a title, a name: the response that contains it is the API you want.' : 'Record first, then search the captured responses.'}>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <TextField size="small" fullWidth placeholder="e.g. $24.99 or a product name" disabled={!captured}
                        value={query} onChange={e => setQuery(e.target.value)}
                        inputProps={{ 'aria-label': 'Value to find' }}
                        InputProps={{
                            startAdornment: <InputAdornment position="start"><Search size={14} style={{ opacity: 0.6 }} /></InputAdornment>,
                            endAdornment: query ? <InputAdornment position="end"><IconButton size="small" onClick={() => setQuery('')} aria-label="Clear"><X size={13} /></IconButton></InputAdornment> : undefined,
                        }} />
                    <Tooltip title="Pick the value on the page">
                        <span><Button variant="outlined" onClick={pickFromPage} disabled={picking || !captured} sx={{ minWidth: 0, px: 1.25, height: '100%' }}><Crosshair size={16} /></Button></span>
                    </Tooltip>
                </Box>
                {picking && <Typography variant="caption" display="block" sx={{ mt: 0.5, color: 'warning.main' }}>Click the value on the page (Esc cancels)…</Typography>}
                {query.trim() && captured && groups.length === 0 && (
                    <Alert severity="info" variant="outlined" sx={{ mt: 1, '& .MuiAlert-message': { fontSize: '0.7rem' } }}>
                        No captured response contains “{query.slice(0, 40)}”. It may be in the HTML the server sent (check Page Recon), or loaded before recording started: try “Reload & record”.
                    </Alert>
                )}
                {query.trim() && groups.length > 0 && (
                    <Typography variant="caption" display="block" sx={{ mt: 0.5, color: 'success.main' }}>
                        Found in {groups.length} response{groups.length !== 1 ? 's' : ''}{groups.length > 1 ? ', the most direct first' : ''}.
                    </Typography>
                )}
            </Step>

            {captured && (
                <Step n={3} title="Use the API" hint={selectedEntry ? undefined : 'Choose a response to see its request, paging and code.'}>
                    <Stack spacing={0.5} sx={{ maxHeight: selectedEntry ? 220 : 420, overflowY: 'auto', pr: 0.25 }}>
                        {list.slice(0, LIST_MAX).map(e => (
                            <ResponseRow key={e.seq} e={e} hits={groups.find(g => g.entry.seq === e.seq)?.hits}
                                selected={selected === e.seq} onClick={() => setSelected(selected === e.seq ? null : e.seq)} />
                        ))}
                    </Stack>
                    {list.length > LIST_MAX && <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>Showing the latest {LIST_MAX} of {list.length}. Search to narrow them down.</Typography>}

                    {selectedEntry && (
                        <Stack spacing={1} sx={{ mt: 1.25 }}>
                            <Box sx={{ border: 1, borderColor: 'primary.main', borderRadius: '12px', p: 1.25, bgcolor: 'rgba(6,182,212,0.04)' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                    <Link2 size={13} style={{ color: '#06B6D4', flexShrink: 0 }} />
                                    <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', flex: 1, color: 'text.primary' }}>{selectedEntry.method} {selectedEntry.url}</Typography>
                                    <CopyButton text={selectedEntry.url} label="Copy URL" />
                                </Box>
                                {selectedEntry.truncated && <Typography variant="caption" color="warning.main" display="block">Response over 2 MB: only the start was kept.</Typography>}
                                {paging.length > 0 && (
                                    <Box sx={{ mt: 0.75 }}>
                                        <Typography variant="caption" sx={{ fontWeight: 700 }}>Paging parameters: change these to get more pages</Typography>
                                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.4 }}>
                                            {paging.map(p => (
                                                <Chip key={`${p.where}-${p.name}`} size="small" variant="outlined" color={p.role === 'page' ? 'primary' : 'default'}
                                                    label={`${p.name}=${p.value.slice(0, 20)}${p.where === 'body' ? ' (body)' : ''}`} sx={{ height: 20, fontSize: '0.62rem', fontFamily: 'monospace' }} />
                                            ))}
                                        </Stack>
                                    </Box>
                                )}
                            </Box>

                            {selectedHits.length > 0 && (
                                <DetailSection icon={<MapPin size={14} />} title={`Where “${query.slice(0, 24)}” is`} summary={`${selectedHits.length} place${selectedHits.length !== 1 ? 's' : ''}`} defaultOpen>
                                    <Stack spacing={0.75}>
                                        {selectedHits.slice(0, 5).map((h, i) => {
                                            const gen = generalisePath(h.path);
                                            const count = gen ? resolvePath(parsed(selectedEntry), gen).length : 0;
                                            return (
                                                <Box key={i} sx={{ p: 0.9, bgcolor: 'rgba(0,0,0,0.25)', borderRadius: '8px' }}>
                                                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                                        <Typography variant="caption" sx={{ fontFamily: 'monospace', flex: 1, wordBreak: 'break-all', color: 'text.primary' }}>{formatPath(h.path)}</Typography>
                                                        <CopyButton text={formatPath(h.path)} label="Copy path" size={13} />
                                                    </Box>
                                                    {gen && (
                                                        <>
                                                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                                                <Typography variant="caption" sx={{ color: 'success.main', fontFamily: 'monospace', flex: 1, wordBreak: 'break-all' }}>
                                                                    {formatPath(gen)} · every item ({count})
                                                                </Typography>
                                                                <CopyButton text={formatPath(gen)} label="Copy list path" size={13} />
                                                            </Box>
                                                            <Button size="small" variant="contained" color="success" startIcon={<Table2 size={13} />} onClick={() => saveAsTable(selectedEntry, h)}
                                                                sx={{ mt: 0.75, color: '#04130d', fontWeight: 700 }}>
                                                                Save all {count} as a table
                                                            </Button>
                                                        </>
                                                    )}
                                                </Box>
                                            );
                                        })}
                                    </Stack>
                                    {savedNote && <Typography variant="caption" color="success.main" display="block" sx={{ mt: 0.75 }}>{savedNote}</Typography>}
                                </DetailSection>
                            )}

                            <DetailSection icon={<Code2 size={14} />} title="Call it from code" summary={REQUEST_TARGET_LABELS[target]} defaultOpen>
                                <ToggleButtonGroup size="small" exclusive value={target} onChange={(_, v) => v && setTarget(v)} sx={{ flexWrap: 'wrap', mb: 0.75, gap: 0.5, '& .MuiToggleButtonGroup-grouped': { border: '1px solid rgba(255,255,255,0.08) !important', borderRadius: '6px !important' } }}>
                                    {(Object.keys(REQUEST_TARGET_LABELS) as RequestTarget[]).map(k => (
                                        <ToggleButton key={k} value={k} sx={{ py: 0.2, px: 0.9, fontSize: '0.64rem', textTransform: 'none' }}>{REQUEST_TARGET_LABELS[k]}</ToggleButton>
                                    ))}
                                </ToggleButtonGroup>
                                <Stack direction="row" spacing={1}>
                                    {hasSensitiveHeaders(selectedEntry) && (
                                        <FormControlLabel control={<Checkbox size="small" checked={includeAuth} onChange={e => setIncludeAuth(e.target.checked)} />}
                                            label={<Typography variant="caption">Include auth headers</Typography>} />
                                    )}
                                    <FormControlLabel control={<Checkbox size="small" checked={cookie !== null} onChange={e => loadCookie(e.target.checked)} />}
                                        label={<Typography variant="caption">Include cookies</Typography>} />
                                </Stack>
                                {(includeAuth || cookie) && (
                                    <Box sx={{ display: 'flex', gap: 0.75, mb: 0.75 }}>
                                        <ShieldAlert size={13} style={{ color: '#F59E0B', marginTop: 1, flexShrink: 0 }} />
                                        <Typography variant="caption" color="warning.main">This code now contains your session secrets. Don't share it. Cookies the page can't read (HttpOnly) are not included.</Typography>
                                    </Box>
                                )}
                                <CodeBlock code={snippet} maxHeight={260} />
                                <Button size="small" startIcon={<Copy size={12} />} sx={{ mt: 0.5 }} onClick={() => copyText(selectedEntry.responseText)}>Copy the response JSON</Button>
                            </DetailSection>
                        </Stack>
                    )}
                </Step>
            )}
        </Stack>
    );
}
