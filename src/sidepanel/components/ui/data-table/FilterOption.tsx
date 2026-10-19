import { Check } from 'lucide-react';
import { Tooltip, cx } from '../../../ui';

/** A filter toggle in the data table's filter panel. */
export function FilterOption({ label, active, onClick, icon, description }: { label: string; active: boolean; onClick: () => void; icon: string; description?: string }) {
    const button = (
        <button type="button" onClick={onClick} role="switch" aria-checked={active}
            aria-label={`${label}: ${active ? 'enabled' : 'disabled'}${description ? `. ${description}` : ''}`}
            className={cx('flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border-[1.5px] px-3 py-2 text-left text-caption font-semibold transition-colors duration-150 select-none',
                active ? 'border-line-strong bg-brand text-on-brand' : 'border-transparent bg-ink/5 text-ink-2 hover:bg-ink/8 hover:text-ink')}>
            <span className="flex min-w-0 items-center gap-2">
                <span className={cx('text-[13px]', !active && 'opacity-60 grayscale')}>{icon}</span>
                <span className="truncate">{label}</span>
            </span>
            <span className={cx('flex size-4 shrink-0 items-center justify-center rounded-full', active ? 'bg-on-brand text-brand' : 'border-[1.5px] border-ink/20')}>
                {active && <Check size={11} strokeWidth={3.5} />}
            </span>
        </button>
    );
    return description ? <Tooltip title={description}>{button}</Tooltip> : button;
}
