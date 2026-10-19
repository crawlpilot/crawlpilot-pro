import { useTranslation } from 'react-i18next';
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, LinearProgress, Stack, Typography, alpha, useTheme } from '@mui/material';
import { Activity, Copy, ExternalLink, Settings, Trash2, X } from 'lucide-react';
import { PageStat, stopReasonLabel } from '@/shared/listing/runStats';
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
    const theme = useTheme();
    const { t } = useTranslation('history');
    const { t: tc } = useTranslation('common');

    return (
        <Dialog
            open={!!detailsJob}
            onClose={() => onClose()}
            fullWidth
            maxWidth="sm"
            PaperProps={{
                sx: { borderRadius: 3, bgcolor: 'background.paper', backgroundImage: 'none' }
            }}
        >
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, borderBottom: 1, borderColor: 'divider' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{ p: 1, bgcolor: alpha(theme.palette.secondary.main, 0.1), borderRadius: 1.5, color: 'secondary.main' }}>
                        <Settings size={20} />
                    </Box>
                    <Box>
                        <Typography variant="h6" lineHeight={1.2}>{t('details')}</Typography>
                        <Typography variant="caption" color="text.secondary">{t('idLabel', { id: detailsJob?.id })}</Typography>
                    </Box>
                </Box>
                <IconButton onClick={() => onClose()} size="small">
                    <X size={20} />
                </IconButton>
            </DialogTitle>

            <DialogContent sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {detailsJob && (
                    <>
                        <Box>
                            <Typography variant="overline" color="secondary" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <Activity size={14} /> {t('performance')}
                            </Typography>
                            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                                <DetailItem label={t('statusLabel')} value={detailsJob.stats?.stoppedByUser ? tc('status.stopped').toUpperCase() : detailsJob.status} capitalize />
                                <DetailItem label={t('itemsExtracted')} value={detailsJob.stats?.itemsExtracted || 0} />
                                <DetailItem label={t('pagesVisited')} value={detailsJob.stats?.pagesVisited || 1} />
                                <DetailItem label={t('duration')} value={detailsJob.stats?.endTime
                                    ? `${Math.round((detailsJob.stats.endTime - detailsJob.stats.startTime) / 1000)}s`
                                    : tc('na')}
                                />
                                {detailsJob.stats?.stopReason && (
                                    <DetailItem label={t('stopReason', 'Stopped because')} value={stopReasonLabel(detailsJob.stats.stopReason)} />
                                )}
                                {!!detailsJob.stats?.duplicatesRemoved && (
                                    <DetailItem label={t('duplicatesSkipped', 'Duplicates skipped')} value={detailsJob.stats.duplicatesRemoved} />
                                )}
                                {jobKind(detailsJob) === 'page' && (
                                    <DetailItem label={t('concurrency')} value={detailsJob.input?.concurrency || 1} />
                                )}
                            </Box>
                            {detailsJob.stats?.verdicts && Object.keys(detailsJob.stats.verdicts).length > 0 && (
                                <Box sx={{ mt: 2 }}>
                                    <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" mb={0.5}>
                                        {t('pageChecks', 'Page checks')}
                                    </Typography>
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                                        {Object.entries(detailsJob.stats.verdicts).map(([v, n]) => (
                                            <Chip key={v} size="small" label={`${VERDICT_LABELS[v as PageVerdict] ?? v} · ${n}`}
                                                color={v === 'ok' ? 'success' : v === 'challenge' || v === 'rate_limited' ? 'warning' : 'error'}
                                                variant="outlined" />
                                        ))}
                                    </Box>
                                </Box>
                            )}
                            {detailsJob.stats?.coverage && detailsJob.stats.coverage.length > 0 && (
                                <Box sx={{ mt: 2 }}>
                                    <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" mb={0.5}>
                                        {t('fieldCoverage', 'Rows filled per field')}
                                    </Typography>
                                    <Box sx={{ maxHeight: 160, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 2, px: 1.5, py: 0.5 }}>
                                        {detailsJob.stats.coverage.map((c: { name: string; fill: number }) => (
                                            <Box key={c.name} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25, fontSize: 12 }}>
                                                <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</Box>
                                                <LinearProgress variant="determinate" value={c.fill * 100} color={c.fill < 0.5 ? 'warning' : 'success'} sx={{ width: 60, height: 4, borderRadius: 2 }} />
                                                <Box component="span" sx={{ width: 36, textAlign: 'right', fontFamily: 'monospace' }}>{Math.round(c.fill * 100)}%</Box>
                                            </Box>
                                        ))}
                                    </Box>
                                </Box>
                            )}
                            {detailsJob.stats?.pageStats && detailsJob.stats.pageStats.length > 0 && (
                                <Box sx={{ mt: 2 }}>
                                    <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" mb={0.5}>
                                        {t('perPage', 'Rows per page')}
                                    </Typography>
                                    <Box sx={{ maxHeight: 160, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 2 }}>
                                        {detailsJob.stats.pageStats.map((p: PageStat) => (
                                            <Box key={p.page} sx={{ display: 'flex', justifyContent: 'space-between', px: 1.5, py: 0.5, fontSize: 12, fontFamily: 'monospace' }}>
                                                <span>{t('pageN', 'Page {{n}}', { n: p.page })}</span>
                                                <span title={[
                                                    p.unmapped ? `${p.unmapped} rows had content no field reads: the layout may have changed` : '',
                                                    p.fallback ? 'The list was found through a backup selector: its main selector no longer matches. Re-pick it before the backups stop working too.' : '',
                                                    p.healed?.length ? `Found again by meaning on this page: ${p.healed.join(', ')}` : '',
                                                    p.broken?.length ? `Not found on this page (empty cells): ${p.broken.join(', ')}` : '',
                                                ].filter(Boolean).join('\n') || undefined}>
                                                    {p.rows}{p.duplicates > 0 ? ` (+${p.duplicates} dup)` : ''}{p.unmapped ? ` · ${p.unmapped} unmapped` : ''}{p.fallback ? ` · ${t('backupSelector', 'backup selector')}` : ''}{p.healed?.length ? ` · ${t('fieldsHealed', '{{n}} healed', { n: p.healed.length })}` : ''}{p.broken?.length ? ` · ${t('fieldsBroken', '{{n}} broken', { n: p.broken.length })}` : ''}
                                                </span>
                                            </Box>
                                        ))}
                                    </Box>
                                </Box>
                            )}
                        </Box>

                        <Divider />

                        <Box>
                            <Typography variant="overline" color="secondary" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                                <Settings size={14} /> {t('configuration')}
                            </Typography>

                            <Box sx={{ p: 2, bgcolor: alpha(theme.palette.background.default, 0.5), borderRadius: 2, border: 1, borderColor: 'divider', mb: 2 }}>
                                <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" mb={0.5}>{t('sourceUrl')}</Typography>
                                <Typography variant="body2" fontFamily="monospace" sx={{ wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: 1 }}>
                                    {jobUrl(detailsJob) || tc('na')}
                                    {jobUrl(detailsJob) && (
                                        <IconButton size="small" onClick={() => window.open(jobUrl(detailsJob), '_blank')}>
                                            <ExternalLink size={12} />
                                        </IconButton>
                                    )}
                                </Typography>
                            </Box>

                            <Stack spacing={1}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Typography variant="caption" color="text.secondary">{t('recipeType')}</Typography>
                                    <Typography variant="caption" fontFamily="monospace">{jobKind(detailsJob) || tc('na')}</Typography>
                                </Box>
                                {detailsJob.recipe?.spec.kind === 'list' && (
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Typography variant="caption" color="text.secondary">{t('paginationMode')}</Typography>
                                        <Typography variant="caption" fontFamily="monospace">{detailsJob.recipe.spec.pagination.mode}</Typography>
                                    </Box>
                                )}
                                {detailsJob.recipe && detailsJob.recipe.rev > detailsJob.recipeRev && (
                                    <Typography variant="caption" color="text.secondary">
                                        {t('recipeChanged', 'The recipe has changed since this run (revision {{ran}} → {{now}}); a rerun uses the current one.', { ran: detailsJob.recipeRev, now: detailsJob.recipe.rev })}
                                    </Typography>
                                )}
                            </Stack>
                        </Box>
                    </>
                )}
            </DialogContent>

            <DialogActions sx={{ p: 2, borderTop: 1, borderColor: 'divider', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                        startIcon={<Copy size={16} />}
                        color="inherit"
                        onClick={() => {
                            navigator.clipboard.writeText(JSON.stringify(detailsJob, null, 2));
                            alert(t('copiedToClipboard'));
                        }}
                    >
                        {tc('export')}
                    </Button>
                    <Button
                        startIcon={<Trash2 size={16} />}
                        color="error"
                        onClick={() => {
                            if (detailsJob?.id) {
                                    onDelete(detailsJob.id);
                                onClose();
                            }
                        }}
                    >
                        {tc('delete')}
                    </Button>
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button onClick={() => onClose()} color="inherit">{tc('close')}</Button>
                    <Button
                        variant="contained"
                        color="secondary"
                        onClick={() => {
                            const job = detailsJob;
                                onClose();
                                if (job) onRerun(job);
                        }}
                    >
                        {t('rerun')}
                    </Button>
                </Box>
            </DialogActions>
        </Dialog>
    );
}

function DetailItem({ label, value, capitalize }: any) {
    return (
        <Box sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: alpha('#fff', 0.02) }}>
            <Typography variant="caption" fontWeight={700} color="text.disabled" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {label}
            </Typography>
            <Typography variant="body2" fontWeight={600} sx={{ mt: 0.5, textTransform: capitalize ? 'capitalize' : 'none' }}>
                {value}
            </Typography>
        </Box>
    );
}
