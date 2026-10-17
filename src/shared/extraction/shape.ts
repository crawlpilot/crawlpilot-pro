/**
 * The kind of value a field holds: used to align repeated nodes, name and type fields, and split a
 * field that mixes kinds. Shared by the content script and the side panel.
 */
import { detectType } from '../transforms/detect';

export type Shape = 'text' | 'price' | 'rating' | 'count' | 'number' | 'date' | 'url' | 'image';

/** Where a value was read from: images and links have their shape by attribute. */
type ShapeAttr = string;

const SHAPE_CACHE = new Map<string, Shape>();

/** The kind of value an atom holds, used to align repeated nodes and to name and type fields. */
export function shapeOf(value: string, attr: ShapeAttr = 'text'): Shape {
    if (attr === 'src') return 'image';
    if (attr === 'href') return 'url';
    if (attr === 'datetime') return 'date';
    if (value.length > 80) return 'text';
    const cached = SHAPE_CACHE.get(value);
    if (cached) return cached;
    // "(1.3K)", "(39)": a count in brackets, as shown next to stars.
    const bare = value.trim().replace(/^\((.*)\)$/, '$1');
    let shape: Shape;
    switch (detectType([bare]).type) {
        case 'money': shape = mostlyAmount(bare) ? 'price' : 'text'; break;
        case 'rating': shape = 'rating'; break;
        case 'count': shape = 'count'; break;
        case 'integer': case 'number': case 'percent': shape = bare === value.trim() ? 'number' : 'count'; break;
        case 'date': shape = 'date'; break;
        case 'url': shape = 'url'; break;
        default: shape = 'text';
    }
    if (SHAPE_CACHE.size > 5000) SHAPE_CACHE.clear();
    SHAPE_CACHE.set(value, shape);
    return shape;
}


/**
 * A price is a value that is mostly its amount: "$24.99", "List: $325.99", "From £20". Text that
 * merely contains an amount ("$20.96 delivery Mon, Nov 2", "Save $5 with coupon") is text.
 */
function mostlyAmount(value: string): boolean {
    const rest = value.replace(/[\p{Sc}]|\b[A-Z]{3}\b/gu, ' ').replace(/\d[\d.,\s]*/g, ' ');
    const words = rest.split(/[^\p{L}]+/u).filter(w => w.length > 1);
    return words.length <= 2;
}
