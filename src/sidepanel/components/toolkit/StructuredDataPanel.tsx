/**
 * Data on this page (docs/plans/automation-and-page-tools-plan.md §3.8), two tabs:
 * - Extract: the items and lists in the page's JSON, their attributes ticked into rows (`page-data/`);
 * - Inspect: JSON-LD, microdata, RDFa, meta tags and app state as trees, with search, checks against
 *   schema.org, copy value / path / pointer, and "Use in AI Extract" for an entity.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Database, RotateCw, Search, Sparkles } from 'lucide-react';
import { Button, Chip, IconButton, Notice, Segmented, Skeleton, Stack, Text, TextField, cx } from '../../ui';
import { useToolkit } from './context';
import { CopyButton, GroupLabel } from './ui';
import { checkSources, dottedPath, jsonPointer, schemaLines, searchTree, typeOf, type PageDataSource, type Path } from '../../../shared/structured/pageData';
import { setExtractDraft } from '../../services/ai/extractDraft';
import PageDataExtract from './page-data/PageDataExtract';

/** Children shown before "Show more". */
const PAGE = 100;

const KIND: Record<PageDataSource['kind'], string> = { 'json-ld': 'JSON-LD', microdata: 'Microdata', rdfa: 'RDFa', meta: 'Meta', 'app-state': 'App state' };

const key = (path: Path) => JSON.stringify(path);

function preview(v: unknown): string {
    if (Array.isArray(v)) return `[${v.length}]`;
    if (v && typeof v === 'object') { const t = typeOf(v); return t ? `${t} {…}` : `{${Object.keys(v).length}}`; }
    if (typeof v === 'string') return JSON.stringify(v.length > 120 ? `${v.slice(0, 120)}…` : v);
    return String(v);
}

interface Selected { source: number; path: Path; value: unknown }

function Node({ name, value, path, depth, source, open, toggle, selected, select, hits }: {
    name: string | number | null; value: unknown; path: Path; depth: number; source: number;
    open: Set<string>; toggle: (k: string) => void; selected: Selected | null; select: (s: Selected) => void; hits: Set<string>;
}) {
    const [shown, setShown] = useState(PAGE);
    const k = `${source}:${key(path)}`;
    const branch = !!value && typeof value === 'object';
    const isOpen = open.has(k);
    const entries: [string | number, unknown][] = branch ? (Array.isArray(value) ? value.map((v, i) => [i, v]) : Object.entries(value as object)) : [];
    const isSelected = selected?.source === source && key(selected.path) === key(path);
    const type = branch ? typeOf(value) : undefined;
    return (
        <div>
            <div role="treeitem" aria-expanded={branch ? isOpen : undefined} aria-selected={isSelected} tabIndex={0}
                className={cx('flex cursor-pointer items-baseline gap-1 rounded px-1 py-px font-mono text-[11.5px] leading-5 hover:bg-ink/5',
                    isSelected && 'bg-brand/40 hover:bg-brand/40', hits.has(k) && !isSelected && 'bg-warning-soft')}
                style={{ paddingLeft: depth * 12 + 4 }}
                onClick={() => { select({ source, path, value }); if (branch) toggle(k); }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select({ source, path, value }); if (branch) toggle(k); } }}>
                <ChevronRight size={12} className={cx('shrink-0 self-center text-ink-3 transition-transform', !branch && 'invisible', isOpen && 'rotate-90')} />
                {name !== null && <span className="shrink-0 text-ink-2">{name}:</span>}
                {type && <Chip tone="info" className="self-center">{type}</Chip>}
                <span className={cx('min-w-0 break-all', branch ? 'text-ink-3' : typeof value === 'string' ? 'text-success' : 'text-info')}>{type ? '' : preview(value)}</span>
            </div>
            {branch && isOpen && (
                <div role="group">
                    {entries.slice(0, shown).map(([n, v]) => (
                        <Node key={String(n)} name={n} value={v} path={[...path, n]} depth={depth + 1} source={source}
                            open={open} toggle={toggle} selected={selected} select={select} hits={hits} />
                    ))}
                    {entries.length > shown && (
                        <button type="button" className="cursor-pointer border-0 bg-transparent py-0.5 text-caption font-semibold text-accent" style={{ paddingLeft: (depth + 1) * 12 + 20 }}
                            onClick={() => setShown(s => s + PAGE)}>Show {Math.min(PAGE, entries.length - shown)} more of {entries.length - shown}</button>
                    )}
                </div>
            )}
        </div>
    );
}

function InspectData() {
    const { page, send, navigate } = useToolkit();
    const [sources, setSources] = useState<PageDataSource[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState<Set<string>>(new Set());
    const [selected, setSelected] = useState<Selected | null>(null);

    const read = useCallback(async () => {
        setError(null);
        setSources(null);
        setSelected(null);
        try {
            const reply = await send('PAGE_DATA');
            setSources(reply.sources);
            // Each source and its first level open.
            setOpen(new Set(reply.sources.flatMap((_, i) => [`${i}:${key([])}`])));
        } catch (e) {
            setError((e as Error).message);
            setSources([]);
        }
    }, [send]);

    useEffect(() => { if (page.web) void read(); }, [read, page.url, page.web]);

    const checks = useMemo(() => (sources ? checkSources(sources) : []), [sources]);
    const hits = useMemo(() => {
        const out = new Set<string>();
        const expand = new Set<string>();
        if (!sources || query.trim().length < 2) return { out, expand };
        sources.forEach((s, i) => {
            for (const p of searchTree(s.data, query)) {
                out.add(`${i}:${key(p)}`);
                for (let d = 0; d < p.length; d++) expand.add(`${i}:${key(p.slice(0, d))}`);
            }
        });
        return { out, expand };
    }, [sources, query]);
    const shownOpen = useMemo(() => new Set([...open, ...hits.expand]), [open, hits]);

    const toggle = (k: string) => setOpen(prev => { const next = new Set(prev); if (next.has(k)) next.delete(k); else next.add(k); return next; });

    if (!page.web) return <Notice tone="info">Open a web page to see its data.</Notice>;
    if (!sources) return <Stack gap={2}><Skeleton className="h-10" /><Skeleton className="h-40" /></Stack>;

    const missing = checks.filter(c => c.level !== 'recommended');
    const suggestions = checks.filter(c => c.level === 'recommended');
    const entity = selected && typeOf(selected.value) ? selected.value as Record<string, unknown> : null;
    const useInAiExtract = () => {
        if (!entity) return;
        setExtractDraft(schemaLines(entity));
        navigate?.('ai-extract');
    };

    return (
        <Stack gap={3}>
            <div className="flex items-center gap-2">
                <TextField size="sm" className="flex-1" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search keys and values" start={<Search size={14} />} aria-label="Search the data" />
                <IconButton label="Read again" variant="ghost" size="sm" onClick={() => void read()}><RotateCw /></IconButton>
            </div>
            {error && <Notice tone="warning">{error}</Notice>}
            {sources.length === 0 && !error && (
                <Notice tone="info" icon={<Database />}>No JSON-LD, microdata, meta tags or app state on this page. Its data is only in the HTML (or comes from an API: try the API Finder).</Notice>
            )}
            {missing.length > 0 && (
                <Notice tone="warning" title={`${missing.length} problem${missing.length !== 1 ? 's' : ''}`}>
                    <ul className="m-0 list-disc pl-4">{missing.map((c, i) => <li key={i}>{c.message}</li>)}</ul>
                </Notice>
            )}
            {suggestions.length > 0 && (
                <Text size="caption" tone="muted">Recommended but missing: {suggestions.map(c => c.message.replace(' (recommended)', '')).join(' · ')}</Text>
            )}
            {query.trim().length >= 2 && <Text size="caption" tone="muted" data-testid="data-hits">{hits.out.size} match{hits.out.size !== 1 ? 'es' : ''}</Text>}

            <div role="tree" aria-label="Data on this page" data-testid="data-tree">
                {sources.map((s, i) => (
                    <div key={i} className="mb-2 rounded-field border border-line p-1.5">
                        <div className="mb-1 flex items-center gap-2 px-1">
                            <Chip>{KIND[s.kind]}</Chip>
                            <Text size="caption" weight="semibold" truncate className="flex-1">{s.label}</Text>
                            <Text size="caption" tone="faint">{s.kind === 'json-ld' || s.kind === 'app-state' ? `${(s.size / 1024).toFixed(1)} KB` : `${s.size} ${s.kind === 'meta' ? 'tags' : 'items'}`}</Text>
                        </div>
                        {s.error && <Text size="caption" tone="danger" className="px-1">Not valid JSON: {s.error}</Text>}
                        {s.tooLarge && <Text size="caption" tone="muted" className="px-1">Too large to show here ({(s.size / 1e6).toFixed(1)} MB).</Text>}
                        {s.data !== undefined && (
                            <Node name={null} value={s.data} path={[]} depth={0} source={i} open={shownOpen} toggle={toggle}
                                selected={selected} select={setSelected} hits={hits.out} />
                        )}
                    </div>
                ))}
            </div>

            {selected && (
                <div className="sticky bottom-0 -mx-4 -mb-4 border-t border-line bg-surface p-3" data-testid="data-selected">
                    <GroupLabel>Selected</GroupLabel>
                    <Text size="caption" className="font-mono break-all" data-testid="data-path">{dottedPath(selected.path) || '(whole source)'}</Text>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                        <span className="flex items-center gap-0.5 text-caption text-ink-2">Value <CopyButton label="Copy value" text={typeof selected.value === 'string' ? selected.value : JSON.stringify(selected.value, null, 2)} /></span>
                        <span className="flex items-center gap-0.5 text-caption text-ink-2">Path <CopyButton label="Copy path" text={dottedPath(selected.path)} /></span>
                        <span className="flex items-center gap-0.5 text-caption text-ink-2">Pointer <CopyButton label="Copy JSON pointer" text={jsonPointer(selected.path)} /></span>
                        {entity && navigate && <Button size="sm" variant="primary" className="ml-auto" icon={<Sparkles />} onClick={useInAiExtract}>Use in AI Extract</Button>}
                    </div>
                </div>
            )}
        </Stack>
    );
}

export default function StructuredDataPanel() {
    const { page } = useToolkit();
    const [tab, setTab] = useState<'extract' | 'inspect'>('extract');
    if (!page.web) return <Notice tone="info">Open a web page to see its data.</Notice>;
    return (
        <Stack gap={3}>
            <Segmented tabs fullWidth size="sm" value={tab} onChange={setTab} aria-label="Data on this page"
                options={[{ value: 'extract', label: 'Extract' }, { value: 'inspect', label: 'Inspect' }]} />
            {tab === 'extract' ? <PageDataExtract onBrowse={() => setTab('inspect')} /> : <InspectData />}
        </Stack>
    );
}
