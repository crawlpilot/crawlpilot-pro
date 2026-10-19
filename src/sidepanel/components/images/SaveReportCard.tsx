import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, Collapse, Stack, Typography } from '@mui/material';
import { FAIL_REASONS, type SaveReport } from '../../services/images/save';
import type { FailReason } from '../../services/images/fetchImage';

export function megabytes(bytes: number): string {
    return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** What a save did: how many saved and where, and every failure grouped by reason, with a retry. */
export function SaveReportCard({ report, onRetry, onDismiss }: { report: SaveReport; onRetry: () => void; onDismiss: () => void }) {
    const { t } = useTranslation('imageDownloader');
    const [open, setOpen] = useState(false);
    const byReason = new Map<FailReason, string[]>();
    for (const f of report.failures) byReason.set(f.reason, [...(byReason.get(f.reason) ?? []), f.src]);
    const severity = report.done === 0 ? 'error' : report.failures.length ? 'warning' : 'success';

    return (
        <Alert severity={severity} variant="outlined" onClose={onDismiss} sx={{ mb: 1.5, '& .MuiAlert-message': { width: '100%' } }}>
            <Typography variant="body2" fontWeight={600}>
                {t('savedSummary', { done: report.done, total: report.total, size: megabytes(report.bytes), target: report.target })}
            </Typography>
            {report.failures.length > 0 && (
                <>
                    <Stack direction="row" spacing={1} sx={{ mt: 0.75 }}>
                        <Button size="small" variant="contained" onClick={onRetry}>{t('retryFailed', { count: report.failures.length })}</Button>
                        <Button size="small" onClick={() => void navigator.clipboard.writeText(report.failures.map(f => f.src).join('\n'))}>{t('copyFailed')}</Button>
                        <Button size="small" onClick={() => setOpen(o => !o)}>{open ? t('hideDetails') : t('showDetails')}</Button>
                    </Stack>
                    <Collapse in={open}>
                        <Stack spacing={1} sx={{ mt: 1 }}>
                            {[...byReason].map(([reason, srcs]) => (
                                <Box key={reason}>
                                    <Typography variant="caption" fontWeight={700}>{FAIL_REASONS[reason]} · {srcs.length}</Typography>
                                    {srcs.slice(0, 5).map(src => (
                                        <Typography key={src} variant="caption" component="div" sx={{ color: 'text.secondary', wordBreak: 'break-all' }}>{src.startsWith('data:') ? src.slice(0, 40) + '…' : src}</Typography>
                                    ))}
                                    {srcs.length > 5 && <Typography variant="caption" color="text.secondary">{t('andMore', { count: srcs.length - 5 })}</Typography>}
                                </Box>
                            ))}
                        </Stack>
                    </Collapse>
                </>
            )}
        </Alert>
    );
}
