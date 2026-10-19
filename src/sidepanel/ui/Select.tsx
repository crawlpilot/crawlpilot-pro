import { useId, type ReactNode, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from './cx';
import { FIELD_BOX, FieldFrame } from './Field';

export interface SelectOption<V extends string | number = string> {
    value: V;
    label: string;
    disabled?: boolean;
}

interface SelectProps<V extends string | number> extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'size'> {
    value: V;
    onChange: (value: V) => void;
    options: SelectOption<V>[];
    label?: ReactNode;
    hint?: ReactNode;
    size?: 'sm' | 'md';
    /** No box: the value in bold with a caret, to sit inside a sentence ("next 5 pages"). */
    inline?: boolean;
    className?: string;
}

/** Pick one from a list: the browser's own menu, styled like the other fields. */
export function Select<V extends string | number>({ value, onChange, options, label, hint, size = 'md', inline, className, id, ...rest }: SelectProps<V>) {
    const auto = useId();
    const fid = id ?? auto;
    const numeric = typeof value === 'number';
    const pick = (raw: string) => onChange((numeric ? Number(raw) : raw) as V);

    if (inline) {
        return (
            <span className={cx('relative inline-flex items-center', className)}>
                <select id={fid} value={String(value)} onChange={e => pick(e.target.value)}
                    className="cursor-pointer appearance-none rounded-md border-0 bg-transparent py-0 pr-4 pl-1 font-bold text-ink underline decoration-brand decoration-[3px] underline-offset-2 outline-none hover:bg-ink/6" {...rest}>
                    {options.map(o => <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>{o.label}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-0 size-3 text-ink-2" />
            </span>
        );
    }

    return (
        <FieldFrame id={fid} label={label} hint={hint} className={className}>
            <div className={cx(FIELD_BOX, 'relative p-0', size === 'sm' ? 'min-h-8 text-small' : 'min-h-10 text-body')}>
                <select id={fid} value={String(value)} onChange={e => pick(e.target.value)}
                    className={cx('w-full min-w-0 cursor-pointer appearance-none self-stretch truncate rounded-field border-0 bg-transparent text-inherit outline-none', size === 'sm' ? 'pr-7 pl-2.5' : 'pr-8 pl-3')} {...rest}>
                    {options.map(o => <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>{o.label}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 size-4 text-ink-3" />
            </div>
        </FieldFrame>
    );
}
