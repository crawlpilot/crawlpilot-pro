/**
 * Data on this page → Extract: the items and lists in the page's JSON (JSON-LD, `__NEXT_DATA__`, app
 * state) as cards; pick one, tick its attributes, see the rows, then run the same fields on more pages
 * (a Page Extractor recipe bound to the data, no selectors) or keep this page's rows as a table.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Braces, Files, List, RotateCw, Search, Table2 } from 'lucide-react';
import { Button, CardButton, Checkbox, Chip, IconButton, Notice, Skeleton, Stack, Text, TextField } from '../../../ui';
import { useToolkit } from '../context';
import { GroupLabel } from '../ui';
import { bindingsFor, type JsonCandidate, type PickedAttribute } from '../../../../shared/pageJson/scan';
import { FIELD_TYPE_LABELS } from '../../../../shared/transforms/chain';
import { setPageDataDraft } from '../../../services/pageDataDraft';
import { db } from '../../../../shared/db';

/** Rows shown in the preview. */
const PREVIEW_ROWS = 8;

interface Pick { on: boolean; name: string }

function CandidateCard({ c, onOpen }: { c: JsonCandidate; onOpen: () => void }) {
    return (
        <CardButton pad="sm" onClick={onOpen} data-testid="json-candidate">
            <div className="flex items-center gap-2">
                {c.kind === 'list' ? <List size={14} className="shrink-0 text-ink-3" /> : <Braces size={14} className="shrink-0 text-ink-3" />}
                <Text size="small" weight="semibold" truncate className="flex-1">{c.title}</Text>
                <Chip tone={c.kind === 'list' ? 'info' : 'neutral'}>{c.kind === 'list' ? `${c.count} items` : `${c.attributes.length} values`}</Chip>
            </div>
            {c.sample && <Text size="caption" tone="muted" truncate className="mt-0.5">{c.sample}</Text>}
            <Text size="caption" tone="faint" mono truncate className="mt-0.5">{c.where}</Text>
        </CardButton>
    );
}

export default function PageDataExtract({ onBrowse }: { onBrowse: () => void }) {
    const { page, send, navigate } = useToolkit();
    const [candidates, setCandidates] = useState<JsonCandidate[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [chosen, setChosen] = useState<JsonCandidate | null>(null);
    const [picks, setPicks] = useState<Record<string, Pick>>({});
    const [query, setQuery] = useState('');
    const [rows, setRows] = useState<Record<string, string>[]>([]);
    const [saved, setSaved] = useState<string | null>(null);

    const scan = useCallback(async () => {
        setError(null);
        setCandidates(null);
        setChosen(null);
        try {
            setCandidates((await send('PAGE_JSON_SCAN')).candidates);
        } catch (e) {
            setError((e as Error).message);
            setCandidates([]);
        }
    }, [send]);

    useEffect(() => { if (page.web) void scan(); }, [scan, page.url, page.web]);

    const open = (c: JsonCandidate) => {
        setChosen(c);
        setQuery('');
        setSaved(null);
        setPicks(Object.fromEntries(c.attributes.map(a => [a.key, { on: a.suggested, name: a.name }])));
    };

    const ticked: PickedAttribute[] = useMemo(() => !chosen ? [] : chosen.attributes
        .filter(a => picks[a.key]?.on)
        .map(a => ({ key: a.key, name: picks[a.key].name.trim() || a.name, many: a.many })), [chosen, picks]);

    // The preview reads the page the way a run does (`readBinding`), so what is shown is what a run gets.
    useEffect(() => {
        if (!chosen || ticked.length === 0) { setRows([]); return; }
        let live = true;
        const timer = setTimeout(async () => {
            try {
                const elements = bindingsFor(chosen, ticked);
                const { values } = await send('PAGE_JSON_READ', { bindings: elements.map(e => e.data) });
                if (!live) return;
                if (chosen.kind === 'list') {
                    const cells = (values[0] ?? []) as string[][];
                    setRows(cells.map(r => Object.fromEntries(ticked.map((p, i) => [p.name, r[i] ?? '']))));
                } else {
                    setRows([Object.fromEntries(ticked.map((p, i) => [p.name, Array.isArray(values[i]) ? (values[i] as string[]).join(', ') : (values[i] as string | null) ?? '']))]);
                }
            } catch (e) {
                if (live) setError((e as Error).message);
            }
        }, 250);
        return () => { live = false; clearTimeout(timer); };
    }, [chosen, ticked, send]);

    const runOnPages = () => {
        if (!chosen || ticked.length === 0) return;
        setPageDataDraft({ elements: bindingsFor(chosen, ticked), listOutput: chosen.kind === 'list' ? 'rows' : 'nested', url: page.url });
        navigate?.('page-extractor');
    };

    const saveTable = async () => {
        if (!chosen || rows.length === 0) return;
        const tableId = await db.tables.save({
            type: 'list',
            items: rows.map(r => ({ ...r, source_url: page.url })),
            columns: ticked.map((p, i) => ({ id: p.name, name: p.name, type: 'text' as const, order: i })),
            source_url: page.url,
            count: rows.length,
            timestamp: new Date().toISOString(),
        }, { name: `${chosen.title} · ${page.host}` });
        setSaved(`Saved ${rows.length} row${rows.length !== 1 ? 's' : ''} as a table.`);
        chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?view=data-table&tableId=${tableId}`) });
    };

    if (!candidates) return <Stack gap={2}><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></Stack>;

    if (!chosen) {
        const items = candidates.filter(c => c.kind === 'item');
        const lists = candidates.filter(c => c.kind === 'list');
        return (
            <Stack gap={3}>
                <div className="flex items-center gap-2">
                    <Text size="caption" tone="muted" className="flex-1">Pick what to extract from the data this page carries. It holds when the page's layout changes.</Text>
                    <IconButton label="Scan again" variant="ghost" size="sm" onClick={() => void scan()}><RotateCw /></IconButton>
                </div>
                {error && <Notice tone="warning">{error}</Notice>}
                {candidates.length === 0 && !error && (
                    <Notice tone="info">No items or lists in this page's JSON. Use the Page or List Extractor to pick from the page instead.</Notice>
                )}
                {lists.length > 0 && <div><GroupLabel>Lists</GroupLabel><Stack gap={2}>{lists.map(c => <CandidateCard key={c.id} c={c} onOpen={() => open(c)} />)}</Stack></div>}
                {items.length > 0 && <div><GroupLabel>Items</GroupLabel><Stack gap={2}>{items.map(c => <CandidateCard key={c.id} c={c} onOpen={() => open(c)} />)}</Stack></div>}
                <Button size="sm" variant="ghost" onClick={onBrowse}>Browse the raw data</Button>
            </Stack>
        );
    }

    const q = query.trim().toLowerCase();
    const shown = chosen.attributes.filter(a => !q || a.key.toLowerCase().includes(q) || a.sample.toLowerCase().includes(q) || picks[a.key]?.name.toLowerCase().includes(q));
    const allOn = shown.length > 0 && shown.every(a => picks[a.key]?.on);
    const setPick = (key: string, next: Partial<Pick>) => setPicks(prev => ({ ...prev, [key]: { ...prev[key], ...next } }));
    const columns = ticked.map(p => p.name);

    return (
        <Stack gap={3}>
            <div className="flex items-center gap-2">
                <IconButton label="Back to what is on the page" variant="ghost" size="sm" onClick={() => setChosen(null)}><ArrowLeft /></IconButton>
                <div className="min-w-0 flex-1">
                    <Text size="small" weight="semibold" truncate>{chosen.title}{chosen.kind === 'list' ? ` · ${chosen.count} items` : ''}</Text>
                    <Text size="caption" tone="faint" mono truncate>{chosen.where}</Text>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <TextField size="sm" className="flex-1" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search attributes" start={<Search size={14} />} aria-label="Search attributes" />
                <Checkbox checked={allOn} indeterminate={!allOn && shown.some(a => picks[a.key]?.on)} label="All"
                    onChange={on => setPicks(prev => ({ ...prev, ...Object.fromEntries(shown.map(a => [a.key, { ...prev[a.key], on }])) }))} />
            </div>

            <div className="max-h-[320px] overflow-y-auto rounded-field border border-line" data-testid="json-attributes">
                {shown.map(a => (
                    <div key={a.key} className="flex items-start gap-2 border-b border-line px-2 py-1.5 last:border-b-0">
                        <Checkbox checked={!!picks[a.key]?.on} onChange={on => setPick(a.key, { on })} aria-label={`Extract ${a.key}`} />
                        <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1">
                                <input value={picks[a.key]?.name ?? a.name} onChange={e => setPick(a.key, { name: e.target.value, on: true })}
                                    aria-label={`Column name for ${a.key}`}
                                    className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-small font-semibold text-ink hover:border-line focus:border-line-strong focus:outline-none" />
                                <Chip>{a.many ? `${FIELD_TYPE_LABELS[a.type]} list` : FIELD_TYPE_LABELS[a.type]}</Chip>
                                {chosen.kind === 'list' && <Text size="caption" tone={a.fill < 0.5 ? 'warning' : 'faint'}>{Math.round(a.fill * 100)}%</Text>}
                            </div>
                            <Text size="caption" tone="faint" mono truncate className="px-1">{a.key}</Text>
                            {a.sample && <Text size="caption" tone="muted" truncate className="px-1">{a.sample}</Text>}
                        </div>
                    </div>
                ))}
                {shown.length === 0 && <Text size="caption" tone="muted" className="p-2">No attribute matches.</Text>}
            </div>

            {ticked.length > 0 && (
                <div>
                    <GroupLabel>Preview{chosen.kind === 'list' ? ` · ${rows.length} rows` : ''}</GroupLabel>
                    <div className="overflow-x-auto rounded-field border border-line" data-testid="json-preview">
                        <table className="w-full border-collapse text-caption">
                            <thead><tr>{columns.map(c => <th key={c} className="border-b border-line bg-surface-2 px-2 py-1 text-left font-semibold whitespace-nowrap">{c}</th>)}</tr></thead>
                            <tbody>
                                {rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                                    <tr key={i}>{columns.map(c => <td key={c} className="max-w-[200px] truncate border-b border-line px-2 py-1">{r[c]}</td>)}</tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {saved && <Notice tone="success">{saved}</Notice>}
            <div className="flex flex-wrap gap-2">
                <Button variant="primary" size="sm" icon={<Files />} disabled={ticked.length === 0 || !navigate} onClick={runOnPages}>Run on more pages</Button>
                <Button size="sm" icon={<Table2 />} disabled={rows.length === 0} onClick={() => void saveTable()}>Save as table</Button>
            </div>
        </Stack>
    );
}
