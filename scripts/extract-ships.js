#!/usr/bin/env node
// Extract the ships bluecarrot16 composed in the LPC Ship tileset's Tiled map
// (assets/lpc/lpc-ship/lpc-ship-preview.tmx) into data/shipHulls.json: each
// ship as layered tile references — deck, hull, masts, shrouds, sails, crow's
// nests — in the map's layer order, so the inner map can draw them as the
// artist assembled them (world/shipHulls.js registers them as objects).
//
// The preview-only water and container layers are left out. Ships are found
// as the connected clusters of tiles across the drawn layers.
//
// Usage: node scripts/extract-ships.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const DIR = 'assets/lpc/lpc-ship';
const TMX = path.join(ROOT, DIR, 'lpc-ship-preview.tmx');
const OUT = path.join(ROOT, 'data', 'shipHulls.json');
const FLIP_MASK = 0x1fffffff;
const SKIP_TILESETS = new Set(['water', 'container']);
const SKIP_LAYERS = new Set(['water']);

const xml = fs.readFileSync(TMX, 'utf8');
const W = +/<map [^>]*\swidth="(\d+)"/.exec(xml)[1];
const H = +/<map [^>]*\sheight="(\d+)"/.exec(xml)[1];
const T = +/<map [^>]*tilewidth="(\d+)"/.exec(xml)[1];

// Tilesets
const tilesets = [];
for (const m of xml.matchAll(/<tileset firstgid="(\d+)" name="([^"]+)" tilewidth="(\d+)" tileheight="(\d+)" tilecount="(\d+)" columns="(\d+)">\s*<image source="([^"]+)"/g)) {
    tilesets.push({ firstgid: +m[1], name: m[2], tw: +m[3], th: +m[4], count: +m[5], columns: +m[6], image: `${DIR}/${m[7]}` });
}
tilesets.sort((a, b) => a.firstgid - b.firstgid);
const tilesetOf = (gid) => {
    let ts = null;
    for (const t of tilesets) if (gid >= t.firstgid) ts = t;
    return ts;
};

// Layers, in drawing order (only visible ones: the map hides spare sail and crow layers)
const layers = [];
for (const m of xml.matchAll(/<layer id="\d+" name="([^"]+)" width="\d+" height="\d+"([^>]*)>\s*<data encoding="base64" compression="zlib">\s*([^<]+)<\/data>/g)) {
    const name = m[1];
    if (SKIP_LAYERS.has(name) || /visible="0"/.test(m[2])) continue;
    const buf = zlib.inflateSync(Buffer.from(m[3].trim(), 'base64'));
    const gids = [];
    for (let i = 0; i < buf.length; i += 4) gids.push(buf.readUInt32LE(i));
    layers.push({ name, gids });
}

// Every drawn cell, and the ships as connected clusters of them
const occupied = new Map(); // idx -> true
let flipped = 0;
for (const l of layers) {
    l.gids.forEach((raw, i) => {
        if (!raw) return;
        if (raw & ~FLIP_MASK) flipped++;
        const ts = tilesetOf(raw & FLIP_MASK);
        if (!ts || SKIP_TILESETS.has(ts.name)) return;
        occupied.set(i, true);
        // a big tile (the 64px cannon ports) covers the cells above and right of its anchor
        const cw = ts.tw / T, ch = ts.th / T;
        for (let dy = 0; dy < ch; dy++) for (let dx = 0; dx < cw; dx++) {
            const x = (i % W) + dx, y = Math.floor(i / W) - dy;
            if (x < W && y >= 0) occupied.set(y * W + x, true);
        }
    });
}
const seen = new Set();
const clusters = [];
for (const start of occupied.keys()) {
    if (seen.has(start)) continue;
    const cells = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
        const c = stack.pop();
        cells.push(c);
        const x = c % W, y = Math.floor(c / W);
        // (touching cells, diagonals too, make one ship)
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const n = ny * W + nx;
            if (occupied.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
        }
    }
    if (cells.length >= 12) clusters.push(cells);
}

// Ships, smallest first
const ships = clusters.map(cells => {
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    for (const c of cells) {
        const x = c % W, y = Math.floor(c / W);
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    const set = new Set(cells);
    const tiles = [];
    const layerNames = [];
    for (const l of layers) {
        let any = false;
        l.gids.forEach((raw, i) => {
            if (!raw || !set.has(i)) return;
            const gid = raw & FLIP_MASK;
            const ts = tilesetOf(gid);
            if (!ts || SKIP_TILESETS.has(ts.name)) return;
            const local = gid - ts.firstgid;
            const x = i % W, y = Math.floor(i / W);
            tiles.push({
                col: x - x0, row: y - y0, layer: l.name,
                sheet: ts.image, sx: (local % ts.columns) * ts.tw, sy: Math.floor(local / ts.columns) * ts.th, sw: ts.tw, sh: ts.th,
            });
            any = true;
        });
        if (any) layerNames.push(l.name);
    }
    // The waterline: the lowest row with hull ('ship' layer) on it
    const hullRows = tiles.filter(t => t.layer === 'ship').map(t => t.row);
    return { w: x1 - x0 + 1, h: y1 - y0 + 1, waterline: hullRows.length ? Math.max(...hullRows) : y1 - y0, masts: 0, layers: layerNames, tiles, area: cells.length };
}).sort((a, b) => a.area - b.area);

const NAMES = ['skiff', 'sloop', 'brig', 'galleon', 'carrack', 'ship6', 'ship7'];
const out = {
    _doc: 'Ships as bluecarrot16 composed them in the LPC Ship tileset\'s Tiled map ("[LPC] Ship" by bluecarrot16, commissioned by Sander Frenken, OGA-BY 3.0+ / CC-BY 3.0+ / GPL 2.0+; assets/lpc/lpc-ship/CREDITS-ship.txt). Generated by scripts/extract-ships.js — do not edit by hand. Each ship: w x h cells of 32px, `waterline` the hull\'s lowest row, `tiles` in drawing order (col/row from the top-left; a 64px tile is anchored at its bottom-left cell).',
    tileSize: T,
    ships: ships.map((s, i) => ({ id: `hull_${NAMES[i] || 'ship' + i}`, ...s })),
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`Extracted ${ships.length} ships (${ships.map(s => `${s.w}x${s.h}`).join(', ')}), ${flipped} flipped tiles, layers: ${layers.map(l => l.name).join(', ')}`);
