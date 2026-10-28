/**
 * How the newest version's selectors do on crawls (`recipe/wayHealth.ts`): each way's state over the last
 * 30 days, from the usage the backend reports for a submitted recipe. Clean up proposes the next version
 * without dead ways and with dormant ones last (`recipe/cleanup.ts`); saving it is a `pruned` version that
 * is tested, reviewed and submitted like any other. A proposed change can be kept instead, with why; it
 * is not proposed again (`db/dismissals.ts`).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eraser, RefreshCw, Shield } from 'lucide-react';
import { Button, Card, Chip, Dialog, Notice, Text, TextField, type ChipTone } from '../../sidepanel/ui';
import { pro } from '../db';
import type { WayDayRecord } from '../db/wayStats';
import type { CleanupDismissal } from '../db/dismissals';
import { currentUser } from '../identity';
import { backendApi } from '../backend/settings';
import { refreshWayStats } from '../backend/usage';
import { saveSpecVersion } from '../edit';
import { cleanupKey, proposeCleanup, type CleanupChange } from '../recipe/cleanup';
import { wayLabel } from '../recipe/diff';
import { MIN_PAGES, WINDOW_DAYS, wayHealth, type WayState } from '../recipe/wayHealth';
import type { ProRecipe, Version } from '../recipe/types';

interface Props {
    recipe: ProRecipe;
    /** Newest first; the first is the one judged and cleaned. */
    versions: Version[];
    onSaved: () => void;
}

const STATE: Record<WayState, { tone: ChipTone; label: string; why: string }> = {
    active: { tone: 'success', label: 'active', why: 'its value was used' },
    dormant: { tone: 'warning', label: 'dormant', why: 'found something, but another way always won' },
    dead: { tone: 'danger', label: 'dead', why: 'tried and found nothing' },
    new: { tone: 'info', label: 'new', why: `added recently, and not yet tried on ${MIN_PAGES} pages` },
    'no-data': { tone: 'neutral', label: 'no data', why: `not tried on ${MIN_PAGES} pages in ${WINDOW_DAYS} days` },
};

export function SelectorsCard({ recipe, versions, onSaved }: Props) {
    const version = versions[0];
    const [days, setDays] = useState<WayDayRecord[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [cleaning, setCleaning] = useState(false);
    const [note, setNote] = useState('');
    const [kept, setKept] = useState<CleanupDismissal[]>([]);
    const [keeping, setKeeping] = useState<CleanupChange | null>(null);
    const [why, setWhy] = useState('');

    const load = useCallback(async () => {
        const [d, k] = await Promise.all([pro.wayStats.list(recipe.id), pro.dismissals.list(recipe.id)]);
        setDays(d);
        setKept(k);
    }, [recipe.id]);
    useEffect(() => { void load(); }, [load]);

    const health = useMemo(() => version
        ? wayHealth(version.spec, days, new Map(versions.map(v => [v.version, v.createdAt])))
        : [], [version, versions, days]);
    const cleanup = useMemo(() => version
        ? proposeCleanup(version.spec, new Map(health.flatMap(o => o.ways.flatMap(w => w.way.id ? [[w.way.id, w.state] as const] : []))),
            new Set(kept.map(k => cleanupKey(k.wayId, k.action))))
        : null, [version, health, kept]);

    if (!version || health.every(o => o.ways.length === 0)) return null;

    const refresh = async () => {
        setBusy(true);
        setError(null);
        try {
            const api = await backendApi();
            if (!api) throw new Error('Set the backend address and token first (Backend, on the Recipes screen).');
            await refreshWayStats(api, recipe);
            await load();
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
        setBusy(false);
    };

    const noteFor = (changes: CleanupChange[]) => {
        const removed = changes.filter(c => c.action === 'removed').length, moved = changes.length - removed;
        return `Clean up: ${[removed && `${removed} dead removed`, moved && `${moved} moved last`].filter(Boolean).join(', ')}`;
    };

    const openCleanup = () => {
        if (!cleanup) return;
        setNote(noteFor(cleanup.changes));
        setKeeping(null);
        setCleaning(true);
    };

    /** Keeps one proposed change out, for good; the rest of the cleanup stays open. */
    const keep = async () => {
        if (!keeping?.way.id || !cleanup) return;
        setError(null);
        try {
            await pro.dismissals.dismiss({ recipeId: recipe.id, wayId: keeping.way.id, action: keeping.action, by: await currentUser(), reason: why });
            const rest = cleanup.changes.filter(c => c !== keeping);
            setKeeping(null);
            setWhy('');
            setNote(noteFor(rest));
            if (rest.length === 0) setCleaning(false);
            await load();
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    };

    const save = async () => {
        if (!cleanup) return;
        setError(null);
        try {
            await saveSpecVersion(recipe, version, cleanup.spec, version.output, note.trim(), 'pruned');
            setCleaning(false);
            onSaved();
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    };

    return (
        <Card className="flex flex-col gap-2" data-testid="pro-selectors">
            <div className="flex items-center gap-2">
                <Text size="small" weight="semibold" className="flex-1">Selectors in v{version.version}</Text>
                <Button size="sm" variant="ghost" icon={<RefreshCw />} loading={busy} onClick={refresh} disabled={!recipe.remoteId}>Refresh usage</Button>
                <Button size="sm" variant="ghost" icon={<Eraser />} onClick={openCleanup} disabled={!cleanup?.changes.length}>Clean up</Button>
            </div>
            <Text size="caption" tone="faint">
                {recipe.remoteId ? `Usage on crawls over the last ${WINDOW_DAYS} days.` : 'Usage comes from crawls once the recipe is submitted.'}
            </Text>
            {error && <Notice tone="danger" onClose={() => setError(null)}>{error}</Notice>}
            {health.filter(o => o.ways.length > 0).map(o => (
                <div key={o.owner} className="flex flex-col gap-1">
                    <Text size="caption" weight="semibold">{o.owner}{o.required ? ' · required' : ''}</Text>
                    {o.ways.map((w, i) => (
                        <div key={w.way.id ?? i} className="flex items-center gap-2 pl-2" data-testid="pro-way">
                            <Text size="caption" className="min-w-0 flex-1 truncate font-mono" title={wayLabel(w.way)}>{wayLabel(w.way)}</Text>
                            {w.tried > 0 && <Text size="caption" tone="faint">won {w.won} of {w.tried}{w.matched > w.won ? `, found ${w.matched}` : ''}</Text>}
                            <Chip tone={STATE[w.state].tone} title={STATE[w.state].why + (w.lastWonAt ? `; last used ${w.lastWonAt}` : '')}>{STATE[w.state].label}</Chip>
                        </div>
                    ))}
                    {o.ways.flatMap(w => kept.filter(k => k.wayId === w.way.id).map(k => (
                        <Text key={`${k.wayId}:${k.action}`} size="caption" tone="faint" className="pl-2" data-testid="pro-way-kept">
                            Kept {wayLabel(w.way)} {k.action === 'removed' ? 'in' : 'in place'}: {k.reason} ({k.by})
                        </Text>
                    )))}
                </div>
            ))}

            <Dialog open={cleaning} onClose={() => setCleaning(false)} size="sm" title={`Clean up v${version.version}`}
                description={`Saved as v${version.version + 1}; test, review and submit it as usual.`}
                actions={<>
                    <Button variant="ghost" onClick={() => setCleaning(false)}>Cancel</Button>
                    <Button variant="primary" onClick={save} disabled={!note.trim()}>Save v{version.version + 1}</Button>
                </>}>
                <div className="flex flex-col gap-3">
                    <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="pro-cleanup">
                        {cleanup?.changes.map((c, i) => (
                            <li key={i} className="flex items-start gap-2">
                                <Text size="small" className="min-w-0 flex-1">
                                    {c.action === 'removed' ? 'Remove' : 'Try last'} <span className="font-mono">{wayLabel(c.way)}</span> from {c.owner}: {STATE[c.state].why}.
                                </Text>
                                <Button size="sm" variant="ghost" icon={<Shield />} onClick={() => { setKeeping(c); setWhy(''); }}>Keep</Button>
                            </li>
                        ))}
                    </ul>
                    {keeping && (
                        <div className="flex items-end gap-2">
                            <TextField className="flex-1" label={`Why keep ${wayLabel(keeping.way)}`} value={why} onChange={e => setWhy(e.target.value)} placeholder="Only on sale pages" autoFocus />
                            <Button size="sm" variant="secondary" onClick={keep} disabled={!why.trim()}>Keep it</Button>
                        </div>
                    )}
                    <TextField label="Version note" value={note} onChange={e => setNote(e.target.value)} />
                </div>
            </Dialog>
        </Card>
    );
}
