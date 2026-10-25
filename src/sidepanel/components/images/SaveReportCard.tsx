import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Collapse, Notice, Stack, Text } from '../../ui';
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
    const tone = report.done === 0 ? 'danger' : report.failures.length ? 'warning' : 'success';

    return (
        <Notice tone={tone} onClose={onDismiss} className="mb-3"
            title={t('savedSummary', { done: report.done, total: report.total, size: megabytes(report.bytes), target: report.target })}>
            {report.converted > 0 && <div>{t('convertedCount', { count: report.converted })}</div>}
            {report.keptAnimated > 0 && <div>{t('keptAnimated', { count: report.keptAnimated })}</div>}
            {report.downgraded > 0 && <div>{t('downgraded', { count: report.downgraded })}</div>}
            {report.failures.length > 0 && (
                <>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        <Button size="sm" variant="primary" onClick={onRetry}>{t('retryFailed', { count: report.failures.length })}</Button>
                        <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(report.failures.map(f => f.src).join('\n'))}>{t('copyFailed')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setOpen(o => !o)}>{open ? t('hideDetails') : t('showDetails')}</Button>
                    </div>
                    <Collapse open={open}>
                        <Stack gap={2} className="mt-2">
                            {[...byReason].map(([reason, srcs]) => (
                                <div key={reason}>
                                    <Text size="caption" weight="bold">{FAIL_REASONS[reason]} · {srcs.length}</Text>
                                    {srcs.slice(0, 5).map(src => (
                                        <Text key={src} size="caption" tone="muted" className="break-all">{src.startsWith('data:') ? src.slice(0, 40) + '…' : src}</Text>
                                    ))}
                                    {srcs.length > 5 && <Text size="caption" tone="muted">{t('andMore', { count: srcs.length - 5 })}</Text>}
                                </div>
                            ))}
                        </Stack>
                    </Collapse>
                </>
            )}
        </Notice>
    );
}
