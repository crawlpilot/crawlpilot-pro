import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { Activity, Copy, ExternalLink, Settings, Trash2 } from 'lucide-react';
import { Button, Chip, Dialog, Divider, IconButton, Progress, Stack, Text } from '../../ui';
import { PageStat, stopReasonLabel } from '@/shared/listing/runStats';
import { STEP_STATUS_LABELS, StepStat, StepStatus } from '@/shared/listing/stepStats';
import { VERDICT_LABELS, PageVerdict } from '@/shared/verdict/classifyPage';
import { jobKind, jobUrl, type JobWithRecipe } from './jobFilters';

interface Props {
    detailsJob: JobWithRecipe | null;
    onClose: () => void;
    onDelete: (id: number) => void;
    onRerun: (job: any) => void;
}

/** A job's stats (per page, per field, page checks) and configuration. */
export function JobDetailsDialog({ detailsJob, onClose, onDelete, onRerun }: Props) {
    const { t } = useTranslation('history');
    const { t: tc } = useTranslation('common');

    const job = detailsJob;
    return (
        <Dialog open={!!job} onClose={onClose} size="lg" title={t('details')} description={t('idLabel', { id: job?.id })}
            actions={<>
                <div className="mr-auto flex gap-1">
                    <Button variant="ghost" icon={<Copy />} onClick={() => { navigator.clipboard.writeText(JSON.stringify(job, null, 2)); alert(t('copiedToClipboard')); }}>
                        {tc('export')}
                    </Button>
                    <Button variant="ghost" className="text-danger" icon={<Trash2 />} onClick={() => { if (job?.id) { onDelete(job.id); onClose(); } }}>
                        {tc('delete')}
                    </Button>
                </div>
                <Button variant="ghost" onClick={onClose}>{tc('close')}</Button>
                <Button variant="primary" onClick={() => { onClose(); if (job) onRerun(job); }}>{t('rerun')}</Button>
            </>}>
            {job && (
                <Stack gap={5}>
                    <section>
                        <SectionTitle icon={<Activity />}>{t('performance')}</SectionTitle>
                        <div className="grid grid-cols-2 gap-2">
                            <DetailItem label={t('statusLabel')} value={job.stats?.stoppedByUser ? tc('status.stopped') : job.status} capitalize />
                            <DetailItem label={t('itemsExtracted')} value={job.stats?.itemsExtracted || 0} />
                            <DetailItem label={t('pagesVisited')} value={job.stats?.pagesVisited || 1} />
                            <DetailItem label={t('duration')} value={job.stats?.endTime ? `${Math.round((job.stats.endTime - job.stats.startTime) / 1000)}s` : tc('na')} />
                            {job.stats?.stopReason && <DetailItem label={t('stopReason', 'Stopped because')} value={stopReasonLabel(job.stats.stopReason)} />}
                            {job.stats?.eased && <DetailItem label={t('eased', 'Tabs at a time')} value={`${job.stats.eased.to}, because ${job.stats.eased.reason}`} />}
                            {!!job.stats?.duplicatesRemoved && <DetailItem label={t('duplicatesSkipped', 'Duplicates skipped')} value={job.stats.duplicatesRemoved} />}
                            {jobKind(job) === 'page' && <DetailItem label={t('concurrency')} value={job.input?.concurrency || 1} />}
                        </div>

                        {job.stats?.verdicts && Object.keys(job.stats.verdicts).length > 0 && (
                            <SubBlock title={t('pageChecks', 'Page checks')}>
                                <div className="flex flex-wrap gap-1.5">
                                    {Object.entries(job.stats.verdicts).map(([v, n]) => (
                                        <Chip key={v} tone={v === 'ok' ? 'success' : v === 'challenge' || v === 'rate_limited' ? 'warning' : 'danger'}>
                                            {`${VERDICT_LABELS[v as PageVerdict] ?? v} · ${n}`}
                                        </Chip>
                                    ))}
                                </div>
                            </SubBlock>
                        )}

                        {job.stats?.coverage && job.stats.coverage.length > 0 && (
                            <SubBlock title={t('fieldCoverage', 'Rows filled per field')}>
                                <div className="max-h-40 overflow-y-auto rounded-field border border-line px-3 py-1.5">
                                    {job.stats.coverage.map((c: { name: string; fill: number }) => (
                                        <Meter key={c.name} name={c.name} fill={c.fill} low={c.fill < 0.5} />
                                    ))}
                                </div>
                            </SubBlock>
                        )}

                        {job.stats?.steps && job.stats.steps.length > 0 && (
                            <SubBlock title={t('stepCoverage', 'Pages each step worked on')}>
                                <div className="max-h-56 overflow-y-auto rounded-field border border-line px-3 py-1.5">
                                    {job.stats.steps.map((s: StepStat) => {
                                        const how = (Object.entries(s.counts) as [StepStatus, number][]).map(([k, n]) => `${n} ${STEP_STATUS_LABELS[k]}`).join(' · ');
                                        return (
                                            <div key={s.name + s.action} className="py-1" title={s.failing.length ? `Failed on:\n${s.failing.join('\n')}` : undefined}>
                                                <Meter name={`${s.action === 'click' ? `${t('clickStep', 'Click')}: ` : ''}${s.name}`} fill={s.fill} low={s.fill < 0.8} />
                                                <Text size="caption" tone="faint">{how}</Text>
                                            </div>
                                        );
                                    })}
                                </div>
                            </SubBlock>
                        )}

                        {job.stats?.pageStats && job.stats.pageStats.length > 0 && (
                            <SubBlock title={t('perPage', 'Rows per page')}>
                                <div className="max-h-40 overflow-y-auto rounded-field border border-line py-1 font-mono text-caption">
                                    {job.stats.pageStats.map((p: PageStat) => (
                                        <div key={p.page} className="flex justify-between gap-3 px-3 py-1 text-ink">
                                            <span>{t('pageN', 'Page {{n}}', { n: p.page })}</span>
                                            <span className="text-right" title={[
                                                p.unmapped ? `${p.unmapped} rows had content no field reads: the layout may have changed` : '',
                                                p.fallback ? 'The list was found through a backup selector: its main selector no longer matches. Re-pick it before the backups stop working too.' : '',
                                                p.healed?.length ? `Found again by meaning on this page: ${p.healed.join(', ')}` : '',
                                                p.broken?.length ? `Not found on this page (empty cells): ${p.broken.join(', ')}` : '',
                                                p.loading ? `${p.loading} rows were still loading when read: raise the content load delay in the run settings` : '',
                                                p.short ? 'Far fewer items than the other pages: the list may have been found only in part. Re-pick it on this page' : '',
                                            ].filter(Boolean).join('\n') || undefined}>
                                                {p.rows}{p.duplicates > 0 ? ` (+${p.duplicates} dup)` : ''}{p.unmapped ? ` · ${p.unmapped} unmapped` : ''}{p.fallback ? ` · ${t('backupSelector', 'backup selector')}` : ''}{p.healed?.length ? ` · ${t('fieldsHealed', '{{n}} healed', { n: p.healed.length })}` : ''}{p.broken?.length ? ` · ${t('fieldsBroken', '{{n}} broken', { n: p.broken.length })}` : ''}{p.loading ? ` · ${t('rowsLoading', '{{n}} loading', { n: p.loading })}` : ''}{p.short ? ` · ${t('pageShort', 'short')}` : ''}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </SubBlock>
                        )}
                    </section>

                    <Divider />

                    <section>
                        <SectionTitle icon={<Settings />}>{t('configuration')}</SectionTitle>
                        <div className="mb-3 rounded-field bg-surface-2 p-3">
                            <Text size="caption" weight="semibold" tone="muted">{t('sourceUrl')}</Text>
                            <div className="mt-0.5 flex items-center gap-1">
                                <Text size="small" mono className="min-w-0 flex-1 break-all">{jobUrl(job) || tc('na')}</Text>
                                {jobUrl(job) && <IconButton size="sm" label="Open" onClick={() => window.open(jobUrl(job), '_blank')}><ExternalLink /></IconButton>}
                            </div>
                        </div>
                        <Stack gap={1.5}>
                            <div className="flex justify-between">
                                <Text size="caption" tone="muted">{t('recipeType')}</Text>
                                <Text size="caption" mono>{jobKind(job) || tc('na')}</Text>
                            </div>
                            {job.recipe?.spec.kind === 'list' && (
                                <div className="flex justify-between">
                                    <Text size="caption" tone="muted">{t('paginationMode')}</Text>
                                    <Text size="caption" mono>{job.recipe.spec.pagination.mode}</Text>
                                </div>
                            )}
                            {job.recipe && job.recipe.rev > job.recipeRev && (
                                <Text size="caption" tone="muted">
                                    {t('recipeChanged', 'The recipe has changed since this run (revision {{ran}} → {{now}}); a rerun uses the current one.', { ran: job.recipeRev, now: job.recipe.rev })}
                                </Text>
                            )}
                        </Stack>
                    </section>
                </Stack>
            )}
        </Dialog>
    );
}

function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
    return <h3 className="m-0 mb-2.5 flex items-center gap-1.5 text-small font-bold text-ink [&_svg]:size-3.5">{icon}{children}</h3>;
}

function SubBlock({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="mt-4">
            <Text size="caption" weight="semibold" tone="muted" className="mb-1.5">{title}</Text>
            {children}
        </div>
    );
}

function Meter({ name, fill, low }: { name: string; fill: number; low: boolean }) {
    return (
        <div className="flex items-center gap-2 py-0.5 text-caption text-ink">
            <span className="min-w-0 flex-1 truncate">{name}</span>
            <Progress size="sm" value={fill * 100} tone={low ? 'danger' : 'success'} className="w-16 shrink-0" />
            <span className="w-9 text-right font-mono">{Math.round(fill * 100)}%</span>
        </div>
    );
}

function DetailItem({ label, value, capitalize }: { label: string; value: ReactNode; capitalize?: boolean }) {
    return (
        <div className="rounded-field bg-surface-2 px-3 py-2.5">
            <Text size="caption" tone="muted">{label}</Text>
            <Text weight="semibold" className={capitalize ? 'capitalize' : undefined}>{value}</Text>
        </div>
    );
}
