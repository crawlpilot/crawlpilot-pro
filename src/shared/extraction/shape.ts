/**
 * The kind of value a field holds: used to align repeated nodes, name and type fields, and split a
 * field that mixes kinds. Shared by the content script and the side panel.
 */
import { detectType } from '../transforms/detect';

export type Shape = 'text' | 'price' | 'rating' | 'count' | 'number' | 'phone' | 'date' | 'url' | 'image';

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
    const type = detectType([bare]).type;
    if (type !== 'date' && isPhone(value.trim())) shape = 'phone';
    else switch (type) {
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
 * A phone number, however it is written: "080 4370 1234", "098455 12345", "1800-258-5656",
 * "(555) 123-4567", "+44 20 7946 0958": 8 to 15 digits in 2 to 4 groups, or one group with a
 * country code or a trunk 0. Thousands written with spaces ("10 000 000") and plain IDs ("12574753") are
 * numbers.
 */
const PHONE = /^\+?\(?\d+\)?(?:[\s.-]\(?\d+\)?){0,3}$/;
function isPhone(value: string): boolean {
    if (!PHONE.test(value)) return false;
    const digits = value.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) return false;
    const groups = value.replace(/^\+/, '').split(/[\s.\-()]+/).filter(Boolean);
    // One run of digits: with a country code, or a trunk 0 and 10 digits ("09845512345"); a 12- or 13-digit barcode isn't one.
    if (groups.length === 1) return value.startsWith('+') || (digits.length === 11 && value.startsWith('0'));
    // Thousands: "10 000 000", "1.234.567".
    if (groups.slice(1).every(g => g.length === 3) && groups[0].length <= 3 && !/^[+0(]/.test(value)) return false;
    return true;
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
