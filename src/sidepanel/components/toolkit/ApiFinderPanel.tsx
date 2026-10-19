import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox, Chip, IconButton, Notice, Stack, Text, TextField, ToggleChip, cx } from '../../ui';
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
        <div onClick={onClick} role="button" aria-pressed={selected}
            className={cx('cursor-pointer rounded-field border px-2.5 py-1.5 transition-colors hover:border-line-strong',
                selected ? 'border-[1.5px] border-line-strong bg-brand/15' : hits ? 'border-success/45' : 'border-line')}>
            <div className="flex items-center gap-1.5">
                <span className={cx('rounded-md px-1.5 py-px text-[10px] font-extrabold', e.method === 'GET' ? 'bg-tile-sky text-ink' : 'bg-tile-lilac text-ink')}>{e.method}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-caption text-ink" title={e.url}>{path}</span>
                <span className={cx('text-caption font-semibold', e.status >= 400 ? 'text-danger' : 'text-ink-2')}>{e.status}</span>
                <span className="text-caption text-ink-3">{e.size >= 1024 ? `${(e.size / 1024).toFixed(0)} KB` : `${e.size} B`}</span>
            </div>
            <div className="text-[10.5px] text-ink-3">{host}</div>
            {hits && (
                <div className="mt-0.5 font-mono text-caption text-success">
                    ✓ {formatPath(hits[0].path)}{hits.length > 1 ? `  (+${hits.length - 1} more)` : ''}
                </div>
            )}
        </div>
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
        <Stack gap={4}>
            {!captured && !recording && (
                <ToolIntro icon={<Network />} title="Skip the page, call its API"
                    text="Many sites load their data from a JSON API. Record the calls this page makes, point at a value you can see, and get the request that returns it."
                    points={['Works for infinite scroll and "Load more" lists', 'Finds the exact JSON path of a value, and the whole list it belongs to', 'Copy the call as cURL, fetch, Python… or save the list as a table']} />
            )}

            <Step n={1} title="Record the page's calls" done={captured}
                hint={recording ? undefined : captured ? undefined : '“Reload & record” catches the calls made while the page loads (most data). Use “Record from now” to keep the page as it is, then scroll or click “Load more”.'}>
                {!recording ? (
                    <div className="flex gap-2">
                        <Button className="flex-1" variant={captured ? 'secondary' : 'primary'} icon={<RotateCw />} onClick={() => start(true)} disabled={!page.web}>Reload & record</Button>
                        <Button className="flex-1" icon={<Circle />} onClick={() => start(false)} disabled={!page.web}>Record from now</Button>
                    </div>
                ) : (
                    <div className="flex items-center gap-2.5 rounded-2xl bg-danger-soft px-3 py-2">
                        <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-danger" />
                        <Text size="caption" className="flex-1">
                            Recording · <b>{entries.length}</b> JSON response{entries.length !== 1 ? 's' : ''}. Use the page now: scroll, filter, load more.
                        </Text>
                        <Button size="sm" icon={<Square />} onClick={stop}>Stop</Button>
                    </div>
                )}
                {!recording && captured && (
                    <div className="mt-1.5 flex items-center gap-1">
                        <Text size="caption" tone="muted" className="flex-1">{entries.length} JSON response{entries.length !== 1 ? 's' : ''} captured.</Text>
                        <Button size="sm" variant="ghost" icon={<RotateCw />} onClick={refresh}>Refresh</Button>
                        <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={clear}>Clear</Button>
                    </div>
                )}
                {!recording && hookPresent && !captured && (
                    <Text size="caption" tone="muted" className="mt-1.5">No JSON calls seen yet. The data may be in the HTML itself (see Page Recon).</Text>
                )}
            </Step>
            {error && <Notice tone="warning" onClose={() => setError(null)}>{error}</Notice>}

            <Step n={2} title="Find a value you see on the page" done={groups.length > 0}
                hint={captured ? 'A price, a title, a name: the response that contains it is the API you want.' : 'Record first, then search the captured responses.'}>
                <div className="flex gap-2">
                    <TextField className="flex-1" placeholder="e.g. $24.99 or a product name" disabled={!captured} aria-label="Value to find"
                        value={query} onChange={e => setQuery(e.target.value)} start={<Search />}
                        end={query ? <IconButton size="sm" label="Clear" noTooltip onClick={() => setQuery('')}><X /></IconButton> : undefined} />
                    <IconButton variant="secondary" size="lg" label="Pick the value on the page" onClick={pickFromPage} disabled={picking || !captured}><Crosshair /></IconButton>
                </div>
                {picking && <Text size="caption" tone="warning" className="mt-1">Click the value on the page (Esc cancels)…</Text>}
                {query.trim() && captured && groups.length === 0 && (
                    <Notice tone="info" className="mt-2">
                        No captured response contains “{query.slice(0, 40)}”. It may be in the HTML the server sent (check Page Recon), or loaded before recording started: try “Reload & record”.
                    </Notice>
                )}
                {query.trim() && groups.length > 0 && (
                    <Text size="caption" tone="success" weight="semibold" className="mt-1">
                        Found in {groups.length} response{groups.length !== 1 ? 's' : ''}{groups.length > 1 ? ', the most direct first' : ''}.
                    </Text>
                )}
            </Step>

            {captured && (
                <Step n={3} title="Use the API" hint={selectedEntry ? undefined : 'Choose a response to see its request, paging and code.'}>
                    <div className="flex flex-col gap-1 overflow-y-auto pr-0.5" style={{ maxHeight: selectedEntry ? 220 : 420 }}>
                        {list.slice(0, LIST_MAX).map(e => (
                            <ResponseRow key={e.seq} e={e} hits={groups.find(g => g.entry.seq === e.seq)?.hits}
                                selected={selected === e.seq} onClick={() => setSelected(selected === e.seq ? null : e.seq)} />
                        ))}
                    </div>
                    {list.length > LIST_MAX && <Text size="caption" tone="muted" className="mt-1">Showing the latest {LIST_MAX} of {list.length}. Search to narrow them down.</Text>}

                    {selectedEntry && (
                        <Stack gap={2} className="mt-3">
                            <div className="rounded-card border-[1.5px] border-line-strong bg-surface p-3">
                                <div className="flex items-center gap-1.5">
                                    <Link2 size={14} className="shrink-0 text-accent" />
                                    <Text size="caption" mono className="flex-1 break-all">{selectedEntry.method} {selectedEntry.url}</Text>
                                    <CopyButton text={selectedEntry.url} label="Copy URL" />
                                </div>
                                {selectedEntry.truncated && <Text size="caption" tone="warning">Response over 2 MB: only the start was kept.</Text>}
                                {paging.length > 0 && (
                                    <div className="mt-2">
                                        <Text size="caption" weight="bold">Paging parameters: change these to get more pages</Text>
                                        <div className="mt-1 flex flex-wrap gap-1">
                                            {paging.map(p => (
                                                <Chip key={`${p.where}-${p.name}`} tone={p.role === 'page' ? 'brand' : 'outline'} className="font-mono">
                                                    {`${p.name}=${p.value.slice(0, 20)}${p.where === 'body' ? ' (body)' : ''}`}
                                                </Chip>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {selectedHits.length > 0 && (
                                <DetailSection icon={<MapPin />} title={`Where “${query.slice(0, 24)}” is`} summary={`${selectedHits.length} place${selectedHits.length !== 1 ? 's' : ''}`} defaultOpen>
                                    <Stack gap={1.5}>
                                        {selectedHits.slice(0, 5).map((h, i) => {
                                            const gen = generalisePath(h.path);
                                            const count = gen ? resolvePath(parsed(selectedEntry), gen).length : 0;
                                            return (
                                                <div key={i} className="rounded-field bg-surface-2 p-2.5">
                                                    <div className="flex items-center">
                                                        <Text size="caption" mono className="flex-1 break-all">{formatPath(h.path)}</Text>
                                                        <CopyButton text={formatPath(h.path)} label="Copy path" />
                                                    </div>
                                                    {gen && (
                                                        <>
                                                            <div className="flex items-center">
                                                                <Text size="caption" mono tone="success" className="flex-1 break-all">{formatPath(gen)} · every item ({count})</Text>
                                                                <CopyButton text={formatPath(gen)} label="Copy list path" />
                                                            </div>
                                                            <Button size="sm" variant="brand" className="mt-2" icon={<Table2 />} onClick={() => saveAsTable(selectedEntry, h)}>
                                                                Save all {count} as a table
                                                            </Button>
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </Stack>
                                    {savedNote && <Text size="caption" tone="success" className="mt-1.5">{savedNote}</Text>}
                                </DetailSection>
                            )}

                            <DetailSection icon={<Code2 />} title="Call it from code" summary={REQUEST_TARGET_LABELS[target]} defaultOpen>
                                <div className="mb-2 flex flex-wrap gap-1">
                                    {(Object.keys(REQUEST_TARGET_LABELS) as RequestTarget[]).map(k => (
                                        <ToggleChip key={k} selected={target === k} onClick={() => setTarget(k)}>{REQUEST_TARGET_LABELS[k]}</ToggleChip>
                                    ))}
                                </div>
                                <div className="mb-2 flex flex-wrap gap-4">
                                    {hasSensitiveHeaders(selectedEntry) && <Checkbox checked={includeAuth} onChange={setIncludeAuth} label="Include auth headers" />}
                                    <Checkbox checked={cookie !== null} onChange={v => loadCookie(v)} label="Include cookies" />
                                </div>
                                {(includeAuth || cookie) && (
                                    <Notice tone="warning" icon={<ShieldAlert />} className="mb-2">
                                        This code now contains your session secrets. Don't share it. Cookies the page can't read (HttpOnly) are not included.
                                    </Notice>
                                )}
                                <CodeBlock code={snippet} maxHeight={260} />
                                <Button size="sm" variant="ghost" icon={<Copy />} className="mt-1" onClick={() => copyText(selectedEntry.responseText)}>Copy the response JSON</Button>
                            </DetailSection>
                        </Stack>
                    )}
                </Step>
            )}
        </Stack>
    );
}
