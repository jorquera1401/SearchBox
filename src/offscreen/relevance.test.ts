import { describe, expect, it } from 'vitest';
import type { RankedTab } from '../shared/messages';
import { computeCutoff, NO_MATCH, type RelevanceConfig } from './relevance';
import { MODELS } from './models';

const E5: RelevanceConfig = MODELS['e5-small'].relevance;

const rank = (...scores: number[]): RankedTab[] => scores.map((score, i) => ({ id: i + 1, score }));

/**
 * Real distributions captured from the extension against 11 open tabs. These
 * are the fixtures the config was tuned against, so a regression in either the
 * margin or the spread gate shows up here rather than in the browser.
 */
const MEASURED = {
    // "escala" — the four RASTAR "Escala 1:18" tabs, correctly on top.
    escala: rank(0.837, 0.835, 0.831, 0.83, 0.809, 0.804, 0.804, 0.801, 0.799, 0.797, 0.79),
    // "formula" — the three FORMULA 1 tabs on top.
    formula: rank(0.822, 0.816, 0.813, 0.804, 0.801, 0.798, 0.795, 0.791, 0.789, 0.784, 0.771),
    // "jorge" — one tab titled 'Jorge Constanzo', clearly separated.
    jorge: rank(0.833, 0.811, 0.809, 0.808, 0.802, 0.798, 0.793),
    // "noticias" — no news tab is open; the top is noise.
    noticias: rank(0.825, 0.82, 0.814, 0.812, 0.807, 0.8, 0.781),
    // "automovi" — a half-typed word, which embeds as noise.
    automovi: rank(0.804, 0.799, 0.797, 0.797, 0.796, 0.795, 0.789, 0.785, 0.778, 0.769, 0.768),
    // "automovil" — completed, and the car tabs separate.
    automovil: rank(0.82, 0.818, 0.815, 0.807, 0.8, 0.798, 0.79, 0.788, 0.779, 0.773, 0.765),
    // "gran premio" — flat: nothing stands out at all.
    granPremio: rank(0.812, 0.808, 0.808, 0.806, 0.806, 0.806, 0.805, 0.804, 0.803, 0.8, 0.795),
};

function passing(scores: RankedTab[], config = E5): number {
    const cutoff = computeCutoff(scores, config);
    return scores.filter((s) => s.score >= cutoff).length;
}

describe('computeCutoff on measured distributions', () => {
    it('admits exactly the four "Escala" tabs', () => {
        expect(passing(MEASURED.escala)).toBe(4);
    });

    it('admits exactly the three "Formula 1" tabs', () => {
        expect(passing(MEASURED.formula)).toBe(3);
    });

    it('admits only the single matching tab for a name', () => {
        expect(passing(MEASURED.jorge)).toBe(1);
    });

    it('admits nothing when no tab matches the concept', () => {
        expect(computeCutoff(MEASURED.noticias, E5)).toBe(NO_MATCH);
        expect(passing(MEASURED.noticias)).toBe(0);
    });

    it('admits nothing for a flat distribution', () => {
        expect(computeCutoff(MEASURED.granPremio, E5)).toBe(NO_MATCH);
    });

    it('rejects a half-typed word but accepts the completed one', () => {
        expect(computeCutoff(MEASURED.automovi, E5)).toBe(NO_MATCH);
        expect(passing(MEASURED.automovil)).toBeGreaterThan(0);
    });

    it('would have admitted almost everything under a fixed 0.8 cutoff', () => {
        // The regression this replaced: an absolute threshold sits inside the
        // noise band, so it admitted 10 of 11 tabs for a query that matches none.
        const overFixed = MEASURED.granPremio.filter((s) => s.score >= 0.8).length;
        expect(overFixed).toBe(10);
        expect(passing(MEASURED.granPremio)).toBe(0);
    });
});

describe('computeCutoff edge cases', () => {
    it('admits nothing for an empty ranking', () => {
        expect(computeCutoff([], E5)).toBe(NO_MATCH);
    });

    it('admits the only tab when there is just one', () => {
        expect(passing(rank(0.42))).toBe(1);
    });

    it('never admits more than the ranking holds', () => {
        const scores = rank(0.9, 0.5, 0.4);
        expect(passing(scores)).toBeLessThanOrEqual(scores.length);
    });

    it('widens the selection as the margin grows', () => {
        const scores = MEASURED.escala;
        const narrow = passing(scores, { margin: 0.005, minSpread: 0.018 });
        const wide = passing(scores, { margin: 0.05, minSpread: 0.018 });
        expect(wide).toBeGreaterThan(narrow);
    });
});
