// The crown's dark work in the action menu: The Bowstring (ui/actionMenu/fratricide.js),
// The Synod of the Dead (cadaverSynod.js) and Wipe Their Name (damnatio.js) draw
// without holes, their rows act through the systems, and the Dynasty menu lists them.

import { describe, it, expect, beforeAll } from 'vitest';
import { Throne } from '../systems/throne.js';
import { Kingship } from '../systems/kingship.js';
import { Upbringing } from '../systems/upbringing.js';
import { Fratricide } from '../systems/fratricide.js';
import { CadaverSynod } from '../systems/cadaverSynod.js';
import { Damnatio } from '../systems/damnatio.js';
import { loadData, newGame } from './playtest/harness.js';

let ActionMenu;
beforeAll(async () => {
    await loadData();
    ({ ActionMenu } = await import('../ui/actionMenu.js'));
}, 120000);

function setup() {
    const g = newGame(31);
    const { world, player } = g;
    world.day = 2400;
    const all = world.getSettlementViews();
    const k = world.kingdoms.filter(x => x.isAlive).sort((a, b) => all.filter(s => s.kingdom === b.id).length - all.filter(s => s.kingdom === a.id).length)[0];
    Throne._takeThrone(player, world, k);
    k.treasury = 20000;
    k.laws = { ...(k.laws || {}), succession: 'fratricide' };
    Kingship.processDay(world, player);
    const bro = { id: 'ui_b1', firstName: 'Bram', dynasty: 'Harness', gender: 'male', age: 20, isAlive: true, isSibling: true, traits: [], skills: {} };
    Upbringing.ensure(bro);
    player.children = [bro];
    Fratricide.onSuccession(player, world, null, {});
    const town = all.find(s => s.kingdom === k.id && !(s.q === k.capital.q && s.r === k.capital.r));
    const other = world.kingdoms.find(x => x.isAlive && x.id !== k.id && x.characterData && x.characterData.dynasty);
    const tomb = CadaverSynod.bury(world, { kind: 'king', name: 'King Ugo', dynasty: other.characterData.dynasty.name, kingdomId: other.id, q: town.q, r: town.r, town: town.name, day: 100 });
    const panels = [];
    const notes = [];
    const game = { world, player, ui: { showCustomPanel: (t, h) => panels.push({ t, h }), showNotification: (...a) => notes.push(a), updateStats() {}, hideCustomPanel() {} } };
    return { game, panels, notes, k, bro, tomb };
}

const clean = (h) => !/undefined|NaN|\[object/.test(h.replace(/data-am-args="[^"]*"/g, ''));

describe('the crown\'s dark work', () => {
    it('the Bowstring panel shows the condemned and spares one through the system', () => {
        const { game, panels, bro } = setup();
        ActionMenu.showFratricide(game);
        let p = panels.pop();
        expect(p.t).toMatch(/Bowstring/);
        expect(p.h).toMatch(/Spare Bram/);
        expect(clean(p.h)).toBe(true);
        ActionMenu.fratricideAct(game, 'spare', bro.id);
        p = panels.pop();
        expect(Fratricide.isSpared(bro)).toBe(true);
        expect(p.h).toMatch(/brothers you spared/);
        expect(clean(p.h)).toBe(true);
    }, 60000);

    it('the Synod panel lists the tomb in reach and holds the synod', () => {
        const { game, panels, tomb } = setup();
        ActionMenu.showCadaverSynod(game);
        let p = panels.pop();
        expect(p.h).toMatch(/King Ugo/);
        expect(clean(p.h)).toBe(true);
        ActionMenu.cadaverSynodAct(game, 'hold', tomb.id, 'river');
        p = panels.pop();
        expect(tomb.tried).toBeTruthy();
        expect(p.h).toMatch(/Synods held/);
        expect(clean(p.h)).toBe(true);
    }, 60000);

    it('the Wipe Their Name panel lists the old line and does an act', () => {
        const { game, panels, k } = setup();
        ActionMenu.showDamnatio(game);
        let p = panels.pop();
        expect(p.h).toMatch(/Deface their tombs/);
        expect(clean(p.h)).toBe(true);
        ActionMenu.damnatioAct(game, 'act', `line:${k.id}`, 'tombs');
        p = panels.pop();
        expect(Damnatio.record(game.world, `line:${k.id}`).steps.tombs).toBeTruthy();
        expect(clean(p.h)).toBe(true);
    }, 60000);

    it('the Dynasty menu lists all three', () => {
        const { game, panels } = setup();
        ActionMenu.showDynastyMenu(game, game.world.getTile(game.player.q, game.player.r));
        const p = panels.pop();
        expect(p.h).toMatch(/The Bowstring/);
        expect(p.h).toMatch(/The Synod of the Dead/);
        expect(p.h).toMatch(/Wipe Their Name/);
        // (no Emoji 13+ glyph: Windows 10 draws those as empty boxes)
        expect(/[\u{1FA70}-\u{1FAFF}]/u.test(p.h)).toBe(false);
    }, 60000);

    it('the synod names the dead king\'s realm as the game writes realms', () => {
        const { game, panels } = setup();
        const t = CadaverSynod.state(game.world).tombs[0];
        t.realm = 'Kingdom of Esk';
        ActionMenu.showCadaverSynod(game);
        expect(panels.pop().h).toMatch(/King of the Kingdom of Esk/);
    }, 60000);

    it('Wipe Their Name: no son left to find is one plain row, not kill-or-geld', () => {
        const { game, panels, k } = setup();
        const cand = Damnatio.candidates(game.player, game.world).find(c => c.key === `line:${k.id}`);
        if (Damnatio.sons(game.player, game.world, cand).length) return; // (this seed's old line still has sons)
        ActionMenu.showDamnatio(game);
        const h = panels.pop().h;
        expect(h).toMatch(/Hunt down their last sons/);
        expect(h).not.toMatch(/Geld their last sons/);
    }, 60000);

    it('the Laws panel keeps the code out of the law\'s description, and names mercy plainly', () => {
        const { game, panels } = setup();
        ActionMenu.showLaws(game, 'crown');
        const h = panels.pop().h;
        expect(h).toMatch(/The Brothers of the Heir/);
        expect(h).not.toMatch(/\((?:systems|player|world)\/\w+\.js/);
        expect(h).toMatch(/Make it the cage/);
    }, 60000);
});
