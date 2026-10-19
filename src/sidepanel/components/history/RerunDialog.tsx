import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, Stack, Switch, TextField } from '../../ui';
import { Play } from 'lucide-react';
import { isBulkJob, type JobWithRecipe } from './jobFilters';
import { defaultConcurrency } from '@/shared/utils/concurrency';

export interface RerunOptions {
    name: string;
    maxPages: number;
    parallel: boolean;
    concurrent: number;
}

/** Name, page limit and concurrency for re-running a job (open while `job` is set). */
export function RerunDialog({ job, onClose, onStart }: { job: JobWithRecipe | null; onClose: () => void; onStart: (job: JobWithRecipe, options: RerunOptions) => void }) {
    const { t } = useTranslation('history');
    const { t: tc } = useTranslation('common');
    const [rerunName, setRerunName] = useState('');
    const [rerunMaxPages, setRerunMaxPages] = useState(10);
    const [rerunParallel, setRerunParallel] = useState(false);
    const [rerunConcurrent, setRerunConcurrent] = useState(defaultConcurrency);

    useEffect(() => {
        if (!job) return;
        setRerunName(job.name ? `${job.name} (${t('rerun')})` : `${t('rerun')}: ${job.recipe?.name || tc('na')}`);
        setRerunMaxPages(job.input?.maxPages || 10);
        setRerunParallel((job.input?.concurrency ?? 1) > 1);
        setRerunConcurrent(job.input?.concurrency || 3);
    }, [job, t, tc]);

    return (
        <Dialog open={!!job} onClose={onClose} size="sm" title={t('configureRerun')}
            actions={<>
                <Button variant="ghost" onClick={onClose}>{tc('cancel')}</Button>
                <Button variant="primary" icon={<Play />}
                    onClick={() => job && onStart(job, { name: rerunName, maxPages: rerunMaxPages, parallel: rerunParallel, concurrent: rerunConcurrent })}>
                    {t('startNow')}
                </Button>
            </>}>
            <Stack gap={4} className="pt-1">
                <TextField label={t('runName')} value={rerunName} onChange={e => setRerunName(e.target.value)} placeholder={t('runNamePlaceholder')} />
                {job?.recipe?.spec.kind === 'list' && job.recipe.spec.pagination.mode === 'pagination' && (
                    <TextField type="number" min={1} label={t('maxPages')} hint={t('maxPagesHelper')} value={rerunMaxPages}
                        onChange={e => setRerunMaxPages(parseInt(e.target.value) || 1)} />
                )}
                {job && isBulkJob(job) && (
                    <>
                        <Switch checked={rerunParallel} onChange={setRerunParallel} label={t('parallelMode')} hint={t('parallelModeHelper')} />
                        {rerunParallel && (
                            <TextField type="number" min={1} max={10} label={t('concurrencyLimit')} hint={t('concurrencyHelper')} value={rerunConcurrent}
                                onChange={e => setRerunConcurrent(parseInt(e.target.value) || 1)} />
                        )}
                    </>
                )}
            </Stack>
        </Dialog>
    );
}
