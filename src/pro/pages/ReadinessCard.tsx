/**
 * Ready to submit? (`docs/plans/pro-ops-workflow-review.md`): what stands between a version and a submit, one line
 * each with the way to it: its check on sample pages, the recipe's targeting, its review. Check adds its own line
 * for the open page; the recipe screen shows it first, for the newest version.
 */
import { Button, Card, Chip, Text } from '../../sidepanel/ui';
import { reviewReason } from '../db';
import { readiness, type Readiness } from '../recipe/ready';
import { targetingReasons } from '../recipe/targeting';
import type { ProRecipe, Review, Version } from '../recipe/types';
import type { PageResult } from '../runner/readPage';

export interface ReadinessItem {
    ok: boolean;
    text: string;
    action?: { label: string; go: () => void };
}

/** The lines for a version: sample pages, targeting, review; `actions` gives each open one its way to it. */
export function readinessItems(o: { recipe: ProRecipe; version: Version; samples: { url: string; expectRule?: string }[]; review?: Review; pages?: PageResult[]; ready?: Readiness;
    actions?: { samples?: () => void; targeting?: () => void; review?: () => void } }): ReadinessItem[] {
    const sampleReady = o.ready ?? readiness(o.pages, o.version, o.samples);
    const targeting = targetingReasons(o.recipe, o.samples.map(s => s.url));
    const reviewed = reviewReason(o.review);
    const with_ = (go: (() => void) | undefined, label: string) => go ? { action: { label, go } } : {};
    return [
        { ok: sampleReady.ready, text: sampleReady.ready ? 'Checked on sample pages' : sampleReady.reasons.join(' '), ...(!sampleReady.ready ? with_(o.actions?.samples, 'Check') : {}) },
        { ok: targeting.length === 0, text: targeting.length ? targeting.join(' ') : `For ${o.recipe.competitor} · ${o.recipe.pageType}`, ...(targeting.length ? with_(o.actions?.targeting, 'Set targeting') : {}) },
        { ok: !reviewed, text: reviewed ?? `Approved by ${o.review!.by}`, ...(reviewed ? with_(o.actions?.review, 'Review') : {}) },
    ];
}

export function ReadinessCard({ items, title = 'Ready to submit?' }: { items: ReadinessItem[]; title?: string }) {
    const done = items.every(i => i.ok);
    return (
        <Card className="flex flex-col gap-1.5" data-testid="pro-check-ready">
            <div className="flex items-center gap-1.5">
                <Text weight="semibold" className="flex-1">{title}</Text>
                {done && <Chip tone="success">ready</Chip>}
            </div>
            {items.map((c, i) => (
                <div key={i} className="flex items-start gap-2" data-testid="pro-check-item">
                    <Chip tone={c.ok ? 'success' : 'warning'}>{c.ok ? '✓' : '·'}</Chip>
                    <Text size="caption" className="min-w-0 flex-1">{c.text}</Text>
                    {c.action && <Button size="sm" variant="ghost" onClick={c.action.go}>{c.action.label}</Button>}
                </div>
            ))}
        </Card>
    );
}
