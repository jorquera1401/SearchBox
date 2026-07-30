import { describe, expect, it } from 'vitest';
import type { RankedTab, TabData } from '../shared/messages';
import { formatScores, keywordFilter, mergeRanking } from './search';

function tab(id: number, title: string, url = `https://site${id}.com`): TabData {
    return { id, windowId: 1, title, url };
}

const TABS: TabData[] = [
    tab(1, 'Invoice #4021 — Stripe', 'https://dashboard.stripe.com/invoices/4021'),
    tab(2, 'Facturación mensual', 'https://notion.so/facturacion'),
    tab(3, 'React Hooks reference', 'https://react.dev/reference'),
    tab(4, 'Vacation photos', 'https://photos.google.com/albums'),
];

describe('keywordFilter', () => {
    it('matches title and URL case-insensitively', () => {
        expect(keywordFilter(TABS, 'INVOICE').map((t) => t.id)).toEqual([1]);
        expect(keywordFilter(TABS, 'notion.so').map((t) => t.id)).toEqual([2]);
    });

    it('returns every tab for an empty query', () => {
        expect(keywordFilter(TABS, '   ')).toHaveLength(TABS.length);
    });

    it('does not mutate the input', () => {
        const before = [...TABS];
        keywordFilter(TABS, 'invoice');
        expect(TABS).toEqual(before);
    });
});

describe('mergeRanking', () => {
    const ranked: RankedTab[] = [
        { id: 3, score: 0.91 },
        { id: 2, score: 0.84 },
        { id: 4, score: 0.62 },
        { id: 1, score: 0.41 },
    ];

    it('orders purely by the model, ignoring literal matches', () => {
        // Tab 1 matches "invoice" literally yet the model ranks it last.
        const keyword = keywordFilter(TABS, 'invoice');
        const merged = mergeRanking(TABS, keyword, ranked, 0.8);
        expect(merged.map((t) => t.id)).toEqual([3, 2, 1]);
    });

    it('keeps a literal match that scores below the threshold', () => {
        const keyword = keywordFilter(TABS, 'invoice');
        expect(mergeRanking(TABS, keyword, ranked, 0.8).map((t) => t.id)).toContain(1);
    });

    it('drops non-matching tabs below the threshold', () => {
        expect(mergeRanking(TABS, [], ranked, 0.8).map((t) => t.id)).toEqual([3, 2]);
    });

    it('re-appends literal matches the model could not score', () => {
        // Tab 2 has no vector yet, so it never appears in `ranked`.
        const withoutTab2 = ranked.filter((r) => r.id !== 2);
        const keyword = [TABS[1]];
        expect(mergeRanking(TABS, keyword, withoutTab2, 0.8).map((t) => t.id)).toEqual([3, 2]);
    });

    it('never emits duplicates', () => {
        const keyword = keywordFilter(TABS, 'a');
        const ids = mergeRanking(TABS, keyword, [...ranked, ...ranked], 0.5).map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('ignores ranked ids that no longer correspond to an open tab', () => {
        const stale: RankedTab[] = [{ id: 999, score: 0.99 }, { id: 3, score: 0.9 }];
        expect(mergeRanking(TABS, [], stale, 0.8).map((t) => t.id)).toEqual([3]);
    });
});

describe('formatScores', () => {
    it('marks only entries at or above the threshold', () => {
        const lines = formatScores(TABS, [{ id: 3, score: 0.9 }, { id: 1, score: 0.4 }], 0.8);
        expect(lines[0].startsWith('✓')).toBe(true);
        expect(lines[1].startsWith('✓')).toBe(false);
    });

    it('honours the limit', () => {
        const many = TABS.map((t, i) => ({ id: t.id, score: 1 - i * 0.1 }));
        expect(formatScores(TABS, many, 0.5, 2)).toHaveLength(2);
    });
});
