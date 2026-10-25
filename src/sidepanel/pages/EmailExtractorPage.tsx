/**
 * Contacts from websites (docs/plans/leads-and-sheets-plan.md §1): this page's contacts, or a list of
 * company websites (pasted, or a column of a dataset), each read with its contact pages; one row per
 * company in My data.
 */
import { useEffect, useMemo, useState } from 'react';
import { Copy, Database, ExternalLink, Mail, Play, Square, Users } from 'lucide-react';
import ToolHeader from '../components/ui/ToolHeader';
import { Button, Card, Notice, Progress, Segmented, Select, Spinner, Stepper, Switch, Text, TextArea } from '../ui';
import { sendToActiveTab } from '../../shared/messages';
import { contactRow, CONTACT_COLUMNS, parseSites } from '../../shared/contacts/row';
import type { SiteContacts } from '../../shared/contacts/find';
import { defaultConcurrency } from '../../shared/utils/concurrency';
import { useContactsRun } from '../hooks/useContactsRun';
import { db } from '../../shared/db';
import type { Table } from '../../shared/types/database';

interface EmailExtractorPageProps {
    onBack: () => void;
}

const openTable = (id: number) => chrome.tabs.create({ url: chrome.runtime.getURL(`sidepanel.html?view=data-table&tableId=${id}`) });

function ThisPage({ follow }: { follow: number }) {
    const [busy, setBusy] = useState(false);
    const [found, setFound] = useState<{ url: string; site: SiteContacts } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saved, setSaved] = useState<number | null>(null);
    const row = found ? contactRow(found.url, found.site.contacts, found.site.pages) : null;

    const find = async () => {
        setBusy(true); setError(null); setSaved(null);
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const site = await sendToActiveTab('CMD_FIND_CONTACTS', { follow });
            setFound({ url: tab?.url ?? '', site });
        } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
    };
    const save = async () => {
        if (!found || !row) return;
        setSaved(await db.tables.save({ type: 'contacts', source_url: found.url, columns: CONTACT_COLUMNS, items: [{ ...row, source_url: found.url }] }, { name: `Contacts: ${row.company || new URL(found.url).hostname}` }));
    };

    return (
        <div className="flex flex-col gap-3">
            <Button variant="primary" icon={<Mail />} loading={busy} onClick={find}>Find contacts on this page</Button>
            {error && <Notice tone="warning">{error}</Notice>}
            {found && row && (
                <Card className="flex flex-col gap-2" data-testid="contacts-found">
                    <Text weight="semibold">{row.company || new URL(found.url).hostname}</Text>
                    {found.site.contacts.emails.length === 0 && <Text size="small" tone="muted">No email address on this page or its {found.site.pages.length - 1} contact pages.</Text>}
                    {String(row.emails).split('; ').filter(Boolean).map(e => (
                        <span key={e} className="flex items-center gap-2"><Mail size={13} className="text-ink-3" /><Text size="small" mono>{e}</Text></span>
                    ))}
                    {row.phone && <Text size="small">Phone: {row.phone}</Text>}
                    {CONTACT_COLUMNS.filter(c => c.type === 'url' && c.id !== 'source_url' && c.id !== 'email_page' && row[c.id]).map(c => (
                        <a key={c.id} href={String(row[c.id])} target="_blank" rel="noreferrer" className="text-small text-ink-2">{c.name}: {String(row[c.id]).replace(/^https:\/\//, '')}</a>
                    ))}
                    {row.address && <Text size="small" tone="muted">{row.address}</Text>}
                    <Text size="caption" tone="muted">{found.site.pages.length} page{found.site.pages.length > 1 ? 's' : ''} read</Text>
                    <span className="flex gap-1">
                        <Button size="sm" variant="ghost" icon={<Copy />} onClick={() => navigator.clipboard.writeText(String(row.emails))} disabled={!row.emails}>Copy emails</Button>
                        {saved === null ? <Button size="sm" variant="ghost" icon={<Database />} onClick={save}>Save to My data</Button>
                            : <Button size="sm" variant="ghost" icon={<ExternalLink />} onClick={() => openTable(saved)}>Saved · Open</Button>}
                    </span>
                </Card>
            )}
        </div>
    );
}

function ManySites({ follow, ownOnly }: { follow: number; ownOnly: boolean }) {
    const run = useContactsRun();
    const [source, setSource] = useState<'paste' | 'dataset'>('paste');
    const [text, setText] = useState('');
    const [tables, setTables] = useState<Table[]>([]);
    const [tableId, setTableId] = useState(0);
    const [column, setColumn] = useState('');
    const [fromTable, setFromTable] = useState<string[]>([]);
    const [tabs, setTabs] = useState(defaultConcurrency);

    useEffect(() => { void db.tables.list(100).then(t => setTables(t.filter(x => !x.preview))); }, []);
    const table = tables.find(t => t.id === tableId);
    useEffect(() => {
        if (!table) return;
        setColumn(table.columns.find(c => c.type === 'url' || /url|website|site|domain|link/i.test(c.name))?.id ?? table.columns[0]?.id ?? '');
    }, [table]);
    useEffect(() => {
        if (!tableId || !column) { setFromTable([]); return; }
        void db.tables.rowsPage(tableId, 0, 5000).then(rows => setFromTable(rows.map(r => String(r.data[column] ?? ''))));
    }, [tableId, column]);

    const sites = useMemo(() => {
        const list = source === 'paste' ? parseSites(text) : parseSites(fromTable.join('\n'));
        // A company's site: its homepage (a dataset's links may be to deep pages).
        return [...new Set(list.map(u => { try { return `${new URL(u).origin}/`; } catch { return u; } }))];
    }, [source, text, fromTable]);

    if (run.running || run.finished) {
        return (
            <Card className="flex flex-col gap-2.5" data-testid="contacts-run">
                <span className="flex items-center justify-between">
                    <Text weight="semibold" className="flex items-center gap-2">{run.running && <Spinner size={14} />}{run.running ? (run.stopping ? 'Stopping…' : 'Reading the websites') : run.finished === 'completed' ? 'Done' : run.finished === 'stopped' ? 'Stopped' : 'Failed'}</Text>
                    <Text weight="bold" className="tabular-nums">{run.done} / {run.total}</Text>
                </span>
                <Progress value={Math.max(3, (run.done / (run.total || 1)) * 100)} label="Websites read" />
                {run.failed > 0 && <Text size="caption" tone="muted">{run.failed} website{run.failed > 1 ? 's' : ''} couldn't be read.</Text>}
                {run.error && <Notice tone="danger">{run.error}</Notice>}
                <span className="flex gap-1.5">
                    {run.running && <Button size="sm" icon={<Square />} onClick={run.stop} disabled={run.stopping}>Stop</Button>}
                    {run.tableId !== null && <Button size="sm" variant={run.running ? 'ghost' : 'primary'} icon={<ExternalLink />} onClick={() => openTable(run.tableId!)}>Open in My data</Button>}
                    {!run.running && <Button size="sm" variant="ghost" onClick={run.reset}>New list</Button>}
                </span>
            </Card>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            <Segmented size="sm" fullWidth aria-label="Websites from" value={source} onChange={setSource}
                options={[{ value: 'paste', label: 'Paste websites' }, { value: 'dataset', label: 'From My data' }]} />
            {source === 'paste' ? (
                <TextArea label="Company websites" rows={6} value={text} onChange={e => setText(e.target.value)} placeholder={'acme.com\nhttps://www.example-store.co.uk\n…'} hint="One per line: addresses or bare domains." />
            ) : (
                <div className="flex flex-col gap-2">
                    <Select aria-label="Dataset" value={tableId} onChange={v => setTableId(Number(v))}
                        options={[{ value: 0, label: 'Choose a dataset…' }, ...tables.map(t => ({ value: t.id!, label: `${t.name} (${t.rowCount})` }))]} />
                    {table && <Select aria-label="Column with the websites" value={column} onChange={v => setColumn(String(v))} options={table.columns.map(c => ({ value: c.id, label: c.name }))} />}
                </div>
            )}
            <Text size="caption" tone="muted">{sites.length} website{sites.length === 1 ? '' : 's'}</Text>
            <span className="flex items-center justify-between gap-2">
                <Text size="small">Tabs at a time</Text>
                <Stepper label="Tabs at a time" value={tabs} onChange={setTabs} min={1} max={5} step={1} width={1} />
            </span>
            <Button variant="primary" icon={<Play />} disabled={sites.length === 0}
                onClick={() => run.start({ urls: sites, follow, ownOnly, maxConcurrent: tabs, customName: `Contacts: ${sites.length} websites` })}>
                Find contacts on {sites.length || ''} website{sites.length === 1 ? '' : 's'}
            </Button>
        </div>
    );
}

export default function EmailExtractorPage({ onBack }: EmailExtractorPageProps) {
    const [mode, setMode] = useState<'page' | 'list'>('page');
    const [follow, setFollow] = useState(3);
    const [ownOnly, setOwnOnly] = useState(false);
    return (
        <div className="flex h-full flex-col overflow-hidden bg-bg">
            <ToolHeader title="Contacts from websites" subtitle="Emails, phones and social profiles companies publish" onBack={onBack} />
            <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
                <Segmented fullWidth aria-label="Where" value={mode} onChange={setMode}
                    options={[{ value: 'page', label: 'This page' }, { value: 'list', label: 'A list of websites' }]} />
                {mode === 'page' ? <ThisPage follow={follow} /> : <ManySites follow={follow} ownOnly={ownOnly} />}
                <Card tone="plain" className="flex flex-col gap-2.5">
                    <span className="flex items-center justify-between gap-2">
                        <span><Text size="small" weight="medium">Contact pages per site</Text><Text size="caption" tone="muted">Contact, about and imprint pages read besides the one opened</Text></span>
                        <Stepper label="Contact pages per site" value={follow} onChange={setFollow} min={0} max={6} step={1} width={1} />
                    </span>
                    {mode === 'list' && <Switch checked={ownOnly} onChange={setOwnOnly} label="Only each company's own addresses" hint="Leave out emails on other domains (gmail.com, agencies)" />}
                </Card>
                <Text size="caption" tone="muted" className="flex items-start gap-1.5"><Users size={12} className="mt-0.5 shrink-0" /> Only what each site publishes is collected. Use it as the law where you work allows (for example GDPR for EU contacts).</Text>
            </div>
        </div>
    );
}
