import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Copy, Crosshair, Download, ExternalLink } from 'lucide-react';
import { Button, Dialog, IconButton, Text, Tooltip } from '../../ui';
import type { FoundImage } from '../../../shared/images/types';
import { imageType, savedSize, savedSrc } from './imageFilters';

/**
 * One image large, with what is known about it, and actions: show it on the page, open the
 * original, copy its URL or the image itself, download it. Arrow keys step through the list.
 */
export function ImageLightbox({ images, index, onIndex, onClose, onShowOnPage, onDownload, onCopyImage }: {
    images: FoundImage[];
    index: number;
    onIndex: (i: number) => void;
    onClose: () => void;
    onShowOnPage: (img: FoundImage) => Promise<string | null>;
    onDownload: (img: FoundImage) => void;
    onCopyImage: (img: FoundImage) => Promise<string | null>;
}) {
    const { t } = useTranslation('imageDownloader');
    const img = images[index];
    const [note, setNote] = useState<string | null>(null);

    useEffect(() => { setNote(null); }, [index]);
    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
            if (e.key === 'ArrowRight' && index < images.length - 1) onIndex(index + 1);
        };
        window.addEventListener('keydown', key);
        return () => window.removeEventListener('keydown', key);
    }, [index, images.length, onIndex]);

    if (!img) return null;
    const size = savedSize(img);
    const src = savedSrc(img);
    const rows: [string, string | undefined][] = [
        [t('detailSize'), size.width ? `${size.width}×${size.height}${img.full && img.width ? ` (${t('shownAt', { size: `${img.width}×${img.height}` })})` : ''}` : undefined],
        [t('detailType'), imageType(img).toUpperCase() || undefined],
        [t('detailAlt'), img.alt],
        [t('detailCaption'), img.caption],
        [t('detailSection'), img.heading],
        [t('detailFound'), t(`origin.${img.origin}`)],
        [t('detailUrl'), src.startsWith('data:') ? t('inlineImage') : src],
    ];
    const run = async (action: () => Promise<string | null>, success: string) => setNote((await action()) ?? success);

    return (
        <Dialog open onClose={onClose} size="lg" flush title={t('previewOf', { n: index + 1, total: images.length })} closeLabel={t('close')}>
            <div className="relative flex min-h-[200px] items-center justify-center bg-surface-2">
                <img src={src} alt={img.alt || ''} className="block max-h-[55vh] max-w-full object-contain" />
                <IconButton variant="secondary" label={t('previous')} disabled={index === 0} onClick={() => onIndex(index - 1)} className="absolute left-2"><ChevronLeft /></IconButton>
                <IconButton variant="secondary" label={t('next')} disabled={index === images.length - 1} onClick={() => onIndex(index + 1)} className="absolute right-2"><ChevronRight /></IconButton>
            </div>
            <div className="p-4">
                <div className="mb-4 grid grid-cols-[90px_1fr] gap-x-2 gap-y-1">
                    {rows.filter(([, v]) => v).map(([k, v]) => [
                        <Text key={`${k}-k`} size="caption" weight="semibold" tone="muted">{k}</Text>,
                        <Text key={`${k}-v`} size="caption" className="break-all">{v}</Text>,
                    ])}
                </div>
                <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="primary" icon={<Download />} onClick={() => onDownload(img)}>{t('downloadOne')}</Button>
                    <Button size="sm" icon={<Crosshair />} onClick={() => run(() => onShowOnPage(img), t('shownOnPage'))}>{t('showOnPage')}</Button>
                    {!src.startsWith('data:') && <Button size="sm" icon={<ExternalLink />} onClick={() => chrome.tabs.create({ url: src })}>{t('openOriginal')}</Button>}
                    <Tooltip title={src.startsWith('data:') ? '' : src}>
                        <Button size="sm" variant="ghost" icon={<Copy />} onClick={() => run(async () => { await navigator.clipboard.writeText(src); return null; }, t('copiedUrl'))}>{t('copyUrl')}</Button>
                    </Tooltip>
                    <Button size="sm" variant="ghost" icon={<Copy />} onClick={() => run(() => onCopyImage(img), t('copiedImage'))}>{t('copyImage')}</Button>
                </div>
                {note && <Text size="caption" tone="muted" className="mt-2">{note}</Text>}
            </div>
        </Dialog>
    );
}
