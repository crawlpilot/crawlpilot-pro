/**
 * Reviews of versions: a second person approves or rejects a version before it can be live. A review never
 * changes the version (versions are written once); each one is kept, and the newest is the version's state.
 * Someone may not review a version they saved, and a rejection says why.
 */
import { done, req } from '../../shared/db/idb';
import { proTransaction } from './idb';
import { STORES } from './schema';
import type { Review, ReviewState, Version } from '../recipe/types';

export class ReviewRefused extends Error {}

export async function reviewVersion(recipeId: string, version: number, input: { state: ReviewState; by: string; note: string }): Promise<Review> {
    const note = input.note.trim();
    if (input.state === 'rejected' && !note) throw new ReviewRefused('Say why it is rejected.');
    const tx = await proTransaction([STORES.versions, STORES.reviews], 'readwrite');
    const v = await req<Version | undefined>(tx.objectStore(STORES.versions).get([recipeId, version]));
    if (!v) { tx.abort(); throw new ReviewRefused(`No version ${version}`); }
    if (v.author === input.by) { tx.abort(); throw new ReviewRefused(`${input.by} saved v${version}; someone else reviews it.`); }
    const review: Review = { recipeId, version, state: input.state, by: input.by, note, at: Date.now() };
    const id = await req(tx.objectStore(STORES.reviews).add(review)) as number;
    await done(tx);
    return { ...review, id };
}

/** A recipe's reviews, the newest first. */
export async function listReviews(recipeId: string): Promise<Review[]> {
    const tx = await proTransaction(STORES.reviews);
    const all = await req<Review[]>(tx.objectStore(STORES.reviews).index('recipeId').getAll(recipeId));
    return all.sort((a, b) => b.at - a.at || (b.id ?? 0) - (a.id ?? 0));
}

/** The newest review of each version: its state. A version with none is waiting for one. */
export async function reviewStates(recipeId: string): Promise<Map<number, Review>> {
    const out = new Map<number, Review>();
    for (const r of await listReviews(recipeId)) if (!out.has(r.version)) out.set(r.version, r);
    return out;
}

/** What stops a version going live on review: one line, or none when it is approved. */
export function reviewReason(review: Review | undefined): string | null {
    if (!review) return 'Not reviewed: someone other than its author approves it first.';
    if (review.state === 'rejected') return `Rejected by ${review.by}: ${review.note}`;
    return null;
}
