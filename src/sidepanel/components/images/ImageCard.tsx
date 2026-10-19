import { useTranslation } from 'react-i18next';
import { Check, Download, Maximize2 } from 'lucide-react';
import type { FoundImage } from '../../../shared/images/types';
import { Tooltip, cx } from '../../ui';
import { imageType, savedSize } from './imageFilters';

const TAG = 'rounded-[3px] bg-black/40 px-1 text-[8px] font-extrabold text-white';

/** One image in the grid: click selects (shift-click selects a range), the corner buttons preview and download. */
export function ImageCard({ img, selected, onSelect, onPreview, onDownload }: {
    img: FoundImage;
    selected: boolean;
    onSelect: (e: React.MouseEvent) => void;
    onPreview: () => void;
    onDownload: () => void;
}) {
    const { t } = useTranslation('imageDownloader');
    const size = savedSize(img);
    const type = imageType(img);
    const corner = 'flex size-6 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface text-ink shadow-sm hover:bg-surface-2';
    return (
        <div role="checkbox" aria-checked={selected} tabIndex={0} aria-label={img.alt || type || 'image'}
            onClick={onSelect}
            onDoubleClick={onPreview}
            onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); onSelect(e as unknown as React.MouseEvent); } if (e.key === 'Enter') onPreview(); }}
            className={cx('group relative aspect-square cursor-pointer overflow-hidden rounded-xl border-2 bg-surface-2 transition-[border-color,transform] duration-150 [content-visibility:auto] [contain-intrinsic-size:120px]',
                'bg-[length:12px_12px] bg-[linear-gradient(45deg,rgb(var(--cp-ink-rgb)/0.06)_25%,transparent_25%,transparent_75%,rgb(var(--cp-ink-rgb)/0.06)_75%)]',
                selected ? 'border-line-strong' : 'border-transparent hover:border-ink/25')}>
            <img src={img.src} alt={img.alt || ''} className="block size-full object-contain" loading="lazy" decoding="async" />
            {selected && <div className="pointer-events-none absolute inset-0 bg-brand/20" />}
            <div className={cx('absolute top-1 right-1 flex size-[18px] items-center justify-center rounded-[5px] border-[1.5px]',
                selected ? 'border-line-strong bg-brand text-on-brand' : 'border-white/80 bg-black/25')}>
                {selected && <Check size={12} strokeWidth={3.5} />}
            </div>
            <div className="absolute top-1 left-1 flex gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                <Tooltip title={t('preview')}>
                    <button type="button" aria-label={t('preview')} className={corner} onClick={e => { e.stopPropagation(); onPreview(); }}><Maximize2 size={12} /></button>
                </Tooltip>
                <Tooltip title={t('downloadOne')}>
                    <button type="button" aria-label={t('downloadOne')} className={corner} onClick={e => { e.stopPropagation(); onDownload(); }}><Download size={12} /></button>
                </Tooltip>
            </div>
            {/* Size and type over the image: dark whatever the theme, so it reads on any picture. */}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-b from-transparent to-black/75 px-1 py-0.5">
                <Tooltip title={img.full ? t('fullSizeTip', { full: `${img.full.width}×${img.full.height}`, shown: img.width ? `${img.width}×${img.height}` : '?' }) : ''}>
                    <span className="text-[8px] font-bold whitespace-nowrap text-white">
                        {img.full && <span className="mr-1 rounded-[3px] bg-brand px-1 text-[7px] font-black text-on-brand">HD</span>}
                        {size.width && size.height ? `${size.width}×${size.height}` : '?'}
                    </span>
                </Tooltip>
                <div className="flex gap-1">
                    {!!img.duplicates?.length && (
                        <Tooltip title={t('duplicatesTip', { count: img.duplicates.length })}><span className={TAG}>+{img.duplicates.length}</span></Tooltip>
                    )}
                    {img.hidden && <span className={TAG}>{t('hiddenBadge')}</span>}
                    <span className={cx(TAG, 'uppercase')}>{type || '?'}</span>
                </div>
            </div>
        </div>
    );
}
