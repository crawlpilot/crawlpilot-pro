import { Column, TableRow } from '../types/database';

export class TableUnifier {
    /**
     * Unifies columns that belong to structurally different but semantically identical fields.
     * E.g. A "Title" column from a normal product and a "Title" column from a Sponsored Product.
     * It merges them if there are no collisions across all rows.
     */
    static unifyTableData(columns: Column[], rows: TableRow[]): { columns: Column[], rows: TableRow[] } {
        if (!columns || columns.length === 0) return { columns, rows };

        const finalCols: Column[] = [];

        // Deep clone rows to avoid mutating the original DB results directly
        const unifiedRows = rows.map(r => ({
            ...r,
            data: { ...r.data }
        }));

        columns.forEach(col => {
            if (col.name === 'Text Content') {
                finalCols.push(col);
                return;
            }

            const match = finalCols.find(existing => {
                if (existing.name !== col.name || existing.type !== col.type) return false;

                // Collision check: Are there any rows where BOTH columns have distinct values?
                const hasCollision = unifiedRows.some(row => {
                    const val1 = row.data[existing.id];
                    const val2 = row.data[col.id];
                    return (val1 !== undefined && val1 !== null && val1 !== "" &&
                        val2 !== undefined && val2 !== null && val2 !== "" &&
                        val1 !== val2);
                });

                return !hasCollision;
            });

            if (match) {
                // Merge this column's data into the matched existing column
                unifiedRows.forEach(row => {
                    const sourceVal = row.data[col.id];
                    if (sourceVal !== undefined && sourceVal !== null && sourceVal !== "") {
                        const targetVal = row.data[match.id];
                        if (targetVal === undefined || targetVal === null || targetVal === "") {
                            row.data[match.id] = sourceVal;
                        }
                        // Remove the obsolete key to clean up the row
                        delete row.data[col.id];
                    }
                });
            } else {
                // Keep as a new separate column. If name conflicts but data collides, append a number
                let name = col.name;
                let count = 2;
                while (finalCols.some(c => c.name === name)) {
                    name = `${col.name} ${count}`;
                    count++;
                }
                finalCols.push({ ...col, name });
            }
        });

        // Ensure proper ordering
        finalCols.forEach((col, idx) => {
            col.order = idx;
        });

        return { columns: finalCols, rows: unifiedRows };
    }
}
