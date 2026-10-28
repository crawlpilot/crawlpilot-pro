/**
 * Records a review. A version already uploaded (submitted) is reviewed on the backend first, as `live` is
 * moved there first: a rejection there is what stops it being made live again, and what Pro shows stays
 * what the backend has. A version not yet uploaded is reviewed here only; its approval goes up on submit.
 */
import { pro, reviewProblem, ReviewRefused, type ReviewInput } from '../db';
import type { ProRecipe, Review, Version } from '../recipe/types';
import { BackendError, type BackendApi } from './types';

export async function recordReview(api: BackendApi | null, recipe: ProRecipe, version: Version, input: ReviewInput): Promise<Review> {
    const problem = reviewProblem(version, input);
    if (problem) throw new ReviewRefused(problem);
    if (recipe.remoteId && version.submittedAt) {
        if (!api) throw new BackendError('auth', 'Set the backend address and token first (Backend, on the Recipes screen).');
        await api.reviewVersion(recipe.remoteId, version.version, { state: input.state, by: input.by, note: input.note.trim() });
    }
    return pro.reviews.review(recipe.id, version.version, input);
}
