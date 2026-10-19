/**
 * "Get every page" in the API Finder (docs/plans/api-recipes-plan.md): the chosen call becomes an API
 * recipe (how it pages, an optional list of values for one of its parameters), run in the background
 * from one tab of the site, with no page opened per result page.
 */
import { useMemo, useState } from 'react';
import { ExternalLink, Layers, Play, Square } from 'lucide-react';
import { Button, Notice, Progress, Select, Spinner, Text, TextArea } from '../../ui';
import type { JsonPath, NetEntry } from '../../../shared/network/types';
import { formatPath } from '../../../shared/network/jsonSearch';
import {
    DEFAULT_MAX_PAGES, guessPaging, itemsOf, pagingLabel, requestParams, sameParam, toRequest, unitsFor,
    type ApiParam, type ApiPaging, type ApiSpec,
} from '../../../shared/network/apiRecipe';
import { useApiRun } from '../../hooks/useContactsRun';
import { DetailSection } from './ui';

const openTable = (id: number) => chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?view=data-table&tableId=${id}`) });

const keyOf = (p: ApiParam) => `${p.where}:${(p.path ?? [p.name]).join('.')}`;
const MAX_PAGES = [1, 5, 10, 25, 50, 100, 250, 500, 1000];
const PAGE_LIKE = /^(page|p|pg|pagenum|page_?number|page_?no|page_?index|current_?page)$/i;

function hostOf(url: string): string {
    try { return new URL(url).host; } catch { return url; }
}

export default function ApiRunSection({ entry, json, items, page }: { entry: NetEntry; json: unknown; items: JsonPath; page: string }) {
    const run = useApiRun();
    const request = useMemo(() => toRequest(entry), [entry]);
    const params = useMemo(() => requestParams(request), [request]);
    const guessed = useMemo(() => guessPaging(entry, json, items), [entry, json, items]);
    const count = useMemo(() => itemsOf(json, items).length, [json, items]);

    // 'auto': as guessed; 'none': this page only; a parameter's key: that parameter counts up.
    const [pagingChoice, setPagingChoice] = useState<string>('auto');
    const [maxPages, setMaxPages] = useState(DEFAULT_MAX_PAGES);
    const [inputKey, setInputKey] = useState('');
    const [valuesText, setValuesText] = useState('');

    const paging: ApiPaging = useMemo(() => {
        if (pagingChoice === 'auto') return guessed;
        const param = params.find(p => keyOf(p) === pagingChoice);
        if (!param) return { mode: 'none' };
        const start = Number(param.value) || 0;
        return { mode: 'number', param, start, step: PAGE_LIKE.test(param.name) ? 1 : count || 20 };
    }, [pagingChoice, guessed, params, count]);

    const pagingParam = paging.mode === 'number' || paging.mode === 'cursor' ? paging.param : undefined;
    const input = params.find(p => keyOf(p) === inputKey && !sameParam(p, pagingParam));
    const values = input ? valuesText.split('\n').map(v => v.trim()).filter(Boolean) : [];

    const spec: ApiSpec = { kind: 'api', request, page, items, paging, ...(input ? { input } : {}), maxPages: paging.mode === 'none' ? 1 : maxPages };
    const units = unitsFor(spec, values);

    const pagingOptions = [
        { value: 'auto', label: guessed.mode === 'none' ? 'Found no paging: this page only' : `Found: ${pagingLabel(guessed)}` },
        { value: 'none', label: 'This page only' },
        ...params.filter(p => /^\d+$/.test(p.value)).map(p => ({ value: keyOf(p), label: `Count up ${p.name} (now ${p.value})` })),
    ];

    if (run.running || run.finished) {
        return (
            <div className="rounded-card border-[1.5px] border-line-strong bg-surface p-3" data-testid="api-run">
                <div className="flex items-center justify-between gap-2">
                    <Text weight="semibold" className="flex items-center gap-2">
                        {run.running && <Spinner size={14} />}
                        {run.running ? (run.stopping ? 'Stopping…' : 'Calling the API') : run.finished === 'completed' ? 'Done' : run.finished === 'stopped' ? 'Stopped' : 'Failed'}
                    </Text>
                    <Text weight="bold" className="tabular-nums" data-testid="api-run-rows">{run.rows.toLocaleString()} rows</Text>
                </div>
                {run.total > 1 && <Progress className="mt-2" value={Math.max(3, (run.done / run.total) * 100)} label="Values done" />}
                {run.failed > 0 && <Text size="caption" tone="muted" className="mt-1">{run.failed} of {run.total} value{run.total > 1 ? 's' : ''} returned nothing.</Text>}
                {run.error && <Notice tone="danger" className="mt-2">{run.error}</Notice>}
                <div className="mt-2 flex flex-wrap gap-2">
                    {run.running && <Button size="sm" icon={<Square />} onClick={run.stop} disabled={run.stopping}>Stop</Button>}
                    {run.tableId !== null && <Button size="sm" variant={run.running ? 'ghost' : 'primary'} icon={<ExternalLink />} onClick={() => openTable(run.tableId!)}>Open in My data</Button>}
                    {!run.running && <Button size="sm" variant="ghost" onClick={run.reset}>Change and run again</Button>}
                </div>
            </div>
        );
    }

    return (
        <DetailSection icon={<Layers />} title="Get every page" summary={paging.mode === 'none' ? 'one page' : `up to ${maxPages} pages`} defaultOpen>
            <div className="flex flex-col gap-2.5">
                <Text size="caption" tone="muted">
                    Calls the API again from {hostOf(page)}, with your session, page after page. No page is opened per result page, and a layout change doesn't break it.
                    The list: <span className="font-mono">{formatPath(items)}</span> ({count} on this page).
                </Text>
                <Select label="How it pages" value={pagingChoice} onChange={setPagingChoice} options={pagingOptions} />
                {paging.mode !== 'none' && (
                    <Select label="At most" value={maxPages} onChange={v => setMaxPages(Number(v))}
                        options={MAX_PAGES.map(n => ({ value: n, label: `${n} page${n > 1 ? 's' : ''}` }))} />
                )}
                <Select label="Run it for a list of values (optional)" value={inputKey} onChange={setInputKey}
                    options={[{ value: '', label: 'No: the call as recorded' }, ...params.filter(p => !sameParam(p, pagingParam)).map(p => ({ value: keyOf(p), label: `${p.name} (now “${p.value.slice(0, 24)}”)` }))]} />
                {input && (
                    <TextArea label={`Values for ${input.name}`} rows={4} value={valuesText} onChange={e => setValuesText(e.target.value)}
                        placeholder={`${input.value || 'value'}\n…`} hint="One per line: each gets its own pages, and a column says which value a row came from." />
                )}
                {Object.keys(request.headers).some(h => /^(authorization|x-.*token|x-api-key)$/i.test(h)) && (
                    <Text size="caption" tone="muted">The call sends a sign-in token. It is kept with the recipe on this computer only; if the site refuses later, record the call again.</Text>
                )}
                <Button variant="primary" icon={<Play />} disabled={!!input && values.length === 0}
                    onClick={() => run.start({ spec, values, customName: `API · ${hostOf(request.url)} ${formatPath(items)}${input ? ` · ${values.length} values` : ''}` })}>
                    {input ? `Run for ${units.length} value${units.length > 1 ? 's' : ''}` : 'Start'}
                </Button>
            </div>
        </DetailSection>
    );
}
