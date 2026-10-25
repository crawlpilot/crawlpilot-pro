/** A table as CSV text: a header of column names, one line per row, values quoted when they need it. */
export function csvText(columns: { id: string; name: string }[], rows: Record<string, unknown>[]): string {
    const cell = (raw: unknown) => {
        if (raw === undefined || raw === null) return '';
        // Lists (image or link arrays) as JSON: raw they'd join with commas and shift every column after them.
        const value = typeof raw === 'string' ? raw : JSON.stringify(raw);
        return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    };
    return [columns.map(c => cell(c.name)).join(','), ...rows.map(r => columns.map(c => cell(r[c.id])).join(','))].join('\n');
}
