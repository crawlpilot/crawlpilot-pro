/**
 * Ready-made recipes on the Recipes screen (docs/plans/recipes-run-on-urls-plan.md §3): a site's
 * product page fields, run on the pages the user gives. Only the name, site, spec and the pages it was
 * checked on ship; the rest of each sample file (its contract, example record) stays out of the build.
 */
import { name as zaraName, site as zaraSite, spec as zaraSpec, checked_on as zaraPages } from '../samples/recipes/zara-product.json';
import { name as uniqloName, site as uniqloSite, spec as uniqloSpec, checked_on as uniqloPages } from '../samples/recipes/uniqlo-product.json';
import type { PageSpec } from '../types/database';

export interface ReadyMade {
    key: string;
    name: string;
    site: string;
    spec: PageSpec;
    /** Pages it was checked on: the Run dialog starts with them. */
    pages: string[];
}

export const READY_MADE: ReadyMade[] = [
    { key: 'zara-product', name: zaraName, site: zaraSite, spec: zaraSpec as PageSpec, pages: zaraPages },
    { key: 'uniqlo-product', name: uniqloName, site: uniqloSite, spec: uniqloSpec as PageSpec, pages: uniqloPages },
];
