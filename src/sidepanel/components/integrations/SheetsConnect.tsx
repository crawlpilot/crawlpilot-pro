/**
 * Settings → Google Sheets (docs/plans/leads-and-sheets-plan.md §2): the user connects their own
 * spreadsheet through an Apps Script they paste into it; no CrawlPilot Google account.
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, Sheet } from 'lucide-react';
import { Button, Card, Notice, Text, TextField } from '../../ui';
import { storage, DEFAULT_INTEGRATIONS } from '@/shared/storage';
import { looksLikeWebApp, newSecret, sheetsScript, testSheets, type SheetsConnection } from '@/shared/integrations/sheets';

/** The key in the script being set up, kept until connected (the panel may close meanwhile). */
const DRAFT_SECRET = 'crawlpilot.sheets.draftSecret';
const SCRIPT_ORIGINS = ['https://script.google.com/*', 'https://script.googleusercontent.com/*'];

function draftSecret(): string {
    try {
        const saved = localStorage.getItem(DRAFT_SECRET);
        if (saved) return saved;
        const fresh = newSecret();
        localStorage.setItem(DRAFT_SECRET, fresh);
        return fresh;
    } catch { return newSecret(); }
}

export function SheetsConnect() {
    const [conn, setConn] = useState<SheetsConnection | null>(null);
    const [secret] = useState(draftSecret);
    const [url, setUrl] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [setup, setSetup] = useState(false);

    useEffect(() => { void storage.get('integrations').then(i => setConn(i?.sheets ?? null)); }, []);

    const save = async (sheets: SheetsConnection | undefined) => {
        const current = (await storage.get('integrations')) ?? DEFAULT_INTEGRATIONS;
        await storage.set('integrations', { ...current, sheets });
        setConn(sheets ?? null);
    };

    const copy = async () => {
        await navigator.clipboard.writeText(sheetsScript(secret)).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const connect = async () => {
        setError(null);
        if (!looksLikeWebApp(url)) { setError('Paste the web app URL: it ends in /exec (Deploy → Manage deployments shows it).'); return; }
        setBusy(true);
        try {
            // Talking to Google's script servers: asked for here, from the click.
            if (url.includes('script.google')) await chrome.permissions.request({ origins: SCRIPT_ORIGINS }).catch(() => false);
            const found = await testSheets({ url, secret });
            await save({ url: url.trim(), secret, ...found });
            try { localStorage.removeItem(DRAFT_SECRET); } catch { /* storage blocked */ }
            setSetup(false);
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    };

    if (conn && !setup) {
        return (
            <Card className="flex flex-col gap-2.5" data-testid="sheets-connected">
                <Text weight="semibold" className="flex items-center gap-2"><Sheet size={16} /> Google Sheets</Text>
                <Text size="small" className="flex items-center gap-1.5"><CheckCircle2 size={14} className="text-success" /> Connected to <b>{conn.name ?? 'your spreadsheet'}</b></Text>
                <Text size="caption" tone="muted">In the data table, "Send to Google Sheets" puts a dataset in a tab of its own and keeps adding its new rows.</Text>
                <span className="flex flex-wrap gap-1.5">
                    {conn.spreadsheetUrl && <Button size="sm" icon={<ExternalLink />} onClick={() => chrome.tabs.create({ url: conn.spreadsheetUrl! })}>Open the spreadsheet</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setSetup(true)}>Use another spreadsheet</Button>
                    <Button size="sm" variant="ghost" onClick={() => save(undefined)}>Disconnect</Button>
                </span>
            </Card>
        );
    }

    return (
        <Card className="flex flex-col gap-3" data-testid="sheets-setup">
            <Text weight="semibold" className="flex items-center gap-2"><Sheet size={16} /> Google Sheets</Text>
            <Text size="small" tone="muted">Send datasets to your own spreadsheet and keep them up to date. It uses your Google account; CrawlPilot never sees it.</Text>
            <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-small text-ink">
                <li>Open the spreadsheet, then <b>Extensions → Apps Script</b>.</li>
                <li>Replace the code there with this script, and save.
                    <div className="mt-1.5"><Button size="sm" icon={<Copy />} onClick={copy} data-testid="copy-script">{copied ? 'Copied' : 'Copy script'}</Button></div>
                </li>
                <li><b>Deploy → New deployment → Web app</b>. Execute as: <b>Me</b>. Who has access: <b>Anyone</b>. Allow access when asked.</li>
                <li>Copy the <b>web app URL</b> and paste it here.</li>
            </ol>
            <TextField size="sm" label="Web app URL" placeholder="https://script.google.com/macros/s/…/exec" value={url} onChange={e => setUrl(e.target.value)} />
            {error && <Notice tone="warning">{error}</Notice>}
            <span className="flex gap-1.5">
                <Button size="sm" variant="primary" loading={busy} onClick={connect} disabled={!url.trim()}>Connect</Button>
                {conn && <Button size="sm" variant="ghost" onClick={() => setSetup(false)}>Cancel</Button>}
            </span>
        </Card>
    );
}
