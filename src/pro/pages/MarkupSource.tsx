/**
 * A field read from the page's markup (`src/pro/markup/markup.ts`): the open page's meta tags and microdata
 * props are listed with their values, and the one chosen becomes the field's first way.
 */
import { useState } from 'react';
import { Code } from 'lucide-react';
import { Button, Select, Text } from '../../sidepanel/ui';
import { pageTabId } from '../../sidepanel/hooks/usePageTab';
import type { MarkupEntry } from '../markup/markup';
import type { MarkupWay } from '../recipe/types';
import { call } from '../runner/tabSteps';

const label = (e: MarkupEntry) => `${e.source === 'meta' ? e.key : `${e.type ? `${e.type} · ` : ''}${e.key}`} = ${e.value.length > 60 ? `${e.value.slice(0, 60)}…` : e.value}`;

export function MarkupSource({ onAdd }: { onAdd: (way: MarkupWay) => void }) {
    const [entries, setEntries] = useState<MarkupEntry[] | null>(null);
    const [error, setError] = useState('');
    const load = async () => {
        setError('');
        const tabId = await pageTabId();
        if (!tabId) { setError('Open the page in a tab first.'); return; }
        try {
            setEntries(await call<MarkupEntry[]>(tabId, 'listMarkup', []));
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
    };
    if (!entries) {
        return (
            <div className="flex flex-col gap-1">
                <div><Button size="sm" variant="ghost" icon={<Code />} onClick={load}>From the page's markup</Button></div>
                {error && <Text size="caption" tone="danger">{error}</Text>}
            </div>
        );
    }
    if (!entries.length) return <Text size="caption" tone="faint">This page has no meta tags or microdata to read from.</Text>;
    return (
        <Select<string> size="sm" label="Read it from the page's markup" value=""
            options={[{ value: '', label: `Choose (${entries.length} on this page)` }, ...entries.map((e, i) => ({ value: String(i), label: label(e) }))]}
            onChange={i => {
                if (i === '') return;
                const e = entries[Number(i)];
                onAdd({ kind: 'markup', source: e.source, key: e.key, ...(e.type ? { type: e.type } : {}) });
                setEntries(null);
            }} />
    );
}
