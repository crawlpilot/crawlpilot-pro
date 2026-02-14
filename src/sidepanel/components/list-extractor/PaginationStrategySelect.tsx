import { ArrowDownCircle, ChevronRight, Zap, CheckCircle2 } from 'lucide-react';
import { PaginationMode } from '../../../shared/types/extraction';

interface PaginationStrategySelectProps {
    mode: PaginationMode;
    onChange: (mode: PaginationMode) => void;
}

export function PaginationStrategySelect({ mode, onChange }: PaginationStrategySelectProps) {
    return (
        <div className="space-y-2">
            <SelectionOption
                title="Auto-Scroll"
                description="Scroll down to load more"
                icon={<ArrowDownCircle size={18} />}
                selected={mode === 'auto'}
                onClick={() => onChange('auto')}
            />
            <SelectionOption
                title="Next Button"
                description="Click 'Next' or numbers"
                icon={<ChevronRight size={18} />}
                selected={mode === 'pagination'}
                onClick={() => onChange('pagination')}
            />
            <SelectionOption
                title="Load More"
                description="Click 'Load More' button"
                icon={<Zap size={18} />}
                selected={mode === 'loadMore'}
                onClick={() => onChange('loadMore')}
            />
        </div>
    );
}

const SelectionOption = ({ title, description, icon, selected, onClick }: any) => (
    <div
        onClick={onClick}
        className={`
            flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-all duration-200 relative
            ${selected
                ? 'bg-surface-dark border-primary/50 shadow-[0_0_0_1px_rgba(10,132,255,0.5)]'
                : 'bg-surface-dark border-transparent hover:bg-surface-lighter'}
        `}
    >
        <div className={`p-2.5 rounded-full transition-colors ${selected ? 'bg-primary text-white' : 'bg-surface text-gray-500'}`}>
            {icon}
        </div>
        <div className="flex-1 min-w-0">
            <h4 className={`text-[14px] font-medium mb-0.5 ${selected ? 'text-white' : 'text-gray-300'}`}>{title}</h4>
            <p className="text-[12px] text-gray-500 leading-tight">{description}</p>
        </div>
        {selected && (
            <CheckCircle2 size={18} className="text-primary" />
        )}
    </div>
);
