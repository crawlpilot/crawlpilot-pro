/**
 * A field read from the page's JavaScript-backed data (`steps/pageData.ts`): JSON-LD, `__NEXT_DATA__`, inline
 * state. The open page's values are listed with where they are and searched by key or value; the one chosen
 * becomes a field's first way, or a new field (`newFieldOf`).
 */
import { useState } from 'react';
import { Braces } from 'lucide-react';
import { Button, Text, TextField } from '../../sidepanel/ui';
import { pageTabId } from '../../sidepanel/hooks/usePageTab';
import type { DataBinding } from '../../shared/types/database';
import type { Field, FieldType, Way } from '../recipe/types';
import type { PageDataEntry } from '../steps/pageData';
import { call } from '../runner/tabSteps';

/** A new field from a page-data value: named from its last key, typed from its value. */
export function newFieldOf(e: PageDataEntry, taken: string[], id: string): Field {
    const key = [...e.binding.path].reverse().find((s): s is string => typeof s === 'string') ?? e.binding.label;
    const base = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase() || 'field';
    let name = base;
    for (let n = 2; taken.includes(name); n++) name = `${base}_${n}`;
    const list = e.binding.as === 'list';
    const type: FieldType = list ? 'list' : /^-?\d+(\.\d+)?$/.test(e.value) ? 'number' : /^https?:\/\//.test(e.value) ? 'url' : 'text';
    return { id, name, type, read: list ? 'text_array' : 'text', ways: [dataWay(e.binding)], ops: [] };
}

export const dataWay = (binding: DataBinding): Way => ({ kind: 'data', binding });

export function PageDataSource({ onPick, label = "From the page's data" }: { onPick: (e: PageDataEntry) => void; label?: string }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [entries, setEntries] = useState<PageDataEntry[] | null>(null);
    const [error, setError] = useState('');
    const load = async (q: string) => {
        setError('');
        const tabId = await pageTabId();
        if (!tabId) { setError('Open the page in a tab first.'); return; }
        try {
            setEntries(await call<PageDataEntry[]>(tabId, 'listPageData', [q, 50]));
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };
    if (!open) {
        return (
            <div className="flex flex-col gap-1">
                <div><Button size="sm" variant="ghost" icon={<Braces />} onClick={() => { setOpen(true); void load(''); }}>{label}</Button></div>
            </div>
        );
    }
    return (
        <div className="flex flex-col gap-1.5 rounded-xl border border-line p-2" data-testid="pro-page-data">
            <div className="flex items-end gap-1.5">
                <TextField size="sm" className="flex-1" aria-label="Find in the page's data" placeholder="Key or value: price, sku, 24.99…" value={query}
                    onChange={e => { setQuery(e.target.value); void load(e.target.value); }} />
                <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setEntries(null); setQuery(''); }}>Close</Button>
            </div>
            {error && <Text size="caption" tone="danger">{error}</Text>}
            {entries && !entries.length && <Text size="caption" tone="faint">{query ? 'Nothing in the page\'s data matches.' : 'This page has no JSON data to read from (JSON-LD, __NEXT_DATA__, state).'}</Text>}
            <div className="flex max-h-72 flex-col overflow-y-auto">
                {entries?.map(e => (
                    <button key={e.where} type="button" data-testid="pro-page-data-entry" onClick={() => onPick(e)}
                        className="flex flex-col rounded-lg px-2 py-1 text-left hover:bg-ink/6">
                        <Text size="caption" mono tone="muted" className="break-all">{e.where}</Text>
                        <Text size="caption" className="break-all">{e.binding.as === 'list' ? `[${e.value}]` : e.value}</Text>
                    </button>
                ))}
            </div>
        </div>
    );
}
