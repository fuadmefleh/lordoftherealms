// Windows 10's emoji font (Segoe UI Emoji) on a machine without the later
// font updates stops at Emoji 11; anything newer renders as a blank white box
// (e.g. 🪙 for gold, or Emoji 12's chair and axe). Keep icons in the game's
// code and data to Emoji 11 or older.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Code point ranges first introduced in Emoji 12.0 or later
const NEWER_THAN_11 = [
    [0x1F6D5, 0x1F6DF], [0x1F6FA, 0x1F6FF], [0x1F7E0, 0x1F7FF], [0x1F90C, 0x1F90F],
    [0x1F93F, 0x1F93F], [0x1F971, 0x1F972], [0x1F977, 0x1F979], [0x1F97B, 0x1F97B],
    [0x1F9A3, 0x1F9AF], [0x1F9BA, 0x1F9BF], [0x1F9C3, 0x1F9CF], [0x1FA70, 0x1FAFF],
];
const isTooNew = (cp) => NEWER_THAN_11.some(([a, b]) => cp >= a && cp <= b);
// Gender-neutral people in a joined sequence (🧑 + ZWJ, Emoji 12.1)
const NEUTRAL_ZWJ = /\u{1F9D1}‍/u;

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
    it('uses no emoji newer than Emoji 11 in src/ or data/', () => {
        const files = [
            ...walk(path.join(root, 'src'), ['.js', '.jsx', '.css']),
            ...walk(path.join(root, 'data'), ['.json']).filter(f => !f.endsWith('gamedata.json')),
        ];
        const offenders = [];
        for (const f of files) {
            const text = fs.readFileSync(f, 'utf-8');
            for (const ch of text) {
                if (isTooNew(ch.codePointAt(0))) offenders.push(`${path.relative(root, f)}: ${ch}`);
            }
            if (NEUTRAL_ZWJ.test(text)) offenders.push(`${path.relative(root, f)}: a gender-neutral person sequence`);
        }
        expect(offenders).toEqual([]);
    });
});
