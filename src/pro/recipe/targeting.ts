/**
 * Which URLs a recipe is for, when several recipes share a competitor and page type. Rules are URL globs:
 * `*` is any run of characters, everything else is literal, and a glob matches the whole URL. A URL is the
 * recipe's when it matches an include and no exclude. The rules are checked against the recipe's own sample
 * pages: a rule that leaves one of them out would send that page to another recipe.
 */
import type { MatchRules } from './types';

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
