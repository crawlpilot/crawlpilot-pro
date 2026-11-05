/**
 * Ways that read more than the first match's text (Pro recipes, and Atlas templates imported into them):
 * a way can be tried only when a condition about the page holds, read an attribute, the HTML, a count or
 * name/value pairs, and read every match. The page reads each way's raw values
 * (`content/services/page/ways.ts`); which way wins, after its own cleanup, is decided outside the page
 * (`pro/runner/ways.ts`). Page rules say, before any field is read, that a page is not a product page.
 */
import type { DataBinding } from './database';

/** How a count compares: equal, greater, less, at least, at most, not equal. */
export type CountOp = 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'ne';

/** Where a regex condition counts its matches. */
export type RegexIn = 'html' | 'text' | 'url' | 'title';

/** Something true or false about the page, from counts: of a selector's matches, or of a regex's. */
export type Condition =
    | { kind: 'css'; selector: string; op: CountOp; value: number }
    /**
     * Counted in the page's HTML source (`<html>…</html>`, scripts and attributes included: the default, as Atlas
     * counts), its visible text, its URL, or its title.
     */
    | { kind: 'regex'; pattern: string; flags?: string; in?: RegexIn; op: CountOp; value: number }
    /** Every one holds (none: true), or at least one does (none: false). */
    | { kind: 'all' | 'any'; of: Condition[] }
    | { kind: 'not'; of: Condition };

/** What a selector way reads from each match: its text (all of it, hidden included), an attribute, its HTML, how many there are, or name/value pairs. */
export type WayRead = 'text' | 'attr' | 'html' | 'count' | 'pairs';

/** One way as the page reads it. */
export interface PageWay {
    selector?: string;
    data?: DataBinding;
    read?: WayRead;
    /** The attribute `attr` reads; for `pairs`, read from the value element instead of its text. */
    attr?: string;
    /** Each match's name and value: selectors inside it (none: the match itself). */
    pairs?: { key?: string; value?: string };
    when?: Condition;
    /** Every match is read, not only the first. */
    many?: boolean;
}

/** What one way read. */
export interface WayHit {
    /** Its condition did not hold: not tried. */
    skipped?: true;
    /** One per match read, in page order; none when nothing matched. */
    values: string[];
    /** For `pairs`: name and value per match. */
    pairs?: [string, string][];
}

export type RuleStatus = 'not_found' | 'unavailable' | 'blocked' | 'error';

/** A page that is not what the recipe reads (gone, out of stock, a block, an error page), told by a condition. */
export interface PageRule {
    name: string;
    status: RuleStatus;
    when: Condition;
}

export const hitFilled = (h: WayHit | undefined) => !!h && !h.skipped && (h.values.length > 0 || !!h.pairs?.length);
