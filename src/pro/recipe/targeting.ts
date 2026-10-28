/**
 * Which URLs a recipe is for, when several recipes share a competitor and page type. Rules are URL globs:
 * `*` is any run of characters, everything else is literal, and a glob matches the whole URL. A URL is the
 * recipe's when it matches an include and no exclude. The rules are checked against the recipe's own sample
 * pages: a rule that leaves one of them out would send that page to another recipe.
 */
import type { MatchRules, Targeting } from './types';

function globToRegExp(glob: string): RegExp {
    const body = glob.trim().split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${body}$`, 'i');
}

export function matchesRules(url: string, rules: MatchRules): boolean {
    const hit = (globs: string[] = []) => globs.some(g => globToRegExp(g).test(url));
    return hit(rules.include) && !hit(rules.exclude);
}

/** The sample pages the rules leave out: empty when they cover them all. */
export function uncoveredSamples(rules: MatchRules | undefined, samples: string[]): string[] {
    return rules ? samples.filter(url => !matchesRules(url, rules)) : [];
}

/** What stops a submit on the recipe's side: the workers find a recipe by competitor and page type. */
export function targetingReasons(targeting: Targeting, samples: string[]): string[] {
    const out: string[] = [];
    if (!targeting.competitor) out.push('Set the competitor.');
    if (!targeting.pageType) out.push('Set the page type.');
    const left = uncoveredSamples(targeting.matchRules, samples);
    if (left.length) out.push(`The match rules leave out ${left.length} sample page${left.length === 1 ? '' : 's'}: ${left.join(', ')}.`);
    return out;
}
