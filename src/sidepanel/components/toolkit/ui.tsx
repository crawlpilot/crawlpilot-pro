/** Building blocks shared by the toolkit's tools, so the three read as one product. */
import { ReactNode, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText } from '../../services/clipboard';
import { Disclosure, IconButton, Text, cx, type ChipTone } from '../../ui';

/** Good / watch out / bad, as text and box classes. */
export const TONE = {
    good: { text: 'text-success', box: 'bg-success-soft', chip: 'success' },
    warn: { text: 'text-warning', box: 'bg-warning-soft', chip: 'warning' },
    bad: { text: 'text-danger', box: 'bg-danger-soft', chip: 'danger' },
    info: { text: 'text-info', box: 'bg-info-soft', chip: 'info' },
    neutral: { text: 'text-ink-2', box: 'bg-ink/6', chip: 'neutral' },
} as const satisfies Record<string, { text: string; box: string; chip: ChipTone }>;
export type Tone = keyof typeof TONE;

export function CopyButton({ text, label }: { text: string; label?: string; size?: number }) {
    const [done, setDone] = useState(false);
    const copy = async (e: React.MouseEvent) => {
        e.stopPropagation();
        await copyText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
    };
    return (
        <IconButton size="sm" label={done ? 'Copied' : label ?? 'Copy'} onClick={copy} className={done ? 'text-success' : undefined}>
            {done ? <Check /> : <Copy />}
        </IconButton>
    );
}

/** Monospace text with a copy button in its corner. */
export function CodeBlock({ code, maxHeight = 240 }: { code: string; maxHeight?: number }) {
    return (
        <div className="relative">
            <pre className="m-0 overflow-auto rounded-field bg-surface-2 p-3 pr-10 font-mono text-[11px] leading-normal break-all whitespace-pre-wrap text-ink" style={{ maxHeight }}>{code}</pre>
            <div className="absolute top-1 right-1"><CopyButton text={code} /></div>
        </div>
    );
}

/** A tool's first screen: what it is for, what you get, and the one thing to press. */
export function ToolIntro({ icon, title, text, points, children }: {
    icon: ReactNode; title: string; text: string; points?: string[]; children?: ReactNode;
}) {
    return (
        <div className="rounded-card border-[1.5px] border-line-strong bg-surface p-4 shadow-press">
            <div className="mb-2 flex items-center gap-2.5">
                <span className="flex size-9 shrink-0 -rotate-6 items-center justify-center rounded-xl border-[1.5px] border-line-strong bg-brand text-on-brand [&_svg]:size-[18px]">{icon}</span>
                <h3 className="m-0 font-display text-lead font-bold tracking-[-0.02em] text-ink">{title}</h3>
            </div>
            <Text size="small" tone="muted" className={points ? 'mb-2.5' : 'mb-3.5'}>{text}</Text>
            {points && (
                <ul className="m-0 mb-4 flex list-none flex-col gap-1.5 p-0">
                    {points.map(p => (
                        <li key={p} className="flex items-start gap-2">
                            <Check size={14} strokeWidth={3} className="mt-0.5 shrink-0 text-accent" />
                            <Text size="caption" tone="muted">{p}</Text>
                        </li>
                    ))}
                </ul>
            )}
            {children}
        </div>
    );
}

/** A numbered step heading: "1  Record the page's calls". */
export function Step({ n, title, hint, done, children }: { n: number; title: string; hint?: string; done?: boolean; children: ReactNode }) {
    return (
        <div>
            <div className="mb-1.5 flex items-center gap-2">
                <span className={cx('flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                    done ? 'bg-ink text-bg' : 'border-[1.5px] border-line-strong bg-brand text-on-brand')}>
                    {done ? <Check size={12} strokeWidth={3} /> : n}
                </span>
                <Text weight="semibold" className="flex-1">{title}</Text>
            </div>
            {hint && <Text size="caption" tone="muted" className="-mt-1 mb-1.5 ml-7">{hint}</Text>}
            <div className="ml-7">{children}</div>
        </div>
    );
}

/** A collapsible group of details, its gist shown on the closed header. */
export function DetailSection({ icon, title, summary, defaultOpen = false, children }: {
    icon: ReactNode; title: string; summary?: ReactNode; defaultOpen?: boolean; children: ReactNode;
}) {
    return (
        <Disclosure icon={icon} summary={title} defaultOpen={defaultOpen}
            meta={summary && <span className="block max-w-[180px] truncate">{summary}</span>}>
            {children}
        </Disclosure>
    );
}

/** A label/value line inside a section. */
export function InfoRow({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
    return (
        <div className="flex justify-between gap-4 border-b border-dashed border-line py-1.5 last-of-type:border-b-0">
            <Text size="caption" tone="muted" className="shrink-0">{label}</Text>
            <Text size="caption" mono={mono} className="text-right break-all">{value}</Text>
        </div>
    );
}

/** One fact at a glance: a label, a short value and a colour for good / watch out / bad. */
export function FactTile({ icon, label, value, tone }: { icon: ReactNode; label: string; value: string; tone: Tone }) {
    const t = TONE[tone];
    return (
        <div className={cx('min-w-0 rounded-2xl px-3 py-2.5', t.box)}>
            <div className={cx('mb-0.5 flex items-center gap-1.5 [&_svg]:size-3.5', t.text)}>
                {icon}
                <span className="text-[11px] font-bold">{label}</span>
            </div>
            <div className="truncate text-small font-semibold text-ink" title={value}>{value}</div>
        </div>
    );
}

/** A small heading over a group. */
export function GroupLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
    return (
        <div className="mb-1.5 flex items-center">
            <span className="flex-1 text-small font-semibold text-ink-2">{children}</span>
            {action}
        </div>
    );
}
