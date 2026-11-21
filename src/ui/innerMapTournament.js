// ============================================
// INNER MAP — the lists: a tournament fought in person on the street map
// ============================================
// When a tournament is held in a town today — the town's own (systems/lists.js
// townTourney: announced by the herald a few days before) or one the player
// holds from the menu (ui/actionMenu/realm.js → `player.lists.held`) — the
// town's street map gets its lists (world/innerMap/lists.js listsSite): the
// tilt barrier, the stands full of townsfolk, a pavilion at either end, the
// banners, the herald.
//
// The herald's menu (any cell of the lists): 📯 Enter the Lists (the fee into
// the sponsor's purse — the crown's for a capital, else the town's), then the
// bracket of Duels.tournamentField, each bout fought one of these ways:
//
//   THE JOUST (bouts 1 and 3 by data/lists.json boutKinds) — mounted on your
//     own horse, or a destrier hired from the town's stables (to the town).
//     You and your man charge along the barrier; the lance-meter runs across
//     the bottom of the screen and the lance tip wobbles: SPACE (or a click)
//     strikes — in the green, with the tip steady, is a good strike
//     (Lists.strikeQuality). Miss, glance, broken lance, unhorsed; best of
//     three passes.
//   THE MELEE (bout 2) — on foot in the ring with blunted steel: the street's
//     own combat (ui/innerMapCombat.js) against the knight (an NPC with his
//     duel profile, `_duelProfile`, and `_taskFoe`: no crime, nobody dies).
//     A fighter yields at Lists melee.yieldAt of their health; floored is
//     beaten (the `_taskFoe.onFloored` hook). Your bruises are booked as the
//     bracket's harm (your health put back, then Duels.settleTournament).
//   The duel panel, or Quick Results (the rest by instinct): the old path.
//
// The crowd cheers and groans (its mood follows how you do; a crowd that
// loves you is a point of renown), and a bookie in the crowd takes a wager on
// you winning it all — the stake into their own purse, the winnings out of it.
// Not entered: the knights of the field joust each other while you watch
// (Lists.autoJoust on a hash stream: the same passes every time).
//
//   eventHere(game)            today's tournament on this map, or null
//   menuItems / handle         the herald's menu (lists_* actions, innerMapUI.js)
//   update(dt, game)           from game/gameLoop.js
//   key / click                SPACE / a click strikes during a pass
//   collect(items, …)          the field, its people and the HUD (innerMapLayers/entities.js)
//   hidesPlayer()              while you ride a pass you are drawn as the rider

import { InnerMap } from '../world/innerMap.js';
import { Utils } from '../core/utils.js';
import { PlayerCoin } from '../player/playerCoin.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { Duels } from '../systems/duels.js';
import { Lists } from '../systems/lists.js';
import { Rivals } from '../systems/rivals.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { Brawls } from '../systems/brawls.js';
import { AnimalCompanions } from '../systems/animalCompanions.js';
import { InnerMapRenderer } from './innerMapRenderer.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { InnerMapPets } from './innerMapPets.js';
import { InnerMapBattle } from './innerMapBattle.js';
import { InnerMapEscort } from './innerMapEscort.js';
import { InnerMapReactions } from './innerMapReactions.js';
import { DuelPanel } from './actionMenu/duel.js';
import { esc, lede, chips, rowList, purse, price } from './actionMenu/uiKit.js';
import { drawMapText } from './mapInk.js';

const BOUT_NAMES = ['Opening bout', 'Semi-final', 'The final'];
const T_PX = 32;
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const _now = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) / 1000;
const OUTCOME_WORD = { miss: 'Miss', glance: 'Glancing blow', broken: 'Lance broken!', unhorsed: 'Unhorsed!' };

// Heraldic tinctures: field and charge
const TINCTURES = [
    ['#a3242a', '#f1e4c0'], ['#1f3e8c', '#e9c548'], ['#2f6b36', '#f3efe3'], ['#5c2b7b', '#e9c548'],
    ['#1b1b1d', '#dcdcdc'], ['#c46d1d', '#2a2a2a'], ['#e9c548', '#a3242a'], ['#f1e4c0', '#1f3e8c'],
];

function _notify(game, title, text, kind = 'info') {
    const ui = game && game.ui;
    if (ui && typeof ui.showNotification === 'function') ui.showNotification(title, text, kind);
}

function _settlementHere() {
    return (InnerMap._currentWorldTileRef && InnerMap._currentWorldTileRef.settlement)
        || (InnerMap.currentWorldTile && InnerMap.currentWorldTile.settlement) || null;
}

function _day(game) {
    return Math.floor(_num(game && game.world && game.world.day, 0));
}

/** A plain record of a combatant (for player.lists: no references). */
function _profileOf(c) {
    return {
        id: c.id, kind: c.kind, name: c.name, title: c.title || '', icon: c.icon,
        attack: c.attack, defense: c.defense, power: c.power, hp: c.maxHp, stamina: c.maxStamina,
        armour: c.armour, weapon: c.weapon, weaponDmg: c.weaponDmg, temperament: c.temperament, skill: c.skill,
        rivalId: c.kind === 'rival' && c.ref ? c.ref.id : null,
    };
}

function _fromProfile(p, player) {
    const c = Duels.fromProfile(p);
    c.title = p.title || '';
    if (p.rivalId != null && player) c.ref = Rivals.get(player, p.rivalId) || null;
    return c;
}

export const InnerMapTournament = {
    _site: null,
    _siteFor: null,
    _run: null,       // your bracket today: { key, day, ev, field, bouts, payer, armour, wager, crowd }
    _joust: null,     // a pass you ride: { opp, me, them, st, phase, t, strike, pass, horse }
    _melee: null,     // a melee you fight: { opp, npc, hpBefore, maxHealth, foeMax, over }
    _watch: null,     // the knights jousting each other while you watch
    _barks: [],       // { q, r, text, until, color }
    _fx: [],          // splinters: { x, y, vx, vy, age }
    _cheerUntil: 0,
    _told: new Set(),
    _seq: 0,
    _knights: new Map(),
    _game: null,

    // ──────────── TODAY'S TOURNAMENT ────────────

    /**
     * Today's tournament at `settlement` (pure: world day, the player's record):
     * { key, day, host: 'player' | 'town', prizePool, fee, baseRenown, compete } or null.
     */
    eventFor(player, settlement, day) {
        if (!settlement) return null;
        const key = Lists.townKey(settlement);
        const held = player && player.lists && player.lists.held;
        if (held && held.key === key && held.day === day) {
            return { key, day, host: 'player', prizePool: _num(held.prizePool), fee: 0, baseRenown: _num(held.baseRenown), compete: !!held.compete };
        }
        const t = Lists.townTourney(settlement, day);
        return t ? { ...t, baseRenown: 0, compete: false } : null;
    },

    /** Today's tournament on this street map, with its field, when the lists stand (else null). */
    eventHere(game) {
        if (!InnerMap.active || InnerMap._insideBuilding || InnerMap._underwater || !game || !game.player) return null;
        if (InnerMapBattle.active || game.player.boardedShip) return null;
        const s = _settlementHere();
        const ev = this.eventFor(game.player, s, _day(game));
        if (!ev) return null;
        // (a town's own lists stand by day; yours, and any you are fighting in, all day)
        const mine = this.run(game);
        const fighting = mine && mine.key === ev.key && mine.day === ev.day;
        if (ev.host === 'town' && !fighting && !Lists.open(InnerMap.timeOfDay)) return null;
        const site = this.site();
        return site ? { ...ev, site, settlement: s } : null;
    },

    /** The lists' layout on this map (cached per map). */
    site() {
        if (this._siteFor !== InnerMap.tiles) {
            this._siteFor = InnerMap.tiles;
            const wt = InnerMap.currentWorldTile || {};
            this._site = InnerMap.listsSite ? InnerMap.listsSite(InnerMap.tiles, _num(wt.q), _num(wt.r)) : null;
            this._watch = null;
        }
        return this._site;
    },

    /** The bracket a tournament fields: the named rivals near (when you enter), knights for the rest; same knights for the same day. */
    fieldFor(game, ev, withRivals = false) {
        const s = ev.settlement || _settlementHere();
        let entrants = [];
        if (withRivals && game && game.player && game.world) {
            const tile = game.world.getTile ? game.world.getTile(game.player.q, game.player.r) : null;
            try {
                entrants = Rivals.entrantsNear(game.player, game.world, tile, 2).map(r => Duels.fromRival(r, { archetype: Rivals.archetype(r.archetype) }));
            } catch (e) { entrants = []; }
        }
        return Duels.tournamentField(s, entrants, { rng: Lists.stream(`${ev.key}|${ev.day}|field`) });
    },

    /** Your bracket today (resumed from player.lists after a load), or null. */
    run(game) {
        const player = game && game.player;
        const rec = player && player.lists;
        const ev = this._run ? this._run.ev : null;
        if (this._run && rec && rec.key === this._run.key && rec.day === this._run.day) return this._run;
        this._run = null;
        if (!rec || !rec.entered || rec.done || rec.day !== _day(game) || !Array.isArray(rec.field)) return null;
        const s = _settlementHere();
        if (!s || Lists.townKey(s) !== rec.key) return null;
        const field = rec.field.map(p => _fromProfile(p, player));
        const evNow = ev || this.eventFor(player, s, rec.day) || { key: rec.key, day: rec.day, host: 'town', prizePool: _num(rec.prizePool), fee: 0, baseRenown: 0 };
        this._run = {
            key: rec.key, day: rec.day, ev: { ...evNow, settlement: s }, field,
            bouts: (rec.bouts || []).map((b, i) => ({ opponent: field[i], result: { playerWon: !!b.won, aLost: _num(b.aLost), yielded: b.yielded || null, kind: b.kind } })),
            payer: evNow.host === 'town' ? Lists.sponsor(s, game.world) : null,
            armour: Duels.fromPlayer(player, { mods: PlayerEffects.duelModifiers(player) }).armour,
            wager: rec.wager ? { ...rec.wager, person: s.folk ? Townsfolk.get(s.folk, rec.wager.personId) : null } : null,
            crowd: _num(rec.crowd),
        };
        return this._run;
    },

    // ──────────── THE HERALD'S MENU ────────────

    menuItems(game, tile, q, r) {
        const ev = this.eventHere(game);
        if (!ev || !InnerMap.onLists(ev.site, q, r)) return [];
        const player = game.player;
        const rec = player.lists && player.lists.day === ev.day && player.lists.key === ev.key ? player.lists : null;
        const out = [{ type: 'separator' }, { type: 'header', label: `🏟️ The Lists at ${ev.settlement.name || 'the town'} — ${ev.host === 'player' ? 'your tournament' : 'the town\'s tournament'}` }];
        if (this._joust || this._melee) {
            out.push({ type: 'disabled', label: '⚔️ A bout is under way' });
            return out;
        }
        if (rec && rec.done) {
            out.push({ type: 'disabled', label: '🏁 You have ridden today\'s lists' });
        } else if (ev.host === 'player' && !ev.compete) {
            out.push({ type: 'disabled', label: '🏟️ You host these lists: you watch from the stands' });
        } else if (rec && rec.entered) {
            out.push({ type: 'action', action: 'lists_bracket', label: 'To Your Next Bout', icon: '📯', desc: `${BOUT_NAMES[(rec.bouts || []).length] || 'The bracket'}: the herald calls you` });
        } else {
            const fee = ev.host === 'town' ? ev.fee : 0;
            const short = _num(player.gold) < fee;
            if (short) out.push({ type: 'disabled', label: `📯 Enter the Lists — the fee is ${Utils.formatGold(fee)} gold` });
            else {
                out.push({
                    type: 'action', action: 'lists_enter', label: 'Enter the Lists', icon: '📯',
                    desc: `${fee ? `Entry ${Utils.formatGold(fee)} gold to the ${ev.settlement.type === 'capital' ? 'crown' : 'town'}; ` : ''}the champion takes ${Utils.formatGold(ev.prizePool)} gold. Joust and melee in person`,
                });
            }
        }
        out.push({ type: 'action', action: 'lists_watch', label: 'Watch from the Rail', icon: '👀', desc: 'Stand with the crowd and watch the knights ride' });
        return out;
    },

    handle(game, item) {
        if (!item || typeof item.action !== 'string' || !item.action.startsWith('lists_')) return false;
        if (item.action === 'lists_enter') { this.enter(game); return true; }
        if (item.action === 'lists_bracket') { this.showBracket(game); return true; }
        if (item.action === 'lists_watch') {
            const ev = this.eventHere(game);
            if (ev) {
                const spot = this._standSpot(ev.site, ev.site.herald.q + 2, ev.site.herald.r);
                if (spot) InnerMap.movePlayerTo(spot.q, spot.r);
            }
            return true;
        }
        return false;
    },

    /**
     * Enter today's tournament: the fee paid into the sponsor's purse (a town's
     * own; nothing more for one you hold), the bracket drawn. → the run, or null.
     */
    enter(game, evIn = null) {
        const ev = evIn || this.eventHere(game);
        const player = game && game.player;
        if (!ev || !player) return null;
        const rec = player.lists && player.lists.day === ev.day && player.lists.key === ev.key ? player.lists : null;
        if (rec && rec.done) return null;
        if (rec && rec.entered) { this.showBracket(game); return this.run(game); }
        const payer = ev.host === 'town' ? Lists.sponsor(ev.settlement, game.world) : null;
        const fee = ev.host === 'town' ? _num(ev.fee) : 0;
        if (fee > 0) {
            if (_num(player.gold) < fee) { _notify(game, '📯 The Fee', `The herald wants ${Utils.formatGold(fee)} gold to enter.`, 'warning'); return null; }
            PlayerCoin.pay(game.world, player, fee, payer || ev.settlement, 'tournament');
        }
        const field = this.fieldFor(game, ev, true);
        player.lists = {
            ...(player.lists || {}),
            day: ev.day, key: ev.key, entered: true, done: false, prizePool: ev.prizePool,
            field: field.map(_profileOf), bouts: [], wager: null, crowd: 0,
        };
        this._run = {
            key: ev.key, day: ev.day, ev, field, bouts: [], payer,
            armour: Duels.fromPlayer(player, { mods: PlayerEffects.duelModifiers(player) }).armour,
            wager: null, crowd: 0,
        };
        this._bark(ev.site.herald, Lists.bark('herald', Lists.hash(ev.key, 'cry', 1)), 3);
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
        this.showBracket(game);
        return this._run;
    },

    // ──────────── THE BRACKET ────────────

    /** The kind of the next bout (data boutKinds). */
    _kindOf(i) {
        const k = Lists.config().boutKinds || [];
        return k[i] || 'joust';
    },

    /** A horse to ride: { own: true, name } (yours with you), or null (hire one). */
    _horse(game) {
        const m = InnerMapPets.mounted();
        if (m && m.a) return { own: true, name: m.a.name, m };
        const pet = (InnerMapPets._pets || []).find(p => p.a && InnerMapPets._rideCfg(p.a) && !p.stay
            && !(AnimalCompanions.isYoung && AnimalCompanions.isYoung(p.a, game.world)));
        return pet ? { own: true, name: pet.a.name, m: pet } : null;
    },

    /** The bookie in the crowd: the best-pursed grown townsperson on the map near the lists, or null. */
    _bookie(game, run) {
        const s = run.ev.settlement;
        if (!s || !s.folk) return null;
        if (!Brawls.betting(game.world, s).legal) return null;
        const L = run.ev.site;
        const cq = L ? L.q0 + L.w / 2 : InnerMap.playerInnerQ, cr = L ? L.r0 + L.h / 2 : InnerMap.playerInnerR;
        const adults = (InnerMap.npcs || []).filter(n => n._person && n.type !== 'child' && !(Number(n._person.age) < 16)
            && n.state !== 'unconscious' && n.state !== 'bound' && !n._taskFoe && Math.max(Math.abs(n.q - cq), Math.abs(n.r - cr)) <= 40);
        adults.sort((a, b) => Townsfolk.purse(s.folk, b._person, game.world) - Townsfolk.purse(s.folk, a._person, game.world) || a.id - b.id);
        return adults[0] || null;
    },

    showBracket(game) {
        const run = this.run(game);
        const player = game && game.player;
        if (!run || !player || !game.ui || typeof game.ui.showCustomPanel !== 'function') return;
        const i = run.bouts.length;
        if (i >= run.field.length || (i > 0 && !run.bouts[i - 1].result.playerWon)) { this.finish(game); return; }
        const opp = run.field[i];
        const kind = this._kindOf(i);
        const T = Duels.config().tournament;
        let h = '<div>';
        h += lede(`🏟️ <b>The Lists at ${esc(run.ev.settlement.name || 'the town')}</b>${i > 0 ? ` · <span style="color:#8fd18a;">✓ You beat ${esc(run.bouts[i - 1].opponent.name)}.</span>` : ''}`);
        const mood = run.crowd >= 0.5 ? 'roaring for you' : run.crowd >= 0.15 ? 'warming to you' : run.crowd <= -0.3 ? 'jeering' : 'watching';
        h += chips([
            { icon: '🏆', label: 'Champion takes', value: `${Utils.formatGold(run.ev.prizePool)}g`, cls: 'gold' },
            ['🥈', 'Runner-up', `${Utils.formatGold(Math.floor(run.ev.prizePool * _num(T.runnerUpShare, 0.4)))}g`],
            ['📣', 'The crowd', mood],
            run.wager ? ['🎲', 'Your wager', `${Utils.formatGold(run.wager.stake)}g at ${run.wager.odds}×`] : null,
            purse(player.gold),
        ]);
        h += rowList(run.field.map((o, k) => {
            const T2 = Duels.temperament(o.temperament);
            const mark = k < i ? '✓' : k === i ? '▶' : '·';
            return {
                icon: o.icon, name: `${mark} ${BOUT_NAMES[k]}: ${esc(o.name)}`,
                desc: `${esc(o.title || '')} · ${this._kindOf(k) === 'joust' ? '🐎 the joust' : '🗡️ the melee'} · ${T2.icon || ''} ${esc(T2.label || '')}`,
                side: k < i ? 'won' : k === i ? 'next' : '', tone: k < i ? 'good' : k === i ? 'gold' : '',
            };
        }), 'The bracket:');
        const rows = [];
        const horse = this._horse(game);
        const hire = _num(Lists.config().hireHorse, 15);
        if (kind === 'joust') {
            if (horse) rows.push({ icon: '🐎', name: `Ride at ${esc(opp.name)}`, desc: `On ${esc(horse.name)}: three passes along the barrier. SPACE or click to strike as you close`, attrs: 'onclick="window._lists.joust(false)"', tone: 'gold', side: '›' });
            else rows.push({ icon: '🐎', name: `Hire a destrier and ride at ${esc(opp.name)}`, desc: 'A horse from the town\'s stables for the day. SPACE or click to strike as you close', attrs: 'onclick="window._lists.joust(true)"', off: _num(player.gold) < hire, why: `A destrier is ${hire} gold`, tone: 'gold', side: price(hire, _num(player.gold) >= hire) });
            rows.push({ icon: '🗡️', name: 'Fight it on foot instead', desc: 'The melee in the ring: blunted steel, a fighter may yield', attrs: 'onclick="window._lists.melee()"', side: '›' });
        } else {
            rows.push({ icon: '🗡️', name: `The melee with ${esc(opp.name)}`, desc: 'On foot in the ring: blunted steel; yield when beaten, nobody dies', attrs: 'onclick="window._lists.melee()"', tone: 'gold', side: '›' });
        }
        rows.push({ icon: '⚔️', name: 'Fight in the duel panel', desc: 'Strike, thrust, feint and guard, exchange by exchange', attrs: 'onclick="window._lists.duel()"', side: '›' });
        rows.push({ icon: '⚡', name: 'Quick results', desc: 'The rest of the bracket on instinct, settled at once', attrs: 'onclick="window._lists.quick()"', side: '›' });
        h += rowList(rows, `${BOUT_NAMES[i]}: ${this._kindOf(i) === 'joust' ? 'the joust' : 'the melee'}`);
        // A wager on yourself, before the first bout
        if (i === 0 && !run.wager) {
            const bookie = this._bookie(game, run);
            const me = Duels.fromPlayer(player, { mods: PlayerEffects.duelModifiers(player), fresh: true });
            const odds = Lists.wagerOdds(me, run.field);
            const stakes = (Lists.config().wager.stakes || [10, 25, 50]).filter(v => v > 0);
            if (bookie) {
                h += rowList(stakes.map(st => ({
                    icon: '🎲', name: `Wager ${Utils.formatGold(st)} gold on yourself to win it all`, desc: `${esc(bookie.name)} gives ${odds}× (pays ${Utils.formatGold(Lists.wagerPayout(st, odds, true))})`,
                    attrs: `onclick="window._lists.wager(${st})"`, off: _num(player.gold) < st, why: 'Your purse is too light', side: price(st, _num(player.gold) >= st),
                })), 'A wager with the crowd:');
            }
        }
        h += '</div>';
        game.ui.showCustomPanel('Tournament', h);
        const self = this;
        window._lists = {
            joust: (hireIt) => { self._hide(game); self.startJoust(game, { hire: !!hireIt }); },
            melee: () => { self._hide(game); self.startMelee(game); },
            duel: () => self._duelPanel(game),
            quick: () => self.quickResults(game),
            wager: (st) => { self.placeWager(game, st); self.showBracket(game); },
            close: () => self._hide(game),
        };
    },

    _hide(game) {
        if (game && game.ui && typeof game.ui.hideCustomPanel === 'function') game.ui.hideCustomPanel();
    },

    /** Between bouts you get your wind and some strength back (as the menu's bracket). */
    _fighter(game) {
        const player = game.player;
        const mods = PlayerEffects.duelModifiers(player);
        return Duels.fromPlayer(player, { mods });
    },

    /** Stake `st` on yourself with the bookie: into their own purse. → the wager, or null. */
    placeWager(game, st) {
        const run = this.run(game);
        const player = game && game.player;
        if (!run || run.wager || run.bouts.length || !player) return null;
        const stake = Utils.cents(_num(st));
        if (!(stake > 0) || _num(player.gold) < stake) return null;
        const bookie = this._bookie(game, run);
        if (!bookie) return null;
        const s = run.ev.settlement;
        Townsfolk.purse(s.folk, bookie._person, game.world);
        const me = Duels.fromPlayer(player, { mods: PlayerEffects.duelModifiers(player), fresh: true });
        const odds = Lists.wagerOdds(me, run.field);
        PlayerCoin.pay(game.world, player, stake, { purse: bookie._person, key: 'purse' }, 'gambling');
        run.wager = { stake, odds, personId: bookie._person.id, name: bookie.name, person: bookie._person };
        if (player.lists) player.lists.wager = { stake, odds, personId: bookie._person.id, name: bookie.name };
        this._barkNpc(bookie, 'Done! Ride well.', 2.5);
        _notify(game, '🎲 A Wager', `${Utils.formatGold(stake)} gold on yourself to take the tournament, at ${odds}×, with ${bookie.name}.`, 'info');
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
        return run.wager;
    },

    /** Book a finished bout and go on: the next bout's call, or the results. */
    recordBout(game, result) {
        const run = this.run(game);
        if (!run) return;
        const i = run.bouts.length;
        const opp = run.field[i];
        run.bouts.push({ opponent: opp, result });
        if (opp && opp.kind === 'rival' && opp.ref) {
            try { Rivals.recordBout(game.player, game.world, opp.ref.id, result.playerWon); } catch (e) { /* the rival may be gone */ }
        }
        run.crowd = Lists.crowdStep(run.crowd, result.playerWon ? 'won' : 'lost');
        this._cheer(run.ev.site, result.playerWon ? 'cheer' : 'groan');
        const rec = game.player.lists;
        if (rec) {
            rec.bouts = run.bouts.map(b => ({ won: !!b.result.playerWon, aLost: _num(b.result.aLost), yielded: b.result.yielded || null, kind: b.result.kind || null }));
            rec.crowd = run.crowd;
        }
        if (!result.playerWon || run.bouts.length >= run.field.length) this.finish(game);
        else this.showBracket(game);
    },

    _duelPanel(game) {
        const run = this.run(game);
        if (!run) return;
        const i = run.bouts.length;
        const opp = run.field[i];
        DuelPanel.open(game, {
            a: this._fighter(game), b: opp, mode: 'tournament', title: `⚔️ ${BOUT_NAMES[i]}`,
            intro: `${esc(run.ev.settlement.name || '')}'s lists — ${esc(opp.title || '')} ${esc(opp.name)}. Blunted steel; a fighter may yield.`,
            onFinish: (r) => this.recordBout(game, r),
        });
    },

    /** The rest of the bracket on instinct (the menu's path). */
    quickResults(game) {
        const run = this.run(game);
        if (!run) return;
        while (run.bouts.length < run.field.length) {
            const i = run.bouts.length;
            const opp = run.field[i];
            const r = Duels.autoResolve(this._fighter(game), opp, { mode: 'tournament', playerYieldAt: 0.15 });
            run.bouts.push({ opponent: opp, result: r });
            if (opp.kind === 'rival' && opp.ref) {
                try { Rivals.recordBout(game.player, game.world, opp.ref.id, r.playerWon); } catch (e) { /* gone */ }
            }
            if (!r.playerWon) break;
        }
        this.finish(game);
    },

    /**
     * The tournament's end: Duels.settleTournament pays the purse from the
     * sponsor (the town's own) or the nearest purse (yours), renown and harm;
     * a wager is settled out of the bookie's purse. → the settlement, or null.
     */
    finish(game) {
        const run = this.run(game);
        const player = game && game.player;
        if (!run || !player) return null;
        this._run = null;
        const out = Duels.settleTournament(player, { prizePool: run.ev.prizePool, bouts: run.bouts, armour: run.armour, world: game.world, payer: run.payer || undefined });
        let renown = _num(run.ev.baseRenown) + out.renown;
        const C = Lists.config().crowd;
        const loved = run.crowd >= _num(C.loveAt, 0.5);
        if (loved) {
            player.renown = _num(player.renown) + _num(C.loveRenown, 1);
            renown += _num(C.loveRenown, 1);
        }
        let wagerLine = '';
        if (run.wager) {
            const due = Lists.wagerPayout(run.wager.stake, run.wager.odds, out.champion);
            const person = run.wager.person || (run.ev.settlement && run.ev.settlement.folk ? Townsfolk.get(run.ev.settlement.folk, run.wager.personId) : null);
            if (due > 0 && person) {
                const got = PlayerCoin.receive(game.world, player, due, { purse: person, key: 'purse' }, 'gambling');
                wagerLine = got < due ? `${esc(run.wager.name)} can pay only ${Utils.formatGold(got)} of the ${Utils.formatGold(due)} gold owed.` : `${esc(run.wager.name)} pays out ${Utils.formatGold(got)} gold on your wager.`;
            } else {
                wagerLine = `Your ${Utils.formatGold(run.wager.stake)} gold stays with ${esc(run.wager.name)}.`;
            }
        }
        if (player.lists) { player.lists.done = true; player.lists.out = { wins: out.wins, champion: out.champion, gold: out.gold }; }
        this._cheer(run.ev.site, out.champion ? 'cheer' : out.wins ? 'cheer' : 'groan');
        if (out.champion) this._bark(run.ev.site.herald, `All hail ${player.name || 'the champion'}!`, 4);
        this._showResults(game, run, out, renown, loved, wagerLine);
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
        return out;
    },

    _showResults(game, run, out, renown, loved, wagerLine) {
        if (!game.ui || typeof game.ui.showCustomPanel !== 'function') return;
        let h = '<div>';
        if (out.champion) h += lede(`<b style="color:#ffcf6a;">🏆 GRAND CHAMPION of ${esc(run.ev.settlement.name || 'the lists')}! ${Utils.formatGold(out.gold)} gold, +${renown} renown.</b>`);
        else if (out.finalist) h += lede(`🥈 <b>Runner-up.</b> ${Utils.formatGold(out.gold)} gold, +${renown} renown.`);
        else h += lede(`Out${out.wins ? ' in the semi-final' : ' in the opening bout'}. +${renown} renown for riding.`);
        if (out.purseShort) h += `<div style="color:#e0a46a;">The purse was ${Utils.formatGold(out.purseShort)} gold short: the sponsor paid what it had.</div>`;
        h += chips([
            { icon: '💰', label: 'Prize', value: `${Utils.formatGold(out.gold)}g`, cls: 'gold' },
            ['⭐', 'Renown', `+${renown}`],
            out.harm > 0 ? ['🤕', 'Hurt', `<span style="color:#e0846a;">-${out.harm} HP</span>`] : null,
        ]);
        h += rowList(run.bouts.map((b, i) => {
            const r = b.result;
            const how = r.kind === 'joust' ? ` in the joust (${_num(r.aPts)}–${_num(r.bPts)})` : r.yielded === 'b' ? ' (they yielded)' : r.yielded === 'a' ? ' (you yielded)' : '';
            return r.playerWon
                ? { icon: '✓', name: BOUT_NAMES[i], desc: `beat ${esc(b.opponent.name)}${how}`, side: 'won', tone: 'good' }
                : { icon: '✗', name: BOUT_NAMES[i], desc: `lost to ${esc(b.opponent.name)}${how}`, side: 'lost', tone: 'bad' };
        }), '⚔️ The Lists');
        for (const w of out.wounds) h += `<div style="color:#e0846a; margin-left:12px;">${w.icon} ${esc(w.name)} (${esc(w.text)})</div>`;
        if (loved) h += '<div style="color:#ffcf6a; margin-top:4px;">📣 The crowd loved you: +1 renown.</div>';
        if (wagerLine) h += `<div style="margin-top:4px;">🎲 ${wagerLine}</div>`;
        if (out.skillUp) h += '<div style="color:#9fb4f0; margin-top:4px;">Combat skill improved!</div>';
        h += rowList([{ icon: '➡️', name: 'Continue', desc: 'Leave the lists', attrs: 'onclick="window._lists && window._lists.close()"', tone: 'gold' }]);
        h += '</div>';
        game.ui.showCustomPanel('Tournament Results', h);
        const self = this;
        window._lists = { close: () => self._hide(game) };
    },

    // ──────────── THE JOUST ────────────

    /** Begin your joust with the next man in the bracket. opts.hire: a destrier from the stables (paid to the town). */
    startJoust(game, opts = {}) {
        const run = this.run(game);
        const player = game && game.player;
        if (!run || !player || this._joust || this._melee) return false;
        const L = run.ev.site;
        let horse = this._horse(game);
        if (!horse) {
            if (!opts.hire) { _notify(game, '🐎 No Horse', 'You need a horse for the joust: hire one, or fight on foot.', 'warning'); return false; }
            const fee = _num(Lists.config().hireHorse, 15);
            if (_num(player.gold) < fee) { _notify(game, '🐎 No Horse', `A destrier is ${fee} gold.`, 'warning'); return false; }
            PlayerCoin.pay(game.world, player, fee, run.ev.settlement, 'tournament');
            horse = { own: false, name: 'a hired destrier' };
            _notify(game, '🐎 A Destrier', `${fee} gold to the stables for a tall grey for the day.`, 'info');
        } else if (!InnerMapPets.mounted() && horse.m) {
            // Up on your own horse (the joust draws you on it; you ride on after)
            InnerMapPets.ride(game, horse.m);
        }
        const i = run.bouts.length;
        const opp = run.field[i];
        const skill = _num(player.skills && player.skills.combat, 1);
        const me = this._fighter(game);
        this._joust = {
            opp, i,
            me: Lists.riderOf(me, { skill, ownHorse: horse.own }),
            them: Lists.riderOf(opp, { ownHorse: true }),
            st: Lists.newJoust(), phase: 'ready', t: 0, strike: null, pass: null, horse,
            preset: InnerMapRenderer._playerPreset || InnerMapCharacters.playerPreset || 'male_noble',
            oppPreset: this._knightPreset(opp.name), aimPhase: Lists.hash(opp.name, i) * 6.28,
        };
        this._boutMap = InnerMap.tiles;
        // You wait by the rail at the middle (the camera with you); you are drawn as the rider
        const spot = this._standSpot(L, L.herald.q, L.herald.r - 1) || this._standSpot(L, L.herald.q, L.herald.r);
        if (spot) this._place(spot);
        this._bark(L.herald, `${player.name || 'The challenger'} and ${opp.name}! To your places!`, 2.5);
        return true;
    },

    /** Your strike, now: where the meter's needle and the lance tip stand. */
    strike() {
        const J = this._joust;
        if (!J || J.phase !== 'charge' || J.strike) return false;
        J.strike = { timing: Lists.meterAt(J.t), aim: Lists.aimAt(J.t, J.me, J.aimPhase) };
        return true;
    },

    _updateJoust(dt, game) {
        const J = this._joust;
        const C = Lists.config().joust;
        const charge = _num(C.chargeSeconds, 2.6);
        J.t += dt;
        // (held still by the rail while the pass is ridden)
        if (InnerMap._playerWalking) InnerMap.cancelPlayerWalk();
        if (J.phase === 'ready' && J.t >= 1.4) { J.phase = 'charge'; J.t = 0; J.strike = null; }
        else if (J.phase === 'charge' && J.t >= charge) {
            const pass = Lists.resolvePass({ rider: J.me, strike: J.strike }, { rider: J.them, strike: Lists.aiStrike(J.them) });
            J.pass = pass;
            Lists.scorePass(J.st, pass);
            this._passEffects(game, pass, true);
            J.phase = 'result';
            J.t = 0;
        } else if (J.phase === 'result' && J.t >= 2.4) {
            if (J.st.over) {
                const result = Lists.joustResult(J.st);
                this._joust = null;
                const skillNote = result.playerWon ? `You beat ${J.opp.name}` : `${J.opp.name} has the better of you`;
                _notify(game, result.playerWon ? '🏆 The Joust Is Yours' : '🐎 The Joust Is Lost', `${skillNote}, ${result.aPts} points to ${result.bPts}.`, result.playerWon ? 'success' : 'warning');
                this.recordBout(game, result);
                return;
            }
            J.phase = 'ready';
            J.t = 0;
            J.pass = null;
        }
    },

    /** The crowd, the floats and the splinters for a pass (mine: the player's own). */
    _passEffects(game, pass, mine) {
        const ev = this.eventHere(game);
        const L = ev ? ev.site : this._site;
        if (!L) return;
        const mid = (L.x0 + L.x1 + 1) / 2;
        const run = mine ? this.run(game) : null;
        for (const [side, what] of [['a', pass.a], ['b', pass.b]]) {
            const victimRow = side === 'a' ? L.laneB : L.laneA;
            if (what === 'broken' || what === 'unhorsed') {
                for (let k = 0; k < 9; k++) {
                    const u = Lists.hash(pass.aQ, pass.bQ, side, k);
                    this._fx.push({ x: mid * T_PX, y: (L.barrier + 0.2) * T_PX, vx: (u - 0.5) * 140, vy: -60 - u * 90, age: 0 });
                }
            }
            InnerMapCombat._spawnFloat(mid * T_PX, (victimRow - 0.6) * T_PX, 0, what === 'unhorsed' ? 'critical' : 'normal', OUTCOME_WORD[what]);
        }
        if (run) {
            const ev2 = pass.a === 'unhorsed' ? 'unhorsed' : pass.b === 'unhorsed' ? 'unhorsedYou' : pass.a;
            run.crowd = Lists.crowdStep(run.crowd, ev2);
            if (game.player.lists) game.player.lists.crowd = run.crowd;
        }
        const big = pass.a === 'unhorsed' || pass.b === 'unhorsed';
        const good = mine ? (pass.a !== 'miss') : (pass.a !== 'miss' || pass.b !== 'miss');
        this._cheer(L, big ? 'unhorsed' : good ? 'cheer' : 'groan');
    },

    // ──────────── THE MELEE ────────────

    /** Begin the melee with the next man in the bracket: on foot in the ring, the street's own combat. */
    startMelee(game) {
        const run = this.run(game);
        const player = game && game.player;
        if (!run || !player || this._joust || this._melee) return false;
        const L = run.ev.site;
        const i = run.bouts.length;
        const opp = run.field[i];
        if (InnerMapPets.riding) InnerMapPets.dismount(game, 'You swing down for the melee.');
        // (face to face across a pace of the ring: within a blow of each other)
        const me = this._standSpot(L, L.ring.q, L.ring.r);
        const at = me ? [[1, 0], [-1, 0], [0, -1], [1, -1], [-1, -1]].map(([dq, dr]) => this._standSpot(L, me.q + dq, me.r + dr, me))
            .find(c => c && Math.max(Math.abs(c.q - me.q), Math.abs(c.r - me.r)) <= 1) : null;
        if (!me || !at || !InnerMap._makeNpc) return false;
        this._place(me);
        const rng = Lists.stream(`${run.key}|${run.day}|melee${i}`);
        const npc = InnerMap._makeNpc('guard', 93000 + (++this._seq) + i * 7, rng);
        if (!npc) return false;
        const foeMax = Lists.meleeHp(opp);
        Object.assign(npc, {
            q: at.q, r: at.r, targetQ: at.q, targetR: at.r, prevQ: at.q, prevR: at.r, path: null, state: 'idle', idleTimer: 999,
            name: opp.name, fullName: opp.name, roleTitle: opp.title || 'Knight', _lists: true, _skillRole: 'guard',
            preset: this._knightPreset(opp.name),
            _duelProfile: { name: opp.name, attack: opp.attack, defense: opp.defense, power: opp.power, hp: opp.maxHp, stamina: opp.maxStamina, armour: opp.armour, weapon: opp.weapon, weaponDmg: opp.weaponDmg, temperament: opp.temperament, skill: opp.skill },
        });
        const self = this;
        npc._taskFoe = {
            onYield: () => self._meleeEnd(game, true),
            onFloored: () => self._meleeEnd(game, false),
        };
        InnerMap.npcs.push(npc);
        InnerMapCombat._npcHealth.set(npc.id, { current: foeMax, max: foeMax });
        this._boutMap = InnerMap.tiles;
        this._melee = { opp, npc, i, hpBefore: _num(player.health, 100), maxHealth: Math.max(1, _num(player.maxHealth, 100)), foeMax, over: false, t: 0 };
        this._bark(L.herald, `${opp.name} and ${player.name || 'the challenger'}: to the melee! Yield when beaten!`, 3);
        InnerMapCombat._beginNPCAttack(game, npc);
        return true;
    },

    _updateMelee(dt, game) {
        const M = this._melee;
        if (M.over) return;
        const player = game.player;
        M.t += dt;
        const npc = M.npc;
        const L = this._site;
        // You yield, beaten low
        if (Lists.shouldYield(player.health, M.maxHealth)) { this._meleeEnd(game, false); return; }
        // Walked off: the bout is forfeit
        const far = L ? Math.max(Math.abs(InnerMap.playerInnerQ - L.ring.q), Math.abs(InnerMap.playerInnerR - L.ring.r)) : 0;
        if (far > _num(Lists.config().melee.forfeitDistance, 9)) { this._meleeEnd(game, false, 'You walk out of the ring: the bout is forfeit.'); return; }
        // Close with him and you square up again
        const ia = InnerMapCombat._attackState;
        const busy = ia && ia.npc && ia.npc.id === npc.id;
        const near = Math.max(Math.abs(npc.q - InnerMap.playerInnerQ), Math.abs(npc.r - InnerMap.playerInnerR)) <= 1;
        if (!busy && near && !InnerMap._playerWalking) InnerMapCombat._beginNPCAttack(game, npc);
        if (near) npc.facing = InnerMapCharacters.getDirection(InnerMap.playerInnerQ - npc.q, InnerMap.playerInnerR - npc.r);
    },

    /** The melee is over (won: he yielded). Your health put back (the bracket books the bruises), the knight back to his pavilion. */
    _meleeEnd(game, won, why = null) {
        const M = this._melee;
        if (!M || M.over) return null;
        M.over = true;
        const player = game.player;
        const hp = InnerMapCombat._npcHealth.get(M.npc.id) || { current: 0, max: M.foeMax };
        const result = Lists.meleeResult({ playerWon: won, hpBefore: M.hpBefore, hpAfter: _num(player.health), maxHealth: M.maxHealth, foeHp: hp.current, foeMax: hp.max });
        player.health = M.hpBefore;
        if (InnerMapCombat._attackState && InnerMapCombat._attackState.npc && InnerMapCombat._attackState.npc.id === M.npc.id) InnerMapCombat.cancelAttack();
        InnerMapCombat._npcHealth.delete(M.npc.id);
        InnerMapCombat._npcReactions.delete(M.npc.id);
        const idx = (InnerMap.npcs || []).indexOf(M.npc);
        if (idx >= 0) InnerMap.npcs.splice(idx, 1);
        this._melee = null;
        if (this._site) this._barkAt(this._site.ring, won ? 'I yield! I yield!' : `Yield, ${player.name || 'friend'}!`, 2.5);
        _notify(game, won ? '🗡️ He Yields' : '🗡️ You Yield', why || (won ? `${M.opp.name} lowers his blade and yields the bout.` : `${M.opp.name} has the better of you; you yield the bout.`), won ? 'success' : 'warning');
        this.recordBout(game, result);
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
        return result;
    },

    // ──────────── WATCHING ────────────

    _updateWatch(dt, game, ev) {
        const L = ev.site;
        const pd = Math.max(Math.abs(InnerMap.playerInnerQ - (L.q0 + L.w / 2)), Math.abs(InnerMap.playerInnerR - (L.r0 + L.h / 2)));
        if (pd > 45) return;
        let W = this._watch;
        if (!W || W.key !== `${ev.key}|${ev.day}`) {
            W = this._watch = { key: `${ev.key}|${ev.day}`, n: 0, field: this.fieldFor(game, ev, false), cur: null, wait: 2 };
        }
        if (!W.cur) {
            W.wait -= dt;
            if (W.wait > 0) return;
            const pairs = [[0, 1], [1, 2], [0, 2], [2, 1], [1, 0], [2, 0]];
            const [ai, bi] = pairs[W.n % pairs.length];
            const a = W.field[ai], b = W.field[bi];
            const rng = Lists.stream(`${W.key}|watch${W.n}`);
            const st = Lists.autoJoust(Lists.riderOf(a, { ownHorse: true }), Lists.riderOf(b, { ownHorse: true }), rng);
            W.cur = { a, b, st, k: 0, phase: 'ready', t: 0, aPreset: this._knightPreset(a.name), bPreset: this._knightPreset(b.name) };
            W.n++;
            this._bark(L.herald, `${a.name} rides against ${b.name}!`, 2.5);
            return;
        }
        const P = W.cur;
        P.t += dt;
        const charge = _num(Lists.config().joust.chargeSeconds, 2.6);
        if (P.phase === 'ready' && P.t >= 1.4) { P.phase = 'charge'; P.t = 0; }
        else if (P.phase === 'charge' && P.t >= charge) {
            P.phase = 'result'; P.t = 0;
            this._passEffects(game, P.st.passes[P.k], false);
        } else if (P.phase === 'result' && P.t >= 2.2) {
            P.k++;
            P.t = 0;
            if (P.k >= P.st.passes.length) {
                const win = P.st.winner === 'a' ? P.a : P.b;
                this._bark(L.herald, `The bout to ${win.name}!`, 2.5);
                W.cur = null;
                W.wait = _num(Lists.config().watch.secondsBetween, 7);
            } else P.phase = 'ready';
        }
    },

    // ──────────── EACH FRAME ────────────

    update(dt, game) {
        this._game = game;
        if (!InnerMap.active || !game || !game.player) return;
        const now = _now();
        this._barks = this._barks.filter(b => b.until > now);
        for (const f of this._fx) { f.age += dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 260 * dt; }
        this._fx = this._fx.filter(f => f.age < 1.2);
        // (the map left mid-bout: the bout is put off, to be fought when you come back)
        if ((this._joust || this._melee) && this._boutMap !== InnerMap.tiles) this._abandon(game);
        // (passers-by kept out of the lanes while knights ride them)
        if (this._joust) this._clearLanes(this._joust && this.run(game) && this.run(game).ev.site);
        // (the barrier, stands and pavilions are solid while the lists stand: world/innerMap/lists.js)
        const ev = this.eventHere(game);
        if (InnerMap.setListsStanding) InnerMap.setListsStanding(ev ? ev.site : null);
        if (this._melee) { this._updateMelee(dt, game); return; }
        if (this._joust) { this._updateJoust(dt, game); return; }
        if (ev && this._watch) this._clearLanes(ev.site);
        const s = _settlementHere();
        // The herald cries it: today's lists, or one in the days to come
        if (s && !InnerMap._insideBuilding) {
            const day = _day(game);
            const tag = `${Lists.townKey(s)}|${day}`;
            if (!this._told.has(tag)) {
                this._told.add(tag);
                if (ev) {
                    const rec = game.player.lists;
                    if (!(rec && rec.day === ev.day && rec.key === ev.key && rec.done)) {
                        _notify(game, '📯 A Tournament Today', ev.host === 'player'
                            ? `Your lists are raised at ${s.name}. The herald waits by the barrier.`
                            : `${s.name} holds a tournament today: the lists stand outside the town. The champion takes ${Utils.formatGold(ev.prizePool)} gold; the herald takes entries (${Utils.formatGold(ev.fee)} gold) until evening.`, 'info');
                    }
                } else if (!this.eventFor(game.player, s, day)) {
                    const up = Lists.upcoming(s, day + 1);
                    if (up) _notify(game, '📯 The Herald Cries a Tournament', `${s.name} holds a tournament ${up.inDays + 1 === 1 ? 'tomorrow' : `in ${up.inDays + 1} days`}: knights from all about, ${Utils.formatGold(up.prizePool)} gold to the champion.`, 'info');
                }
            }
        }
        if (ev) this._updateWatch(dt, game, ev);
    },

    /** Anyone wandering in the lanes (the barrier's rows and the rows either side) steps out past the rail. */
    _clearLanes(L) {
        if (!L || !Number.isFinite(L.laneA) || !Number.isFinite(L.laneB)) return;
        const q0 = L.q0, q1 = L.q0 + L.w - 1;
        for (const n of InnerMap.npcs || []) {
            if (!n || n.q < q0 || n.q > q1 || n.r < L.laneA || n.r > L.laneB) continue;
            const out = this._standSpot(L, n.q, L.laneB + 2) || this._standSpot(L, n.q, L.laneB + 3);
            if (!out) continue;
            n.q = n.prevQ = out.q; n.r = n.prevR = out.r;
            n.path = null; n.moveProgress = 0;
        }
    },

    /** SPACE / Enter strikes during a pass you ride. → handled */
    key(game, e) {
        if (!this._joust || !e) return false;
        if (e.type && e.type !== 'keydown') return false;
        if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter') {
            if (e.preventDefault) e.preventDefault();
            this.strike();
            return true;
        }
        return false;
    },

    /** A click strikes during a pass you ride (and does nothing else while you ride). → handled */
    click(game, button) {
        if (!this._joust) return false;
        if (button === 'left' || button == null) this.strike();
        return true;
    },

    /** While you ride a pass you are drawn as the rider, not where you stand. */
    hidesPlayer() {
        return !!this._joust;
    },

    /** A bout left unfinished (the map left): nothing booked; your health as it was before a melee. */
    _abandon(game) {
        const M = this._melee;
        if (M && game && game.player && !M.over) game.player.health = M.hpBefore;
        if (M && M.npc) {
            InnerMapCombat._npcHealth.delete(M.npc.id);
            InnerMapCombat._npcReactions.delete(M.npc.id);
        }
        this.reset();
    },

    /** Forget the map's lists (a load, a new game, leaving the map). */
    reset() {
        if (this._melee && this._melee.npc) {
            const idx = (InnerMap.npcs || []).indexOf(this._melee.npc);
            if (idx >= 0) InnerMap.npcs.splice(idx, 1);
        }
        this._melee = null;
        this._joust = null;
        this._watch = null;
        if (InnerMap.setListsStanding) InnerMap.setListsStanding(null);
        this._barks = [];
        this._fx = [];
    },

    // ──────────── PLACES AND VOICES ────────────

    /** A free standing cell at or next to (q, r) on the lists (not `not`). */
    _standSpot(L, q, r, not = null) {
        const cells = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0]];
        for (const [dq, dr] of cells) {
            const x = q + dq, y = r + dr;
            const t = InnerMap.tiles && InnerMap.tiles[y] && InnerMap.tiles[y][x];
            if (!t || !t.subTerrain || !t.subTerrain.passable) continue;
            if (InnerMap._listsBlocks && InnerMap._listsBlocks(x, y)) continue;
            if (not && not.q === x && not.r === y) continue;
            return { q: x, r: y };
        }
        return null;
    },

    _place(spot) {
        if (InnerMap._playerWalking) InnerMap.cancelPlayerWalk();
        InnerMap._playerPrevQ = InnerMap.playerInnerQ;
        InnerMap._playerPrevR = InnerMap.playerInnerR;
        InnerMap.playerInnerQ = spot.q;
        InnerMap.playerInnerR = spot.r;
    },

    _bark(at, text, secs = 2.5, color = '#ffe9a8') {
        if (!at || !text) return;
        this._barks.push({ q: at.q, r: at.r, text, until: _now() + secs, color });
        if (this._barks.length > 14) this._barks.shift();
    },

    _barkAt(at, text, secs) { this._bark(at, text, secs, '#f4efe4'); },

    _barkNpc(npc, text, secs) {
        if (npc) InnerMapReactions.bark(npc, text, secs);
    },

    /** The crowd's voice: a few spectators call out, the stands bob with it. */
    _cheer(L, kind) {
        if (!L) return;
        const t = _now();
        if (kind !== 'groan') this._cheerUntil = t + 2.2;
        const crowd = L.crowd || [];
        if (!crowd.length) return;
        for (let k = 0; k < 3; k++) {
            const u = Lists.hash(kind, Math.floor(t * 10), k);
            const c = crowd[Math.floor(u * crowd.length)];
            this._bark(c, Lists.bark(kind, Lists.hash(kind, t, k, 'w')), 1.8, kind === 'groan' ? '#c9c2b0' : '#fff2c4');
        }
    },

    _knightPreset(name) {
        const had = this._knights.get(name);
        if (had && InnerMapCharacters.getComposited(had)) return had;
        let id = null;
        try {
            id = InnerMapEscort._preset({ type: 'knight', realmGuard: `lists:${name}` }, 0);
        } catch (e) {
            id = InnerMapCharacters.getPresetForNPC('guard', Math.floor(Lists.hash(name) * 9999));
        }
        this._knights.set(name, id);
        return id;
    },

    // ──────────── DRAWING ────────────

    collect(items, ctx, camera, T) {
        const game = this._game;
        const ev = game ? this.eventHere(game) : null;
        if (!ev) return;
        const L = ev.site;
        const ds = T * camera.zoom;
        const W = ctx.canvas.width, H = ctx.canvas.height;
        const tl = camera.worldToScreenFast(L.q0 * T, L.r0 * T);
        const x0 = tl.x, y0 = tl.y;
        if (x0 > W + ds * 2 || y0 > H + ds * 2 || x0 + L.w * ds < -ds * 2 || y0 + L.h * ds < -ds * 4) return;
        const now = _now();
        const self = this;
        const sx = (q) => x0 + (q - L.q0) * ds;
        const sy = (r) => y0 + (r - L.r0) * ds;
        const [field, charge] = TINCTURES[Math.floor(Lists.hash(ev.key, 'arms') * TINCTURES.length)];
        // The trampled ground of the lanes and the ring (flat, under everything on the field)
        items.push({ sortY: L.r0 * T - T * 2, zLayer: 0, sortX: L.q0, draw: () => self._drawGround(ctx, L, sx, sy, ds) });
        // The stands and the folk in them
        items.push({ sortY: (L.r0 + 1) * T + T * 0.9, zLayer: 1, sortX: L.stands.q, draw: () => self._drawStands(ctx, L, sx, sy, ds, now, field, charge) });
        // The tilt barrier, draped in the host's colours
        items.push({ sortY: L.barrier * T + T * 0.55, zLayer: 1, sortX: L.x0, draw: () => self._drawBarrier(ctx, L, sx, sy, ds, field, charge) });
        // The rails either side of the lanes
        items.push({ sortY: (L.laneA) * T + 2, zLayer: 1, sortX: L.x0, draw: () => self._drawRail(ctx, L, sx, sy(L.laneA) + ds * 0.05, ds) });
        items.push({ sortY: (L.laneB + 1) * T + T * 0.2, zLayer: 1, sortX: L.x0, draw: () => self._drawRail(ctx, L, sx, sy(L.laneB + 1) + ds * 0.15, ds) });
        // The pavilions
        L.pavilions.forEach((p, k) => {
            const [pf, pc] = TINCTURES[Math.floor(Lists.hash(ev.key, 'pav', k) * TINCTURES.length)];
            items.push({ sortY: (p.r + p.h) * T, zLayer: 1, sortX: p.q, draw: () => self._drawPavilion(ctx, p, sx, sy, ds, now, pf, pc) });
        });
        // The banners
        for (const b of L.banners) {
            const [bf, bc] = TINCTURES[Math.floor(Lists.hash(ev.key, 'ban', b.i) * TINCTURES.length)];
            items.push({ sortY: (b.r + 1) * T, zLayer: 1, sortX: b.q, draw: () => self._drawBanner(ctx, sx(b.q) + ds * 0.5, sy(b.r + 1) - ds * 0.05, ds, now, bf, bc, b.tall, b.i) });
        }
        // The crowd along the rail
        items.push({ sortY: (L.r0 + 7) * T + T * 0.5, zLayer: 2, sortX: L.q0, draw: () => self._drawRailCrowd(ctx, L, sx, sy, ds, now) });
        // The herald
        items.push({ sortY: L.herald.r * T + T * 0.5, zLayer: 2, sortX: L.herald.q, draw: () => self._drawHerald(ctx, L, sx, sy, ds, now, field, charge) });
        // The riders: yours, the watched bout's, or two waiting at the pavilions
        const horseSp = InnerMap.animalSpecies ? InnerMap.animalSpecies('horse', InnerMap.animalConfig()) : null;
        const riders = this._riders(L, ev);
        for (const rd of riders) {
            items.push({ sortY: rd.r * T + T * 0.5, zLayer: 2, sortX: rd.q, draw: () => self._drawJouster(ctx, rd, sx, sy, ds, now, horseSp) });
        }
        // Splinters, voices, and your lance-meter over everything
        items.push({ sortY: 1e9, zLayer: 9, draw: () => {
            self._drawFx(ctx, camera, T);
            self._drawBarks(ctx, sx, sy, ds, now);
            if (self._joust) self._drawMeter(ctx, W, H);
        } });
    },

    /** The riders to draw now: { q, r (cells, fractional), dir, moving, preset, lance, fallen, broken, me } */
    _riders(L, ev) {
        const C = Lists.config().joust;
        const charge = _num(C.chargeSeconds, 2.6);
        const impact = _num(C.impactAt, 0.86);
        const mid = (L.x0 + L.x1) / 2;
        const lanePos = (side, p) => {
            // (meeting at the middle when the meter reads impactAt; on past it after)
            const f = p / impact;
            return side < 0 ? L.x0 + (mid - L.x0) * f : L.x1 - (L.x1 - mid) * f;
        };
        const fromPass = (aPreset, bPreset, phase, t, pass, meA) => {
            const out = [];
            const p = phase === 'charge' ? Math.min(1, t / charge) : phase === 'result' ? Math.min(1.25, 1 + t * 0.12) : 0;
            const aDown = phase === 'result' && pass && pass.b === 'unhorsed';
            const bDown = phase === 'result' && pass && pass.a === 'unhorsed';
            out.push({ q: lanePos(-1, p), r: L.laneA, dir: 3, moving: phase === 'charge' || (phase === 'result' && t < 1.2), preset: aPreset, lance: true, fallen: aDown ? t : -1, broken: phase === 'result' && pass && (pass.a === 'broken' || pass.a === 'unhorsed'), me: !!meA });
            out.push({ q: lanePos(1, p), r: L.laneB, dir: 1, moving: phase === 'charge' || (phase === 'result' && t < 1.2), preset: bPreset, lance: true, fallen: bDown ? t : -1, broken: phase === 'result' && pass && (pass.b === 'broken' || pass.b === 'unhorsed') });
            return out;
        };
        if (this._joust) {
            const J = this._joust;
            return fromPass(J.preset, J.oppPreset, J.phase, J.t, J.pass, true);
        }
        const W = this._watch;
        if (W && W.cur && W.key === `${ev.key}|${ev.day}`) {
            const P = W.cur;
            return fromPass(P.aPreset, P.bPreset, P.phase, P.t, P.phase === 'result' ? P.st.passes[P.k] : null, false);
        }
        if (this._melee) return [];
        // Two knights at their pavilions, waiting their turn
        return [
            { q: L.pavilions[0].q + 2.3, r: L.laneA, dir: 3, moving: false, preset: this._knightPreset(`${ev.key}w`), lance: true, fallen: -1 },
            { q: L.pavilions[1].q - 1.3, r: L.laneB, dir: 1, moving: false, preset: this._knightPreset(`${ev.key}e`), lance: true, fallen: -1 },
        ];
    },

    _drawGround(ctx, L, sx, sy, ds) {
        ctx.save();
        const gx = sx(L.x0 - 1), gy = sy(L.laneA) - ds * 0.1, gw = (L.x1 - L.x0 + 3) * ds, gh = (L.laneB - L.laneA + 2) * ds;
        ctx.fillStyle = 'rgba(176,146,98,0.78)';
        ctx.fillRect(Math.floor(gx), Math.floor(gy), Math.ceil(gw), Math.ceil(gh));
        // Hoof-churned speckle, the same each frame
        const px = Math.max(1, Math.round(ds / 16));
        for (let q = L.x0 - 1; q <= L.x1 + 1; q++) {
            for (let r = L.laneA; r <= L.laneB + 1; r++) {
                for (let k = 0; k < 5; k++) {
                    const u = Lists.hash('g', q, r, k), v = Lists.hash('h', q, r, k);
                    ctx.fillStyle = k % 2 ? 'rgba(120,92,58,0.55)' : 'rgba(214,190,140,0.5)';
                    ctx.fillRect(Math.floor(sx(q) + u * ds), Math.floor(sy(r) + v * ds * 0.9), px * (1 + (k % 2)), px);
                }
            }
        }
        ctx.restore();
    },

    _drawRail(ctx, L, sx, y, ds) {
        ctx.save();
        const a = sx(L.x0 - 1), b = sx(L.x1 + 2);
        ctx.fillStyle = '#5b3d22';
        for (let q = L.x0 - 1; q <= L.x1 + 2; q += 2) ctx.fillRect(Math.floor(sx(q) - ds * 0.04), Math.floor(y - ds * 0.3), Math.max(2, Math.round(ds * 0.08)), Math.round(ds * 0.32));
        ctx.fillStyle = '#8a6238';
        ctx.fillRect(Math.floor(a), Math.floor(y - ds * 0.26), Math.ceil(b - a), Math.max(2, Math.round(ds * 0.06)));
        ctx.restore();
    },

    _drawBarrier(ctx, L, sx, sy, ds, field, charge) {
        ctx.save();
        const y = sy(L.barrier) + ds * 0.55;
        const a = sx(L.x0), b = sx(L.x1 + 1);
        // Posts
        ctx.fillStyle = '#4a311b';
        for (let q = L.x0; q <= L.x1 + 1; q++) ctx.fillRect(Math.floor(sx(q) - ds * 0.05), Math.floor(y - ds * 0.62), Math.max(2, Math.round(ds * 0.1)), Math.round(ds * 0.64));
        // The cloth hung on the top beam, field and charge in turn
        const step = ds;
        for (let q = L.x0; q <= L.x1; q++) {
            const x = sx(q);
            ctx.fillStyle = (q - L.x0) % 2 ? charge : field;
            ctx.fillRect(Math.floor(x), Math.floor(y - ds * 0.54), Math.ceil(step), Math.round(ds * 0.4));
            // A scalloped hem
            ctx.beginPath();
            ctx.moveTo(x, y - ds * 0.14);
            ctx.quadraticCurveTo(x + step / 2, y - ds * 0.02, x + step, y - ds * 0.14);
            ctx.lineTo(x + step, y - ds * 0.15); ctx.lineTo(x, y - ds * 0.15);
            ctx.fill();
        }
        // The top beam
        ctx.fillStyle = '#9a6e3e';
        ctx.fillRect(Math.floor(a), Math.floor(y - ds * 0.62), Math.ceil(b - a), Math.max(2, Math.round(ds * 0.1)));
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(Math.floor(a), Math.floor(y), Math.ceil(b - a), Math.max(2, Math.round(ds * 0.08)));
        ctx.restore();
    },

    _drawStands(ctx, L, sx, sy, ds, now, field, charge) {
        const S = L.stands;
        const x = sx(S.q), w = S.w * ds;
        ctx.save();
        // The awning over the back tier, striped
        const ay = sy(S.r) - ds * 1.15;
        for (let k = 0; k < S.w; k++) {
            ctx.fillStyle = k % 2 ? charge : field;
            ctx.fillRect(Math.floor(x + k * ds), Math.floor(ay), Math.ceil(ds), Math.round(ds * 0.32));
            ctx.beginPath();
            ctx.moveTo(x + k * ds, ay + ds * 0.32);
            ctx.lineTo(x + (k + 0.5) * ds, ay + ds * 0.48);
            ctx.lineTo(x + (k + 1) * ds, ay + ds * 0.32);
            ctx.fill();
        }
        ctx.fillStyle = '#4a311b';
        for (let k = 0; k <= S.w; k += 3) ctx.fillRect(Math.floor(x + k * ds - ds * 0.05), Math.floor(ay), Math.max(2, Math.round(ds * 0.1)), Math.round(ds * 3.1));
        ctx.restore();
        const cheering = now < this._cheerUntil;
        const tiers = [0, 1];
        for (const k of tiers) {
            // The bench of this tier (the back one raised)
            const by = sy(S.r + k) + ds * (k === 0 ? 0.25 : 0.55);
            ctx.save();
            ctx.fillStyle = k === 0 ? '#6e4c2a' : '#7f5a33';
            ctx.fillRect(Math.floor(x), Math.floor(by), Math.ceil(w), Math.round(ds * 0.5));
            ctx.fillStyle = 'rgba(0,0,0,0.25)';
            ctx.fillRect(Math.floor(x), Math.floor(by + ds * 0.42), Math.ceil(w), Math.round(ds * 0.08));
            ctx.fillStyle = '#a57b48';
            ctx.fillRect(Math.floor(x), Math.floor(by), Math.ceil(w), Math.max(2, Math.round(ds * 0.06)));
            ctx.restore();
            // Its folk, sat facing the lists
            for (const c of L.crowd) {
                if (c.tier !== 1 - k) continue;
                const bob = cheering ? Math.abs(Math.sin(now * 9 + c.i)) * ds * 0.12 : Math.sin(now * 1.3 + c.i) * ds * 0.01;
                this._drawFolk(ctx, c, sx(c.q) + ds * 0.5, by + ds * 0.22 - bob, ds, now, 2);
            }
        }
    },

    _drawRailCrowd(ctx, L, sx, sy, ds, now) {
        const cheering = now < this._cheerUntil;
        for (const c of L.crowd) {
            if (c.tier !== -1) continue;
            const bob = cheering ? Math.abs(Math.sin(now * 8 + c.i * 1.7)) * ds * 0.14 : 0;
            this._drawFolk(ctx, c, sx(c.q) + ds * 0.5, sy(c.r) + ds * 0.8 - bob, ds, now, 0);
        }
    },

    _drawFolk(ctx, c, x, feetY, ds, now, dir) {
        const seed = Math.floor(Lists.hash('folk', c.q, c.r, c.i) * 99991);
        const types = ['villager', 'merchant', 'farmer', 'noble', 'villager', 'priest'];
        const preset = c._preset !== undefined ? c._preset : (c._preset = InnerMapCharacters.getPresetForNPC(types[seed % types.length], seed) || null);
        const cw = ds * 1.2, ch = ds * 1.8;
        if (!(preset && InnerMapCharacters.drawCharacter(ctx, preset, 'idle', dir, now + c.i * 0.37, x - cw / 2, feetY - ch + ds * 0.3, cw, ch))) {
            ctx.fillStyle = ['#6d4f3b', '#3e5a7a', '#7a3e3e', '#4f6a3a'][seed % 4];
            ctx.beginPath(); ctx.ellipse(x, feetY - ds * 0.35, ds * 0.18, ds * 0.3, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#e2b892';
            ctx.beginPath(); ctx.arc(x, feetY - ds * 0.78, ds * 0.13, 0, Math.PI * 2); ctx.fill();
        }
    },

    _drawPavilion(ctx, p, sx, sy, ds, now, field, charge) {
        ctx.save();
        const x = sx(p.q), w = p.w * ds;
        const base = sy(p.r + p.h) - ds * 0.1;
        const wallTop = base - ds * 1.6;
        const peak = wallTop - ds * 1.3;
        // Shadow
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(x + w / 2, base, w * 0.6, ds * 0.22, 0, 0, Math.PI * 2); ctx.fill();
        // The walls: upright stripes
        const n = 6;
        for (let k = 0; k < n; k++) {
            ctx.fillStyle = k % 2 ? charge : field;
            ctx.fillRect(Math.floor(x + (k * w) / n), Math.floor(wallTop), Math.ceil(w / n), Math.ceil(base - wallTop));
        }
        // The door flap, open toward the lists
        ctx.fillStyle = 'rgba(30,18,10,0.85)';
        const dx = p.side < 0 ? x + w * 0.62 : x + w * 0.12;
        ctx.beginPath();
        ctx.moveTo(dx, base); ctx.lineTo(dx + w * 0.13, wallTop + ds * 0.35); ctx.lineTo(dx + w * 0.26, base);
        ctx.fill();
        // The roof: a cone of the field, a valance of the charge
        ctx.fillStyle = field;
        ctx.beginPath();
        ctx.moveTo(x - ds * 0.15, wallTop); ctx.lineTo(x + w / 2, peak); ctx.lineTo(x + w + ds * 0.15, wallTop);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.moveTo(x + w / 2, peak); ctx.lineTo(x + w + ds * 0.15, wallTop); ctx.lineTo(x + w * 0.7, wallTop);
        ctx.fill();
        ctx.fillStyle = charge;
        for (let k = 0; k < 6; k++) {
            const vx = x - ds * 0.15 + (k * (w + ds * 0.3)) / 6;
            ctx.beginPath();
            ctx.moveTo(vx, wallTop); ctx.lineTo(vx + (w + ds * 0.3) / 12, wallTop + ds * 0.25); ctx.lineTo(vx + (w + ds * 0.3) / 6, wallTop);
            ctx.fill();
        }
        // The pole and its pennant
        ctx.fillStyle = '#4a311b';
        ctx.fillRect(Math.floor(x + w / 2 - 1), Math.floor(peak - ds * 0.7), 2, Math.ceil(ds * 0.7));
        const wave = Math.sin(now * 3 + p.side) * ds * 0.06;
        ctx.fillStyle = charge;
        ctx.beginPath();
        ctx.moveTo(x + w / 2 + 1, peak - ds * 0.7);
        ctx.lineTo(x + w / 2 + 1 + ds * 0.55, peak - ds * 0.6 + wave);
        ctx.lineTo(x + w / 2 + 1, peak - ds * 0.48);
        ctx.fill();
        ctx.restore();
    },

    _drawBanner(ctx, x, footY, ds, now, field, charge, tall, i) {
        ctx.save();
        const h = ds * (tall ? 2.6 : 2.0);
        const top = footY - h;
        ctx.fillStyle = '#4a311b';
        ctx.fillRect(Math.floor(x - 1), Math.floor(top), Math.max(2, Math.round(ds * 0.07)), Math.ceil(h));
        ctx.fillStyle = '#c9a24a';
        ctx.beginPath(); ctx.arc(x, top, Math.max(2, ds * 0.06), 0, Math.PI * 2); ctx.fill();
        // The banner hangs from a crossbar, rippling
        const bw = ds * 0.56, bh = ds * 0.85;
        const bx = x - bw / 2, by = top + ds * 0.1;
        ctx.fillStyle = '#6b4a2a';
        ctx.fillRect(Math.floor(bx - ds * 0.05), Math.floor(by - 1), Math.ceil(bw + ds * 0.1), 2);
        const ripple = (k) => Math.sin(now * 2.6 + i * 1.3 + k) * ds * 0.025;
        ctx.fillStyle = field;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + bw, by);
        ctx.lineTo(bx + bw + ripple(1), by + bh);
        ctx.lineTo(bx + bw / 2 + ripple(2), by + bh - ds * 0.16);
        ctx.lineTo(bx + ripple(3), by + bh);
        ctx.closePath();
        ctx.fill();
        // A charge on it: a cross, a chevron, a roundel or a pale (by the banner)
        ctx.fillStyle = charge;
        const kind = i % 4;
        const cx = bx + bw / 2, cy = by + bh * 0.42;
        if (kind === 0) { ctx.fillRect(Math.floor(cx - bw * 0.08), Math.floor(by + bh * 0.1), Math.ceil(bw * 0.16), Math.ceil(bh * 0.62)); ctx.fillRect(Math.floor(bx + bw * 0.15), Math.floor(cy - bh * 0.06), Math.ceil(bw * 0.7), Math.ceil(bh * 0.12)); }
        else if (kind === 1) { ctx.beginPath(); ctx.moveTo(bx + bw * 0.12, cy + bh * 0.16); ctx.lineTo(cx, cy - bh * 0.14); ctx.lineTo(bx + bw * 0.88, cy + bh * 0.16); ctx.lineTo(bx + bw * 0.88, cy + bh * 0.3); ctx.lineTo(cx, cy); ctx.lineTo(bx + bw * 0.12, cy + bh * 0.3); ctx.fill(); }
        else if (kind === 2) { ctx.beginPath(); ctx.arc(cx, cy, bw * 0.2, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(Math.floor(cx - bw * 0.14), Math.floor(by), Math.ceil(bw * 0.28), Math.ceil(bh * 0.78));
        ctx.restore();
    },

    _drawHerald(ctx, L, sx, sy, ds, now, field, charge) {
        const x = sx(L.herald.q) + ds * 0.5, feet = sy(L.herald.r) + ds * 0.8;
        const preset = this._heraldPreset !== undefined ? this._heraldPreset : (this._heraldPreset = InnerMapCharacters.getPresetForNPC('noble', 7) || InnerMapCharacters.getPresetForNPC('merchant', 7) || null);
        const cw = ds * 1.2, ch = ds * 1.8;
        const drawn = preset && InnerMapCharacters.drawCharacter(ctx, preset, 'idle', 0, now, x - cw / 2, feet - ch + ds * 0.3, cw, ch);
        if (!drawn) {
            ctx.fillStyle = field;
            ctx.beginPath(); ctx.ellipse(x, feet - ds * 0.35, ds * 0.18, ds * 0.3, 0, 0, Math.PI * 2); ctx.fill();
        }
        // The tabard over the herald's back (his master's arms) and the horn when he cries
        ctx.save();
        ctx.fillStyle = field;
        ctx.fillRect(Math.floor(x - ds * 0.17), Math.floor(feet - ds * 0.95), Math.ceil(ds * 0.34), Math.ceil(ds * 0.42));
        ctx.fillStyle = charge;
        ctx.fillRect(Math.floor(x - ds * 0.04), Math.floor(feet - ds * 0.95), Math.ceil(ds * 0.08), Math.ceil(ds * 0.42));
        const crying = this._barks.some(b => b.q === L.herald.q && b.r === L.herald.r);
        if (crying) {
            ctx.strokeStyle = '#e0b84a';
            ctx.lineWidth = Math.max(2, ds * 0.07);
            ctx.beginPath(); ctx.moveTo(x + ds * 0.12, feet - ds * 1.15); ctx.lineTo(x + ds * 0.45, feet - ds * 1.45); ctx.stroke();
            ctx.fillStyle = '#e0b84a';
            ctx.beginPath(); ctx.arc(x + ds * 0.47, feet - ds * 1.47, ds * 0.08, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    },

    _drawJouster(ctx, rd, sx, sy, ds, now, horseSp) {
        const x = sx(rd.q) + ds * 0.5, y = sy(rd.r) + ds * 0.5;
        const preset = rd.preset && InnerMapCharacters.getComposited(rd.preset) ? rd.preset : null;
        const east = rd.dir === 3;
        if (rd.fallen >= 0) {
            // Unhorsed: the horse runs on, the man down in the dirt
            const k = Math.min(1, rd.fallen / 0.4);
            if (horseSp) {
                const c = { id: 9400 + (east ? 1 : 2), order: { type: 'charge' }, state: 'formed' };
                InnerMapBattle._drawRider(ctx, ds, c, { i: 0, moving: true, anim: 'walk' }, null, x + (east ? 1 : -1) * ds * 1.2 * k, y, rd.dir, now, horseSp, false);
            }
            if (preset) {
                ctx.save();
                ctx.translate(x, y + ds * 0.1);
                ctx.rotate((east ? -1 : 1) * (Math.PI / 2) * k);
                const cw = ds * 1.2 * 0.9, chh = ds * 1.8 * 0.9;
                InnerMapCharacters.drawCharacter(ctx, preset, 'idle', 2, 0, -cw / 2, -chh / 2, cw, chh);
                ctx.restore();
            }
            return;
        }
        if (horseSp) {
            const c = { id: 9400 + (east ? 1 : 2), order: { type: rd.moving ? 'charge' : 'hold' }, state: 'formed' };
            InnerMapBattle._drawRider(ctx, ds, c, { i: 0, moving: rd.moving, anim: rd.moving ? 'walk' : 'idle' }, preset, x, y, rd.dir, now, horseSp, !!preset);
        } else if (preset) {
            InnerMapBattle._drawFoot(ctx, ds, preset, x, y, rd.moving ? 'walk' : 'idle', rd.dir, now, true, false);
        }
        if (rd.lance) this._drawLance(ctx, x, y, ds, east, rd.broken, rd.moving, now, rd.me);
    },

    /** A couched lance across the horse's neck toward the barrier: striped, with its vamplate. */
    _drawLance(ctx, x, y, ds, east, broken, moving, now, mine) {
        ctx.save();
        const s = east ? 1 : -1;
        const hx = x + s * ds * 0.1, hy = y - ds * 1.05;
        // (lowered at the charge, high while waiting)
        const len = broken ? ds * 1.0 : ds * 2.3;
        const ang = moving ? 0.12 : -0.9;
        const tx = hx + s * len * Math.cos(ang), ty = hy + len * Math.sin(ang) * (east ? 1 : 1) + (east ? ds * 0.12 : -ds * 0.05);
        const segs = 6;
        for (let k = 0; k < segs; k++) {
            const a = k / segs, b = (k + 1) / segs;
            ctx.strokeStyle = k % 2 ? '#f1e4c0' : (mine ? '#1f3e8c' : '#a3242a');
            ctx.lineWidth = Math.max(2, ds * (0.1 - 0.05 * a));
            ctx.beginPath();
            ctx.moveTo(hx + (tx - hx) * a, hy + (ty - hy) * a);
            ctx.lineTo(hx + (tx - hx) * b, hy + (ty - hy) * b);
            ctx.stroke();
        }
        if (broken) {
            ctx.strokeStyle = '#d8c69a';
            ctx.lineWidth = Math.max(1, ds * 0.04);
            for (let k = 0; k < 3; k++) {
                ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + s * ds * 0.15, ty + (k - 1) * ds * 0.1); ctx.stroke();
            }
        }
        ctx.fillStyle = '#b9b9c2';
        ctx.beginPath(); ctx.arc(hx + s * ds * 0.18, hy + ds * 0.02, Math.max(2, ds * 0.1), 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    },

    _drawFx(ctx, camera) {
        if (!this._fx.length) return;
        ctx.save();
        for (const f of this._fx) {
            const s = camera.worldToScreenFast(f.x, f.y);
            ctx.globalAlpha = Math.max(0, 1 - f.age / 1.2);
            ctx.fillStyle = '#e2cf9e';
            ctx.fillRect(Math.floor(s.x), Math.floor(s.y), Math.max(2, Math.round(camera.zoom * 3)), Math.max(1, Math.round(camera.zoom * 1.5)));
        }
        ctx.restore();
    },

    _drawBarks(ctx, sx, sy, ds, now) {
        for (const b of this._barks) {
            const fade = Math.min(1, (b.until - now) / 0.4);
            drawMapText(ctx, b.text, sx(b.q) + ds * 0.5, sy(b.r) - ds * 1.25, { size: 11, color: b.color, alpha: fade, family: 'body' });
        }
    },

    /** The lance-meter: the needle crossing toward impact, the green window, the lance tip's wobble, the score. */
    _drawMeter(ctx, W, H) {
        const J = this._joust;
        if (!J) return;
        const C = Lists.config().joust;
        const impact = _num(C.impactAt, 0.86);
        const win = Lists.window(J.me);
        const bw = Math.min(520, W * 0.6), bh = 18;
        const bx = Math.round((W - bw) / 2), by = Math.round(H * 0.72);
        ctx.save();
        ctx.fillStyle = 'rgba(12,10,8,0.78)';
        ctx.fillRect(bx - 12, by - 40, bw + 24 + 70, bh + 72);
        ctx.strokeStyle = 'rgba(245,197,66,0.55)';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx - 12.5, by - 40.5, bw + 25 + 70, bh + 73);
        // The bar and its window
        ctx.fillStyle = '#3a2f22';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = 'rgba(214,170,60,0.55)';
        ctx.fillRect(bx + bw * (impact - win * 4), by, bw * win * 8, bh);
        ctx.fillStyle = 'rgba(110,200,90,0.85)';
        ctx.fillRect(bx + bw * (impact - win), by, bw * win * 2, bh);
        // The needle
        const p = J.phase === 'charge' ? Lists.meterAt(J.t) : J.phase === 'result' ? (J.strike ? J.strike.timing : 1) : 0;
        const nx = bx + bw * _clamp(J.strike && J.phase !== 'ready' ? J.strike.timing : p, 0, 1);
        ctx.fillStyle = '#fff4cc';
        ctx.fillRect(Math.round(nx) - 2, by - 5, 4, bh + 10);
        // The lance tip's wobble, in its box beside the bar
        const ax = bx + bw + 30, ay = by + bh / 2;
        ctx.strokeStyle = 'rgba(245,197,66,0.4)';
        ctx.strokeRect(ax - 14.5, by - 26.5, 29, bh + 53);
        ctx.fillStyle = 'rgba(110,200,90,0.5)';
        ctx.fillRect(ax - 14, ay - 4, 28, 8);
        const aim = J.strike && J.phase !== 'ready' ? J.strike.aim : (J.phase === 'charge' ? Lists.aimAt(J.t, J.me, J.aimPhase) : 0);
        ctx.fillStyle = '#ff6a4a';
        ctx.beginPath(); ctx.arc(ax, ay + aim * (bh / 2 + 22), 5, 0, Math.PI * 2); ctx.fill();
        // Words
        const st = J.st;
        const n = st.passes.length + (J.phase === 'result' ? 0 : 1);
        const head = `Pass ${Math.max(1, n)} · You ${st.aPts} — ${st.bPts} ${J.opp.name}`;
        drawMapText(ctx, head, bx + bw / 2, by - 24, { size: 14, color: '#ffe08a' });
        const line = J.phase === 'ready' ? 'Ready your lance…'
            : J.phase === 'charge' ? (J.strike ? 'Struck!' : 'SPACE or click to strike — in the green, the tip steady')
                : J.pass ? `You: ${OUTCOME_WORD[J.pass.a]}  ·  ${J.opp.name}: ${OUTCOME_WORD[J.pass.b]}` : '';
        drawMapText(ctx, line, bx + bw / 2, by + bh + 16, { size: 12, color: '#f4efe4', family: 'body' });
        ctx.restore();
    },
};
