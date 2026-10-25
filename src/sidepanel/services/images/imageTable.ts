/**
 * The Image Downloader's images as a Data table, so they join the rest of the toolkit (filters,
 * CSV/JSON/Sheets export): one row per image with its URL, full-size URL, page, text and size.
 */
import type { Column, ExtractionResult } from '../../../shared/types/database';
import type { FoundImage } from '../../../shared/images/types';
import { imageType, savedSize } from '../../components/images/imageFilters';

const COLUMNS: [string, Column['type']][] = [
    ['image', 'image'], ['full_size', 'url'], ['alt', 'text'], ['caption', 'text'], ['section', 'text'],
    ['width', 'number'], ['height', 'number'], ['type', 'text'], ['found_in', 'text'], ['hidden', 'text'],
];

export function imageTable(images: FoundImage[], pageUrl: string): ExtractionResult {
    const items = images.map(img => {
        const size = savedSize(img);
        return {
            image: img.src.startsWith('data:') ? '' : img.src,
            full_size: img.full?.src ?? '',
            alt: img.alt ?? '',
            caption: img.caption ?? '',
            section: img.heading ?? '',
            width: size.width || null,
            height: size.height || null,
            type: imageType(img),
            found_in: img.origin,
            hidden: img.hidden ? 'yes' : 'no',
            source_url: img.pageUrl || pageUrl,
        };
    });
    return {
        columns: COLUMNS.map(([id, type], order) => ({ id, name: id, type, order })),
        items,
        source_url: pageUrl,
        type: 'images',
        count: items.length,
        timestamp: new Date().toISOString(),
    };
}
