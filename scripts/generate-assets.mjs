// Regenerates every brand asset from one vector source: `npm run assets`.
//
// Assets used to be hand-made binaries kept out of git, so they drifted and
// could not be rebuilt. Deriving them from SVG keeps every size consistent and
// guarantees the promo tiles are full-bleed at the exact dimensions the Chrome
// Web Store requires.

import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// public/ is copied verbatim into the extension package, so only the icons the
// extension actually declares belong there. Store marketing art lives outside
// it -- shipping promo tiles and screenshots to every user is dead weight.
const ICONS = resolve(ROOT, 'public/icons');
const STORE = resolve(ROOT, 'store-assets');

const BLUE_LIGHT = '#3b82f6';
const BLUE_DARK = '#1d4ed8';
const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

/**
 * The app mark: stacked bars that read as both a tab list and motion lines.
 * Deliberately free of fine detail — the previous keyboard artwork turned to
 * mush at 16px, where this still resolves.
 *
 * @param size    Square canvas size in px.
 * @param rounded Icons are rounded tiles; promo art bleeds to the edge.
 */
function markSvg(size, { rounded = true } = {}) {
    const r = rounded ? size * 0.22 : 0;
    const bars = [
        { y: 0.28, w: 0.60, o: 1.0 },
        { y: 0.455, w: 0.44, o: 0.85 },
        { y: 0.63, w: 0.28, o: 0.7 },
    ];

    const rects = bars
        .map(({ y, w, o }) => {
            const h = size * 0.115;
            return `<rect x="${size * 0.2}" y="${size * y}" width="${size * w}" height="${h}"
                          rx="${h / 2}" fill="#fff" fill-opacity="${o}"/>`;
        })
        .join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <defs>
            <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="${BLUE_LIGHT}"/>
                <stop offset="1" stop-color="${BLUE_DARK}"/>
            </linearGradient>
        </defs>
        <rect width="${size}" height="${size}" rx="${r}" fill="url(#g)"/>
        ${rects}
    </svg>`;
}

/**
 * Full-bleed promo tile: mark on the left, wordmark on the right.
 *
 * @param leftFraction Where the lockup starts. The wide marquee needs a larger
 *   inset than the small tile, or the art clusters left and leaves dead space.
 */
function promoSvg(width, height, leftFraction = 0.08) {
    const markSize = Math.round(height * 0.46);
    const markX = Math.round(width * leftFraction);
    const markY = Math.round((height - markSize) / 2);

    const textX = markX + markSize + Math.round(width * 0.05);
    const titleSize = Math.round(height * 0.135);
    const subSize = Math.round(height * 0.062);

    const bars = [
        { y: 0.28, w: 0.6, o: 1.0 },
        { y: 0.455, w: 0.44, o: 0.85 },
        { y: 0.63, w: 0.28, o: 0.7 },
    ]
        .map(({ y, w, o }) => {
            const h = markSize * 0.115;
            return `<rect x="${markX + markSize * 0.2}" y="${markY + markSize * y}"
                          width="${markSize * w}" height="${h}" rx="${h / 2}"
                          fill="#fff" fill-opacity="${o}"/>`;
        })
        .join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <defs>
            <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="${BLUE_LIGHT}"/>
                <stop offset="1" stop-color="#1e3a8a"/>
            </linearGradient>
        </defs>
        <rect width="${width}" height="${height}" fill="url(#bg)"/>
        ${bars}
        <text x="${textX}" y="${height * 0.47}" font-family="${FONT}" font-size="${titleSize}"
              font-weight="700" fill="#fff">Tab Wind</text>
        <text x="${textX}" y="${height * 0.47 + titleSize * 1.05}" font-family="${FONT}"
              font-size="${titleSize}" font-weight="700" fill="#fff">Command</text>
        <text x="${textX}" y="${height * 0.47 + titleSize * 1.05 + subSize * 1.9}" font-family="${FONT}"
              font-size="${subSize}" font-weight="500" fill="#dbeafe">On-device AI tab search</text>
    </svg>`;
}

async function png(svg, outPath, width, height) {
    mkdirSync(dirname(outPath), { recursive: true });
    await sharp(Buffer.from(svg)).resize(width, height).png({ compressionLevel: 9 }).toFile(outPath);
    console.log(`  ${outPath.replace(ROOT + '/', '')}  ${width}x${height}`);
}

console.log('Generating brand assets...');

for (const size of [16, 32, 48, 128]) {
    await png(markSvg(512), `${ICONS}/icon-${size}.png`, size, size);
}

await png(markSvg(512), `${STORE}/store-icon-128.png`, 128, 128);
await png(promoSvg(440, 280), `${STORE}/store-promo-small-440x280.png`, 440, 280);
await png(promoSvg(1400, 560, 0.19), `${STORE}/store-promo-marquee-1400x560.png`, 1400, 560);

console.log('Done. Screenshots are NOT generated: the Web Store requires real captures.');
