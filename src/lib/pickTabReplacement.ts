/**
 * Pure function: pick which tab to focus after closing a tab.
 *
 * Algorithm:
 * 1. Walk LEFT from closedIndex-1 down to 0
 * 2. Then walk RIGHT from closedIndex to end
 * 3. Return first candidate that isn't excluded
 * 4. Return null if no candidates
 */
export function pickTabReplacement(
    closedIndex: number,
    remainingPaths: string[],
    exclude?: string | null,
): string | null {
    if (remainingPaths.length === 0) return null;

    const order: number[] = [];
    // Walk left from closedIndex-1
    for (let i = closedIndex - 1; i >= 0; i--) order.push(i);
    // Walk right from closedIndex
    for (let i = closedIndex; i < remainingPaths.length; i++) order.push(i);

    for (const idx of order) {
        const candidate = remainingPaths[idx];
        if (candidate && candidate !== exclude) return candidate;
    }
    return null;
}
