/** Joins class names, skipping empty ones: cx('a', on && 'b', undefined) → 'a b'. */
export function cx(...parts: (string | false | null | undefined | 0)[]): string {
    return parts.filter(Boolean).join(' ');
}
