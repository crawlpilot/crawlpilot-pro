/** A lowercase identifier from a name: "Was Price" → "was_price" (or "was-price" with sep "-"). */
export function slug(name: string, sep = '_', fallback = 'field'): string {
    const s = name.toLowerCase().replace(/[^a-z0-9]+/g, sep);
    return s.split(sep).filter(Boolean).join(sep) || fallback;
}
