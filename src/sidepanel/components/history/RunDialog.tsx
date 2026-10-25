import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, Row, Stack, Switch, Text, TextArea, TextField } from '../../ui';
import { FileText, Globe, Play } from 'lucide-react';
import type { JobWithRecipe } from './jobFilters';
import type { RecipeSpec } from '@/shared/types/database';
import { defaultConcurrency } from '@/shared/utils/concurrency';
import { urlsFromText } from '@/shared/utils/urls';
import { pageTabId } from '../../hooks/usePageTab';

/** What a run starts from: a recipe (saved, or ready-made), the run it repeats if any, and its pages so far. */
export interface RunTarget {
    name: string;
    spec: RecipeSpec;
    job?: JobWithRecipe;
    pages: string[];
    /** Ready-made: saved under its own name before it runs. */
    readyMade?: boolean;
}

export interface RunOptions {
    name: string;
    /** The pages to run on (a list: its start page first). */
    urls: string[];
    maxPages: number;
    concurrent: number;
    /** A list: keep only the items the run being repeated didn't have. */
    onlyNew?: boolean;
}

/** The target for running a saved job's recipe again, starting from the job's pages. */
export const runTargetOf = (job: JobWithRecipe): RunTarget | null =>
    job.recipe ? { name: job.recipe.name, spec: job.recipe.spec, job, pages: job.input?.urls ?? [] } : null;

/** Pages, name, page limit and concurrency for a run of a recipe (open while `target` is set). */
export function RunDialog({ target, onClose, onStart }: { target: RunTarget | null; onClose: () => void; onStart: (target: RunTarget, options: RunOptions) => void }) {
    const { t } = useTranslation('history');
    const { t: tc } = useTranslation('common');
    const [name, setName] = useState('');
    const [pagesText, setPagesText] = useState('');
    const [maxPages, setMaxPages] = useState(10);
    const [concurrent, setConcurrent] = useState(defaultConcurrency);
    const [onlyNew, setOnlyNew] = useState(false);
    const csvRef = useRef<HTMLInputElement>(null);

    const kind = target?.spec.kind;
    const job = target?.job;
    // Pages are asked for page recipes (any number) and lists (one start page); other runs keep their inputs.
    const asksPages = kind === 'page' || kind === 'list';
    const urls = asksPages ? urlsFromText(pagesText) : target?.pages ?? [];
    const runUrls = kind === 'list' ? urls.slice(0, 1) : urls;

    useEffect(() => {
        if (!target) return;
        setName(job?.name ? `${job.name} (${t('rerun')})` : job ? `${t('rerun')}: ${target.name || tc('na')}` : target.name);
        setPagesText((target.spec.kind === 'list' ? target.pages.slice(0, 1) : target.pages).join('\n'));
        setMaxPages(job?.input?.maxPages || 10);
        setConcurrent(job?.input?.concurrency || defaultConcurrency());
        setOnlyNew(false);
    }, [target, job, t, tc]);

    const add = (more: string[]) => {
        const next = kind === 'list' ? more.slice(0, 1) : [...new Set([...urls, ...more])];
        setPagesText(next.join('\n'));
    };
    const addThisPage = async () => {
        const id = await pageTabId();
        const url = id ? (await chrome.tabs.get(id)).url : undefined;
        if (url && /^https?:/.test(url)) add([url]);
    };
    const upload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        void file.text().then(text => add(urlsFromText(text)));
    };

    return (
        <Dialog open={!!target} onClose={onClose} size="sm" title={job ? t('configureRerun') : t('runRecipe')}
            actions={<>
                <Button variant="ghost" onClick={onClose}>{tc('cancel')}</Button>
                <Button variant="primary" icon={<Play />} disabled={runUrls.length === 0}
                    onClick={() => target && onStart(target, { name, urls: runUrls, maxPages, concurrent, onlyNew: onlyNew && kind === 'list' && job?.tableId !== undefined })}>
                    {t('startNow')}
                </Button>
            </>}>
            <Stack gap={4} className="pt-1">
                {kind === 'page' && (
                    <div>
                        <TextArea mono rows={4} label={t('runPages')} hint={t('runPagesHint', { count: urls.length })} value={pagesText}
                            onChange={e => setPagesText(e.target.value)} placeholder="https://…" data-testid="run-pages" />
                        <Row gap={1} className="mt-1.5">
                            <Button size="sm" variant="ghost" icon={<Globe />} onClick={() => void addThisPage()}>{t('addThisPage')}</Button>
                            <Button size="sm" variant="ghost" icon={<FileText />} onClick={() => csvRef.current?.click()}>{t('uploadCsv')}</Button>
                            <input ref={csvRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={upload} />
                        </Row>
                    </div>
                )}
                {kind === 'list' && (
                    <div>
                        <TextField type="url" label={t('startPage')} hint={t('startPageHint')} value={pagesText}
                            onChange={e => setPagesText(e.target.value)} placeholder="https://…" data-testid="run-start-page" />
                        <Button size="sm" variant="ghost" icon={<Globe />} className="mt-1.5" onClick={() => void addThisPage()}>{t('useThisPage')}</Button>
                    </div>
                )}
                {asksPages && runUrls.length === 0 && <Text size="caption" tone="muted">{t('runNeedsPage')}</Text>}
                <TextField label={t('runName')} value={name} onChange={e => setName(e.target.value)} placeholder={t('runNamePlaceholder')} />
                {target?.spec.kind === 'list' && target.spec.pagination.mode === 'pagination' && (
                    <TextField type="number" min={1} label={t('maxPages')} hint={t('maxPagesHelper')} value={maxPages}
                        onChange={e => setMaxPages(parseInt(e.target.value) || 1)} />
                )}
                {kind === 'list' && job?.tableId !== undefined && (
                    <Switch checked={onlyNew} onChange={setOnlyNew} label={t('onlyNew')} hint={t('onlyNewHint')} />
                )}
                {kind === 'page' && urls.length > 1 && (
                    <TextField type="number" min={1} max={5} label={t('concurrencyLimit')} hint={t('concurrencyHelper')} value={concurrent}
                        onChange={e => setConcurrent(parseInt(e.target.value) || 1)} />
                )}
            </Stack>
        </Dialog>
    );
}
