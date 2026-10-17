/**
 * "Copy as code": the same selector written for the scraping libraries people use.
 */
import { looksLikeXPath } from './resolve';

export type SnippetTarget = 'playwright' | 'puppeteer' | 'selenium' | 'scrapy' | 'beautifulsoup' | 'cheerio';

export const SNIPPET_LABELS: Record<SnippetTarget, string> = {
    playwright: 'Playwright',
    puppeteer: 'Puppeteer',
    selenium: 'Selenium (Py)',
    scrapy: 'Scrapy',
    beautifulsoup: 'BeautifulSoup',
    cheerio: 'Cheerio',
};

const js = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const py = (s: string) => (s.includes("'") && !s.includes('"') ? `"${s}"` : `'${s.replace(/'/g, "\\'")}'`);

/** @param all true when the selector targets a list of elements. */
export function toSnippet(target: SnippetTarget, selector: string, all = false): string {
    const xpath = looksLikeXPath(selector);
    switch (target) {
        case 'playwright':
            return all
                ? `const texts = await page.locator(${js(xpath ? `xpath=${selector}` : selector)}).allInnerTexts();`
                : `const text = await page.locator(${js(xpath ? `xpath=${selector}` : selector)}).first().innerText();`;
        case 'puppeteer': {
            const sel = xpath ? `xpath/${selector}` : selector;
            return all
                ? `const texts = await page.$$eval(${js(sel)}, els => els.map(e => e.textContent.trim()));`
                : `const text = await page.$eval(${js(sel)}, e => e.textContent.trim());`;
        }
        case 'selenium': {
            const by = xpath ? 'By.XPATH' : 'By.CSS_SELECTOR';
            return all
                ? `texts = [e.text for e in driver.find_elements(${by}, ${py(selector)})]`
                : `text = driver.find_element(${by}, ${py(selector)}).text`;
        }
        case 'scrapy':
            if (xpath) {
                return all
                    ? `texts = response.xpath(${py(selector)}).xpath('normalize-space()').getall()`
                    : `text = response.xpath(${py(selector)}).xpath('normalize-space()').get()`;
            }
            return all
                ? `texts = [t.strip() for t in response.css(${py(selector + ' ::text')}).getall()]`
                : `text = ''.join(response.css(${py(selector + ' ::text')}).getall()).strip()`;
        case 'beautifulsoup':
            if (xpath) {
                return `# BeautifulSoup has no XPath; use lxml:\nfrom lxml import html\ntree = html.fromstring(page_html)\ntexts = [e.text_content().strip() for e in tree.xpath(${py(selector)})]`;
            }
            return all
                ? `texts = [e.get_text(strip=True) for e in soup.select(${py(selector)})]`
                : `el = soup.select_one(${py(selector)})\ntext = el.get_text(strip=True) if el else None`;
        case 'cheerio':
            if (xpath) return `// Cheerio has no XPath; convert to CSS or use xpath + xmldom\n// ${selector}`;
            return all
                ? `const texts = $(${js(selector)}).map((_, e) => $(e).text().trim()).get();`
                : `const text = $(${js(selector)}).first().text().trim();`;
    }
}
