import { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, Download, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button, Heading, IconButton, Notice, Progress, Spinner, Text, ToggleChip, cx } from '../../../ui';
import type { ExtractedContent } from '@/shared/types/summarizer';
import { useSummaryEngine } from '../../../hooks/useSummaryEngine';
import { useChatSession, type ChatMessage } from '../../../hooks/useChatSession';
import { SummaryControls } from '../SummaryControls';

interface Step2SummaryChatProps {
    doc: ExtractedContent | null;
    onBack: () => void;
}

export function Step2SummaryChat({ doc, onBack }: Step2SummaryChatProps) {
    const engine = useSummaryEngine(doc);
    const chat = useChatSession(doc, engine.chunkDigest);
    const [input, setInput] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const summaryStarted = engine.phase === 'streaming' || engine.phase === 'ready' || engine.phase === 'mapping';
    const messages: ChatMessage[] = [
        ...(engine.summary || engine.phase === 'streaming' ? [{ role: 'model' as const, content: engine.summary }] : []),
        ...chat.messages
    ];
    const isBusy = chat.isThinking || engine.phase === 'streaming' || engine.phase === 'mapping';
    const inputDisabled = !doc || !chat.chatAvailable || isBusy || engine.phase === 'downloading';

    // Auto-scroll to bottom of chat
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length, engine.summary, chat.isThinking]);

    const handleSend = (customMessage?: string) => {
        const text = typeof customMessage === 'string' ? customMessage : input.trim();
        if (!text || inputDisabled) return;
        if (typeof customMessage !== 'string') setInput('');
        chat.sendMessage(text);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    if (engine.phase === 'checking' || engine.phase === 'idle') {
        return (
            <div className="flex flex-col items-center justify-center gap-3 p-12 text-ink-2">
                <Spinner size={32} />
                <Text tone="muted">Checking AI model availability…</Text>
            </div>
        );
    }

    if (engine.phase === 'downloading') {
        const percent = engine.downloadProgress !== null ? Math.round(engine.downloadProgress * 100) : 0;
        return (
            <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
                <span className="flex size-14 -rotate-6 items-center justify-center rounded-[18px] border-[1.5px] border-line-strong bg-brand text-on-brand shadow-press"><Download size={26} /></span>
                <Heading size="heading">Downloading the language model</Heading>
                <Text size="small" tone="muted" className="max-w-[300px]">Chrome is downloading the AI model for your device. This only happens once.</Text>
                <div className="mt-2 w-full max-w-sm">
                    <div className="mb-1.5 flex justify-between">
                        <Text size="caption" tone="muted">Progress</Text>
                        <Text size="caption" weight="bold">{percent}%</Text>
                    </div>
                    <Progress value={percent} label="Download" />
                </div>
            </div>
        );
    }

    if (engine.phase === 'needs-activation') {
        return (
            <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
                <span className="flex size-14 -rotate-6 items-center justify-center rounded-[18px] border-[1.5px] border-line-strong bg-brand text-on-brand shadow-press"><Download size={26} /></span>
                <Heading size="heading">AI model download required</Heading>
                <Text size="small" tone="muted" className="max-w-[320px]">Chrome needs your permission to download the on-device AI model. This only happens once.</Text>
                <Button variant="primary" className="mt-2" onClick={engine.retryDownload}>Download AI model</Button>
                <Button variant="ghost" onClick={onBack}>Go back</Button>
            </div>
        );
    }

    if (engine.phase === 'unavailable' || engine.phase === 'error') {
        return (
            <div className="flex flex-col items-center gap-4 p-6">
                <Notice tone="danger">{engine.error}</Notice>
                <Button onClick={onBack}>Go back</Button>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col gap-3">
            {summaryStarted && <SummaryControls type={engine.type} length={engine.length} disabled={false} onChange={engine.setOptions} />}

            <div className="flex flex-1 flex-col gap-3 overflow-y-auto rounded-card border border-line bg-surface p-3">
                <div className="flex items-center gap-2.5 rounded-2xl bg-tile-lilac px-3 py-2.5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface/80 text-ink"><Sparkles size={16} /></span>
                    <div>
                        <Text size="small" weight="semibold">Powered by Gemini Nano</Text>
                        <Text size="caption" tone="muted">Runs on your device: private and fast.</Text>
                    </div>
                </div>

                {engine.phase === 'mapping' && engine.chunkProgress && (
                    <div className="rounded-2xl border-[1.5px] border-dashed border-line p-3">
                        <Text size="small" tone="muted" className="mb-2">
                            Long page detected — summarizing part {engine.chunkProgress.current} of {engine.chunkProgress.total}…
                        </Text>
                        <Progress size="sm" value={((engine.chunkProgress.current - 1) / engine.chunkProgress.total) * 100} label="Summarizing" />
                    </div>
                )}

                {messages.length === 0 && engine.phase === 'streaming' && (
                    <div className="flex items-center gap-2.5 p-3 text-ink-2">
                        <Spinner size={16} />
                        <Text size="small" tone="muted">Writing the summary…</Text>
                    </div>
                )}

                {messages.map((msg, index) => {
                    const user = msg.role === 'user';
                    return (
                        <div key={index} className={cx('flex items-start gap-2.5', user && 'flex-row-reverse')}>
                            <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-full', user ? 'bg-ink text-bg' : 'border-[1.5px] border-line-strong bg-brand text-on-brand')}>
                                {user ? <User size={16} /> : <Bot size={16} />}
                            </span>
                            <div className={cx('max-w-[85%] rounded-2xl px-4 py-3',
                                user ? 'rounded-tr-md bg-ink text-bg' : 'rounded-tl-md border border-line bg-surface-2/60 text-ink')}>
                                {msg.role === 'model' ? (
                                    <div className="cp-prose overflow-x-auto break-words">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content || ' '}</ReactMarkdown>
                                    </div>
                                ) : (
                                    <p className="m-0 text-body whitespace-pre-wrap">{msg.content}</p>
                                )}
                            </div>
                        </div>
                    );
                })}

                {chat.isThinking && messages[messages.length - 1]?.content === '' && (
                    <div className="flex items-center gap-2.5">
                        <span className="flex size-8 items-center justify-center rounded-full border-[1.5px] border-line-strong bg-brand text-on-brand"><Bot size={16} /></span>
                        <Text size="small" tone="muted" className="flex items-center gap-2"><Spinner size={12} /> Thinking…</Text>
                    </div>
                )}

                {chat.chatAvailable && messages.length > 0 && !isBusy && messages[messages.length - 1].role === 'model' && (
                    <div className="mt-1 flex flex-wrap gap-1.5 border-t border-dashed border-line pt-3">
                        <Text size="caption" tone="muted" className="mb-0.5 w-full">Ask next:</Text>
                        {chat.dynamicReplies.map(reply => (
                            <ToggleChip key={reply} selected={false} onClick={() => handleSend(reply)} className="h-auto py-1 text-left whitespace-normal">{reply}</ToggleChip>
                        ))}
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            <div className="flex flex-col gap-0.5 rounded-card border-[1.5px] border-line bg-surface p-1.5 focus-within:border-line-strong">
                <div className="flex items-end gap-1">
                    <textarea rows={1} placeholder="Ask a follow-up question…" value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown}
                        disabled={inputDisabled} aria-label="Ask a follow-up question"
                        className="max-h-28 min-h-9 flex-1 resize-none border-0 bg-transparent px-2.5 py-2 text-body text-ink outline-none placeholder:text-ink-3 focus-visible:outline-none disabled:opacity-60" />
                    <IconButton label="Send" variant="secondary" onClick={() => handleSend()} disabled={!input.trim() || inputDisabled}
                        className={input.trim() && !inputDisabled ? 'border-line-strong! bg-brand! text-on-brand!' : undefined}><Send /></IconButton>
                </div>
                {!chat.chatAvailable && <Text size="caption" tone="muted" className="px-2.5 pb-1">Follow-up chat requires Chrome's Prompt API.</Text>}
            </div>
        </div>
    );
}
