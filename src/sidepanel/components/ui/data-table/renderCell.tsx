import { FileText } from 'lucide-react';
import type { Column } from '@/shared/types/database';

const isImageUrl = (v: string) => /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp|ico|tiff?)(\?[^"]*)?$/i.test(v) || /^data:image\//i.test(v);

/** A cell by its column type: images, image lists, markdown (opens a preview), links, or text. */
export function renderCell(value: unknown, col: Column, showImages: boolean, onMarkdown: (content: string) => void) {
    if (value === null || value === undefined || value === '') return <span className="text-ink-3">-</span>;
    if (typeof value === 'boolean') return <span>{value ? 'Yes' : 'No'}</span>;

    const strValue = String(value);

    const looksLikeImage = col.type === 'image' || (strValue.length < 500 && isImageUrl(strValue));

    if (col.type === 'image_array') {
        let urls: string[] = [];
        if (Array.isArray(value)) {
            urls = value as string[];
        } else {
            try { urls = JSON.parse(strValue); } catch { urls = [strValue]; }
        }
        if (!showImages) return <span className="text-xs text-ink-3 truncate block w-full" title={urls.join(', ')}>{urls.length} images</span>;
        return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%', height: '100%', overflow: 'hidden' }}>
                {urls.slice(0, 5).map((url, i) => (
                    <img
                        key={i}
                        src={url}
                        alt={`img-${i}`}
                        style={{ height: '24px', width: 'auto', maxWidth: '40px', objectFit: 'contain', borderRadius: '4px' }}
                        loading="lazy"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                ))}
                {urls.length > 5 && <span className="text-xs text-ink-3">+{urls.length - 5}</span>}
            </div>
        );
    }

    if (looksLikeImage) {
        if (!showImages) return <span className="text-xs text-ink-3 truncate block w-full" title={strValue}>{strValue}</span>;
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', overflow: 'hidden' }}>
                <img
                    src={strValue}
                    alt="cell"
                    style={{ height: '24px', width: 'auto', maxWidth: '100%', objectFit: 'contain', borderRadius: '4px' }}
                    loading="lazy"
                    onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                        (e.target as HTMLImageElement).insertAdjacentHTML('afterend',
                            `<span style="font-size:11px;color:var(--cp-text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${strValue}</span>`
                        );
                    }}
                />
            </div>
        );
    }

    if (col.type === 'markdown') {
        const preview = strValue.replace(/[#*`>\-_~\[\]]/g, '').slice(0, 60).trim();
        return (
            <div className="flex items-center gap-1.5 w-full overflow-hidden">
                <button
                    onClick={(e) => { e.stopPropagation(); onMarkdown(strValue); }}
                    className="shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-brand/30 text-ink text-[10px] font-semibold hover:bg-brand/60 transition-colors"
                >
                    <FileText size={9} />
                    MD
                </button>
                <span className="text-xs text-ink-3 truncate flex-1">{preview || '…'}</span>
            </div>
        );
    }

    if (col.type === 'url') {
        return (
            <a
                href={strValue}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline decoration-brand decoration-2 underline-offset-2 hover:bg-brand/30 block w-full truncate text-xs"
                title={strValue}
            >
                {strValue}
            </a>
        );
    }

    return (
        <div className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={String(value || '')}>
            <span className="text-sm text-ink font-medium">
                {String(value ?? '')}
            </span>
        </div>
    );
}
