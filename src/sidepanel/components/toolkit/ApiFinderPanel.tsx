import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, Chip, FormControlLabel, IconButton, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import { Circle, RotateCw, Square, Crosshair, Copy, Check, Table2, Search, Trash2 } from 'lucide-react';
import type { NetEntry } from '../../../shared/network/types';
import { findValuePaths, formatPath, generalisePath, resolvePath, arrayPathOf, ValueHit } from '../../../shared/network/jsonSearch';
import { tableFromArray } from '../../../shared/network/arrayTable';
import { REQUEST_TARGET_LABELS, RequestTarget, toRequestSnippet, detectPagingParams, hasSensitiveHeaders } from '../../../shared/network/requestSnippets';
import { db } from '../../../shared/db/db-manager';
import { on, sendToActiveTab } from '../../../shared/messages';
import { copyText } from '../../services/clipboard';
import { startRecording, stopRecording, isRecordingRegistered } from './apiRecording';

const POLL_MS = 2000;

function shortUrl(u: string): string {
    try {
        const url = new URL(u);
        return `${url.pathname}${url.search}`.slice(0, 90) || '/';
    } catch {
        return u.slice(0, 90);
    }
}

function CopyBtn({ text }: { text: string }) {
    const [done, setDone] = useState(false);
    return (
        <Tooltip title={done ? 'Copied' : 'Copy'}>
            <IconButton size="small" onClick={async () => { await copyText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}>
                {done ? <Check size={14} /> : <Copy size={14} />}
            </IconButton>
        </Tooltip>
    );
}

interface HitGroup {
    entry: NetEntry;
    hits: ValueHit[];
}

export default function ApiFinderPanel() {
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

    const refresh = useCallback(async () => {
        try {
            const res = await sendToActiveTab('NET_LIST');
            setHookPresent(res.installed);
            if (res.installed) setEntries(res.entries);
        } catch (e: any) {
            setError(e.message);
        }
    }, []);

    useEffect(() => {
        isRecordingRegistered().then(setRecording);
        refresh();
        return on('LAB_PICKED', picked => {
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
            await startRecording(reload);
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
        await sendToActiveTab('NET_CLEAR').catch(() => undefined);
        parsedCache.current.clear();
        setEntries([]);
        setSelected(null);
    };

    const pickFromPage = async () => {
        setError(null);
        try {
            await sendToActiveTab('LAB_PICK_START');
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

    const selectedEntry = entries.find(e => e.seq === selected) ?? null;
    const selectedHits = groups.find(g => g.entry.seq === selected)?.hits ?? [];

    const loadCookie = async (on: boolean) => {
        if (!on) { setCookie(null); return; }
        try {
            const res = await sendToActiveTab('PAGE_COOKIE');
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
        let host = '';
        try { host = new URL(entry.url).host; } catch { /* keep empty */ }
        const tableId = await db.saveExtraction({
            type: 'list',
            items: rows,
            columns: columns.map((c, i) => ({ id: c, name: c, type: 'text' as const, order: i })),
            source_url: entry.url,
            count: rows.length,
            timestamp: new Date().toISOString(),
        }, { name: `API · ${host} ${formatPath(arrPath)}` });
        setSavedNote(`Saved ${rows.length} rows.`);
        chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?view=data-table&tableDataId=${tableId}`) });
    };

    const list = query.trim() ? groups.map(g => g.entry) : [...entries].reverse();

    return (
        <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
                Record the JSON calls this page makes, then point at a value to find the API that returns it. Often the fastest scraper skips the page and calls that API directly.
            </Typography>

            {!recording ? (
                <Stack direction="row" spacing={1}>
                    <Button fullWidth variant="contained" startIcon={<RotateCw size={15} />} onClick={() => start(true)}>Reload & record</Button>
                    <Button fullWidth variant="outlined" startIcon={<Circle size={13} />} onClick={() => start(false)}>Record from now</Button>
                </Stack>
            ) : (
                <Stack direction="row" spacing={1} alignItems="center">
                    <Chip size="small" color="error" icon={<Circle size={10} fill="currentColor" />} label={`Recording · ${entries.length} JSON responses`} />
                    <Box sx={{ flex: 1 }} />
                    <Button size="small" variant="outlined" startIcon={<Square size={12} />} onClick={stop}>Stop</Button>
                </Stack>
            )}
            {!recording && hookPresent && entries.length > 0 && (
                <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>{entries.length} JSON responses captured on this page.</Typography>
                    <Button size="small" startIcon={<RotateCw size={12} />} onClick={refresh}>Refresh</Button>
                    <Button size="small" startIcon={<Trash2 size={12} />} onClick={clear}>Clear</Button>
                </Stack>
            )}
            {error && <Alert severity="warning" variant="outlined" onClose={() => setError(null)}>{error}</Alert>}

            <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField size="small" fullWidth placeholder="Find a value you see on the page, e.g. a price or title"
                    value={query} onChange={e => setQuery(e.target.value)}
                    InputProps={{ startAdornment: <Search size={14} style={{ marginRight: 6, opacity: 0.6 }} /> }} />
                <Tooltip title="Pick a value on the page">
                    <span>
                        <Button variant="outlined" onClick={pickFromPage} disabled={picking} sx={{ minWidth: 0, px: 1.25, height: '100%' }}><Crosshair size={16} /></Button>
                    </span>
                </Tooltip>
            </Box>
            {picking && <Typography variant="caption" color="text.secondary">Click a value on the page (Esc to cancel)…</Typography>}
            {query.trim() && entries.length > 0 && groups.length === 0 && (
                <Typography variant="caption" color="text.secondary">No captured response contains this value. It may be rendered into the HTML on the server (check Page Recon), or loaded before recording started; try “Reload & record”.</Typography>
            )}

            <Stack spacing={0.5}>
                {list.slice(0, 80).map(e => {
                    const hits = groups.find(g => g.entry.seq === e.seq)?.hits;
                    return (
                        <Box key={e.seq} onClick={() => setSelected(selected === e.seq ? null : e.seq)}
                            sx={{ border: 1, borderColor: selected === e.seq ? 'primary.main' : 'divider', borderRadius: 1.5, px: 1, py: 0.75, cursor: 'pointer' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                <Chip size="small" label={e.method} sx={{ height: 18, fontSize: 10, fontWeight: 700 }} />
                                <Typography variant="caption" sx={{ fontFamily: 'monospace', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortUrl(e.url)}</Typography>
                                <Typography variant="caption" color={e.status >= 400 ? 'error' : 'text.secondary'}>{e.status}</Typography>
                                <Typography variant="caption" color="text.secondary">{(e.size / 1024).toFixed(0)}K</Typography>
                            </Box>
                            {hits && (
                                <Typography variant="caption" color="success.main" sx={{ fontFamily: 'monospace', display: 'block', mt: 0.25 }}>
                                    {formatPath(hits[0].path)}{hits.length > 1 ? `  +${hits.length - 1}` : ''}
                                </Typography>
                            )}
                        </Box>
                    );
                })}
            </Stack>

            {selectedEntry && (
                <Box sx={{ border: 1, borderColor: 'primary.main', borderRadius: 2, p: 1.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Typography variant="caption" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', flex: 1 }}>{selectedEntry.method} {selectedEntry.url}</Typography>
                        <CopyBtn text={selectedEntry.url} />
                    </Box>
                    {selectedEntry.truncated && <Typography variant="caption" color="warning.main" display="block">Response over 2 MB: only the start was kept.</Typography>}

                    {detectPagingParams(selectedEntry).length > 0 && (
                        <Box sx={{ mt: 1 }}>
                            <Typography variant="caption" color="text.secondary">Paging parameters</Typography>
                            <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                {detectPagingParams(selectedEntry).map(p => (
                                    <Chip key={`${p.where}-${p.name}`} size="small" variant="outlined" color={p.role === 'page' ? 'primary' : 'default'}
                                        label={`${p.name}=${p.value.slice(0, 20)}${p.where === 'body' ? ' (body)' : ''}`} />
                                ))}
                            </Stack>
                        </Box>
                    )}

                    {selectedHits.length > 0 && (
                        <Box sx={{ mt: 1 }}>
                            <Typography variant="caption" color="text.secondary">Where “{query.slice(0, 30)}” is</Typography>
                            {selectedHits.slice(0, 5).map((h, i) => {
                                const gen = generalisePath(h.path);
                                const count = gen ? resolvePath(parsed(selectedEntry), gen).length : 0;
                                return (
                                    <Box key={i} sx={{ mt: 0.5, p: 0.75, bgcolor: 'action.hover', borderRadius: 1 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                            <Typography variant="caption" sx={{ fontFamily: 'monospace', flex: 1, wordBreak: 'break-all' }}>{formatPath(h.path)}</Typography>
                                            <CopyBtn text={formatPath(h.path)} />
                                        </Box>
                                        {gen && (
                                            <>
                                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                                    <Typography variant="caption" color="success.main" sx={{ fontFamily: 'monospace', flex: 1, wordBreak: 'break-all' }}>
                                                        {formatPath(gen)} · {count} items
                                                    </Typography>
                                                    <CopyBtn text={formatPath(gen)} />
                                                </Box>
                                                <Button size="small" startIcon={<Table2 size={13} />} onClick={() => saveAsTable(selectedEntry, h)} sx={{ mt: 0.25 }}>
                                                    Save the list as a table
                                                </Button>
                                            </>
                                        )}
                                    </Box>
                                );
                            })}
                        </Box>
                    )}
                    {savedNote && <Typography variant="caption" color="success.main">{savedNote}</Typography>}

                    <Box sx={{ mt: 1.5 }}>
                        <ToggleButtonGroup size="small" exclusive value={target} onChange={(_, v) => v && setTarget(v)} sx={{ flexWrap: 'wrap', mb: 0.5 }}>
                            {(Object.keys(REQUEST_TARGET_LABELS) as RequestTarget[]).map(k => (
                                <ToggleButton key={k} value={k} sx={{ py: 0.25, px: 0.75, fontSize: 10, textTransform: 'none' }}>{REQUEST_TARGET_LABELS[k]}</ToggleButton>
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
                            <Typography variant="caption" color="warning.main" display="block" sx={{ mb: 0.5 }}>
                                This code now contains your session secrets. Don't share it. Cookies the page can't read (HttpOnly) are not included.
                            </Typography>
                        )}
                        <Box sx={{ position: 'relative' }}>
                            <Box component="pre" sx={{ m: 0, p: 1, pr: 4, fontSize: 11, maxHeight: 260, overflow: 'auto', bgcolor: 'background.default', border: 1, borderColor: 'divider', borderRadius: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                {toRequestSnippet(target, selectedEntry, { includeAuth, cookie: cookie || undefined })}
                            </Box>
                            <Box sx={{ position: 'absolute', top: 2, right: 2 }}>
                                <CopyBtn text={toRequestSnippet(target, selectedEntry, { includeAuth, cookie: cookie || undefined })} />
                            </Box>
                        </Box>
                        <Button size="small" startIcon={<Copy size={12} />} sx={{ mt: 0.5 }} onClick={() => copyText(selectedEntry.responseText)}>Copy response JSON</Button>
                    </Box>
                </Box>
            )}
        </Stack>
    );
}
