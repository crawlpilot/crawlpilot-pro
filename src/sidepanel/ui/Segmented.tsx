import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from './cx';

export interface SegmentOption<V extends string> {
    value: V;
    label: ReactNode;
    icon?: ReactNode;
    disabled?: boolean;
    /** Accessible name when the label is only an icon. */
    title?: string;
}

interface SegmentedProps<V extends string> {
    value: V;
    onChange: (value: V) => void;
    options: SegmentOption<V>[];
    size?: 'sm' | 'md';
    fullWidth?: boolean;
    /** Tabs switch what is shown below (role tablist); otherwise it is a choice (radiogroup). */
    tabs?: boolean;
    'aria-label'?: string;
    className?: string;
}

/** Pick one of a few, side by side: a choice ("Light · Dark · System") or tabs. Arrow keys move between them. */
export function Segmented<V extends string>({ value, onChange, options, size = 'md', fullWidth, tabs, className, ...aria }: SegmentedProps<V>) {
    const refs = useRef<(HTMLButtonElement | null)[]>([]);
    const enabled = options.filter(o => !o.disabled);

    const onKey = (e: KeyboardEvent) => {
        const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!step || !enabled.length) return;
        e.preventDefault();
        const i = enabled.findIndex(o => o.value === value);
        const next = enabled[(i + step + enabled.length) % enabled.length];
        onChange(next.value);
        refs.current[options.indexOf(next)]?.focus();
    };

    return (
        <div role={tabs ? 'tablist' : 'radiogroup'} aria-label={aria['aria-label']} onKeyDown={onKey}
            className={cx('inline-flex gap-0.5 rounded-control bg-ink/7 p-[3px]', fullWidth && 'flex w-full', className)}>
            {options.map((o, i) => {
                const on = o.value === value;
                return (
                    <button key={o.value} ref={el => { refs.current[i] = el; }} type="button" disabled={o.disabled} title={o.title}
                        role={tabs ? 'tab' : 'radio'} aria-selected={tabs ? on : undefined} aria-checked={tabs ? undefined : on} aria-label={o.title}
                        tabIndex={on ? 0 : -1} onClick={() => onChange(o.value)}
                        className={cx('inline-flex min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-control font-semibold whitespace-nowrap transition-[background-color,color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-40',
                            size === 'sm' ? 'h-7 px-2.5 text-caption [&_svg]:size-3.5' : 'h-8 px-3.5 text-small [&_svg]:size-4',
                            fullWidth && 'flex-1',
                            on ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(0_0_0/0.12),0_0_0_1.5px_var(--cp-line-strong)]' : 'text-ink-2 hover:text-ink')}>
                        {o.icon}{o.label}
                    </button>
                );
            })}
        </div>
    );
}
