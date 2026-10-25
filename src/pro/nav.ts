/** Which recipe the History screen shows: set before navigating to it (the panel's routes take no params). */
let historyRecipeId: string | null = null;

export function openHistory(recipeId: string) {
    historyRecipeId = recipeId;
}

export function historyRecipe(): string | null {
    return historyRecipeId;
}
