// Pure result-list logic. No DOM, no chrome APIs — this is the part worth
// testing, and it used to be buried inside a 376-line closure.

import type { RankedTab, TabData } from '../shared/messages';

/** Case-insensitive substring match over title and URL. */
export function keywordFilter(tabs: TabData[], query: string): TabData[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [...tabs];

    return tabs.filter((tab) => {
        const title = (tab.title || '').toLowerCase();
        const url = (tab.url || '').toLowerCase();
        return title.includes(needle) || url.includes(needle);
    });
}

/**
 * Builds the final list from the model's ranking.
 *
 * Ordering is entirely the model's call, including for tabs that match
 * literally. Inclusion is not: a literal match is never dropped for scoring
 * below the threshold, because typing a title verbatim and watching it vanish
 * reads as a broken search rather than a judgement call. Tabs with no vector
 * yet are absent from `ranked` altogether, so literal matches are re-appended.
 */
export function mergeRanking(
    tabs: TabData[],
    keywordResults: TabData[],
    ranked: RankedTab[],
    threshold: number
): TabData[] {
    const byId = new Map(tabs.map((tab) => [tab.id, tab]));
    const keywordIds = new Set(keywordResults.map((tab) => tab.id));

    const merged: TabData[] = [];
    const included = new Set<number>();

    for (const { id, score } of ranked) {
        if (score < threshold && !keywordIds.has(id)) continue;
        const tab = byId.get(id);
        if (!tab || included.has(id)) continue;
        merged.push(tab);
        included.add(id);
    }

    for (const tab of keywordResults) {
        if (included.has(tab.id)) continue;
        merged.push(tab);
        included.add(tab.id);
    }

    return merged;
}

/**
 * Formats scores for the console. Deep enough to show where an expected tab
 * landed, which is what separates "cutoff too high" from "ranking is wrong".
 */
export function formatScores(tabs: TabData[], ranked: RankedTab[], threshold: number, limit = 30): string[] {
    const byId = new Map(tabs.map((tab) => [tab.id, tab]));

    return ranked.slice(0, limit).map((entry, index) => {
        const title = byId.get(entry.id)?.title || '?';
        const mark = entry.score >= threshold ? '✓' : ' ';
        return `${mark} #${index + 1} ${entry.score.toFixed(3)}  ${title.slice(0, 60)}`;
    });
}
