/** Which recipe the History and Editor screens show: set before navigating (the panel's routes take no params). */
let openedRecipeId: string | null = null;

export function openRecipe(recipeId: string) {
    openedRecipeId = recipeId;
}

export function openedRecipe(): string | null {
    return openedRecipeId;
}
