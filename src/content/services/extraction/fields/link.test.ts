import { describe, it, expect, afterEach } from 'vitest';
import { inferFields, readRow } from '.';

const jobs = [
    ['4456918528', 'Pharma Sales Associate', 'Acme Pharma', 'Bengaluru'],
    ['4456918529', 'Medical Representative', 'Zen Labs', 'Mumbai'],
    ['4456918530', 'Territory Sales Executive', 'Cura Health', 'Pune'],
    ['4456918531', 'Junior Sales Officer', 'Novex', 'Delhi'],
    ['4456918532', 'Field Sales Trainee', 'Medi Corp', 'Chennai'],
];

/** A job search results list opened by script: cards are buttons, the only link is the company's. */
const scriptCards = (attr = 'data-occludable-job-id') => '<ul>' + jobs.map(([id, title, company, place]) => `
    <li ${attr}="${id}"><div role="button" tabindex="0" class="x1a2">
        <img src="/logo/${company.length}.png" width="48" height="48">
        <div class="x9f"><p class="x3k"><strong>${title}</strong></p>
        <a class="x7c" href="/company/${company.toLowerCase().replace(/\s/g, '-')}/">${company}</a>
        <p class="x2m">${place} (On-site)</p></div>
    </div></li>`).join('') + '</ul>';

const at = (path: string) => window.history.replaceState(null, '', path);
const rows = () => Array.from(document.querySelectorAll('li'));
const urls = () => { const r = rows(); const { columns } = inferFields(r); return { columns, read: r.map(x => readRow(x, columns)) }; };

describe('the item link where the card has no link to it', () => {
    afterEach(() => at('/'));

    it('builds each card\'s link from its ID and the page URL that names the open one (LinkedIn job search)', () => {
        at('/jobs/search-results/?currentJobId=4456918528&keywords=sales%20pharma');
        document.body.innerHTML = scriptCards();
        const { columns, read } = urls();
        const link = columns.find(c => c.reader?.link)!;
        expect(link).toBeDefined();
        expect(link.type).toBe('url');
        expect(read.map(r => r[link.id])).toEqual(jobs.map(([id]) => `http://localhost:3000/jobs/search-results/?currentJobId=${id}&keywords=sales%20pharma`));
        // The company link stays its own column.
        expect(columns.some(c => !c.reader?.link && c.type === 'url')).toBe(true);
    });

    it('uses the page\'s own link to the open job (a detail pane), without its tracking', () => {
        at('/jobs/search-results/?currentJobId=4456918530&keywords=sales');
        document.body.innerHTML = scriptCards('componentkey').replace(/componentkey="(\d+)"/g, 'componentkey="job-card-component-ref-$1"')
            + '<section><a href="/jobs/view/4456918530/?trackingId=abc&refId=x">Sales Officer</a></section>';
        const { columns, read } = urls();
        const link = columns.find(c => c.reader?.link)!;
        expect(read.map(r => r[link.id])).toEqual(jobs.map(([id]) => `http://localhost:3000/jobs/view/${id}/`));
    });

    it('finds the ID inside a longer attribute value, and in a path segment', () => {
        at('/jobs/view/4456918530/');
        document.body.innerHTML = scriptCards('componentkey').replace(/componentkey="(\d+)"/g, 'componentkey="job-card-$1-v2"');
        const { columns, read } = urls();
        const link = columns.find(c => c.reader?.link)!;
        expect(read.map(r => r[link.id])).toEqual(jobs.map(([id]) => `http://localhost:3000/jobs/view/${id}/`));
    });

    it('reads the link around the card when the card sits inside it', () => {
        document.body.innerHTML = '<div>' + jobs.map(([id, title, , place]) => `<a href="/job/${id}"><div class="card"><h3>${title}</h3><p>${place}</p></div></a>`).join('') + '</div>';
        const r = Array.from(document.querySelectorAll('.card'));
        const { columns } = inferFields(r);
        const link = columns.find(c => c.reader?.link)!;
        expect(r.map(x => readRow(x, columns)[link.id])).toEqual(jobs.map(([id]) => `http://localhost:3000/job/${id}`));
    });

    it('reads a link kept in a data attribute', () => {
        document.body.innerHTML = '<ul>' + jobs.map(([id, title, , place]) => `<li data-url="/jobs/${id}"><h3>${title}</h3><p>${place}</p></li>`).join('') + '</ul>';
        const { columns, read } = urls();
        const url = columns.find(c => c.name === 'URL')!;
        expect(url.type).toBe('url');
        expect(read.map(r => r[url.id])).toEqual(jobs.map(([id]) => `http://localhost:3000/jobs/${id}`));
    });

    it('adds nothing when the page URL names no card, or the cards already link to themselves', () => {
        at('/jobs/search-results/?keywords=sales');
        document.body.innerHTML = scriptCards();
        expect(urls().columns.some(c => c.reader?.link)).toBe(false);
        at('/jobs/search-results/?currentJobId=4456918528');
        document.body.innerHTML = '<ul>' + jobs.map(([id, title]) => `<li data-job-id="${id}"><a href="/jobs/view/${id}/?trk=x"><h3>${title}</h3></a><p>Remote</p></li>`).join('') + '</ul>';
        expect(urls().columns.some(c => c.reader?.link)).toBe(false);
    });
});

describe('LinkedIn job card titles (a <p>, a screen-reader copy and a visible one)', () => {
    const icon = '<span> </span><span aria-hidden="true"><svg viewBox="0 0 16 16"><g><path d="M0 0h16v16H0z"></path></g></svg></span>';
    const card = (sr: string, shown: string, verified = false, company = 'Acme', place = 'Pune') => `
        <li><div role="button" class="x1"><p class="t"><span class="sr-only">${sr}</span><span aria-hidden="true">${shown}${verified ? icon : ''}</span></p>
        <div><p class="c">${company}</p></div><p class="l">${place}</p></div></li>`;

    it('reads what is shown, whatever the screen reader is told, with or without a badge icon; names it Title', () => {
        document.body.innerHTML = '<ul>' + [
            card('Selected, Sales Officer', 'Sales Officer', false, 'Piramal', 'Ghaziabad'),
            card('Area Sales Manager (Verified job)', 'Area Sales Manager', true, 'Cipla', 'Mumbai'),
            card('', 'Business Development Associate', false, 'Novex', 'Delhi'),
            card('', 'Territory Sales Officer', true, 'Zen Labs', 'Chennai'),
            card('Medical Sales Representative', 'Medical Sales Representative', false, 'Cura', 'Pune'),
        ].join('') + '</ul>';
        const r = rows();
        const { columns } = inferFields(r);
        const title = columns.find(c => c.name === 'Title')!;
        expect(title).toBeDefined();
        expect(r.map(x => readRow(x, columns)[title.id])).toEqual(['Sales Officer', 'Area Sales Manager', 'Business Development Associate', 'Territory Sales Officer', 'Medical Sales Representative']);
    });
});
