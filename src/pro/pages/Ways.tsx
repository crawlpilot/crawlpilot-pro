/**
 * A field's or step's ways to find its element, first that works wins: shown, reordered, removed, and added by
 * typing a selector.
 */
import { useState } from 'react';
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react';
import { Button, Chip, IconButton, Text, TextField } from '../../sidepanel/ui';
import { wayLabel } from '../recipe/diff';
import type { Way } from '../recipe/types';

export function Ways({ ways, onMove, onRemove, onAdd, title = 'Ways to find it, first that works wins' }: { ways: Way[]; title?: string; onMove: (i: number, d: number) => void; onRemove: (i: number) => void; onAdd: (s: string) => void }) {
    const [adding, setAdding] = useState('');
    const firstSelector = ways.findIndex(w => w.kind === 'selector');
    return (
        <div className="flex flex-col gap-1.5">
            <Text size="caption" weight="semibold" tone="muted">{title}</Text>
            {ways.map((w, i) => (
                <div key={`${i}-${wayLabel(w)}`} className="flex items-center gap-1.5">
                    <Chip tone={w.kind === 'data' ? 'info' : 'neutral'}>{w.kind === 'data' ? 'Page data' : 'Selector'}</Chip>
                    <Text size="caption" mono className="min-w-0 flex-1 break-all">{wayLabel(w)}</Text>
                    {w.kind === 'selector' && <>
                        <IconButton size="sm" label="Try it earlier" onClick={() => onMove(i, -1)} disabled={i <= firstSelector}><ArrowUp /></IconButton>
                        <IconButton size="sm" label="Try it later" onClick={() => onMove(i, 1)} disabled={i === ways.length - 1}><ArrowDown /></IconButton>
                    </>}
                    <IconButton size="sm" label={`Remove way ${i + 1}`} onClick={() => onRemove(i)}><Trash2 /></IconButton>
                </div>
            ))}
            <form className="flex items-end gap-1.5" onSubmit={e => { e.preventDefault(); onAdd(adding); setAdding(''); }}>
                <TextField size="sm" className="flex-1" aria-label="Add a selector" placeholder="Add a selector (CSS or XPath)" value={adding} onChange={e => setAdding(e.target.value)} />
                <Button size="sm" variant="ghost" type="submit" disabled={!adding.trim()}>Add</Button>
            </form>
        </div>
    );
}
