/**
 * A field's or step's ways to find its element, first that works wins: shown, reordered, removed, and added by
 * typing a selector. A field's ways can also open their options (`options`): what each reads, which matches it keeps,
 * its condition and its own cleanup.
 */
import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, SlidersHorizontal, Trash2 } from 'lucide-react';
import { Button, Chip, IconButton, Text, TextField } from '../../sidepanel/ui';
import { neverHolds } from '../recipe/conditions';
import { conditionLabel, wayLabel } from '../recipe/diff';
import type { Way } from '../recipe/types';

/** A way's options beyond its selector, in short. */
function wayNotes(w: Way): string[] {
    return [
        ...(w.kind === 'selector' && w.read ? [w.read === 'attr' ? `@${w.attr ?? '?'}` : w.read] : []),
        ...(w.pick === 'firstFilled' ? ['first filled'] : w.pick === 'all' ? ['every match'] : []),
        ...(w.ops?.length ? [`${w.ops.length} step${w.ops.length === 1 ? '' : 's'}`] : []),
    ];
}

export function Ways({ ways, onMove, onRemove, onAdd, options, title = 'Ways to find it, first that works wins' }: {
    ways: Way[]; title?: string; onMove: (i: number, d: number) => void; onRemove: (i: number) => void; onAdd: (s: string) => void;
    /** A way's options, opened from its row. */
    options?: (way: Way, i: number) => ReactNode;
}) {
    const [adding, setAdding] = useState('');
    const [open, setOpen] = useState<number | null>(null);
    const firstSelector = ways.findIndex(w => w.kind === 'selector');
    return (
        <div className="flex flex-col gap-1.5">
            <Text size="caption" weight="semibold" tone="muted">{title}</Text>
            {ways.map((w, i) => (
                <div key={`${i}-${wayLabel(w)}`} className="flex flex-col gap-1">
                    <div className="flex items-center gap-1.5">
                        <Chip tone={w.kind === 'selector' ? 'neutral' : 'info'}>{w.kind === 'data' ? 'Page data' : w.kind === 'markup' ? 'Markup' : 'Selector'}</Chip>
                        <Text size="caption" mono className="min-w-0 flex-1 break-all">{wayLabel(w)}</Text>
                        {wayNotes(w).map(n => <Chip key={n} tone="outline">{n}</Chip>)}
                        {w.when && (neverHolds(w.when)
                            ? <Chip tone="danger" title={`Never tried: ${conditionLabel(w.when)}`}>never tried</Chip>
                            : <Chip tone="warning" title={conditionLabel(w.when)}>if…</Chip>)}
                        {options && <IconButton size="sm" label={`Options of way ${i + 1}`} onClick={() => setOpen(open === i ? null : i)}><SlidersHorizontal /></IconButton>}
                        {w.kind === 'selector' && <>
                            <IconButton size="sm" label="Try it earlier" onClick={() => onMove(i, -1)} disabled={i <= firstSelector}><ArrowUp /></IconButton>
                            <IconButton size="sm" label="Try it later" onClick={() => onMove(i, 1)} disabled={i === ways.length - 1}><ArrowDown /></IconButton>
                        </>}
                        <IconButton size="sm" label={`Remove way ${i + 1}`} onClick={() => onRemove(i)}><Trash2 /></IconButton>
                    </div>
                    {options && open === i && options(w, i)}
                </div>
            ))}
            <form className="flex items-end gap-1.5" onSubmit={e => { e.preventDefault(); onAdd(adding); setAdding(''); }}>
                <TextField size="sm" className="flex-1" aria-label="Add a selector" placeholder="Add a selector (CSS or XPath)" value={adding} onChange={e => setAdding(e.target.value)} />
                <Button size="sm" variant="ghost" type="submit" disabled={!adding.trim()}>Add</Button>
            </form>
        </div>
    );
}
