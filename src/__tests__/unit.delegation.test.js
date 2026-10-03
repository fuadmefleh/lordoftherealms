/**
 * Unit tests for the delegated panel-click router (Phase 6).
 *
 * Inline onclick="window.game.ui.X()" handlers were replaced by data-ui-act /
 * data-am-act attributes routed through routeDelegatedClick(). Since the game
 * is a browser canvas app we can't click-test here, so this locks the riskiest
 * part — attribute parsing + method dispatch — with a fake element.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let routeDelegatedClick;

beforeAll(async () => {
    if (!DataLoader._gamedata) {
        DataLoader.clearCache();
        await DataLoader.initializeAll();
    }
    // Import after DataLoader so ui.js's import graph is satisfied.
    ({ routeDelegatedClick } = await import('../ui/ui.js'));
});

// Minimal stand-in for a clicked DOM element carrying data-* attributes.
// `closest(sel)` returns itself when the requested data-attr is present.
function fakeEl(dataset) {
    const el = {
        dataset,
        closest(sel) {
            const key = sel === '[data-ui-act]' ? 'uiAct' : sel === '[data-am-act]' ? 'amAct' : null;
            return key && dataset[key] != null ? el : null;
        },
    };
    return el;
}

describe('routeDelegatedClick', () => {
    it('calls a UI method with JSON-parsed args (numbers)', () => {
        const ui = { showSettlementDetails: vi.fn() };
        const matched = routeDelegatedClick(
            ui,
            fakeEl({ uiAct: 'showSettlementDetails', uiArgs: '[5, 10]' })
        );
        expect(matched).toBe('ui:showSettlementDetails');
        expect(ui.showSettlementDetails).toHaveBeenCalledWith(5, 10);
    });

    it('passes string args and preserves types', () => {
        const ui = { showEconomicBreakdown: vi.fn() };
        routeDelegatedClick(ui, fakeEl({ uiAct: 'showEconomicBreakdown', uiArgs: '["3,7"]' }));
        expect(ui.showEconomicBreakdown).toHaveBeenCalledWith('3,7');
    });

    it('appends the clicked element when data-ui-el is set (was `this`)', () => {
        const ui = { openTreasuryTab: vi.fn() };
        const el = fakeEl({ uiAct: 'openTreasuryTab', uiArgs: '["tabMarket"]', uiEl: '1' });
        routeDelegatedClick(ui, el);
        expect(ui.openTreasuryTab).toHaveBeenCalledWith('tabMarket', el);
    });

    it('parses a boolean arg', () => {
        const ui = { createTreasuryRoute: vi.fn() };
        routeDelegatedClick(ui, fakeEl({ uiAct: 'createTreasuryRoute', uiArgs: '[true]' }));
        expect(ui.createTreasuryRoute).toHaveBeenCalledWith(true);
    });

    it('returns null and calls nothing for an unmatched element', () => {
        const ui = { foo: vi.fn() };
        expect(routeDelegatedClick(ui, fakeEl({}))).toBeNull();
        expect(ui.foo).not.toHaveBeenCalled();
    });

    it('does not throw on malformed args (falls back to no args)', () => {
        const ui = { openActionMenu: vi.fn() };
        expect(() =>
            routeDelegatedClick(ui, fakeEl({ uiAct: 'openActionMenu', uiArgs: 'not-json' }))
        ).not.toThrow();
        expect(ui.openActionMenu).toHaveBeenCalledWith();
    });
});

describe('inline handlers — static guards', () => {
    // There is no global `game` (see GameView.jsx), so inline onclick code that
    // names it throws on click. Panel buttons must route via data-am-act /
    // data-ui-act, and each routed name must be a real method.
    const files = [];
    const walk = (dir) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) walk(full);
            else if (ent.name.endsWith('.js')) files.push(full);
        }
    };
    walk(path.resolve(__dirname, '../ui'));

    it('no inline onclick references the removed `game` global', () => {
        const offenders = [];
        for (const f of files) {
            const src = fs.readFileSync(f, 'utf-8');
            for (const m of src.matchAll(/onclick="([^"]*)"/g)) {
                if (/(^|[^\w.$])game\b/.test(m[1])) offenders.push(`${path.basename(f)}: ${m[1].slice(0, 80)}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('every data-am-act and inline ActionMenu call names an existing method', async () => {
        const { ActionMenu } = await import('../ui/actionMenu.js');
        const missing = new Set();
        for (const f of files) {
            const src = fs.readFileSync(f, 'utf-8');
            for (const m of src.matchAll(/data-am-act="(\w+)"|onclick="[^"]*?ActionMenu\.(\w+)\(/g)) {
                const name = m[1] || m[2];
                if (typeof ActionMenu[name] !== 'function') missing.add(name);
            }
        }
        expect([...missing]).toEqual([]);
    });
});
