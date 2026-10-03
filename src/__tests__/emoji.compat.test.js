// Windows 10's emoji font (Segoe UI Emoji) stops at Emoji 12.1; anything
// newer renders as a blank white box (e.g. 🪙 for gold). Keep icons in the
// game's code and data to Emoji 12.1 or older.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Code point ranges first introduced in Emoji 13.0 or later
const NEWER_THAN_12_1 = [
    [0x1F6D6, 0x1F6D7], [0x1F6DC, 0x1F6DF], [0x1F7F0, 0x1F7F0], [0x1F90C, 0x1F90C],
    [0x1F972, 0x1F972], [0x1F977, 0x1F979], [0x1F9A3, 0x1F9A4], [0x1F9AB, 0x1F9AD],
    [0x1F9CB, 0x1F9CC], [0x1FA74, 0x1FA74], [0x1FA7B, 0x1FA7C], [0x1FA83, 0x1FA8F],
    [0x1FA96, 0x1FAFF],
];
const isTooNew = (cp) => NEWER_THAN_12_1.some(([a, b]) => cp >= a && cp <= b);

function walk(dir, exts, out = []) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            if (ent.name !== '__tests__') walk(full, exts, out);
        } else if (exts.some(e => ent.name.endsWith(e))) {
            out.push(full);
        }
    }
    return out;
}

describe('emoji compatibility', () => {
    it('uses no emoji newer than Emoji 12.1 in src/ or data/', () => {
        const files = [
            ...walk(path.join(root, 'src'), ['.js', '.jsx', '.css']),
            ...walk(path.join(root, 'data'), ['.json']).filter(f => !f.endsWith('gamedata.json')),
        ];
        const offenders = [];
        for (const f of files) {
            for (const ch of fs.readFileSync(f, 'utf-8')) {
                if (isTooNew(ch.codePointAt(0))) offenders.push(`${path.relative(root, f)}: ${ch}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});
