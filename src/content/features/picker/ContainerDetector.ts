import { calculateSimilarityScore, getStructuralFingerprint } from '../../utils/similarity';
import { VisualBlockExtractor } from './VisualBlockExtractor';

interface ContainerCandidate {
    container: HTMLElement;
    siblings: HTMLElement[];
    childCount: number;
    confidence: number;
    level: number;
    area: number;
}

export class ContainerDetector {
    private maxLevelsUp = 8;
    private minSiblings = 2;
    private visualExtractor: VisualBlockExtractor;

    constructor() {
        this.visualExtractor = new VisualBlockExtractor();
    }

    public findContainer(element: HTMLElement): {
        isContainer: boolean;
        container: HTMLElement | null;
        childCount: number;
        siblings: HTMLElement[];
        confidence?: number;
        candidates?: any[];
    } {
        console.log('[ContainerDetector] findContainer for:', element);
        // FR-4: Smallest Lowest Common Ancestor (SLCA) Search
        // Instead of just walking up, find "Similar Nodes" first, then find their LCA.

        // 1. Identification Phase: Find cluster of similar elements
        // Search scope: Whole document? Too slow. 
        // Heuristic: Search within a few levels up (scoped traversal).
        // Actually, adhering to the "User Pointed at Item X" paradigm:
        // We look at X's siblings, X's parent's siblings, etc.

        const candidates: ContainerCandidate[] = [];
        let current: HTMLElement | null = element;

        // Traverse up to find potential containers
        for (let level = 0; level < this.maxLevelsUp; level++) {
            if (!current || current === document.body || current === document.documentElement) break;

            const parent: HTMLElement | null = current.parentElement;
            if (!parent) break;

            // ANALYZE: Is this parent a valid container for 'current'?
            // We look for "siblings of current" within "parent" that are similar to "element".

            const cluster = this.findClusterInParent(element, parent);
            console.log(`[ContainerDetector] Level ${level} (Parent: ${parent.tagName}.${parent.className}): Cluster size = ${cluster.length}`);

            if (cluster.length >= this.minSiblings) {
                // We found a repeating pattern at this level.
                const similarity = this.calculateClusterScore(parent, cluster);
                console.log(`[ContainerDetector] -> Candidate Valid! Score: ${similarity}`);

                candidates.push({
                    container: parent,
                    siblings: cluster,
                    childCount: cluster.length,
                    confidence: similarity,
                    level: level,
                    area: parent.offsetWidth * parent.offsetHeight
                });
            }

            current = parent;
        }

        // 2. Selection Phase
        if (candidates.length === 0) {
            console.log('[ContainerDetector] No candidates found.');
            return { isContainer: false, container: null, childCount: 0, siblings: [], confidence: 0 };
        }

        // Sort candidates
        candidates.sort((a, b) => {
            // FR-5 Ambiguity Resolution:
            // Prefer High Confidence > High Child Count > Deeper (Lower Area/Level)

            // 1. Confidence diff
            if (Math.abs(a.confidence - b.confidence) > 15) {
                return b.confidence - a.confidence;
            }

            // 2. Child Count (Coverage)
            // If one covers significantly more items (e.g. grid wrapper vs row wrapper), pick it.
            if (a.childCount > b.childCount * 1.5) return -1;
            if (b.childCount > a.childCount * 1.5) return 1;

            // 3. Compactness (SLCA concept)
            // We want the *Smallest* ancestor that covers the data.
            // Usually, this means the one with smaller Area or Lower Level (closer to items).
            return a.area - b.area;
        });

        console.log('[ContainerDetector] Sorted Candidates:', candidates);

        const best = candidates[0];

        // FR-6: Child Targeting (Validation)
        // Ensure the best container actually visually contains the items (simple check)
        // (Cluster logic already ensures they are children/descendants)

        return {
            isContainer: true,
            container: best.container,
            childCount: best.childCount,
            siblings: best.siblings,
            confidence: best.confidence,
            candidates: candidates
        };
    }

    /**
     * Finds elements within 'parent' that are structurally similar to 'target'.
     * This implements the Clustering logic (FR-1).
     */
    private findClusterInParent(target: HTMLElement, parent: HTMLElement): HTMLElement[] {
        // Optimization: Only scan direct children? 
        // For "Row > Col" layouts, if we are at "Row" level, specific cols are children.
        // If we are at "Grid" level, items might be children.

        // Flatten children to consider
        const children = Array.from(parent.children) as HTMLElement[];

        // If target is not a direct child, finding its "cousins" is complex.
        // Simplified Logic: 
        // If parent contains `target` as a descendant, we want to find other descendants of `parent` similar to `target`.
        // BUT, usually we iterate up. 
        // Level 0: Parent is direct parent. Children are siblings. We check siblings.
        // Level 1: Parent is grandparent. Children are "Rows". Target is inside one Row.
        // We check if "Rows" are similar. If yes, we return "Rows".
        // The *target* itself is just the seed.

        // So, we are actually checking if `parent`'s direct children are similar to EACH OTHER.
        // And ensure `target` is inside one of them.

        const targetAncestorIndex = children.findIndex(c => c === target || c.contains(target));
        if (targetAncestorIndex === -1) return []; // Should not happen

        const seedNode = children[targetAncestorIndex];
        const seedFP = getStructuralFingerprint(seedNode);

        const cluster: HTMLElement[] = [];

        children.forEach(child => {
            // Skip non-visual elements
            if (child.offsetWidth === 0 || child.offsetHeight === 0) return;

            // Compare with seed
            if (child === seedNode) {
                cluster.push(child);
                return;
            }

            const childFP = getStructuralFingerprint(child);
            const score = calculateSimilarityScore(seedFP, childFP);

            // [REFINED] Threshold for "Same Template" - lowered to 50 to handle heterogeneous items (Google Maps)
            if (score >= 50) {
                cluster.push(child);
            }
        });

        // FR-3: Visual Check
        // Ensure the cluster items are visually aligned (Grid/List)
        // This filters out random matching divs that are floating elsewhere
        if (cluster.length > 1) {
            // Check alignment of first few items
            return cluster.filter(c => this.visualExtractor.areVisuallyAligned(seedNode, c));
        }

        return cluster;
    }

    private calculateClusterScore(container: HTMLElement, cluster: HTMLElement[]): number {
        // Coherence: How similar are they?
        // Coverage: What % of container children are in cluster?

        const validChildrenCount = Array.from(container.children).filter(c =>
            (c as HTMLElement).offsetWidth > 0 && (c as HTMLElement).offsetHeight > 0
        ).length;

        const coverage = cluster.length / (validChildrenCount || 1);

        // We assume high similarity because they passed the threshold in findClusterInParent
        const baseScore = 80;

        // Boost by coverage
        return Math.min(100, baseScore + (coverage * 20));
    }
}

