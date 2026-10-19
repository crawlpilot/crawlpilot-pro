import { it } from 'vitest';
import { loadPage } from '../test/corpus/measure';
import { collectAtoms, withAtomCache } from '../content/services/extraction/atoms';
import { inferFields } from '../content/services/extraction/fields';
it('probe', () => {
    loadPage('corpus/walmart-search.html.gz');
    const rows = Array.from(document.querySelector('[data-testid="item-stack"]')!.children);
    const { columns } = inferFields(rows);
    const sel = columns.find(c => c.name === 'Rating 2')!.reader!.chain[0];
    withAtomCache(() => rows.forEach((row, r) => {
        const sigs = collectAtoms(row).filter(a => a.sig.includes('descriptive-meta-data-container>div>span') || a.sig.endsWith('descriptive-meta-data-container>div>span@text')).map(a => `${a.sig.split('>').slice(-3).join('>')} = ${JSON.stringify(a.value)}`);
        const m = Array.from(row.querySelectorAll(sel)).map(e => `<${e.tagName.toLowerCase()} ${Array.from(e.attributes).map(a => `${a.name}="${a.value.slice(0, 40)}"`).join(' ')}> ${JSON.stringify((e.textContent || '').slice(0, 50))}`);
        console.log('ROW', r, '\n  atoms:', sigs.join('\n         '), '\n  matched:', m.join('\n           '));
    }));
});
