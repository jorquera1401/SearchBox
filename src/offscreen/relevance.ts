// Turns a score distribution into an absolute cutoff for one query.
//
// A fixed cutoff does not work here. Measured on real tabs, e5 puts every
// score between 0.76 and 0.84, with unrelated tabs sitting around 0.79 — so any
// constant lands inside the noise band and admits an arbitrary slice of it.
//
// What does separate a hit from noise is the shape of the distribution: when a
// tab genuinely matches, the top score pulls away from the middle of the pack.
// When nothing matches, the scores are flat.

import type { RankedTab } from '../shared/messages';

export interface RelevanceConfig {
    /** How far below the best score a tab may sit and still be shown. */
    margin: number;
    /** Minimum top-to-median spread for the query to count as matching at all. */
    minSpread: number;
}

/** No tab can reach this, so a flat distribution admits nothing. */
export const NO_MATCH = Infinity;

/**
 * @param ranked Scored tabs, best first.
 * @returns The score a tab must reach, or NO_MATCH if nothing stands out.
 */
export function computeCutoff(ranked: RankedTab[], config: RelevanceConfig): number {
    if (ranked.length === 0) return NO_MATCH;
    if (ranked.length === 1) return ranked[0].score;

    const best = ranked[0].score;
    const median = ranked[Math.floor(ranked.length / 2)].score;

    // Also catches half-typed words: "automovi" scores flat where "automovil"
    // separates cleanly, so incomplete queries fall back to keyword matching
    // instead of returning whatever the model found least unlike them.
    if (best - median < config.minSpread) return NO_MATCH;

    return best - config.margin;
}
