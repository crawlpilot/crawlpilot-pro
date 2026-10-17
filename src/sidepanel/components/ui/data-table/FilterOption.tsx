import { Tooltip } from '@mui/material';
import { Check } from 'lucide-react';

/** A filter toggle in the data table's filter panel. */
export function FilterOption({ label, active, onClick, icon, description }: { label: string; active: boolean; onClick: () => void; icon: string; description?: string }) {
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
        }
    };

    const button = (
        <button
            onClick={onClick}
            onKeyDown={handleKeyDown}
            role="switch"
            aria-checked={active}
            aria-label={`${label}: ${active ? 'enabled' : 'disabled'}${description ? `. ${description}` : ''}`}
            className={`
                flex items-center justify-between px-3 py-2 rounded-lg text-[11px] font-semibold transition-all duration-300 select-none group relative overflow-hidden
                focus-visible:ring-2 focus-visible:ring-accent-ai/50 focus-visible:outline-none
                ${active
                    ? 'bg-accent-ai/20 text-accent-ai border border-accent-ai/40 shadow-[0_0_15px_-3px_rgba(34,211,238,0.25)]'
                    : 'bg-white/5 text-text-muted hover:bg-white/[0.08] border border-white/5 hover:border-white/10'}
            `}
        >
            <div className="flex items-center gap-2.5 z-10">
                <span className={`text-[13px] transition-all duration-300 ${active ? 'scale-110 drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]' : 'grayscale opacity-60 group-hover:grayscale-0 group-hover:opacity-100'}`}>
                    {icon}
                </span>
                <span className={`truncate ${active ? 'text-white' : ''}`}>{label}</span>
            </div>

            <div className="flex-shrink-0 z-10">
                {active ? (
                    <div className="flex h-4 w-4 items-center justify-center rounded-full bg-accent-ai text-black shadow-[0_0_8px_rgba(34,211,238,0.5)] scale-100 animate-in zoom-in-50 duration-300">
                        <Check size={12} />
                    </div>
                ) : (
                    <div className="h-4 w-4 rounded-full border-2 border-white/10 group-hover:border-white/20 transition-all duration-300" />
                )}
            </div>

            {/* Animated hover background effect */}
            {!active && (
                <div className="absolute inset-0 bg-gradient-to-r from-accent-ai/0 via-accent-ai/5 to-accent-ai/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
            )}
        </button>
    );

    return description ? <Tooltip title={description} placement="top"><span>{button}</span></Tooltip> : button;
}
