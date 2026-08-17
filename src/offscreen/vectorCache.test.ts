import { describe, expect, it } from 'vitest';
import { dot, embeddingText, cacheKey, EMBEDDING_DIM } from './vectorCache';

/** Random unit vector, matching what the model produces. */
function unitVector(seed: number): Float32Array {
    const vec = new Float32Array(EMBEDDING_DIM);
    let state = seed;
    for (let i = 0; i < EMBEDDING_DIM; i++) {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        vec[i] = state / 0x3fffffff - 1;
    }
    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    return vec;
}

describe('embeddingText', () => {
    it('keeps the bare domain and drops path noise', () => {
        const text = embeddingText('Cómo hacer pan', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLab');
        expect(text).toBe('Cómo hacer pan youtube.com');
    });

    it('survives URLs with no usable host', () => {
        expect(embeddingText('New Tab', 'about:blank')).toBe('New Tab');
        expect(embeddingText('Broken', 'not a url')).toBe('Broken');
    });

    it('tolerates missing title and url', () => {
        expect(embeddingText(undefined, undefined)).toBe('');
    });
});

describe('cacheKey', () => {
    it('changes when the title changes, so a renamed tab is re-embedded', () => {
        const url = 'https://example.com';
        expect(cacheKey('Before', url)).not.toBe(cacheKey('After', url));
    });

    it('distinguishes different urls with the same title', () => {
        expect(cacheKey('Docs', 'https://a.com')).not.toBe(cacheKey('Docs', 'https://b.com'));
    });
});

describe('dot', () => {
    it('returns 1 for a vector against itself', () => {
        const vec = unitVector(7);
        expect(dot(vec, vec)).toBeCloseTo(1, 5);
    });

    it('is symmetric', () => {
        const a = unitVector(1);
        const b = unitVector(2);
        expect(dot(a, b)).toBeCloseTo(dot(b, a), 6);
    });

    it('stays within the cosine range for unit vectors', () => {
        const score = dot(unitVector(3), unitVector(4));
        expect(score).toBeGreaterThanOrEqual(-1);
        expect(score).toBeLessThanOrEqual(1);
    });

    it('is zero for orthogonal vectors', () => {
        const a = new Float32Array(EMBEDDING_DIM);
        const b = new Float32Array(EMBEDDING_DIM);
        a[0] = 1;
        b[1] = 1;
        expect(dot(a, b)).toBe(0);
    });
});
