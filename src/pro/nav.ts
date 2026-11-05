/** Which recipe the History and Editor screens show: set before navigating (the panel's routes take no params). */
let openedRecipeId: string | null = null;

export function openRecipe(recipeId: string) {
    openedRecipeId = recipeId;
}

export function openedRecipe(): string | null {
    return openedRecipeId;
}

/** A screen to go on to once the Recipes screen opens: Check, right after a new version is saved. */
let nextView: string | null = null;

export function openNext(recipeId: string, view: string) {
    openedRecipeId = recipeId;
    nextView = view;
}

/** The screen to go on to, once. */
export function takeNextView(): string | null {
    const v = nextView;
    nextView = null;
    return v;
}

/** A repair the editor opens with: the fields a crawl found failing, and pages they failed on. */
export interface Repair {
    recipeId: string;
    fields: { name: string; baseline: number; now: number; failingPages: string[] }[];
}

let pendingRepair: Repair | null = null;

export function openRepair(repair: Repair) {
    openedRecipeId = repair.recipeId;
    pendingRepair = repair;
}

/** The repair for this recipe, once. */
export function takeRepair(recipeId: string): Repair | null {
    const out = pendingRepair?.recipeId === recipeId ? pendingRepair : null;
    pendingRepair = null;
    return out;
}
