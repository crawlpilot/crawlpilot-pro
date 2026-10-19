/**
 * The one header every tool uses: back, the tool's name, one line saying what it does, optional
 * actions on the right, and the steps of a guided flow with their names ("1 Pick · 2 Pages · 3 Get data").
 * Kept compact so the panel's height goes to the content (docs/plans/ux-simplification-plan.md §4.1).
 */
import { ReactNode } from 'react';
import { Check, ChevronLeft } from 'lucide-react';
import { IconButton, cx } from '../../ui';

interface ToolHeaderProps {
    title: string;
    subtitle?: string;
    icon?: ReactNode;
    onBack?: () => void;
    /** Buttons on the right of the title row. */
    actions?: ReactNode;
    /** Names of the steps of a guided flow, and the current one (1-based). Hidden for a single step. */
    steps?: { labels: string[]; current: number };
    /** A thin moving bar along the top while something loads. */
    loading?: boolean;
    /** Anything under the title (tabs, a search row, the page strip). */
    children?: ReactNode;
}

function Steps({ labels, current }: { labels: string[]; current: number }) {
    return (
        <ol aria-label="Steps" className="m-0 mt-3 flex list-none items-center gap-1 p-0">
            {labels.map((label, i) => {
                const n = i + 1;
                const done = n < current;
                const active = n === current;
                return (
                    <li key={label} aria-current={active ? 'step' : undefined} className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className={cx('flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                            active ? 'border-[1.5px] border-line-strong bg-brand text-on-brand' : done ? 'bg-ink text-bg' : 'bg-ink/7 text-ink-3')}>
                            {done ? <Check size={11} strokeWidth={3.5} /> : n}
                        </span>
                        <span className={cx('truncate text-caption', active ? 'font-bold text-ink' : done ? 'font-medium text-ink-2' : 'font-medium text-ink-3')}>{label}</span>
                        {n < labels.length && <span className={cx('h-[1.5px] min-w-2 flex-1 rounded-full', done ? 'bg-ink' : 'bg-line')} />}
                    </li>
                );
            })}
        </ol>
    );
}

export default function ToolHeader({ title, subtitle, icon, onBack, actions, steps, loading, children }: ToolHeaderProps) {
    return (
        <header className="relative z-10 shrink-0 border-b border-line bg-bg px-4 py-3">
            {loading && (
                <div className="absolute inset-x-0 top-0 h-[3px] overflow-hidden" aria-hidden>
                    <div className="absolute inset-y-0 w-2/5 rounded-full bg-brand animate-[cp-indeterminate_1.2s_ease-in-out_infinite]" />
                </div>
            )}
            <div className="flex items-center gap-2">
                {onBack && <IconButton label="Back" onClick={onBack} className="-ml-2"><ChevronLeft className="size-5!" /></IconButton>}
                {icon && <span className="flex text-ink-2">{icon}</span>}
                <div className="min-w-0 flex-1">
                    <h1 className="m-0 truncate font-display text-heading font-bold tracking-[-0.02em] text-ink">{title}</h1>
                    {subtitle && <p className="m-0 truncate text-caption text-ink-2" title={subtitle}>{subtitle}</p>}
                </div>
                {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
            </div>
            {steps && steps.labels.length > 1 && <Steps labels={steps.labels} current={steps.current} />}
            {children}
        </header>
    );
}
