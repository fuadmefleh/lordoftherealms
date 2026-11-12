// I opens and closes the Inventory (ui/inventoryHotkey.js, read by the game's
// keydown handler in ui/game/gameLoop.js) — never while typing in a field.
import { describe, it, expect } from 'vitest';
import { isInventoryKey, isTextEntry } from '../ui/inventoryHotkey.js';

const el = (tagName, extra = {}) => ({ tagName, closest: () => null, ...extra });
const key = (k, target = el('CANVAS'), mods = {}) => ({ key: k, target, ...mods });

describe('the inventory hotkey', () => {
    it('I or i on the map toggles it', () => {
        expect(isInventoryKey(key('i'))).toBe(true);
        expect(isInventoryKey(key('I'))).toBe(true);
        expect(isInventoryKey(key('i', el('BODY')))).toBe(true);
        expect(isInventoryKey(key('i', null))).toBe(true);
    });

    it('other keys, chords and held-key repeats do not', () => {
        expect(isInventoryKey(key('o'))).toBe(false);
        expect(isInventoryKey(key('i', undefined, { ctrlKey: true }))).toBe(false);
        expect(isInventoryKey(key('i', undefined, { altKey: true }))).toBe(false);
        expect(isInventoryKey(key('I', undefined, { metaKey: true }))).toBe(false);
        expect(isInventoryKey(key('i', undefined, { repeat: true }))).toBe(false);
        expect(isInventoryKey(null)).toBe(false);
    });

    it('typing an i into a text field never toggles it', () => {
        for (const tag of ['INPUT', 'TEXTAREA', 'SELECT', 'input']) {
            expect(isTextEntry(el(tag))).toBe(true);
            expect(isInventoryKey(key('i', el(tag)))).toBe(false);
        }
        expect(isInventoryKey(key('i', el('DIV', { isContentEditable: true })))).toBe(false);
        // inside an editable block (a span in a contenteditable div)
        const inEditable = el('SPAN', { closest: (sel) => (/contenteditable/.test(sel) ? {} : null) });
        expect(isInventoryKey(key('i', inEditable))).toBe(false);
        expect(isTextEntry(el('BUTTON'))).toBe(false);
    });

    it('the game keydown handler asks it before toggling the window', async () => {
        const fs = await import('fs');
        const path = await import('path');
        const src = fs.readFileSync(path.resolve(__dirname, '../ui/game/gameLoop.js'), 'utf8');
        expect(src).toMatch(/isInventoryKey\(e\)[^\n]*npcDialogOverlay/);
        expect(src).toMatch(/toggleInventoryPanel\(\)/);
    });
});
