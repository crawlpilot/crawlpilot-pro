import type { ElementSelected } from '../../../../shared/messages';
import { ISelectionStrategy, type Reading } from './ISelectionStrategy';
import { VisualElementPicker } from '../VisualElementPicker';
import { DataExtractor } from '../../../services/extraction/DataExtractor';
import { findListInside, ListMatch } from '../../../services/extraction/items';
import { elementChain } from '../../../services/selectors/element';
import { clickElementRobust } from '../../../utils/click';
import { hasRenderedBox } from '../../../utils/rendering';
import { bindToData } from '../../../services/page/dataBinding';

type ExtractionType = 'text' | 'link' | 'image' | 'list' | 'table' | 'image_array' | 'text_array' | 'link_array';

interface ClassificationResult {
    extractionType: ExtractionType;
    previewValue: string;
    finalValue: string;
    /** The element to find instead of the picked one (sibling cards → their parent). */
    selectors?: string[];
    count?: number;
    /** Items like this one: the siblings read with it. */
    siblings?: HTMLElement[];
}

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function valueLabel(c: ClassificationResult): string {
    if (c.extractionType === 'image') return 'Image';
    if (c.extractionType === 'link') return `Link · ${short(c.previewValue.replace(/^https?:\/\/(www\.)?/, ''), 28)}`;
    const text = c.previewValue.replace(/\s+/g, ' ').trim();
    return text ? `Text · “${short(text, 30)}”` : 'Text (empty)';
}

const ARRAY_NAMES = { image_array: 'Images', link_array: 'Links', text_array: 'Texts' } as const;

/**
 * A list of plain bullets: two or more items, each one piece of text (at most one part of it in an element of its
 * own). Rows split into parts (a name and a value: "Height | 45 cm") are not bullets: one of them is a row.
 */
function isBulletList(list: Element): boolean {
    const items = Array.from(list.children).filter(c => c.tagName === 'LI');
    return items.length >= 2 && items.every(li => Array.from(li.children).filter(c => (c.textContent || '').trim()).length <= 1);
}

export class DetailSelectionStrategy implements ISelectionStrategy {
    private extractor: DataExtractor;

    public preferredAction?: 'extract' | 'click' = 'extract';

    constructor() {
        this.extractor = new DataExtractor();
    }

    handleHover(element: HTMLElement, picker: VisualElementPicker, reading?: Reading): void {
        const shown = reading ?? this.readings(element)[0];
        picker.updateHighlightManual(shown.outline ?? element, shown.label, 'Click to select · ↑↓ wider / narrower', element, shown.outlines ?? []);
    }

    /**
     * The ways a click can read `element` (docs/plans/picker-level-control-plan.md §3.3), suggested
     * first in the order the detectors always ran: a list or table inside it, an array of like
     * children, its image or link, the items like it around it, its text. One item of a `ul` / `ol`
     * of texts (a product's bullets) is offered as its whole list first: pointing at a bullet usually
     * means the bullets, and the one item's text is still a reading away (V).
     */
    readings(element: HTMLElement): Reading[] {
        const out: Reading[] = [];
        const parent = element.parentElement;
        if (element.tagName === 'LI' && parent && (parent.tagName === 'UL' || parent.tagName === 'OL') && isBulletList(parent)) {
            const whole = this.detectHomogeneousArray(parent);
            // Bullets of text only: one link of a menu, or one thumbnail, is still picked as itself first.
            if (whole?.arrayType === 'text_array') out.push({ kind: 'array', label: `${ARRAY_NAMES[whole.arrayType]} · ${whole.count} (the whole list)`, outline: parent });
        }
        const inside = findListInside(element);
        if (inside.isContainer && inside.container) {
            const n = inside.childCount || inside.siblings.length;
            out.push({ kind: 'list', label: `${inside.containerType === 'table' ? 'Table' : 'List'} · ${n} items`, outlines: inside.siblings });
        } else {
            const array = this.detectHomogeneousArray(element);
            if (array) out.push({ kind: 'array', label: `${ARRAY_NAMES[array.arrayType]} · ${array.count}` });
        }
        const strong = this.classifyAsDirectTag(element) ?? this.classifyAsWrapperContent(element);
        const value: Reading = { kind: 'value', label: valueLabel(strong ?? this.classifyAsText(element)) };
        const like = this.classifyAsSiblingTable(element);
        const items: Reading | null = like ? { kind: 'items', label: `Items like this · ${like.count}`, outline: element.parentElement ?? undefined, outlines: like.siblings } : null;
        if (strong) out.push(value);
        if (items) out.push(items);
        if (!strong) out.push(value);
        return out;
    }

    handleClick(element: HTMLElement, picker: VisualElementPicker, report: (selected: ElementSelected) => void, reading?: Reading): void {
        const chosen = reading ?? this.readings(element)[0];
        const kind = chosen.kind;
        // A bullet read as its whole list: the list is what is saved, found by its own chain.
        const target = kind === 'array' && chosen.outline ? chosen.outline : element;
        const none = { isContainer: false, siblings: [], container: null, childCount: 0 };

        // What the user chose to save, read that way: the click never re-decides it.
        const containerInfo = kind === 'list' ? findListInside(target) : none;
        const isList = !!(containerInfo.isContainer && containerInfo.container);

        // The element is found on every page by its chain: a list's or table's container, else itself
        // (a control by its label too).
        const control = this.preferredAction === 'click';
        const data = this.extractor.extract(target, isList ? containerInfo : none);

        const classification = (kind === 'list' && this.classifyAsContainer(isList, containerInfo, data))
            || (kind === 'array' && this.classifyAsHomogeneousArray(target))
            || (kind === 'items' && this.classifyAsSiblingTable(element))
            || this.classifyAsDirectTag(element) || this.classifyAsWrapperContent(element) || this.classifyAsText(element);
        // A reading may retarget (the items like this one: their parent is the table).
        const selectors = classification.selectors
            ?? elementChain(isList ? containerInfo.container! : target, { control }).map(c => c.selector);

        // Where the value is in the page's own data: runs read it there first, with no click (P3).
        const bound = control ? null : bindToData((isList && !classification.selectors ? containerInfo.container! : target) as HTMLElement, classification.extractionType);

        report({
            success: true,
            id: `sel-${Date.now()}`,
            data,
            selectors,
            ...(bound ? { dataBinding: bound } : {}),
            value: classification.finalValue,
            previewValue: classification.previewValue,
            tagName: element.tagName.toLowerCase(),
            selectionMode: 'detail',
            action: this.preferredAction || 'extract',
            extractionType: classification.extractionType,
            waitTime: 0,
            patternFound: isList,
            count: classification.count ?? (isList ? (containerInfo.childCount || data?.items?.length || 1) : 1),
            viewportWidth: window.outerWidth,
            viewportHeight: window.outerHeight
        });

        picker.deactivate();

        if (this.preferredAction === 'click') {
            setTimeout(async () => { await clickElementRobust(element); }, 100);
        }
    }

    // =========================================================================
    // Detectors — each reading is read by one of these
    // =========================================================================

    /** Detected as a list / table container (`findListInside`) */
    private classifyAsContainer(isList: boolean, containerInfo: ListMatch, data: any): ClassificationResult | null {
        if (!isList) return null;
        const itemCount = containerInfo.childCount || data?.items?.length || 0;
        const extractionType: ExtractionType = containerInfo.containerType === 'table' ? 'table' : 'list';
        const typeStr = extractionType === 'table' ? 'Table' : 'List';
        return {
            extractionType,
            previewValue: `${typeStr} (${itemCount} items)`,
            finalValue: `${typeStr} (${itemCount} items)`,
            count: itemCount
        };
    }

    /** Homogeneous array of same-type children (images, links, icons, etc.) */
    private classifyAsHomogeneousArray(target: HTMLElement): ClassificationResult | null {
        const result = this.detectHomogeneousArray(target);
        if (!result) return null;
        return {
            extractionType: result.arrayType,
            previewValue: `Array (${result.count} items)`,
            finalValue: JSON.stringify(result.values),
            count: result.count
        };
    }

    /** Direct IMG or A tag clicked */
    private classifyAsDirectTag(element: HTMLElement): ClassificationResult | null {
        if (element.tagName === 'IMG') {
            const src = (element as HTMLImageElement).src;
            return { extractionType: 'image', previewValue: src, finalValue: src };
        }
        if (element.tagName === 'A') {
            const href = (element as HTMLAnchorElement).href;
            return { extractionType: 'link', previewValue: href, finalValue: href };
        }
        return null;
    }

    /** Wrapper containing a single dominant image, link, or background-image */
    private classifyAsWrapperContent(element: HTMLElement): ClassificationResult | null {
        const images = element.querySelectorAll('img');
        const textContent = (element.textContent || '').trim();

        // Single dominant image with minimal text
        if (images.length === 1 && textContent.length < 20) {
            const src = (images[0] as HTMLImageElement).src;
            return { extractionType: 'image', previewValue: src, finalValue: src };
        }

        // Single dominant link — must be the only real anchor in the entire subtree
        const anchors = element.querySelectorAll('a[href]:not([href^="javascript:"])');
        if (anchors.length === 1) {
            const anchor = anchors[0] as HTMLAnchorElement;
            if (anchor?.href) {
                return { extractionType: 'link', previewValue: anchor.href, finalValue: anchor.href };
            }
        }

        // Background image
        try {
            const bgImage = window.getComputedStyle(element).backgroundImage;
            if (bgImage && bgImage !== 'none' && bgImage.startsWith('url(')) {
                const url = bgImage.replace(/^url\(["']?/, '').replace(/["']?\)$/, '');
                return { extractionType: 'image', previewValue: url, finalValue: url };
            }
        } catch (_) { /* ignore */ }

        return null;
    }

    /** Element is part of a repeating sibling pattern → treat as table */
    private classifyAsSiblingTable(element: HTMLElement): ClassificationResult | null {
        const parent = element.parentElement;
        if (!parent || parent === document.body || parent === document.documentElement) return null;

        const siblingTag = element.tagName;
        const childCount = element.children.length;
        if (childCount < 2) return null;

        const siblings = Array.from(parent.children) as HTMLElement[];
        const matchingSiblings = siblings.filter(sib =>
            sib.tagName === siblingTag &&
            Math.abs(sib.children.length - childCount) <= 1 &&
            hasRenderedBox(sib) &&
            (sib.textContent || '').trim().length > 0
        );

        if (matchingSiblings.length < 3) return null;

        const selectors = elementChain(parent).map(c => c.selector);
        return {
            extractionType: 'table',
            previewValue: `Table (${matchingSiblings.length} items)`,
            finalValue: `Table (${matchingSiblings.length} items)`,
            selectors,
            count: matchingSiblings.length,
            siblings: matchingSiblings
        };
    }

    /** Default fallback: plain text extraction */
    private classifyAsText(element: HTMLElement): ClassificationResult {
        const textContent = (element.textContent || '').trim();
        return {
            extractionType: 'text',
            previewValue: textContent.substring(0, 50) || '',
            finalValue: textContent || ''
        };
    }

    // =========================================================================
    // Homogeneous Array Detection
    // =========================================================================

    private detectHomogeneousArray(element: HTMLElement): { arrayType: 'image_array' | 'text_array' | 'link_array'; values: string[]; count: number } | null {
        const skipTags = new Set(['BR', 'HR', 'SCRIPT', 'STYLE', 'LINK', 'META']);
        const children = Array.from(element.children).filter(child => {
            if (skipTags.has(child.tagName)) return false;
            if (child.nodeType === Node.TEXT_NODE && !(child.textContent || '').trim()) return false;
            return true;
        }) as HTMLElement[];

        if (children.length < 2) return null;

        // Count tag frequencies
        const tagCounts = new Map<string, number>();
        for (const child of children) {
            tagCounts.set(child.tagName, (tagCounts.get(child.tagName) || 0) + 1);
        }

        // Find dominant tag (>=70% of children)
        let dominantTag = '';
        let dominantCount = 0;
        for (const [tag, count] of tagCounts) {
            if (count > dominantCount) { dominantTag = tag; dominantCount = count; }
        }
        if (dominantCount / children.length < 0.7) return null;

        // Classify by dominant tag and extract values
        let arrayType: 'image_array' | 'text_array' | 'link_array';
        let values: string[] = [];

        switch (dominantTag) {
            case 'IMG':
                arrayType = 'image_array';
                values = children.filter(c => c.tagName === 'IMG')
                    .map(c => (c as HTMLImageElement).currentSrc || (c as HTMLImageElement).src)
                    .filter(Boolean);
                break;
            case 'A':
                arrayType = 'link_array';
                values = children.filter(c => c.tagName === 'A')
                    .map(c => (c as HTMLAnchorElement).href)
                    .filter(v => v && !v.startsWith('javascript:'));
                break;
            case 'VIDEO':
            case 'SOURCE':
                arrayType = 'link_array';
                values = children.filter(c => c.tagName === dominantTag)
                    .map(c => c.getAttribute('src') || '').filter(Boolean);
                break;
            case 'SVG':
            case 'I':
                arrayType = 'text_array';
                values = children.filter(c => c.tagName === dominantTag)
                    .map(c => c.getAttribute('class') || c.textContent?.trim() || '').filter(Boolean);
                break;
            default: {
                // Wrappers containing single images or links
                const dominantChildren = children.filter(c => c.tagName === dominantTag);
                const innerImgs = dominantChildren.filter(c => c.querySelector('img') && !c.querySelector('img ~ img'));
                if (innerImgs.length === dominantCount) {
                    arrayType = 'image_array';
                    values = innerImgs.map(c => {
                        const img = c.querySelector('img') as HTMLImageElement;
                        return img ? (img.currentSrc || img.src) : '';
                    }).filter(Boolean);
                } else {
                    const innerLinks = dominantChildren.filter(c => c.querySelector('a[href]') && !c.querySelector('a[href] ~ a[href]'));
                    if (innerLinks.length === dominantCount) {
                        arrayType = 'link_array';
                        values = innerLinks.map(c => (c.querySelector('a[href]') as HTMLAnchorElement)?.href || '')
                            .filter(v => v && !v.startsWith('javascript:'));
                    } else {
                        arrayType = 'text_array';
                        values = dominantChildren.map(c => (c.textContent || '').trim()).filter(Boolean);
                    }
                }
                break;
            }
        }

        if (values.length < 2) return null;
        return { arrayType, values, count: values.length };
    }
}
