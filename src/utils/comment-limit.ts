/**
 * Keep a comment tree within a user supplied row limit. A parent always
 * precedes its replies, so a reply is never retained without its parent.
 */
export function limitNested<T, C>(
    items: readonly T[],
    limit: number,
    getChildren: (item: T) => readonly C[] | undefined,
    cloneWithChildren: (item: T, children: C[]) => T,
): T[] {
    const max = normalizeLimit(limit);
    const result: T[] = [];
    let remaining = max;
    for (const item of items) {
        if (remaining <= 0) break;
        const children = getChildren(item) || [];
        const keptChildren = children.slice(0, Math.max(0, remaining - 1));
        result.push(cloneWithChildren(item, keptChildren));
        remaining -= 1 + keptChildren.length;
    }
    return result;
}

export function normalizeLimit(limit: number): number {
    return Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
}

export function nestedCount<T>(items: readonly T[], getChildren: (item: T) => readonly unknown[] | undefined): number {
    return items.reduce((count, item) => count + 1 + (getChildren(item)?.length || 0), 0);
}
