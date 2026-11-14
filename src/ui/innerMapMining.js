// ============================================
// INNER MAP MINING — caves, drifts and shafts, and the rock cut by hand
// ============================================
// The work of world/innerMap/mines.js, done by the player on the street map
// and underground (tuning and wording: data/mining.json):
//
//   • A cave's mouth in a crag's face: walk to it and Enter the Cave.
//   • A rock face, from its foot: Dig into the Rock — stage by stage a drift
//     (each stage stone in the packs) until it is through: Enter the Drift.
//   • Open ground: Sink a Mine Shaft — stage by stage, the last lined with
//     timber and a ladder hung (materials in the packs): Climb Down.
//   • Underground: Cut into the Rock beside open ground — it lies as rubble,
//     any ore in it in the packs; Haul the Rubble Out — stone in the packs and
//     the cell open; pick up loose stones, break off crystal; Shore Up with
//     timbers (wood or planks). A cut with too many dug cells round it and no
//     timbers over them may bring the roof down (rubble again, and hurt if you
//     stand under it).
//
// Every piece of work is timed at the spot (ui/innerMapDigging.js start with
// `anywhere`: walking off stops it), costs energy (Endurance), trains Mining
// (systems/practiceSkills.js), and wants a pick (tools in the packs; a better
// one and the skill's blows perk cut faster). Goods come out of the hex's own
// rock (the geology of its terrain and resource): nothing from nowhere.
// Randomness: Utils (seedable).

import { InnerMap } from '../world/innerMap.js';
import { Mines } from '../world/innerMap/mines.js';
import { Utils } from '../core/utils.js';
import { PlayerInventory } from '../player/inventory.js';
import { PlayerEconomy } from '../player/playerEconomy.js';
import { PracticeSkills } from '../systems/practiceSkills.js';
import { audioManager } from '../systems/audio/index.js';
import { InnerMapDigging } from './innerMapDigging.js';
import { aditCell, shaftCell } from './caveArt.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function _note(game, title, text, type = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, text, type);
}

function _sfx(name) {
    try { audioManager.playSFX(name); } catch { /* sound is best-effort */ }
}

function _fill(line, vars) {
    return String(line || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
}

/** A good's display name. */
function _name(id) {
    const g = (PlayerEconomy.GOODS || {})[String(id).toUpperCase()];
    return (g && g.name) || String(id).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function _roll(range, d = 1) {
    const [a, b] = Array.isArray(range) ? range : [d, d];
    return Utils.randInt(Math.max(0, a), Math.max(a, b));
}

/** The first of a list of alternative costs ({ item: n }) the packs hold, or null. */
function _affordable(player, options) {
    const inv = (player && player.inventory) || {};
    for (const opt of options || []) {
        if (Object.entries(opt).every(([id, n]) => _num(inv[id]) >= n)) return opt;
    }
    return null;
}

function _pay(player, cost) {
    for (const [id, n] of Object.entries(cost || {})) {
        player.inventory[id] = _num(player.inventory[id]) - n;
        if (player.inventory[id] <= 0) delete player.inventory[id];
    }
}

const _costText = options => (options || []).map(o => Object.entries(o).map(([id, n]) => `${n} ${_name(id).toLowerCase()}`).join(' and ')).join(' or ');

export const InnerMapMining = {
    config() {
        return Mines.config();
    },

    /** The best pick in the packs: { item, name, mult } or null. */
    pickOf(player) {
        const inv = (player && player.inventory) || {};
        let best = null;
        for (const p of this.config().picks || []) {
            if (!p || !p.item || !(_num(inv[p.item]) > 0)) continue;
            const mult = _num(p.mult, 1);
            if (!best || mult > best.mult) best = { item: p.item, name: p.name || p.item, mult };
        }
        return best;
    },

    /** How fast the player breaks rock: the Mining skill's blows and the pick. */
    speedOf(player) {
        const pick = this.pickOf(player);
        return (1 + _num(PracticeSkills.perk(player, 'mining', 'blows')) / 100) * (pick ? pick.mult : 1);
    },

    /** Seconds of work for a kind of job (rock work is quicker with skill and a better pick). */
    secondsFor(player, kind) {
        const base = _num(this.config().seconds[kind], 5);
        return ['cut', 'adit', 'shaft'].includes(kind) ? base / this.speedOf(player) : base;
    },

    /** The light the player carries underground: its radius (px at zoom 1). */
    lightRadius(player) {
        const L = this.config().light;
        const inv = (player && player.inventory) || {};
        if (_num(inv.lantern) > 0) return _num(L.lantern, 140);
        if (_num(inv.candles) > 0) return _num(L.candles, 92);
        return _num(L.none, 46);
    },

    /** Can a shaft be sunk here: open, bare ground, at the ground's level (not a crag's top). */
    canSinkShaft(tile) {
        if (!tile || tile._isInterior || InnerMap._insideBuilding) return false;
        if (tile._shaft || tile._adit || tile._caveMouthOf) return false;
        if (InnerMap.standLevel(tile) !== 0) return false;
        return InnerMapDigging.canDig(tile);
    },

    // ══════════════════════════════════════════════
    // THE MENU
    // ══════════════════════════════════════════════

    /** The street map's or the underground's menu entries for a tile. */
    menuItems(game, tile, q, r) {
        if (!tile || !InnerMap.active) return [];
        if (InnerMap.isUnderground()) return this._underItems(game, tile, q, r);
        if (InnerMap._insideBuilding) return [];
        return this._surfaceItems(game, tile, q, r);
    },

    _surfaceItems(game, tile, q, r) {
        const out = [];
        const player = game && game.player;
        const pick = this.pickOf(player);
        const C = this.config();
        const mouth = InnerMap.caveMouthAt(q, r);
        if (mouth) {
            out.push({ type: 'header', label: '🕳️ A Cave' });
            out.push({ type: 'action', action: 'mine_enter', label: 'Enter the Cave', icon: '🕳️', desc: 'Into the dark under the rock. Carry a lantern or candles to see by', mineKind: 'cave', siteQ: mouth.q, siteR: mouth.r });
            return out;
        }
        const work = InnerMap.mineWorkAt(q, r);
        if (work && work.kind === 'adit') {
            out.push({ type: 'header', label: work.open ? '⛏️ Your Drift' : `⛏️ A Drift Begun (${work.stage}/${C.adit.stages})` });
            if (work.open) out.push({ type: 'action', action: 'mine_enter', label: 'Enter the Drift', icon: '⛏️', desc: 'Into your mine: every cell of it to be cut by hand', mineKind: 'adit', siteQ: q, siteR: r });
            else if (pick) out.push({ type: 'action', action: 'mine_adit', label: 'Cut on into the Rock', icon: '⛏️', desc: `Stage ${work.stage + 1} of ${C.adit.stages}: stone as you go`, siteQ: q, siteR: r });
            else out.push({ type: 'disabled', label: `⛏️ Cut on: ${C.text.noPick || 'you need a pick'}` });
            return out;
        }
        if (work && work.kind === 'shaft') {
            out.push({ type: 'header', label: work.open ? '🪜 Your Mine Shaft' : `🕳️ A Shaft Begun (${work.stage}/${C.shaft.stages})` });
            if (work.open) out.push({ type: 'action', action: 'mine_enter', label: 'Climb Down the Shaft', icon: '🪜', desc: 'Down the ladder into your mine', mineKind: 'shaft', siteQ: q, siteR: r });
            else if (!pick) out.push({ type: 'disabled', label: `⛏️ Sink it deeper: ${C.text.noPick || 'you need a pick'}` });
            else {
                const last = work.stage + 1 >= C.shaft.stages;
                const lining = last ? _affordable(player, C.shaft.lining) : true;
                const ladder = last ? _affordable(player, C.shaft.ladder) : true;
                if (last && (!lining || !ladder)) out.push({ type: 'disabled', label: `🪜 Line it and hang a ladder: needs ${_costText(C.shaft.lining)}, and ${_costText(C.shaft.ladder)}` });
                else out.push({ type: 'action', action: 'mine_shaft', label: last ? 'Line the Shaft and Hang a Ladder' : 'Sink the Shaft Deeper', icon: last ? '🪜' : '⛏️', desc: last ? `Uses ${Object.entries(lining).map(([id, n]) => `${n} ${_name(id).toLowerCase()}`).join(', ')} and ${Object.entries(ladder).map(([id, n]) => `${n} ${_name(id).toLowerCase()}`).join(', ')}` : `Stage ${work.stage + 1} of ${C.shaft.stages}: stone as you go`, siteQ: q, siteR: r });
            }
            return out;
        }
        if (InnerMap.canStartAdit(q, r)) {
            out.push({ type: 'header', label: '⛰️ Rock Face' });
            if (pick) out.push({ type: 'action', action: 'mine_adit', label: 'Dig into the Rock', icon: '⛏️', desc: `Cut a drift into the face (${C.adit.stages} stages): stone as you go, and a mine of your own behind it`, siteQ: q, siteR: r });
            else out.push({ type: 'disabled', label: `⛏️ Dig into the Rock: ${C.text.noPick || 'you need a pick'}` });
        } else if (pick && this.canSinkShaft(tile)) {
            out.push({ type: 'action', action: 'mine_shaft', label: 'Sink a Mine Shaft', icon: '🕳️', desc: `Dig down here (${C.shaft.stages} stages), line it with timber and hang a ladder: a mine of your own below`, siteQ: q, siteR: r });
        }
        return out;
    },

    _underItems(game, tile, q, r) {
        const out = [];
        const player = game && game.player;
        const C = this.config();
        const pick = this.pickOf(player);
        if (tile._cave === 'rock') {
            const vein = tile._vein;
            out.push({ type: 'header', label: vein ? `⛏️ ${_name(vein)} in the Rock` : tile._bedrock ? '🪨 Solid Rock' : '🪨 Rock' });
            if (tile._bedrock) {
                out.push({ type: 'disabled', label: 'The bones of the hill: too hard to cut' });
            } else if (!InnerMap.mineCanCut(q, r)) {
                out.push({ type: 'disabled', label: 'Cut it from open ground beside it' });
            } else if (!pick) {
                out.push({ type: 'disabled', label: `⛏️ ${C.text.noPick || 'You need a pick'}` });
            } else {
                const risk = InnerMap.mineRoofRisk(q, r);
                const warn = risk.chance > 0 ? ` The roof over the dug ground round it is unpropped: about ${Math.round(risk.chance * 100)}% it comes down.` : '';
                out.push({ type: 'action', action: 'mine_cut', label: vein ? `Cut Out the ${_name(vein)}` : 'Cut into the Rock', icon: '⛏️', desc: `Break it down to rubble to haul out${vein ? `, the ${_name(vein).toLowerCase()} into your packs` : ''}.${warn}` });
            }
            return out;
        }
        if (tile._cave === 'rubble') {
            out.push({ type: 'header', label: '🪨 Rubble' });
            out.push({ type: 'action', action: 'mine_haul', label: 'Haul the Rubble Out', icon: '🧺', desc: 'Clear it: the stone into your packs and the ground open' });
            return out;
        }
        if (tile._cave !== 'floor') return out;
        if (tile._loose === 'stone') out.push({ type: 'action', action: 'mine_loose', label: 'Pick Up the Loose Stones', icon: '🪨', desc: 'Stones fallen from the roof' });
        else if (tile._loose === 'crystal') {
            if (pick) out.push({ type: 'action', action: 'mine_loose', label: 'Break Off the Crystal', icon: '💎', desc: 'Crystal grown out of the rock: it fetches a price' });
            else out.push({ type: 'disabled', label: `💎 Break off the crystal: ${C.text.noPick || 'you need a pick'}` });
        }
        if (tile._support) {
            out.push({ type: 'header', label: '🪵 Mine Timbers' });
        } else if (tile._mined) {
            const cost = _affordable(player, C.support.cost);
            if (cost) out.push({ type: 'action', action: 'mine_prop', label: 'Shore Up with Timbers', icon: '🪵', desc: `Posts and a cap beam (${Object.entries(cost).map(([id, n]) => `${n} ${_name(id).toLowerCase()}`).join(', ')}): the roof holds for ${C.support.reach} cells round`, cost });
            else out.push({ type: 'disabled', label: `🪵 Shore up: needs ${_costText(C.support.cost)}` });
        }
        return out;
    },

    // ══════════════════════════════════════════════
    // THE WORK
    // ══════════════════════════════════════════════

    /** A mining action from the menu. True when it was one. */
    handle(game, item, q, r) {
        const a = item && item.action;
        if (!a || !/^mine_/.test(a)) return false;
        switch (a) {
            case 'mine_enter': this._goIn(game, item.mineKind, item.siteQ, item.siteR); return true;
            case 'mine_adit': this._work(game, 'adit', item.siteQ, item.siteR, 'Cutting into the rock', g => this._aditDone(g, item.siteQ, item.siteR)); return true;
            case 'mine_shaft': this._work(game, 'shaft', item.siteQ, item.siteR, 'Sinking the shaft', g => this._shaftDone(g, item.siteQ, item.siteR)); return true;
            case 'mine_cut': this._work(game, 'cut', q, r, 'Cutting the rock', g => this._cutDone(g, q, r)); return true;
            case 'mine_haul': this._work(game, 'haul', q, r, 'Hauling rubble', g => this._haulDone(g, q, r)); return true;
            case 'mine_loose': this._work(game, 'loose', q, r, 'Gathering', g => this._looseDone(g, q, r)); return true;
            case 'mine_prop': this._work(game, 'prop', q, r, 'Setting timbers', g => this._propDone(g, q, r)); return true;
            default: return false;
        }
    },

    _work(game, kind, q, r, verb, onDone) {
        const C = this.config();
        const player = game && game.player;
        const res = InnerMapDigging.start(game, `mine_${kind}`, q, r, {
            seconds: this.secondsFor(player, kind),
            verb,
            needs: C.needs[kind] || null,
            anywhere: true,
            onTile: kind === 'loose' || kind === 'prop',
            onDone: (g) => onDone(g || game),
        });
        if (res === 'unreachable') _note(game, 'Blocked', 'You can\'t reach that spot.', 'error');
        else if (kind === 'cut' || kind === 'adit' || kind === 'shaft') _sfx('pick');
        return res;
    },

    /** Mining practice for a piece of work; a level-up told. */
    _train(game, xp) {
        const player = game && game.player;
        if (!player || !(xp > 0)) return;
        const up = PracticeSkills.gain(player, 'mining', xp);
        if (up) _note(game, up.title || `${up.icon} ${up.name} Improved`, up.text, 'success');
    },

    /** Into the packs: what fits goes in. → [{ item, qty, ok }] */
    _give(game, items) {
        const player = game && game.player;
        const out = [];
        for (const [item, qty] of Object.entries(items)) {
            if (!(qty > 0)) continue;
            const ok = !!(player && PlayerInventory.addItem(player, item, qty).success);
            if (ok) InnerMap.mineCredit(item, qty);
            out.push({ item, qty, ok });
        }
        if (game && game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, game.world);
        return out;
    },

    _told(got) {
        return got.map(g => g.ok ? `+${g.qty} ${_name(g.item)}` : `${g.qty} ${_name(g.item)} left (no room)`).join(', ');
    },

    /** The extra stone of a practised hand (the skill's stone perk). */
    _stone(player, range) {
        let n = _roll(range, 2);
        const chance = _num(PracticeSkills.perk(player, 'mining', 'stone')) / 100;
        if (n > 0 && chance > 0 && Utils.random() < chance) n += Math.max(1, Math.round(n * 0.4));
        return n;
    },

    _goIn(game, kind, q, r) {
        const enter = () => {
            if (!InnerMap.enterUnderground(game, kind, q, r)) {
                _note(game, '🕳️ No Way In', 'You cannot get in there now.', 'warning');
                return;
            }
            const u = InnerMap._insideBuilding._underground;
            u.lightRadius = this.lightRadius(game.player);
            if (typeof game._configureInnerMapCamera === 'function') game._configureInnerMapCamera('outer');
            if (typeof game._updateBuildingExitButton === 'function') game._updateBuildingExitButton();
            const T = this.config().text;
            const dim = u.lightRadius <= _num(this.config().light.none, 46) ? ' You carry no light: you can barely see your hand.' : '';
            _note(game, kind === 'cave' ? '🕳️ The Cave' : kind === 'shaft' ? '🪜 Down the Shaft' : '⛏️ The Drift', (kind === 'cave' ? T.enterCave : kind === 'shaft' ? T.enterShaft : T.enterMine) + dim, 'info');
        };
        // A cave's mouth or a drift: from the foot of the face; a shaft: from beside it
        if (kind === 'shaft') {
            const res = InnerMap.approachAndThen(q, r, enter);
            if (res === 'unreachable') _note(game, 'Blocked', 'You can\'t reach that spot.', 'error');
            return;
        }
        const fq = q, fr = r + 1;
        if (InnerMap.playerInnerQ === fq && InnerMap.playerInnerR === fr && !InnerMap._playerWalking) { enter(); return; }
        InnerMap.cancelPlayerWalk();
        const walk = InnerMap.movePlayerTo(fq, fr);
        if (!walk || !walk.started) { _note(game, 'Blocked', (walk && walk.refused) || 'You can\'t reach that spot.', 'error'); return; }
        InnerMap._pendingAction = { q: fq, r: fr, run: () => { if (!InnerMap._insideBuilding) enter(); } };
    },

    _aditDone(game, q, r) {
        const C = this.config();
        const player = game.player;
        if (!InnerMap.canStartAdit(q, r) && !(InnerMap.mineWorkAt(q, r) || {}).kind) return;
        const st = InnerMap.advanceAdit(q, r);
        if (!st) return;
        const got = this._give(game, { stone: this._stone(player, C.adit.stone) });
        this._train(game, _num(C.xp.adit, 5));
        _sfx('rock_break');
        if (st.open) _note(game, '⛏️ The Drift Is Through', `The face gives onto dark rock beyond: a mine of your own (${this._told(got)}). Right-click it to go in.`, 'success');
        else _note(game, '⛏️ Into the Rock', `Stage ${st.stage} of ${C.adit.stages} (${this._told(got)}).`, 'info');
    },

    _shaftDone(game, q, r) {
        const C = this.config();
        const player = game.player;
        const tile = InnerMap.getTile(q, r);
        const work = InnerMap.mineWorkAt(q, r);
        if (!work && !this.canSinkShaft(tile)) { _note(game, '⛏️ Not There', 'You can\'t dig a shaft there now.', 'warning'); return; }
        const last = (work ? work.stage : 0) + 1 >= C.shaft.stages;
        if (last) {
            const lining = _affordable(player, C.shaft.lining);
            const ladder = _affordable(player, C.shaft.ladder);
            if (!lining || !ladder) { _note(game, '🪜 Not Yet', `To finish the shaft you need ${_costText(C.shaft.lining)}, and ${_costText(C.shaft.ladder)}.`, 'warning'); return; }
            _pay(player, lining);
            _pay(player, ladder);
        }
        const st = InnerMap.advanceShaft(q, r);
        if (!st) return;
        const got = last ? [] : this._give(game, { stone: this._stone(player, C.shaft.stone) });
        this._train(game, _num(C.xp.shaft, 5));
        _sfx('rock_break');
        if (st.open) _note(game, '🪜 The Shaft Is Sunk', 'Timbered and laddered: a mine of your own below. Right-click it to climb down.', 'success');
        else _note(game, '🕳️ Deeper', `Stage ${st.stage} of ${C.shaft.stages} (${this._told(got)}).`, 'info');
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
    },

    _cutDone(game, q, r) {
        const C = this.config();
        const player = game.player;
        const cut = InnerMap.mineCut(q, r);
        if (!cut) return;
        // What was in the rock: the vein's ore, or now and then a stray lump (the skill's ore perk)
        const items = {};
        let found = cut.vein && cut.vein !== 'stone' ? cut.vein : null;
        if (!found) {
            const m = InnerMap.mineHere();
            const chance = _num(C.cell.strayChance, 0.08) + _num(PracticeSkills.perk(player, 'mining', 'ore')) / 200;
            if (m && Utils.random() < chance) {
                const table = Mines.veinTable(m.under.terrainId, m.under.resource);
                found = Mines.pickVein(table, Utils.random());
                if (found === 'stone') found = null;
            }
        }
        if (found) items[found] = _roll(C.cell.veinQty, 1);
        const got = Object.keys(items).length ? this._give(game, items) : [];
        this._train(game, _num(C.xp.cut, 4) + (found ? _num(C.xp.vein, 6) : 0));
        _sfx('rock_break');
        // The roof over the dug ground: the weight unpropped may bring it down
        const risk = InnerMap.mineRoofRisk(q, r);
        if (risk.chance > 0 && Utils.random() < risk.chance) {
            this._caveIn(game, q, r);
            return;
        }
        const told = got.length ? ` ${this._told(got)}.` : '';
        const creak = risk.open > _num(C.support.free, 4) ? ` ${C.text.unsupported || ''}` : '';
        _note(game, found ? `⛏️ ${_name(found)}` : '⛏️ Rock Cut', `The rock breaks away: rubble to haul out.${told}${creak}`, found ? 'success' : (creak ? 'warning' : 'info'));
    },

    _caveIn(game, q, r) {
        const C = this.config();
        const player = game.player;
        const down = InnerMap.mineCollapse(q, r, () => Utils.random());
        _sfx('rock_break');
        let hurt = '';
        if (down.some(c => c.q === InnerMap.playerInnerQ && c.r === InnerMap.playerInnerR)) {
            // Out from under it: to the nearest open ground, hurt
            const spot = this._openNear(InnerMap.playerInnerQ, InnerMap.playerInnerR);
            if (spot) { InnerMap.playerInnerQ = spot.q; InnerMap.playerInnerR = spot.r; InnerMap.cancelPlayerWalk(); }
            const hp = _roll(C.support.hurt, 5);
            if (player && Number.isFinite(player.health)) player.health = Math.max(0, player.health - hp);
            hurt = ' ' + _fill(C.text.caveInHurt || '(-{hp} health)', { hp });
            if (player && player.health <= 0 && typeof game._triggerDeath === 'function') setTimeout(() => game._triggerDeath('a cave-in'), 0);
        }
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
        _note(game, '⚠️ Cave-in!', `${C.text.caveIn || 'The roof comes down.'}${hurt} Shore the dug ground up with timbers.`, 'error');
    },

    /** The nearest open floor to (q, r), not (q, r) itself. */
    _openNear(q, r) {
        for (let d = 1; d <= 4; d++) {
            for (let y = -d; y <= d; y++) for (let x = -d; x <= d; x++) {
                if (Math.max(Math.abs(x), Math.abs(y)) !== d) continue;
                const t = InnerMap.getTile(q + x, r + y);
                if (t && (t._cave === 'floor' || t._cave === 'exit')) return { q: q + x, r: r + y };
            }
        }
        return null;
    },

    _haulDone(game, q, r) {
        const C = this.config();
        const player = game.player;
        const t = InnerMap.getTile(q, r);
        if (!t || t._cave !== 'rubble') return;
        if (player && !PlayerInventory.canAdd(player, 'stone')) {
            _note(game, '🎒 Packs Full', `${C.text.packsFull || 'Your packs are full.'} ${PlayerInventory.fullMessage(player)}`, 'warning');
            return;
        }
        const got = this._give(game, { stone: this._stone(player, C.cell.stone) });
        if (got.length && !got[0].ok) { _note(game, '🎒 Packs Full', C.text.packsFull || 'Your packs are full.', 'warning'); return; }
        InnerMap.mineHaul(q, r);
        this._train(game, _num(C.xp.haul, 1));
        _note(game, '🧺 Cleared', `The rubble hauled out: ${this._told(got)}.`, 'info');
    },

    _looseDone(game, q, r) {
        const player = game.player;
        const t = InnerMap.getTile(q, r);
        const what = t && t._loose;
        if (!what) return;
        const items = what === 'crystal' ? { gems: 1 } : { stone: _roll([1, 3], 2) };
        if (player && !PlayerInventory.canAdd(player, Object.keys(items)[0])) {
            _note(game, '🎒 Packs Full', PlayerInventory.fullMessage(player), 'warning');
            return;
        }
        InnerMap.mineTakeLoose(q, r);
        const got = this._give(game, items);
        if (what === 'crystal') this._train(game, _num(this.config().xp.vein, 6));
        _note(game, what === 'crystal' ? '💎 Crystal' : '🪨 Stones', `${this._told(got)}.`, what === 'crystal' ? 'success' : 'info');
    },

    _propDone(game, q, r) {
        const C = this.config();
        const player = game.player;
        const cost = _affordable(player, C.support.cost);
        if (!cost) { _note(game, '🪵 No Timber', `You need ${_costText(C.support.cost)}.`, 'warning'); return; }
        if (!InnerMap.mineProp(q, r)) return;
        _pay(player, cost);
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
        _note(game, '🪵 Timbered', `Posts and a cap beam set: the roof holds for ${C.support.reach} cells round.`, 'info');
    },

    // ══════════════════════════════════════════════
    // RENDER — drifts and shafts on the street map; underground, the work's ring and the bats
    // ══════════════════════════════════════════════

    /** renderer: the InnerMapRenderer drawing (ui/innerMapLayers/entities.js hands itself in). */
    renderGround(ctx, camera, range, T, renderer) {
        if (!InnerMap.tiles) return;
        const ds = T * camera.zoom;
        const sz = Math.ceil(ds) + 1;
        const { qMin, qMax, rMin, rMax } = range;
        if (!InnerMap._insideBuilding) {
            const C = this.config();
            for (let r = Math.max(0, rMin); r <= Math.min(InnerMap.height - 1, rMax); r++) {
                const row = InnerMap.tiles[r];
                if (!row) continue;
                for (let q = Math.max(0, qMin); q <= Math.min(InnerMap.width - 1, qMax); q++) {
                    const t = row[q];
                    if (!t || !t.explored || (!t._adit && !t._shaft)) continue;
                    const cell = t._adit ? aditCell(t._adit.stage, C.adit.stages, t._adit.open) : shaftCell(t._shaft.stage, C.shaft.stages, t._shaft.open);
                    if (!cell) continue;
                    const s = camera.worldToScreenFast(q * T, r * T);
                    if (renderer && renderer.drawCaveCell) renderer.drawCaveCell(ctx, cell, Math.floor(s.x), Math.floor(s.y), sz);
                }
            }
            return;
        }
        if (!InnerMap.isUnderground()) return;
        // The work under way: a ring filling round the spot (the digging layer draws none indoors)
        const job = InnerMapDigging._job;
        if (job && job.t != null && job.anywhere) {
            const s = camera.worldToScreenFast(job.q * T + T / 2, job.r * T + T / 2);
            ctx.save();
            ctx.lineWidth = Math.max(2, ds * 0.07);
            ctx.strokeStyle = 'rgba(0,0,0,0.45)';
            ctx.beginPath();
            ctx.arc(s.x, s.y, ds * 0.42, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = '#f5c542';
            ctx.beginPath();
            ctx.arc(s.x, s.y, ds * 0.42, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * InnerMapDigging.progress());
            ctx.stroke();
            ctx.restore();
        }
        this._renderBats(ctx, camera, T);
    },

    /** A few bats wheeling in a cave's dark (only a cave: a mine is too new for them). */
    _renderBats(ctx, camera, T) {
        const u = InnerMap._insideBuilding._underground;
        if (!u || u.kind !== 'cave') return;
        const n = Math.round(_num(this.config().map.bats, 0.5) * 6);
        if (!n) return;
        const now = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) / 1000;
        const ds = T * camera.zoom;
        ctx.save();
        ctx.fillStyle = '#120c0a';
        for (let i = 0; i < n; i++) {
            // each wheels round its own roost (from the cave's seed), flapping
            const seed = (u.seed >>> (i % 16)) ^ (i * 2654435761);
            const cx = (8 + (seed % 24)) * T, cy = (6 + ((seed >>> 5) % 24)) * T;
            const a = now * (0.5 + (i % 3) * 0.17) + i;
            const x = cx + Math.cos(a) * T * 3, y = cy + Math.sin(a * 1.3) * T * 2;
            const t = InnerMap.getTile(Math.floor(x / T), Math.floor(y / T));
            if (!t || !t.explored || t._cave === 'rock') continue;
            const s = camera.worldToScreenFast(x, y);
            const flap = Math.sin(now * 14 + i) * 0.5 + 0.5;
            const w = ds * 0.22, h = ds * (0.04 + flap * 0.1);
            ctx.beginPath();
            ctx.moveTo(s.x - w, s.y - h);
            ctx.quadraticCurveTo(s.x - w * 0.4, s.y + h * 0.2, s.x, s.y);
            ctx.quadraticCurveTo(s.x + w * 0.4, s.y + h * 0.2, s.x + w, s.y - h);
            ctx.quadraticCurveTo(s.x + w * 0.4, s.y + ds * 0.03, s.x, s.y + ds * 0.05);
            ctx.quadraticCurveTo(s.x - w * 0.4, s.y + ds * 0.03, s.x - w, s.y - h);
            ctx.fill();
        }
        ctx.restore();
    },
};
