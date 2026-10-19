/**
 * The Page assistant (docs/plans/summarize-ask-plan.md P1): a brief made for the kind of page, every
 * point checked against the page and shown on it with a click, and questions answered with citations.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle, ArrowRight, Crosshair, History, ImagePlus, Languages, Monitor, UserCheck, CheckCircle2, Copy, Database, Download, Lock, MapPin, RotateCcw, Send, Sparkles, Table2 } from 'lucide-react';
import { Button, Card, Chip, Heading, IconButton, Menu, MenuItem, Notice, Progress, Skeleton, Spinner, Text, TextArea, ToggleChip, Tooltip, cx, type ChipTone } from '../../ui';
import { usePageAssistant, type BriefStatus } from '../../hooks/usePageAssistant';
import { useAskSession, type AskMessage } from '../../hooks/useAskSession';
import { usePageTab } from '../../hooks/usePageTab';
import { briefMarkdown, briefNowRow, openTable, pointKey, runFit, saveBrief, savedBrief, saveTable, type BriefOutcome, type FitOutcome } from '../../services/ai/assistant';
import { storage } from '../../../shared/storage';
import { setExtractDraft } from '../../services/ai/extractDraft';
import { languageName } from '../../services/ai/translate';
import { capturePage, pickOnPage, type PageImage } from '../../services/ai/vision';
import { SCHEMA_PRESETS } from '../../../shared/ai/schemaIntake';
import { BRIEFS, EXTRACT_PRESET, briefChanges, tableCsv, type AnswerTable, type BriefChange, type FitVerdict } from '../../../shared/ai/brief';
import type { CiteStatus } from '../../../shared/ai/cite';

const STATUS: Record<CiteStatus, { icon: ReactNode; label: string; tone: string }> = {
    verified: { icon: <CheckCircle2 size={14} />, label: 'On the page: click to show it', tone: 'text-success' },
    relocated: { icon: <MapPin size={14} />, label: 'Found in another part of the page: click to show it', tone: 'text-warning' },
    not_on_page: { icon: <AlertTriangle size={14} />, label: 'Not found on the page: check before relying on it', tone: 'text-ink-3' },
    unchecked: { icon: <AlertTriangle size={14} />, label: 'Not checked', tone: 'text-ink-3' },
};

function statusText(s: BriefStatus | null): string {
    if (!s || s.step === 'reading') return 'Reading the page…';
    const kind = s.kind ? BRIEFS[s.kind].label.toLowerCase() : 'page';
    if (s.step === 'translating') return `Translating the page from ${languageName(s.language ?? '')}${s.parts && s.parts > 1 ? ` (part ${s.part} of ${s.parts})` : ''}…`;
    if (s.step === 'briefing') return s.parts && s.parts > 1 ? `Briefing this ${kind} page (part ${s.part} of ${s.parts})…` : `Briefing this ${kind} page…`;
    return 'Checking each point against the page…';
}

/** What to do next with this kind of page, in CrawlPilot's own tools. */
function NextStep({ outcome, onNavigate }: { outcome: BriefOutcome; onNavigate?: (view: string) => void }) {
    if (!onNavigate) return null;
    if (outcome.kind === 'listing') {
        return <Button size="sm" variant="secondary" iconEnd={<ArrowRight />} onClick={() => onNavigate('list-extractor')}>Extract all items</Button>;
    }
    const preset = EXTRACT_PRESET[outcome.kind];
    if (!preset || !SCHEMA_PRESETS[preset]) return null;
    return (
        <Button size="sm" variant="secondary" iconEnd={<ArrowRight />} onClick={() => { setExtractDraft(SCHEMA_PRESETS[preset].text); onNavigate('ai-extract'); }}>
            Get these details as data
        </Button>
    );
}

function BriefCard({ outcome, onShow, onNavigate }: { outcome: BriefOutcome; onShow: (ref: string, quote?: string) => void; onNavigate?: (view: string) => void }) {
    const [copied, setCopied] = useState(false);
    const [saved, setSaved] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);
    const sections = outcome.brief.sections.filter(s => s.points.length > 0);
    const checked = Object.values(outcome.checks);
    const found = checked.filter(c => c.status === 'verified' || c.status === 'relocated').length;

    if (sections.length === 0) {
        return <Notice tone="info">The page didn't give enough to brief. Ask a question below instead.</Notice>;
    }
    const copy = async () => {
        await navigator.clipboard.writeText(briefMarkdown(outcome)).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };
    return (
        <Card pad="none" className="overflow-hidden" data-testid="page-brief">
            <div className="flex flex-col gap-3 p-3.5">
                {sections.map(s => (
                    <div key={s.key} className="flex flex-col gap-1">
                        <Text size="caption" weight="semibold" tone="muted" className="flex items-center gap-1.5 uppercase tracking-wide">
                            {s.label}
                            {s.inferred && <Chip tone="outline">the model's reading</Chip>}
                        </Text>
                        {s.points.map((p, i) => {
                            const check = s.inferred ? undefined : outcome.checks[pointKey(s.key, i)];
                            const where = check?.ref && (check.status === 'verified' || check.status === 'relocated') ? check.ref : undefined;
                            const st = check ? STATUS[check.status] : undefined;
                            const body = (
                                <span className={cx('flex items-start gap-2 text-left', check?.status === 'not_on_page' && 'text-ink-3 italic')}>
                                    {st && <span className={cx('mt-0.5 shrink-0', st.tone)} aria-label={st.label}>{st.icon}</span>}
                                    <Text size="small" as="span" className={cx(check?.status === 'not_on_page' && 'text-ink-3')}>{p.text}</Text>
                                </span>
                            );
                            return where ? (
                                <Tooltip key={i} title={st!.label}>
                                    <button type="button" data-testid="brief-point" data-status={check!.status} onClick={() => onShow(where, p.quote)}
                                        className="-mx-1.5 cursor-pointer rounded-lg px-1.5 py-1 hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-brand">
                                        {body}
                                    </button>
                                </Tooltip>
                            ) : (
                                <div key={i} data-testid="brief-point" data-status={check?.status ?? 'inferred'} className="-mx-1.5 px-1.5 py-1" title={st?.label}>{body}</div>
                            );
                        })}
                    </div>
                ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2/50 px-3.5 py-2">
                <Text size="caption" tone="muted">
                    {checked.length > 0 ? `${found} of ${checked.length} points found on the page` : 'Nothing to check'}
                    {outcome.partial ? ' · long page: the brief covers its first parts' : ''}
                </Text>
                <span className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" icon={<Copy />} onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
                    {saved === null
                        ? <Button size="sm" variant="ghost" icon={<Database />} loading={saving} onClick={async () => { setSaving(true); try { setSaved(await saveBrief(outcome)); } finally { setSaving(false); } }}>Save</Button>
                        : <Button size="sm" variant="ghost" icon={<Database />} onClick={() => openTable(saved)} data-testid="brief-saved">Saved · Open Briefs</Button>}
                </span>
            </div>
            <div className="flex flex-wrap gap-2 border-t border-line px-3.5 py-2.5 empty:hidden"><NextStep outcome={outcome} onNavigate={onNavigate} /></div>
        </Card>
    );
}

/** An answer with its `[b12]` markers as numbered citation chips. */
function Answer({ message, onShow }: { message: AskMessage; onShow: (ref: string) => void }) {
    const { markdown, numbers } = useMemo(() => {
        // Each block gets a number; each marker keeps its place, so it shows its own sentence's check.
        const numbers = new Map<string, number>();
        let marker = 0;
        const markdown = message.content.replace(/\s?\[(b\d+(?:\s*,\s*b\d+)*)\]/g, (_, list: string) =>
            list.split(/\s*,\s*/).map(ref => {
                if (!numbers.has(ref)) numbers.set(ref, numbers.size + 1);
                return ` [${numbers.get(ref)}](#cite-${ref}-${marker++})`;
            }).join(''));
        return { markdown, numbers };
    }, [message.content]);
    return (
        <div className="cp-prose overflow-x-auto break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                a: ({ href, children }) => {
                    const cite = href?.match(/^#cite-(b\d+)-(\d+)$/);
                    if (!cite) return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
                    const ref = cite[1];
                    const status = message.markers?.[Number(cite[2])];
                    const tone = status === 'verified' ? 'bg-success-soft text-success' : status === 'relocated' ? 'bg-warning-soft text-warning' : status === 'not_on_page' ? 'bg-ink/7 text-ink-3 line-through' : 'bg-ink/7 text-ink-2';
                    return (
                        <button type="button" data-testid="cite" data-status={status ?? 'pending'} onClick={() => onShow(ref)}
                            title={status ? STATUS[status].label : 'Show on the page'}
                            className={cx('mx-0.5 inline-flex h-4 min-w-4 cursor-pointer items-center justify-center rounded px-1 align-super text-[10px] font-bold no-underline', tone)}>
                            {children}
                        </button>
                    );
                },
            }}>{markdown || ' '}</ReactMarkdown>
            {message.fromImage && !message.streaming && (
                <Text size="caption" tone="muted" className="mt-1">From the image: not checked against the page's text.</Text>
            )}
            {!message.fromImage && numbers.size === 0 && !message.streaming && message.content && !/^the page doesn'?t say/i.test(message.content.trim()) && (
                <Text size="caption" tone="muted" className="mt-1">No part of the page cited: check before relying on it.</Text>
            )}
            {!!message.unsupported && (
                <Text size="caption" tone="muted" className="mt-1">{message.unsupported} sentence{message.unsupported > 1 ? 's' : ''} not found on the page: check before relying on {message.unsupported > 1 ? 'them' : 'it'}.</Text>
            )}
        </div>
    );
}

function TableView({ table, rows, name, url, fromImage }: { table: AnswerTable; rows: CiteStatus[]; name: string; url: string; fromImage?: boolean }) {
    const [saved, setSaved] = useState<number | null>(null);
    const [copied, setCopied] = useState(false);
    const found = rows.filter(s => s === 'verified' || s === 'relocated').length;
    return (
        <div className="mt-2 flex flex-col gap-1.5" data-testid="answer-table">
            <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full border-collapse text-small">
                    <thead><tr className="bg-surface-2/60">
                        <th className="w-5 px-1.5" aria-label="Checked" />
                        {table.columns.map(c => <th key={c} className="px-2 py-1.5 text-left font-semibold text-ink-2">{c}</th>)}
                    </tr></thead>
                    <tbody>
                        {table.rows.map((r, i) => (
                            <tr key={i} className="border-t border-line" data-status={rows[i]}>
                                <td className={cx('px-1.5 align-top', STATUS[rows[i] ?? 'unchecked'].tone)} title={STATUS[rows[i] ?? 'unchecked'].label}>{!fromImage && STATUS[rows[i] ?? 'unchecked'].icon}</td>
                                {r.cells.map((c, k) => <td key={k} className={cx('px-2 py-1.5 align-top', rows[i] === 'not_on_page' && 'text-ink-3 italic')}>{c}</td>)}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <span className="flex flex-wrap items-center gap-1">
                <Text size="caption" tone="muted" className="mr-auto">{fromImage ? 'Read from the image: check before relying on it' : `${found} of ${rows.length} rows found on the page`}</Text>
                <Button size="sm" variant="ghost" icon={<Copy />} onClick={async () => { await navigator.clipboard.writeText(tableCsv(table)).catch(() => undefined); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copied' : 'Copy CSV'}</Button>
                {saved === null
                    ? <Button size="sm" variant="ghost" icon={<Database />} onClick={async () => setSaved(await saveTable(table, name, url))}>Save to My data</Button>
                    : <Button size="sm" variant="ghost" icon={<Database />} onClick={() => openTable(saved)} data-testid="table-saved">Saved · Open</Button>}
            </span>
        </div>
    );
}

/** "Since you saved this page": what changed against the latest saved brief of this page. */
function SinceSaved({ outcome }: { outcome: BriefOutcome }) {
    const [diff, setDiff] = useState<{ at: number; changes: BriefChange[] } | null>(null);
    useEffect(() => {
        let live = true;
        savedBrief(outcome.view.url).then(saved => {
            if (live && saved) setDiff({ at: saved.at, changes: briefChanges(saved.row, briefNowRow(outcome), outcome.kind) });
        }).catch(() => undefined);
        return () => { live = false; };
    }, [outcome]);
    if (!diff) return null;
    const when = new Date(diff.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    if (diff.changes.length === 0) {
        return <Text size="caption" tone="muted" className="flex items-center gap-1.5" data-testid="since-saved"><History size={12} /> No change since you saved this page on {when}.</Text>;
    }
    return (
        <Card tone="plain" className="flex flex-col gap-1.5 border-warning/40!" data-testid="since-saved">
            <Text size="small" weight="semibold" className="flex items-center gap-1.5"><History size={14} /> Since you saved this page on {when}</Text>
            {diff.changes.map(c => (
                <div key={c.field} className="flex flex-col gap-0.5">
                    <Text size="caption" weight="semibold" tone="muted" className="uppercase tracking-wide">{c.label}</Text>
                    {c.from !== undefined && <Text size="small"><span className="text-ink-3 line-through">{c.from}</span> → <span className="font-semibold">{c.to}</span></Text>}
                    {c.added?.map(p => <Text key={`+${p}`} size="small">New: {p}</Text>)}
                    {c.removed?.map(p => <Text key={`-${p}`} size="small" tone="muted">No longer: {p}</Text>)}
                </div>
            ))}
        </Card>
    );
}

const VERDICT: Record<FitVerdict, { label: string; tone: ChipTone }> = {
    fits: { label: 'Fits what matters to you', tone: 'success' },
    partly: { label: 'Partly fits', tone: 'warning' },
    no: { label: "Doesn't fit", tone: 'danger' },
    unclear: { label: "The page doesn't say enough", tone: 'neutral' },
};

/** "Does it fit me?": the user's needs (kept on this device) against the brief's facts, each reason checked. */
function FitCheck({ outcome, page, onShow }: { outcome: BriefOutcome; page: ReturnType<typeof usePageAssistant>['page']; onShow: (ref: string, quote?: string) => void }) {
    const [needs, setNeeds] = useState('');
    const [draft, setDraft] = useState('');
    const [editing, setEditing] = useState(false);
    const [running, setRunning] = useState(false);
    const [fit, setFit] = useState<FitOutcome | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => { storage.get('assistantNeeds').then(n => { setNeeds(n ?? ''); setDraft(n ?? ''); }).catch(() => undefined); }, []);
    useEffect(() => { setFit(null); setError(null); }, [outcome]);

    const check = async (text: string) => {
        if (!page || !text.trim()) return;
        setRunning(true);
        setError(null);
        try { setFit(await runFit(outcome, text, page)); } catch (e) { setError((e as Error).message); } finally { setRunning(false); }
    };
    const saveAndCheck = async () => {
        const text = draft.trim();
        if (!text) return;
        await storage.set('assistantNeeds', text).catch(() => undefined);
        setNeeds(text);
        setEditing(false);
        void check(text);
    };

    if (editing) {
        return (
            <Card className="flex flex-col gap-2" data-testid="fit-editor">
                <TextArea label="What matters to you?" rows={2} value={draft} onChange={e => setDraft(e.target.value)}
                    placeholder="For example: under $200, for a 5-year-old, ships to Canada" hint="Saved on this device and used only for this check." />
                <span className="flex gap-1.5">
                    <Button size="sm" variant="primary" onClick={saveAndCheck} disabled={!draft.trim()}>Check this page</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(needs); }}>Cancel</Button>
                </span>
            </Card>
        );
    }
    return (
        <div className="flex flex-col gap-2">
            {!fit && (
                <span className="flex flex-wrap items-center gap-1.5">
                    <Button size="sm" variant="secondary" icon={<UserCheck />} loading={running} onClick={() => (needs ? check(needs) : setEditing(true))}>Does it fit me?</Button>
                    {needs && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit what matters</Button>}
                </span>
            )}
            {error && <Notice tone="warning">{error}</Notice>}
            {fit && (
                <Card className="flex flex-col gap-2" data-testid="fit">
                    <span className="flex flex-wrap items-center gap-2">
                        <Chip tone={VERDICT[fit.verdict].tone} size="md" icon={<UserCheck />} data-testid="fit-verdict" data-verdict={fit.verdict}>{VERDICT[fit.verdict].label}</Chip>
                        <Text size="caption" tone="muted" className="truncate">for: {needs}</Text>
                    </span>
                    {fit.reasons.map((r, i) => {
                        const check = fit.checks[i];
                        const where = check?.ref && (check.status === 'verified' || check.status === 'relocated') ? check.ref : undefined;
                        const st = STATUS[check?.status ?? 'unchecked'];
                        return (
                            <button key={i} type="button" disabled={!where} onClick={() => where && onShow(where, r.quote)} data-testid="fit-reason" data-status={check?.status ?? 'unchecked'}
                                className={cx('-mx-1.5 flex items-start gap-2 rounded-lg px-1.5 py-1 text-left', where ? 'cursor-pointer hover:bg-ink/5' : 'cursor-default')} title={st.label}>
                                <span className={cx('mt-0.5 shrink-0', st.tone)}>{st.icon}</span>
                                <Text size="small" as="span" className={cx(check?.status === 'not_on_page' && 'text-ink-3 italic')}>{r.text}</Text>
                            </button>
                        );
                    })}
                    <span className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit what matters</Button>
                        <Button size="sm" variant="ghost" icon={<RotateCcw />} loading={running} onClick={() => check(needs)}>Check again</Button>
                    </span>
                </Card>
            )}
        </div>
    );
}

const IMAGE_QUESTIONS = ['What does this show?', 'What are the numbers in it?', 'Read the text in it.'];

function AskPanel({ outcome, page, onShow, userLang, tabId }: { outcome: BriefOutcome; page: ReturnType<typeof usePageAssistant>['page']; onShow: (ref: string) => void; userLang: string; tabId: number | null }) {
    const session = useAskSession(outcome.view, page, BRIEFS[outcome.kind].questions, userLang);
    const [input, setInput] = useState('');
    const [image, setImage] = useState<PageImage | null>(null);
    const [picking, setPicking] = useState(false);
    const [imageError, setImageError] = useState<string | null>(null);
    const [menu, setMenu] = useState<HTMLElement | null>(null);
    const attach = async (how: 'pick' | 'screen') => {
        setMenu(null);
        if (tabId === null) return;
        setImageError(null);
        setPicking(how === 'pick');
        try {
            const region = how === 'pick' ? await pickOnPage(tabId) : null;
            if (how === 'pick' && !region) return;
            setImage(await capturePage(tabId, region));
        } catch (e) {
            setImageError(`Couldn't take a picture of the page: ${(e as Error).message}`);
        } finally {
            setPicking(false);
        }
    };
    const end = useRef<HTMLDivElement>(null);
    useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [session.messages.length, session.messages[session.messages.length - 1]?.content]);
    const send = (text?: string) => {
        const q = (text ?? input).trim();
        if (!q || session.thinking) return;
        if (text === undefined) setInput('');
        session.ask(q, image ?? undefined);
        setImage(null);
    };
    return (
        <div className="flex flex-col gap-2.5">
            {session.messages.map((m, i) => m.role === 'user' ? (
                <div key={i} className="ml-8 flex flex-col gap-1.5 self-end rounded-2xl rounded-tr-md bg-ink px-3.5 py-2 text-bg">
                    {m.image && <img src={m.image.url} alt={m.image.label} className="max-h-40 w-auto self-end rounded-lg" data-testid="asked-image" />}
                    <p className="m-0 text-body whitespace-pre-wrap">{m.content}</p>
                </div>
            ) : (
                <div key={i} className="mr-4 rounded-2xl rounded-tl-md border border-line bg-surface px-3.5 py-2.5" data-testid="answer">
                    {m.content ? <Answer message={m} onShow={onShow} /> : <Text size="small" tone="muted" className="flex items-center gap-2"><Spinner size={12} /> Reading the page…</Text>}
                    {m.table && <TableView table={m.table.data} rows={m.table.rows} url={outcome.view.url} fromImage={m.table.fromImage}
                        name={`${outcome.view.title || 'Page'}: ${[...session.messages.slice(0, i)].reverse().find(x => x.role === 'user')?.content ?? 'table'}`.slice(0, 120)} />}
                    {m.tableError && <Text size="caption" tone="muted" className="mt-1">{m.tableError}</Text>}
                    {!m.streaming && !m.table && m.content && !/^the page doesn'?t say/i.test(m.content.trim()) && !/^error:/i.test(m.content) && (
                        <Button size="sm" variant="ghost" className="mt-1 -ml-2" icon={<Table2 />} loading={m.tabling} disabled={session.thinking} onClick={() => session.asTable(i)}>As a table</Button>
                    )}
                </div>
            ))}
            {!session.thinking && (
                <div className="flex flex-wrap gap-1.5" data-testid="suggestions">
                    {(image ? IMAGE_QUESTIONS : session.suggestions).map(q => (
                        <ToggleChip key={q} selected={false} onClick={() => send(q)} className="h-auto py-1 text-left whitespace-normal">{q}</ToggleChip>
                    ))}
                </div>
            )}
            <div ref={end} />
            {picking && <Notice tone="info">Click what to ask about on the page. Esc cancels.</Notice>}
            {imageError && <Notice tone="warning">{imageError}</Notice>}
            {image && (
                <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-1.5" data-testid="attached-image">
                    <img src={image.url} alt={image.label} className="size-12 rounded-md object-cover" />
                    <Text size="caption" className="min-w-0 flex-1" truncate>{image.label}</Text>
                    <Button size="sm" variant="ghost" onClick={() => setImage(null)}>Remove</Button>
                </div>
            )}
            <div className="flex items-end gap-1 rounded-card border-[1.5px] border-line bg-surface p-1.5 focus-within:border-line-strong">
                <IconButton label="Ask about an image" variant="ghost" onClick={e => setMenu(e.currentTarget)} disabled={session.thinking || picking}><ImagePlus /></IconButton>
                <Menu anchor={menu} onClose={() => setMenu(null)}>
                    <MenuItem icon={<Crosshair />} onClick={() => void attach('pick')} hint="An image, a chart, a table">Point at something on the page</MenuItem>
                    <MenuItem icon={<Monitor />} onClick={() => void attach('screen')} hint="What you see now">The whole visible page</MenuItem>
                </Menu>
                <textarea rows={1} placeholder={image ? 'Ask about the image…' : 'Ask about this page…'} value={input} onChange={e => setInput(e.target.value)} aria-label="Ask about this page"
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} disabled={session.thinking}
                    className="max-h-28 min-h-9 flex-1 resize-none border-0 bg-transparent px-2.5 py-2 text-body text-ink outline-none placeholder:text-ink-3 disabled:opacity-60" />
                <IconButton label="Ask" variant="secondary" onClick={() => send()} disabled={!input.trim() || session.thinking}
                    className={input.trim() && !session.thinking ? 'border-line-strong! bg-brand! text-on-brand!' : undefined}><Send /></IconButton>
            </div>
        </div>
    );
}

export function PageAssistant({ initialTabId, onSummary, onNavigate }: { initialTabId: number; onSummary: () => void; onNavigate?: (view: string) => void }) {
    const a = usePageAssistant(initialTabId);
    const current = usePageTab();
    const elsewhere = a.phase === 'ready' && current.web && current.tab?.id !== undefined && current.tab.id !== a.tabId;

    if (a.phase === 'starting') {
        return <div className="flex flex-col items-center gap-3 p-12"><Spinner size={28} /><Text tone="muted">Checking the on-device model…</Text></div>;
    }
    if (a.phase === 'needs-translation' && a.translation) {
        const from = languageName(a.translation.source);
        return (
            <div className="flex flex-col items-center gap-3 p-8 text-center" data-testid="needs-translation">
                <span className="flex size-14 -rotate-6 items-center justify-center rounded-[18px] border-[1.5px] border-line-strong bg-brand text-on-brand shadow-press"><Languages size={26} /></span>
                <Heading size="heading">This page is in {from}</Heading>
                <Text size="small" tone="muted" className="max-w-[320px]">Chrome translates it on this device so the assistant can read it. The {from} pack downloads once.</Text>
                <Button variant="primary" className="mt-2" onClick={a.downloadLanguage}>Download {from}</Button>
            </div>
        );
    }
    if (a.phase === 'needs-model' || a.phase === 'downloading') {
        const percent = Math.round((a.downloadProgress ?? 0) * 100);
        return (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
                <span className="flex size-14 -rotate-6 items-center justify-center rounded-[18px] border-[1.5px] border-line-strong bg-brand text-on-brand shadow-press"><Download size={26} /></span>
                <Heading size="heading">{a.phase === 'downloading' ? (a.translation ? `Downloading ${languageName(a.translation.source)}` : 'Downloading the on-device model') : 'Get the on-device model'}</Heading>
                <Text size="small" tone="muted" className="max-w-[320px]">Chrome downloads Gemini Nano once. After that, pages are read on this computer and never sent anywhere.</Text>
                {a.phase === 'downloading'
                    ? <div className="mt-2 w-full max-w-sm"><Progress value={percent} label="Download" /><Text size="caption" tone="muted" className="mt-1">{percent}%</Text></div>
                    : <Button variant="primary" className="mt-2" onClick={a.download}>Download the model</Button>}
            </div>
        );
    }
    if (a.phase === 'no-model') {
        return (
            <div className="flex flex-col gap-3 p-1">
                <Notice tone="warning">The brief needs Chrome's on-device model, which can't run here. {a.noModelReason}</Notice>
                <Button onClick={onSummary}>Try a plain summary instead</Button>
            </div>
        );
    }
    if (a.phase === 'error') {
        return (
            <div className="flex flex-col gap-3 p-1">
                <Notice tone="danger">{a.error}</Notice>
                <Button icon={<RotateCcw />} onClick={() => a.tabId !== null && a.brief(a.tabId)}>Try again</Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
                {a.outcome && <Chip tone="brand" icon={<Sparkles />}>{BRIEFS[a.outcome.kind].label}</Chip>}
                {a.outcome && <Text size="caption" tone="muted" className="truncate">{(() => { try { return new URL(a.outcome.view.url).host; } catch { return ''; } })()}</Text>}
                {a.outcome?.translatedFrom && <Chip tone="info" icon={<Languages />} data-testid="read-from">Read from {languageName(a.outcome.translatedFrom)}</Chip>}
                <Text size="caption" tone="muted" className="ml-auto flex items-center gap-1"><Lock size={11} /> On this device</Text>
            </div>
            {a.outcome?.showInPending && (
                <Button size="sm" variant="secondary" icon={<Languages />} loading={a.downloadProgress !== null} onClick={a.showInMyLanguage}>
                    Show in {new Intl.DisplayNames([a.outcome.showInPending], { type: 'language' }).of(a.outcome.showInPending) ?? a.outcome.showInPending}
                </Button>
            )}

            {elsewhere && (
                <Notice tone="info">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                        <span>You're on another page now.</span>
                        <Button size="sm" onClick={() => a.brief(current.tab!.id!)}>Brief this page</Button>
                    </span>
                </Notice>
            )}

            {a.phase === 'briefing' && (
                <Card className="flex flex-col gap-2.5" data-testid="briefing">
                    <Text size="small" tone="muted" className="flex items-center gap-2"><Spinner size={14} /> {statusText(a.status)}</Text>
                    <Skeleton className="h-3 w-3/4" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" />
                </Card>
            )}

            {a.phase === 'ready' && a.outcome && (
                <>
                    <SinceSaved outcome={a.outcome} />
                    <BriefCard outcome={a.outcome} onShow={a.show} onNavigate={onNavigate} />
                    <FitCheck outcome={a.outcome} page={a.page} onShow={a.show} />
                    <AskPanel outcome={a.outcome} page={a.page} onShow={ref => a.show(ref)} userLang={a.userLang} tabId={a.tabId} />
                </>
            )}
        </div>
    );
}
