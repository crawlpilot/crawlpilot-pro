/**
 * One recipe's history (`docs/design/LLD.md` §10): its labels, every version with its note, what changed
 * between any two versions, restoring an old version as the newest, and moving `live` and `test` with a
 * reason. Every label move is listed.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { GitCompare, Pencil, RefreshCw, RotateCcw, Send, Tag, Wrench } from 'lucide-react';
import ToolHeader from '../../sidepanel/components/ui/ToolHeader';
import { Button, Card, Chip, Dialog, Notice, Select, Text, TextField, type ChipTone } from '../../sidepanel/ui';
import { pro } from '../db';
import { diffVersions, type ChangeKind } from '../recipe/diff';
import { readiness, type Readiness } from '../recipe/ready';
import { SubmitDialog } from './SubmitDialog';
import type { CrawlRecord } from '../db/crawls';
import { backendApi } from '../backend/settings';
import { refreshCrawls } from '../backend/submit';
import { LOCAL_AUTHOR } from '../edit';
import { openedRecipe, openRepair } from '../nav';
import { healthOf } from '../maintain';
import type { CrawlHealth } from '../recipe/health';
import type { LabelMove, LabelName, ProRecipe, Version } from '../recipe/types';

interface Props {
    onBack: () => void;
    onNavigate: (view: string) => void;
}

const KIND_TONE: Record<ChangeKind, ChipTone> = { added: 'success', removed: 'danger', renamed: 'info', changed: 'warning', moved: 'neutral' };
const when = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function LabelChips({ recipe, version }: { recipe: ProRecipe; version: number }) {
    const labels = (Object.entries(recipe.labels) as [LabelName, number][]).filter(([, v]) => v === version).map(([l]) => l);
    return <>{labels.map(l => <Chip key={l} tone={l === 'live' ? 'success' : l === 'test' ? 'warning' : 'info'}>{l}</Chip>)}</>;
}

export default function HistoryPage({ onBack, onNavigate }: Props) {
    const [recipeId] = useState(openedRecipe);
    const [recipe, setRecipe] = useState<ProRecipe | null>(null);
    const [versions, setVersions] = useState<Version[]>([]);
    const [log, setLog] = useState<LabelMove[]>([]);
    const [ready, setReady] = useState<Map<number, Readiness>>(new Map());
    const [submitting, setSubmitting] = useState<Version | null>(null);
    const [crawls, setCrawls] = useState<CrawlRecord[]>([]);
    const [health, setHealth] = useState<Map<string, CrawlHealth>>(new Map());
    const [refreshing, setRefreshing] = useState(false);
    const [pair, setPair] = useState<{ from: number; to: number } | null>(null);
    const [labelling, setLabelling] = useState<{ label: Exclude<LabelName, 'latest'>; version: number } | null>(null);
    const [reason, setReason] = useState('');
    const [error, setError] = useState<string | null>(null);

    const showCrawls = async (list: CrawlRecord[]) => {
        setCrawls(list);
        const pairs = await Promise.all(list.map(async c => [c.crawlId, await healthOf(c)] as const));
        setHealth(new Map(pairs.filter((p): p is readonly [string, CrawlHealth] => !!p[1])));
    };

    const load = useCallback(async () => {
        if (!recipeId) return;
        const [r, vs, moves] = await Promise.all([pro.recipes.get(recipeId), pro.versions.list(recipeId), pro.recipes.labelLog(recipeId)]);
        setRecipe(r ?? null);
        setVersions(vs);
        setLog(moves);
        await showCrawls(await pro.crawls.list(recipeId));
        // Each version is ready by the newest multi-page test of its spec.
        setReady(new Map(await Promise.all(vs.map(async v => [v.version, readiness((await pro.tests.latest(recipeId, v.digest, 'pages'))?.results, v)] as const))));
        // What the newest version changed, until another pair is chosen.
        setPair(p => p ?? (vs.length > 1 ? { from: vs[1].version, to: vs[0].version } : null));
    }, [recipeId]);
    useEffect(() => { void load(); }, [load]);

    const diff = useMemo(() => {
        const a = versions.find(v => v.version === pair?.from), b = versions.find(v => v.version === pair?.to);
        return a && b ? diffVersions(a, b) : null;
    }, [versions, pair]);

    if (!recipe) {
        return (
            <div className="flex h-full flex-col">
                <ToolHeader title="History" onBack={onBack} />
                <div className="p-4"><Notice tone="warning">This recipe is no longer here.</Notice></div>
            </div>
        );
    }

    const options = versions.map(v => ({ value: v.version, label: `v${v.version}${v.note ? ` · ${v.note.slice(0, 30)}` : ''}` }));

    const refresh = async () => {
        if (!recipe) return;
        setRefreshing(true);
        setError(null);
        try {
            const api = await backendApi();
            if (!api) throw new Error('Set the backend address and token first (Backend, on the Recipes screen).');
            await showCrawls(await refreshCrawls(api, recipe.id));
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        setRefreshing(false);
    };

    const restore = async (version: number) => {
        setError(null);
        try {
            const v = await pro.versions.restore(recipe.id, version, LOCAL_AUTHOR);
            setPair({ from: v.parentVersion!, to: v.version });
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        await load();
    };

    /** Live on a recipe the backend has moves there first: what it runs and what Pro shows stay the same. */
    const moveLabel = async () => {
        if (!labelling) return;
        setError(null);
        if (labelling.label === 'live' && recipe.remoteId) {
            try {
                const api = await backendApi();
                if (!api) throw new Error('Set the backend address and token first (Backend, on the Recipes screen).');
                await api.setLive(recipe.remoteId, labelling.version, reason.trim());
            } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
                setLabelling(null);
                return;
            }
        }
        await pro.recipes.moveLabel(recipe.id, labelling.label, labelling.version, LOCAL_AUTHOR, reason.trim());
        setLabelling(null);
        setReason('');
        await load();
    };

    return (
        <div className="flex h-full flex-col">
            <ToolHeader
                title={recipe.name}
                subtitle={`${recipe.site} · ${recipe.kind} · ${versions.length} version${versions.length === 1 ? '' : 's'}`}
                onBack={onBack}
                actions={<Button size="sm" variant="primary" icon={<Pencil />} onClick={() => onNavigate('pro-editor')} disabled={!versions[0]}>Edit fields</Button>}
            />
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
                {error && <Notice tone="danger" onClose={() => setError(null)}>{error}</Notice>}

                {versions.length > 1 && pair && (
                    <Card className="flex flex-col gap-2" data-testid="pro-diff">
                        <div className="flex items-end gap-2">
                            <Select size="sm" className="flex-1" label="Compare" value={pair.from} options={options} onChange={from => setPair({ ...pair, from })} />
                            <Select size="sm" className="flex-1" label="with" value={pair.to} options={options} onChange={to => setPair({ ...pair, to })} />
                        </div>
                        {diff && (diff.changes.length === 0
                            ? <Text size="small" tone="muted">No differences.</Text>
                            : <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                                {diff.changes.map((c, i) => (
                                    <li key={i} className="flex flex-col gap-0.5">
                                        <span className="flex items-center gap-1.5"><Chip tone={KIND_TONE[c.kind]}>{c.kind}</Chip><Text size="small" weight="semibold">{c.subject}</Text></span>
                                        {c.details.map(d => <Text key={d} size="caption" tone="muted" className="pl-2 break-all">{d}</Text>)}
                                    </li>
                                ))}
                            </ul>)}
                        {diff && <Text size="caption" tone={diff.outputChanged ? 'danger' : 'faint'}>{diff.outputChanged ? 'The output changes: field names, types or required.' : 'The output stays the same.'}</Text>}
                    </Card>
                )}

                {versions.map((v, i) => (
                    <div key={v.version} className="flex flex-col gap-1.5 rounded-card border border-line bg-surface p-3" data-testid="pro-version">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <Text weight="semibold">v{v.version}</Text>
                            <Chip tone="outline">{v.origin}</Chip>
                            {v.submittedAt && <Chip tone="brand">submitted</Chip>}
                            <LabelChips recipe={recipe} version={v.version} />
                        </div>
                        {v.note && <Text size="small">{v.note}</Text>}
                        {ready.get(v.version) && (ready.get(v.version)!.ready
                            ? <div><Chip tone="success">ready to submit</Chip></div>
                            : <Text size="caption" tone="warning" data-testid="pro-not-ready">Not ready: {ready.get(v.version)!.reasons.join(' ')}</Text>)}
                        <Text size="caption" tone="faint">{when(v.createdAt)} · {v.author}{v.parentVersion ? ` · from v${v.parentVersion}` : ''}</Text>
                        <div className="flex flex-wrap gap-1">
                            {versions[i + 1] && <Button size="sm" variant="ghost" icon={<GitCompare />} onClick={() => setPair({ from: v.parentVersion ?? versions[i + 1].version, to: v.version })}>Changes</Button>}
                            <Button size="sm" variant="ghost" icon={<Tag />} onClick={() => setLabelling({ label: 'live', version: v.version })} disabled={recipe.labels.live === v.version}>Mark live</Button>
                            <Button size="sm" variant="ghost" icon={<Tag />} onClick={() => setLabelling({ label: 'test', version: v.version })} disabled={recipe.labels.test === v.version}>Mark test</Button>
                            {i > 0 && <Button size="sm" variant="ghost" icon={<RotateCcw />} onClick={() => restore(v.version)}>Restore</Button>}
                            {ready.get(v.version)?.ready && <Button size="sm" variant="primary" icon={<Send />} onClick={() => setSubmitting(v)}>{v.submittedAt ? 'Crawl again' : 'Submit'}</Button>}
                        </div>
                    </div>
                ))}

                {crawls.length > 0 && (
                    <section className="flex flex-col gap-1.5" data-testid="pro-crawls">
                        <div className="flex items-center justify-between">
                            <Text size="small" weight="semibold" tone="muted">Crawls</Text>
                            <Button size="sm" variant="ghost" icon={<RefreshCw />} loading={refreshing} onClick={refresh}>Refresh</Button>
                        </div>
                        {crawls.map(c => (
                            <div key={c.crawlId} className="flex flex-col gap-0.5 rounded-xl border border-line px-3 py-2" data-testid="pro-crawl">
                                <div className="flex items-center gap-1.5">
                                    <Text size="small" weight="semibold">v{c.version}</Text>
                                    <Chip tone={c.last?.status === 'done' ? 'success' : c.last?.status === 'failed' ? 'danger' : 'info'}>{c.last?.status ?? 'started'}</Chip>
                                    {health.get(c.crawlId)?.state === 'repair' && <Chip tone="danger">needs repair</Chip>}
                                    {health.get(c.crawlId)?.state === 'watch' && <Chip tone="warning">watch</Chip>}
                                    <Text size="caption" tone="faint">{c.schedule} · {when(c.startedAt)}</Text>
                                </div>
                                {health.get(c.crawlId) && health.get(c.crawlId)!.state !== 'healthy' && (
                                    <div className="flex flex-col gap-1" data-testid="pro-crawl-health">
                                        {health.get(c.crawlId)!.fields.map(f => (
                                            <Text key={f.name} size="caption" tone={f.state === 'repair' ? 'danger' : 'warning'}>
                                                {f.name}: {Math.round(f.baseline * 100)}% when tested, {Math.round(f.now * 100)}% now
                                            </Text>
                                        ))}
                                        {health.get(c.crawlId)!.state === 'repair' && <div><Button size="sm" variant="primary" icon={<Wrench />}
                                            onClick={() => { openRepair({ recipeId: recipe.id, fields: health.get(c.crawlId)!.fields.filter(f => f.state === 'repair') }); onNavigate('pro-editor'); }}>Repair</Button></div>}
                                    </div>
                                )}
                                {c.last && <Text size="caption" tone="muted">{c.last.pagesDone} pages done{c.last.pagesFailed ? `, ${c.last.pagesFailed} failed` : ''}{c.last.fields.length ? ` · ${c.last.fields.map(f => `${f.name} ${Math.round(f.fill * 100)}%`).join(', ')}` : ''}</Text>}
                            </div>
                        ))}
                    </section>
                )}

                {log.length > 0 && (
                    <section className="flex flex-col gap-1">
                        <Text size="small" weight="semibold" tone="muted">Label moves</Text>
                        {log.map(m => (
                            <Text key={m.id} size="caption" tone="muted" data-testid="pro-label-move">
                                {m.label} {m.from ? `v${m.from} → ` : ''}v{m.to} · {when(m.at)} · {m.by}{m.reason ? ` · ${m.reason}` : ''}
                            </Text>
                        ))}
                    </section>
                )}
            </div>

            <SubmitDialog recipe={recipe} version={submitting} onClose={() => setSubmitting(null)} onSubmitted={() => void load()} />
            <Dialog open={!!labelling} onClose={() => setLabelling(null)} size="sm"
                title={labelling ? `Mark v${labelling.version} as ${labelling.label}` : ''}
                description={labelling?.label === 'live' ? 'Live is the version the backend runs. Moving it back is a rollback.' : 'Test is the version being tried before it goes live.'}
                actions={<>
                    <Button variant="ghost" onClick={() => setLabelling(null)}>Cancel</Button>
                    <Button variant="primary" onClick={moveLabel} disabled={!reason.trim()}>Move {labelling?.label}</Button>
                </>}>
                <TextField label="Why" value={reason} onChange={e => setReason(e.target.value)} placeholder="Checked on 5 pages" autoFocus />
            </Dialog>
        </div>
    );
}
