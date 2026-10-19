/**
 * Tables on this page (docs/plans/automation-and-page-tools-plan.md §3.5): every data table, each with
 * a preview and Copy (pastes as cells), CSV, Save to My data and Show on page.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Database, Download, Eye, RefreshCw, Table2 } from 'lucide-react';
import { Button, Card, EmptyState, IconButton, Notice, Row, Skeleton, Stack, Text } from '../ui';
import ToolHeader from '../components/ui/ToolHeader';
import { sendToTab } from '../../shared/messages';
import { usePageTab } from '../hooks/usePageTab';
import { db } from '../../shared/db';
import { tableCsv, tableResult, tableTsv } from '../../shared/export/tables';
import { downloadText } from '../services/download';
import { slug } from '../../shared/utils/text';
import type { PageTable } from '../../content/services/tables/findTables';

const PREVIEW_ROWS = 3;

function Preview({ table }: { table: PageTable }) {
    const { t } = useTranslation('tables');
    return (
        <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-caption">
                <thead>
                    <tr>{table.columns.map(c => <th key={c} className="whitespace-nowrap border-b border-line bg-ink/4 px-2 py-1 text-left font-semibold text-ink">{c}</th>)}</tr>
                </thead>
                <tbody>
                    {table.rows.slice(0, PREVIEW_ROWS).map((r, i) => (
                        <tr key={i}>{r.map((v, k) => <td key={k} className="max-w-[160px] truncate border-b border-line px-2 py-1 text-ink-2">{v}</td>)}</tr>
                    ))}
                </tbody>
            </table>
            {table.rows.length > PREVIEW_ROWS && <Text size="caption" tone="faint" className="px-2 py-1">{t('more', { count: table.rows.length - PREVIEW_ROWS })}</Text>}
        </div>
    );
}

function TableCard({ table, tabId, url, pageTitle }: { table: PageTable; tabId: number; url: string; pageTitle: string }) {
    const { t } = useTranslation('tables');
    const [copied, setCopied] = useState(false);
    const [saved, setSaved] = useState(false);
    const file = slug(`${table.name} ${pageTitle}`.slice(0, 60), '-', 'table');

    const copy = async () => {
        await navigator.clipboard.writeText(tableTsv(table));
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };
    const save = async () => {
        const id = await db.tables.save(tableResult(table, url), { name: `${table.name} · ${pageTitle || url}` });
        setSaved(true);
        chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?view=data-table&tableId=${id}`) });
    };

    return (
        <Card pad="sm" data-testid="page-table">
            <Stack gap={2}>
                <Row justify="between" className="gap-2">
                    <div className="min-w-0">
                        <Text weight="semibold" truncate>{table.name}</Text>
                        <Text size="caption" tone="muted">
                            {table.totalRows
                                ? t('truncated', { shown: table.rows.length, total: table.totalRows })
                                : t('size', { rows: table.rows.length, cols: table.columns.length })}
                        </Text>
                    </div>
                    <IconButton label={t('show')} size="sm" variant="ghost" onClick={() => void sendToTab(tabId, 'TABLES_SHOW', { index: table.index })}><Eye /></IconButton>
                </Row>
                <Preview table={table} />
                <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="primary" onClick={() => void copy()} icon={copied ? <Check /> : <Copy />} title={t('copyHint')}>{copied ? t('copied') : t('copy')}</Button>
                    <Button size="sm" onClick={() => downloadText(tableCsv(table), `${file}.csv`, 'text/csv')} icon={<Download />}>{t('csv')}</Button>
                    <Button size="sm" variant="ghost" onClick={() => void save()} disabled={saved} icon={<Database />}>{saved ? t('saved') : t('save')}</Button>
                </div>
            </Stack>
        </Card>
    );
}

export default function TablesPage({ onBack, onNavigate }: { onBack: () => void; onNavigate: (view: string) => void }) {
    const { t } = useTranslation('tables');
    const page = usePageTab();
    const tabId = page.tab?.id;
    const [tables, setTables] = useState<PageTable[] | null>(null);
    const [error, setError] = useState(false);

    const read = useCallback(async () => {
        if (!tabId) return;
        setTables(null);
        setError(false);
        try {
            const reply = await sendToTab(tabId, 'TABLES_FIND');
            setTables(reply.tables);
        } catch {
            setError(true);
            setTables([]);
        }
    }, [tabId]);

    useEffect(() => { void read(); }, [read, page.url]);

    return (
        <div className="flex h-full flex-col overflow-hidden bg-bg">
            <ToolHeader title={t('title')} subtitle={t('subtitle')} icon={<Table2 size={17} />} onBack={onBack} loading={tables === null}
                actions={<IconButton label={t('refresh')} variant="ghost" size="sm" onClick={() => void read()}><RefreshCw /></IconButton>} />
            <div className="flex-1 overflow-y-auto p-4">
                <Stack gap={3}>
                    {error && <Notice tone="warning">{t('error')}</Notice>}
                    {tables === null && <><Skeleton className="h-32" /><Skeleton className="h-32" /></>}
                    {tables && tables.length > 0 && <Text size="caption" tone="muted">{t('count', { count: tables.length })}</Text>}
                    {tables?.map(table => <TableCard key={`${page.url}#${table.index}`} table={table} tabId={tabId!} url={page.url} pageTitle={page.title} />)}
                    {tables?.length === 0 && !error && (
                        <EmptyState icon={<Table2 />} title={t('none')}
                            action={<Button onClick={() => onNavigate('list-extractor')}>{t('listExtractor')}</Button>}>
                            {t('noneHint')}
                        </EmptyState>
                    )}
                </Stack>
            </div>
        </div>
    );
}
