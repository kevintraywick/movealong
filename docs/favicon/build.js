#!/usr/bin/env node
// Regenerates the app favicon into server/public/.
//
// The mark is a white chevron on the app's accent blue — the same forward
// arrow that moves a task to the next day, which is the one gesture the whole
// product is about. A single chevron is used rather than a stacked wordmark or
// a "»" because the icon has to survive 16px in a browser tab, where anything
// with two shapes turns to mush.
//
// The chevron is deliberately oversized and BLEEDS off both edges: drawn to fit
// inside the tile it was a thin stroke on a mostly-blue square, which read as a
// media "next" button. Running it off the edges makes white half the mark
// instead of a detail. Chosen from eight variants judged at 16px
// (archive/favicon-variants/, gitignored). Consequence: the chevron now has to
// be CLIPPED to the rounded square — the raster path gets that free from the
// tile's alpha, the SVG needs an explicit clipPath.
//
// Rasterized here rather than shelling out to a converter so the PNGs can be
// rebuilt on any machine with nothing but Node. Shapes are defined as signed
// distance functions and supersampled 4x4 per pixel for antialiasing.
//
//   node docs/favicon/build.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', '..', 'server', 'public');

// Accent ramp from index.html: #0ea5e9 is the fill blue used for buttons and
// the wordmark's "Along". White is the only other colour in the mark.
const BLUE = [14, 165, 233];
const WHITE = [255, 255, 255];

// --- geometry, in unit coordinates (0..1) ---------------------------------
const RADIUS = 0.22;          // rounded-square corner radius
// Apex sits past the right edge and the arms past top and bottom, so all three
// ends are cut by the tile rather than floating inside it.
const CHEVRON = [[0.40, 0.04], [0.86, 0.5], [0.40, 0.96]];
const STROKE = 0.125;         // half-width of the chevron stroke

function roundedRectDist(x, y) {
    // Signed distance to a rounded square inset so the corners have room.
    const dx = Math.abs(x - 0.5) - (0.5 - RADIUS);
    const dy = Math.abs(y - 0.5) - (0.5 - RADIUS);
    const ax = Math.max(dx, 0), ay = Math.max(dy, 0);
    return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - RADIUS;
}

function segmentDist(px, py, [ax, ay], [bx, by]) {
    const vx = bx - ax, vy = by - ay;
    const wx = px - ax, wy = py - ay;
    const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
    return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

// Round caps and joins fall out of taking the min over both segments.
function chevronDist(x, y) {
    return Math.min(
        segmentDist(x, y, CHEVRON[0], CHEVRON[1]),
        segmentDist(x, y, CHEVRON[1], CHEVRON[2]),
    ) - STROKE;
}

// --- rasterizer -----------------------------------------------------------
const SS = 4; // supersampling factor per axis

function render(size) {
    // RGBA, straight alpha.
    const px = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let bg = 0, fg = 0;
            for (let sy = 0; sy < SS; sy++) {
                for (let sx = 0; sx < SS; sx++) {
                    const u = (x + (sx + 0.5) / SS) / size;
                    const v = (y + (sy + 0.5) / SS) / size;
                    if (roundedRectDist(u, v) <= 0) bg++;
                    if (chevronDist(u, v) <= 0) fg++;
                }
            }
            const n = SS * SS;
            const alpha = bg / n;
            const mix = fg / n;
            const i = (y * size + x) * 4;
            // Chevron over blue, both clipped by the rounded square.
            for (let c = 0; c < 3; c++) {
                px[i + c] = Math.round(BLUE[c] * (1 - mix) + WHITE[c] * mix);
            }
            px[i + 3] = Math.round(alpha * 255);
        }
    }
    return px;
}

// --- minimal PNG encoder --------------------------------------------------
function crc32(buf) {
    let c, crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
        c = (crc ^ buf[n]) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = c ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
    // Filter type 0 (none) on every scanline — the images are tiny and this
    // keeps the encoder to a page.
    const raw = Buffer.alloc(size * (size * 4 + 1));
    for (let y = 0; y < size; y++) {
        raw[y * (size * 4 + 1)] = 0;
        rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 6;   // colour type: RGBA
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

// An .ico may wrap a PNG payload directly, which is all modern browsers need
// from /favicon.ico — the bare path some clients request without reading the
// <link> tags.
function encodeIco(size, png) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2); // type: icon
    header.writeUInt16LE(1, 4); // one image
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size;
    entry[1] = size === 256 ? 0 : size;
    entry.writeUInt16LE(1, 4);  // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(22, 12);
    return Buffer.concat([header, entry, png]);
}

// --- SVG ------------------------------------------------------------------
// Vector version for browsers that take one; identical geometry, scaled to 64.
function svg() {
    const s = 64;
    const p = CHEVRON.map(([x, y]) => `${(x * s).toFixed(1)} ${(y * s).toFixed(1)}`);
    const rx = (RADIUS * s).toFixed(1);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}">
  <clipPath id="t"><rect width="${s}" height="${s}" rx="${rx}"/></clipPath>
  <rect width="${s}" height="${s}" rx="${rx}" fill="rgb(${BLUE})"/>
  <path d="M ${p[0]} L ${p[1]} L ${p[2]}" fill="none" stroke="#ffffff" clip-path="url(#t)"
        stroke-width="${(STROKE * 2 * s).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;
}

// --- write ----------------------------------------------------------------
const targets = [
    ['favicon-32.png', 32],
    ['favicon-192.png', 192],
    ['apple-touch-icon.png', 180],
];

fs.writeFileSync(path.join(OUT, 'favicon.svg'), svg());
console.log('favicon.svg');
for (const [name, size] of targets) {
    const png = encodePng(size, render(size));
    fs.writeFileSync(path.join(OUT, name), png);
    console.log(`${name}  ${size}x${size}  ${png.length} bytes`);
}
const ico = encodeIco(32, encodePng(32, render(32)));
fs.writeFileSync(path.join(OUT, 'favicon.ico'), ico);
console.log(`favicon.ico  32x32  ${ico.length} bytes`);
