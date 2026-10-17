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
    let shape: Shape;
    switch (detectType([value]).type) {
        case 'money': shape = 'price'; break;
        case 'rating': shape = 'rating'; break;
        case 'count': shape = 'count'; break;
        case 'integer': case 'number': case 'percent': shape = 'number'; break;
        case 'date': shape = 'date'; break;
        case 'url': shape = 'url'; break;
        default: shape = 'text';
    }
    if (SHAPE_CACHE.size > 5000) SHAPE_CACHE.clear();
    SHAPE_CACHE.set(value, shape);
    return shape;
}

