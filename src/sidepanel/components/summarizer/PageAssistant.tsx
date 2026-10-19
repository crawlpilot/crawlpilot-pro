/**
 * The Page assistant (docs/plans/summarize-ask-plan.md P1): a brief made for the kind of page, every
 * point checked against the page and shown on it with a click, and questions answered with citations.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertTriangle, CheckCircle2, Copy, Download, Lock, MapPin, RotateCcw, Send, Sparkles } from 'lucide-react';
import { Button, Card, Chip, Heading, IconButton, Notice, Progress, Skeleton, Spinner, Text, ToggleChip, Tooltip, cx } from '../../ui';
import { usePageAssistant, type BriefStatus } from '../../hooks/usePageAssistant';
import { useAskSession, type AskMessage } from '../../hooks/useAskSession';
import { usePageTab } from '../../hooks/usePageTab';
import { briefMarkdown, pointKey, type BriefOutcome } from '../../services/ai/assistant';
import { BRIEFS } from '../../../shared/ai/brief';
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
    if (s.step === 'briefing') return s.parts && s.parts > 1 ? `Briefing this ${kind} page (part ${s.part} of ${s.parts})…` : `Briefing this ${kind} page…`;
    return 'Checking each point against the page…';
}

function BriefCard({ outcome, onShow }: { outcome: BriefOutcome; onShow: (ref: string, quote?: string) => void }) {
    const [copied, setCopied] = useState(false);
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
                <Button size="sm" variant="ghost" icon={<Copy />} onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
            </div>
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
            {numbers.size === 0 && !message.streaming && message.content && !/^the page doesn'?t say/i.test(message.content.trim()) && (
                <Text size="caption" tone="muted" className="mt-1">No part of the page cited: check before relying on it.</Text>
            )}
            {!!message.unsupported && (
                <Text size="caption" tone="muted" className="mt-1">{message.unsupported} sentence{message.unsupported > 1 ? 's' : ''} not found on the page: check before relying on {message.unsupported > 1 ? 'them' : 'it'}.</Text>
            )}
        </div>
    );
}

function AskPanel({ outcome, page, onShow }: { outcome: BriefOutcome; page: ReturnType<typeof usePageAssistant>['page']; onShow: (ref: string) => void }) {
    const session = useAskSession(outcome.view, page, BRIEFS[outcome.kind].questions);
    const [input, setInput] = useState('');
    const end = useRef<HTMLDivElement>(null);
    useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [session.messages.length, session.messages[session.messages.length - 1]?.content]);
    const send = (text?: string) => {
        const q = (text ?? input).trim();
        if (!q || session.thinking) return;
        if (text === undefined) setInput('');
        session.ask(q);
    };
    return (
        <div className="flex flex-col gap-2.5">
            {session.messages.map((m, i) => m.role === 'user' ? (
                <div key={i} className="ml-8 self-end rounded-2xl rounded-tr-md bg-ink px-3.5 py-2 text-bg"><p className="m-0 text-body whitespace-pre-wrap">{m.content}</p></div>
            ) : (
                <div key={i} className="mr-4 rounded-2xl rounded-tl-md border border-line bg-surface px-3.5 py-2.5" data-testid="answer">
                    {m.content ? <Answer message={m} onShow={onShow} /> : <Text size="small" tone="muted" className="flex items-center gap-2"><Spinner size={12} /> Reading the page…</Text>}
                </div>
            ))}
            {!session.thinking && (
                <div className="flex flex-wrap gap-1.5" data-testid="suggestions">
                    {session.suggestions.map(q => (
                        <ToggleChip key={q} selected={false} onClick={() => send(q)} className="h-auto py-1 text-left whitespace-normal">{q}</ToggleChip>
                    ))}
                </div>
            )}
            <div ref={end} />
            <div className="flex items-end gap-1 rounded-card border-[1.5px] border-line bg-surface p-1.5 focus-within:border-line-strong">
                <textarea rows={1} placeholder="Ask about this page…" value={input} onChange={e => setInput(e.target.value)} aria-label="Ask about this page"
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} disabled={session.thinking}
                    className="max-h-28 min-h-9 flex-1 resize-none border-0 bg-transparent px-2.5 py-2 text-body text-ink outline-none placeholder:text-ink-3 disabled:opacity-60" />
                <IconButton label="Ask" variant="secondary" onClick={() => send()} disabled={!input.trim() || session.thinking}
                    className={input.trim() && !session.thinking ? 'border-line-strong! bg-brand! text-on-brand!' : undefined}><Send /></IconButton>
            </div>
        </div>
    );
}

export function PageAssistant({ initialTabId, onSummary }: { initialTabId: number; onSummary: () => void }) {
    const a = usePageAssistant(initialTabId);
    const current = usePageTab();
    const elsewhere = a.phase === 'ready' && current.web && current.tab?.id !== undefined && current.tab.id !== a.tabId;

    if (a.phase === 'starting') {
        return <div className="flex flex-col items-center gap-3 p-12"><Spinner size={28} /><Text tone="muted">Checking the on-device model…</Text></div>;
    }
    if (a.phase === 'needs-model' || a.phase === 'downloading') {
        const percent = Math.round((a.downloadProgress ?? 0) * 100);
        return (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
                <span className="flex size-14 -rotate-6 items-center justify-center rounded-[18px] border-[1.5px] border-line-strong bg-brand text-on-brand shadow-press"><Download size={26} /></span>
                <Heading size="heading">{a.phase === 'downloading' ? 'Downloading the on-device model' : 'Get the on-device model'}</Heading>
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
                <Text size="caption" tone="muted" className="ml-auto flex items-center gap-1"><Lock size={11} /> On this device</Text>
            </div>

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
                    <BriefCard outcome={a.outcome} onShow={a.show} />
                    <AskPanel outcome={a.outcome} page={a.page} onShow={ref => a.show(ref)} />
                </>
            )}
        </div>
    );
}
