// The tax guide (ui/actionMenu/taxGuide.js): the Crown's Treasury explains
// every tax, level and budget line, with the numbers the simulation reads
// (data/fiscal.json explain, filled from the live tuning), and the Royal
// Treasury's Taxes tab explains the player's own settlement tax
// (data/market.json taxGuide). Rendered against a real new game.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { CrownBooks } from '../world/crownBooks.js';
import { Fiscal } from '../systems/fiscal.js';
import { Ledger } from '../systems/ledger.js';
import { Taxation } from '../systems/marketDynamics.js';
import { loadData, newGame } from './playtest/harness.js';

let ActionMenu, Guide, logSpy;
const savedDocument = globalThis.document;

function el() {
    return {
        style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        addEventListener() {}, removeEventListener() {}, appendChild(c) { return c; }, querySelector() { return el(); }, querySelectorAll() { return []; },
        setAttribute() {}, getAttribute() { return null; }, remove() {}, insertAdjacentHTML() {},
    };
}

function shell(game) {
    const rec = { panels: [] };
    game.ui = new Proxy({
        showCustomPanel: (title, html) => rec.panels.push({ title: String(title), html: String(html) }),
        _panelNav: null,
    }, { get(t, p) { return p in t ? t[p] : (typeof p === 'symbol' ? undefined : () => {}); } });
    return rec;
}

/** The new game with the player standing in, and ruling, the first living realm's capital. */
function ruler() {
    const game = newGame(7);
    const { world, player } = game;
    const k = world.kingdoms.find(x => x.isAlive && x.capital);
    player.q = k.capital.q;
    player.r = k.capital.r;
    player.throne = player.throne || {};
    player.throne.ruling = { kingdomId: k.id, policies: { tax: 'standard', stance: 'defensive', faith: 'devout' } };
    CrownBooks.state(k).rates.land = 'heavy';
    return { game, k };
}

const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ');

beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    globalThis.document = { getElementById: () => el(), createElement: () => el(), querySelector: () => el(), querySelectorAll: () => [], addEventListener() {}, body: el() };
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
    Guide = await import('../ui/actionMenu/taxGuide.js');
});
afterAll(() => {
    globalThis.document = savedDocument;
    if (logSpy) logSpy.mockRestore();
});

describe('the Crown\'s Treasury explains its taxes and lines', () => {
    it('fills the prose from the live tuning (no placeholder left)', () => {
        const C = CrownBooks.config();
        expect(Guide.fill('{pct:rates.land} {num:rates.poll} {x:levels.heavy.mult}')).toBe(`${C.rates.land * 100}% ${C.rates.poll} ×${C.levels.heavy.mult}`);
        for (const t of ['land', 'poll', 'excise']) {
            for (const key of ['who', 'on', 'how']) expect(Guide.fill(C.explain.taxes[t][key])).not.toMatch(/\{[a-z]+:/);
        }
        for (const s of C.explain.raise) expect(Guide.fill(s)).not.toMatch(/\{[a-z]+:/);
    });

    it('computes each level\'s effect from the burden and stability rules', () => {
        const C = CrownBooks.config();
        const k = { fisc: null };
        CrownBooks.state(k);
        const base = { burden: CrownBooks.burden(k), stab: CrownBooks.stabilityMod(k) };
        k.fisc.rates.land = 'crushing';
        const e = Guide.levelEffect('land', 'crushing');
        expect(e.mult).toBe(C.levels.crushing.mult);
        expect(CrownBooks.burden(k) - base.burden).toBeCloseTo(e.burden / 100, 2);
        expect(CrownBooks.stabilityMod(k) - base.stab).toBeCloseTo(e.stability, 1);
    });

    it('every revenue, spending and financing line has a one-line explanation', () => {
        for (const l of [...CrownBooks.REVENUE_LINES, ...CrownBooks.EXPENSE_LINES, ...CrownBooks.FINANCE_LINES, 'other']) {
            expect(Guide.lineTip(l), l).toBeTruthy();
        }
        expect(Guide.lineTip('arms')).toMatch(/weapons/i);
        expect(Guide.lineTip('army')).toMatch(/officers/i);
    });

    it('the Budget and Your purse tabs show the guide, the hovers and the current levels', () => {
        const { game } = ruler();
        const rec = shell(game);
        ActionMenu.showTreasury(game, 'budget');
        const budget = rec.panels.at(-1).html;
        expect(budget).toContain('What are these?');
        const t = text(budget);
        for (const name of ['Land tax', 'Hearth tax', 'Excise', 'Who pays:', 'How much:', 'Army pay', 'The court', 'Arms & armour', 'Revenue lines', 'Spending lines']) expect(t).toContain(name);
        expect(t).toContain(`${CrownBooks.config().rates.land * 100}% of the peasants' earnings`);
        expect(budget).toContain('now 💰 Heavy');
        ActionMenu.showTreasury(game, 'crown');
        const crown = rec.panels.at(-1).html;
        expect(crown).toContain('What are these?');
        // The level buttons carry their effects in figures, the tax names who pays
        expect(crown).toMatch(/title="[^"]*×1\.65 its take · people&#39;s burden \+/);
        expect(crown).toMatch(/title="[^"]*Clergy and nobles are exempt/i);
        expect(text(crown)).toMatch(/now 💰 Heavy · ×1\.3 its take/);
        for (const bad of ['undefined', 'NaN', '[object Object]', '{pct:', '{num:', '{x:', '{c100:']) expect(crown + budget, bad).not.toContain(bad);
        expect(text(crown + budget)).not.toMatch(/\d\.\d{4,}/);
    });

    it('a budget line row carries its explanation on hover', () => {
        const { game, k } = ruler();
        const rec = shell(game);
        const f = CrownBooks.state(k);
        f.last.arms = 120;
        f.last.land = 300;
        Fiscal.budget(game.world, k);
        ActionMenu.showTreasury(game, 'budget');
        const html = rec.panels.at(-1).html;
        expect(html).toContain(`title="${Guide.lineTip('arms').replace(/'/g, '&#39;')}"`);
    });
});

describe('the Royal Treasury explains the settlement tax', () => {
    it('the Taxes tab shows the guide and each rate in figures', async () => {
        const { UI } = await import('../ui/ui.js');
        const { game } = ruler();
        const rec = { panels: [] };
        const ui = Object.create(UI.prototype);
        ui.game = game;
        ui.showCustomPanel = (title, html) => rec.panels.push({ title, html });
        ui.setPanelNav = () => {};
        ui.openTreasuryTab = () => {};
        ui.showTreasuryPanel(game.player, game.world);
        const html = rec.panels.at(-1).html;
        expect(html).toContain('What is this tax?');
        const t = text(html);
        expect(t).toContain(`${Taxation.TAX_PER_HEAD}g a head a week`);
        expect(t).toMatch(/Very High \(40%\)[^:]*: Takes 40% · happiness heads for 20 · growth −10% a year · welfare −25 pts/);
        expect(html).toContain('data-am-act="showTreasury"');
        expect(html).not.toContain('{perHead}');
    });

    it('ledger lines for taxes, crown wages and arms carry a description', () => {
        for (const id of ['taxes', 'royalLevy', 'taxFarms', 'crownWages', 'armsKit', 'tariffs', 'roadTolls']) expect(Ledger.category(id).desc, id).toBeTruthy();
    });
});
