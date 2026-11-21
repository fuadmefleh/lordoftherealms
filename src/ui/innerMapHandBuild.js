// ============================================
// INNER MAP — BUILD BY HAND: small structures you raise yourself
// ============================================
// The street map's half of world/handBuilding.js (the model) and
// world/innerMap/handBuilding.js (the ground and the standing).
//
//   • On ground that is yours (your lot, about your own house, your estate,
//     the camp you staked in the wilds) the menu offers Build by Hand: a
//     palette (top left) of fences, a gate, a stone wall, a woodpile, a bough
//     lean-to, a shed, a hen coop, a well, a scarecrow, a signpost, a bench —
//     what each takes and whether your packs hold it. Pick one and a ghost
//     follows the cursor, green where it may stand and red (with the reason)
//     where not; left-click lays its site (stakes and string), right-click or
//     Esc puts it back; fences and walls stay in hand to lay a run.
//   • Work on It (the site's menu, or the palette's site list): walk beside it
//     and swing (InnerMapDigging's job: its ring and the slash), each piece of
//     work half an hour on the clock; each stage's goods come out of your
//     packs as you start it; the stages show as they go up: frame, walls,
//     roof. It goes on piece after piece until done, you walk off, the goods
//     run out, or it is too late in the day.
//   • Hire a Hand (in town): a townsman for the day, paid into the town's
//     purse, working beside you — it goes faster.
//   • Finished: a store to open (woodpile, lean-to, shed), a bench to sit on,
//     a sign to read; a gate opens and shuts with the town's gates; anything
//     can be taken down again (some goods back).
//
//   update(game)                  each frame on the street map (ui/game/gameLoop.js)
//   click(game, q, r, button)     an inner-map click while the mode is on
//   menuItems(game, tile, q, r)   the entries for a clicked cell
//   handle(game, item)            'hb_*'
//   collect(items, ctx, camera, T) the sites and hand-drawn structures, depth-sorted (innerMapLayers/entities.js)
//   render(ctx, camera)           the ghost (InnerMapRenderer.onHandBuildLayer)

import { InnerMap } from '../world/innerMap.js';
import { HandBuilding } from '../world/handBuilding.js';
import { InnerMapRenderer } from './innerMapRenderer.js';
import { InnerMapDigging } from './innerMapDigging.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { Crops } from '../systems/crops.js';
import { TownLabour } from '../world/townLabour.js';
import { PlayerCoin } from '../player/playerCoin.js';
import { BTN_GOLD, BTN_PLAIN, BTN_OFF, BTN_RED, esc } from './actionMenu/uiKit.js';

const PANEL_ID = 'handBuildPanel';
const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _cheb = (aq, ar, bq, br) => Math.max(Math.abs(aq - bq), Math.abs(ar - br));

function _note(game, title, text, kind = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, text, kind);
}

function _refresh(game) {
    if (game && game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, game.world);
}

function _hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
}

// The colours of the hand-drawn work
const C = {
    stake: '#6b4a2a', string: 'rgba(240,230,200,0.85)', earth: 'rgba(110,80,50,0.28)',
    post: '#6e4b2b', postHi: '#8f6a43', postLo: '#3e2a16',
    plank: '#a07648', plankHi: '#c39563', plankLo: '#6a4a2a', door: '#4a3220',
    thatch: '#b89a55', thatchHi: '#d8bd74', thatchLo: '#7a6232',
    stone: '#8d8a82', stoneHi: '#b3afa4', stoneLo: '#5c5a54',
    hole: '#1e1710', coat: '#5a6e3a', coatLo: '#3c4a26', hat: '#6b5530', straw: '#d6bd6a',
    paint: '#e8dcc0', ink: '#2a1c10',
};

export const InnerMapHandBuild = {
    active: false,
    held: null,
    _game: null,
    _keys: null,
    /** The open store ({ id }) shown in the panel, or null */
    storeOf: null,
    /** The site being worked: its id, while the work goes on */
    workingId: null,
    _ground: null,

    // ──────────── WHERE ────────────

    _hex() {
        const wt = InnerMap.currentWorldTile;
        return wt && Number.isFinite(wt.q) ? { q: wt.q, r: wt.r } : null;
    },

    _outdoors() {
        return !!(InnerMap.active && !InnerMap._insideBuilding && !InnerMap._underwater && InnerMap.tiles);
    },

    _bind(game) {
        this._game = game;
        if (game && game.world) InnerMap._hbWorld = game.world;
    },

    _rec(game, id) {
        const hex = this._hex();
        return hex && game && game.world ? HandBuilding.find(game.world, hex.q, hex.r, id) : null;
    },

    /** The player's crop at (q, r) of this map (none: the ground may take a structure). */
    _cropAt(game) {
        const hex = this._hex();
        return (q, r) => {
            const c = hex && game && game.player ? Crops.cell(game.player, hex.q, hex.r, q, r) : null;
            return !!(c && c.crop);
        };
    },

    _settlement() {
        const wt = InnerMap._currentWorldTileRef;
        return (wt && wt.settlement) || null;
    },

    /** A hand's wage for the day in this town (null out of town: nobody to hire). */
    handWage() {
        const s = this._settlement();
        if (!s) return null;
        const lab = s.labour;
        const w = lab && lab.wage && Number.isFinite(lab.wage.land) ? lab.wage.land : TownLabour.baseWage(s.type || 'town', 'land');
        const H = HandBuilding.config().hands;
        return Math.max(0.1, Math.round(Math.max(_num(w, _num(H.fallbackWage, 0.6)), 0.1) * _num(H.wageMult, 1.5) * 10) / 10);
    },

    _isLate() {
        return Math.floor(_num(InnerMap.timeOfDay, 12)) >= _num(HandBuilding.config().work.lateHour, 22);
    },

    // ──────────── THE MODE ────────────

    available() {
        return HandBuilding.enabled() && this._outdoors();
    },

    start(game) {
        this._bind(game);
        if (!this.available()) { _note(game, '🔨 Build by Hand', 'Only out of doors, on your own ground.', 'error'); return false; }
        this.storeOf = null;
        this._ground = this._ownCells(game);
        if (!this.active) {
            this.active = true;
            this._keys = (e) => this._onKey(e);
            if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('keydown', this._keys, true);
        }
        this.renderPanel();
        return true;
    },

    stop() {
        this.active = false;
        this.held = null;
        this.storeOf = null;
        this._ground = null;
        if (this._keys && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') window.removeEventListener('keydown', this._keys, true);
        this._keys = null;
        if (typeof document !== 'undefined') {
            const el = document.getElementById(PANEL_ID);
            if (el) el.remove();
        }
    },

    /** Open a structure's store in the panel (the mode on, nothing in hand). */
    openStore(game, id) {
        this.start(game);
        this.held = null;
        this.storeOf = id;
        this.renderPanel();
    },

    _onKey(e) {
        if (!this.active) return;
        const tag = e.target && e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (e.key !== 'Escape') return;
        if (this.held) this.held = null;
        else if (this.storeOf) this.storeOf = null;
        else { this.stop(); e.preventDefault(); e.stopImmediatePropagation(); return; }
        e.preventDefault();
        e.stopImmediatePropagation();
        this.renderPanel();
    },

    /** The cells of this map that are the player's ground (a Set of 'q,r'), for the mode's tint. */
    _ownCells(game) {
        const out = new Set();
        const tiles = InnerMap.tiles;
        if (!tiles) return out;
        for (let r = 0; r < tiles.length; r++) for (let q = 0; q < tiles[r].length; q++) {
            if (InnerMap.handBuildGround(q, r, game && game.world).ok) out.add(`${q},${r}`);
        }
        return out;
    },

    pick(kind) {
        if (!HandBuilding.def(kind)) return;
        this.held = kind;
        this.storeOf = null;
        this.renderPanel();
    },

    /** Lay the held kind's site with its anchor at (q, r). → { ok, reason } */
    lay(game, q, r) {
        const kind = this.held;
        if (!kind) return { ok: false, reason: 'Nothing in hand.' };
        const res = InnerMap.layHandBuilt(game.world, kind, q, r, _num(game.world && game.world.day), { cropAt: this._cropAt(game) });
        if (!res.ok) return res;
        const d = HandBuilding.def(kind);
        _note(game, `${d.icon} Staked Out`, `You drive in stakes and run string round the ground for your ${d.name.toLowerCase()}. Work on it when you have ${HandBuilding.needsText(HandBuilding.totalNeeds(kind))}: about ${HandBuilding.totalHours(kind)} hours of work.`, 'success');
        if (!d.repeat) this.held = null;
        this.renderPanel();
        return res;
    },

    click(game, q, r, button = 'left') {
        if (!this.active) return false;
        this._bind(game);
        if (!this.available()) { this.stop(); return false; }
        if (button === 'right') {
            if (this.held) this.held = null;
            else this.stop();
            this.renderPanel();
            return true;
        }
        if (!this.held) return false;   // (no kind in hand: the click is the map's as ever)
        const res = this.lay(game, q, r);
        if (!res.ok) _note(game, '🔨 Not Here', res.reason, 'warning');
        return true;
    },

    // ──────────── THE WORK ────────────

    /** The footprint cell of a record nearest the player (where to stand beside it). */
    _nearestCell(rec) {
        let best = null;
        for (const c of InnerMap.handBuildCells(rec.kind, rec.q, rec.r)) {
            const d = _cheb(c.q, c.r, InnerMap.playerInnerQ, InnerMap.playerInnerR);
            if (!best || d < best.d) best = { ...c, d };
        }
        return best || { q: rec.q, r: rec.r };
    },

    /** Go and work on a site: piece after piece until done or stopped. */
    workOn(game, id, quiet = false) {
        this._bind(game);
        const rec = this._rec(game, id);
        if (!rec) { _note(game, '🔨 Gone', 'There is nothing to build there now.', 'warning'); return false; }
        const chk = HandBuilding.canWork(game.player, rec);
        if (!chk.ok) { _note(game, `${HandBuilding.def(rec.kind).icon} Can't Go On`, chk.reason, 'warning'); this.workingId = null; return false; }
        if (this._isLate()) { _note(game, '🌙 Too Late', 'It is too dark to work on it now. Come back in the morning.', 'info'); this.workingId = null; return false; }
        const W = HandBuilding.config().work;
        const at = this._nearestCell(rec);
        const res = InnerMapDigging.start(game, 'hb_work', at.q, at.r, {
            seconds: Math.max(0.5, _num(W.chunkSeconds, 2.5)),
            verb: chk.stage.stage.name,
            needs: W.needs || null,
            onDone: (g) => this._pieceDone(g || game, id),
        });
        if (res === 'unreachable') { _note(game, 'Blocked', 'You can\'t get beside it.', 'error'); this.workingId = null; return false; }
        this.workingId = id;
        if (!quiet && chk.stage && !rec.paid[chk.stage.index]) {
            const needs = chk.stage.stage.needs || {};
            if (Object.keys(needs).length) _note(game, `${HandBuilding.def(rec.kind).icon} ${chk.stage.stage.name}`, `You lay out ${HandBuilding.needsText(needs)} from your packs.`, 'info');
        }
        return true;
    },

    /** A piece of work done: the record moved on, the clock, and on to the next piece. */
    _pieceDone(game, id) {
        const rec = this._rec(game, id);
        if (!rec) { this.workingId = null; return; }
        const d = HandBuilding.def(rec.kind);
        const hours = Math.max(0.05, _num(HandBuilding.config().work.chunkMinutes, 30) / 60);
        const res = HandBuilding.work(game.world, game.player, rec, hours, { day: _num(game.world && game.world.day) });
        if (!res.ok) { _note(game, `${d.icon} Can't Go On`, res.reason, 'warning'); this.workingId = null; this.renderPanel(); return; }
        InnerMap.passHours(hours);
        _refresh(game);
        if (res.finished) {
            if (rec.kind === 'signpost') rec.label = this._houseName(game);
            InnerMap.refreshHandBuilt(rec);
            if (this.active) this._ground = this._ownCells(game);
            const what = d.store ? ' It is ready to keep things in.' : d.seat ? ' Sit down and try it.' : d.water ? ' Water at your door: your crops nearby can be watered from it.' : d.guard ? ' The birds will think twice about your crops.' : d.room ? ' There is room for more hens at your place here.' : '';
            _note(game, `${d.icon} ${d.name} Finished`, `You stand back and look at it: your own ${d.name.toLowerCase()}, built with your own hands.${what}`, 'success');
            this.workingId = null;
            this.renderPanel();
            return;
        }
        if (res.stageDone && res.next) _note(game, `${d.icon} ${res.stage.name} — done`, `Next: ${res.next.name.toLowerCase()} (${HandBuilding.needsText(res.next.needs)}).`, 'success');
        this.renderPanel();
        // On to the next piece (stopped by walking off, the goods, or the hour)
        if (this.workingId === id) this.workOn(game, id, false);
    },

    _houseName(game) {
        const p = game && game.player;
        return (p && p.house && p.house.name) || (p && p.name) || 'Here';
    },

    /** Hire a hand for today on a site. */
    hire(game, id) {
        this._bind(game);
        const rec = this._rec(game, id);
        const s = this._settlement();
        const wage = this.handWage();
        if (!rec || !s || wage == null) { _note(game, '👷 Hire a Hand', 'There is nobody about here to hire.', 'warning'); return false; }
        const day = _num(game.world && game.world.day);
        const chk = HandBuilding.canHire(game.player, rec, day, wage);
        if (!chk.ok) { _note(game, '👷 Hire a Hand', chk.reason, 'warning'); return false; }
        PlayerCoin.pay(game.world, game.player, wage, s, 'handBuildWages', 'wages');
        const who = this._pickHand(rec);
        HandBuilding.addHand(rec, day, who);
        _note(game, '👷 A Hand Hired', `${who.name} takes your ${wage}g for the day and rolls up their sleeves: they will work beside you on the ${HandBuilding.def(rec.kind).name.toLowerCase()} today.`, 'success');
        _refresh(game);
        this.renderPanel();
        return true;
    },

    /** A townsperson's look and name for a hand (one of the town's own folk on the map). */
    _pickHand(rec) {
        const folk = (InnerMap.npcs || []).filter(n => n && n.preset && n.name && !/guard|watch|soldier|noble|lord|priest/.test(String(n.type || '')) && n.state !== 'gone');
        const taken = new Set((rec.hands || []).map(h => h.name));
        const pool = folk.filter(n => !taken.has(n.name));
        if (!pool.length) return { name: 'A labourer', preset: null };
        const n = pool[_hash(`${rec.id}|${(rec.hands || []).length}`) % pool.length];
        return { name: n.name, preset: n.preset };
    },

    /** Take a structure or site down. */
    dismantle(game, id) {
        this._bind(game);
        const rec = this._rec(game, id);
        if (!rec) return false;
        const d = HandBuilding.def(rec.kind);
        if (Object.values(rec.store || {}).some(n => n > 0)) { _note(game, `${d.icon} Take It Down`, 'Empty it first: take out what is stored in it.', 'warning'); return false; }
        const hours = HandBuilding.dismantleHours(rec);
        const at = this._nearestCell(rec);
        const res = InnerMapDigging.start(game, 'hb_down', at.q, at.r, {
            seconds: Math.min(8, Math.max(1, hours * 2)),
            verb: rec.done ? 'Taking it down' : 'Pulling up the stakes',
            needs: { energy: -2 },
            onDone: (g) => {
                const hex = this._hex();
                if (!hex) return;
                const out = HandBuilding.dismantle(game.world, game.player, hex.q, hex.r, id);
                if (!out.ok) { _note(game, `${d.icon} Take It Down`, out.reason, 'warning'); return; }
                InnerMap._unstandHandBuilt(out.rec);
                InnerMap.passHours(hours);
                const got = HandBuilding.needsText(out.got);
                const lost = Object.keys(out.lost).length ? ` (${HandBuilding.needsText(out.lost)} left lying: your packs are full)` : '';
                _note(game, `${d.icon} Taken Down`, `The ${d.name.toLowerCase()} is gone. You save ${Object.keys(out.got).length ? got : 'nothing worth keeping'}${lost}.`, 'info');
                if (this.workingId === id) this.workingId = null;
                if (this.active) this._ground = this._ownCells(game);
                _refresh(game);
                this.renderPanel();
            },
        });
        if (res === 'unreachable') { _note(game, 'Blocked', 'You can\'t get beside it.', 'error'); return false; }
        return true;
    },

    /** Sit a while on a bench of yours. */
    sit(game, id) {
        const rec = this._rec(game, id);
        const d = rec && HandBuilding.def(rec.kind);
        if (!d || !d.seat || !rec.done) return false;
        const at = this._nearestCell(rec);
        const res = InnerMap.approachAndThen(at.q, at.r, () => {
            const p = game.player;
            if (p && typeof p.modifyNeed === 'function') {
                p.modifyNeed('comfort', _num(d.seat.comfort, 6));
                p.modifyNeed('fun', _num(d.seat.fun, 2));
            }
            InnerMap._activeInteraction = { anchorQ: at.q, anchorR: at.r, defId: null, animKey: 'sitting', nonDestructive: true, elapsed: 0, duration: 3, done: false };
            InnerMap.passHours(_num(d.seat.minutes, 20) / 60);
            _note(game, '🪑 A Rest', 'You sit on your own bench a while and watch the world go by.', 'success');
            _refresh(game);
        });
        if (res === 'unreachable') _note(game, 'Blocked', 'You can\'t get to it.', 'error');
        return true;
    },

    // ──────────── THE MENU ────────────

    menuItems(game, tile, q, r) {
        if (!game || !game.world || !game.player || !this.available()) return [];
        this._bind(game);
        const out = [];
        const rec = InnerMap.handBuiltAt(q, r, game.world);
        const hex = this._hex();
        if (rec) {
            const d = HandBuilding.def(rec.kind);
            if (!d) return out;
            out.push({ type: 'separator' });
            if (!rec.done) {
                const s = HandBuilding.stageOf(rec);
                const pct = Math.round(HandBuilding.fraction(rec) * 100);
                out.push({ type: 'header', label: `${d.icon} Your ${d.name} — ${pct}% built` });
                const chk = HandBuilding.canWork(game.player, rec);
                const paid = s && rec.paid[s.index];
                if (chk.ok) out.push({ type: 'action', action: 'hb_work', label: 'Work on It', icon: '🔨', desc: `${s.stage.name}${paid ? ' (goods laid out)' : `: takes ${HandBuilding.needsText(s.stage.needs)}`}. Half an hour a swing; on until it is done or you stop`, hbId: rec.id });
                else out.push({ type: 'disabled', label: `🔨 Work on It — ${chk.reason}` });
                const wage = this.handWage();
                if (wage != null) {
                    const n = HandBuilding.handsToday(rec, _num(game.world.day)).length;
                    const hc = HandBuilding.canHire(game.player, rec, _num(game.world.day), wage);
                    if (hc.ok) out.push({ type: 'action', action: 'hb_hire', label: `Hire a Hand (${wage}g a day)`, icon: '👷', desc: `A townsman works beside you today${n ? ` (${n} hired already)` : ''}: it goes faster`, hbId: rec.id });
                    else out.push({ type: 'disabled', label: `👷 Hire a Hand — ${hc.reason}` });
                }
                out.push({ type: 'action', action: 'hb_down', label: Object.keys(HandBuilding.paidTotal(rec)).length ? 'Take Down the Site' : 'Pull Up the Stakes', icon: '🪓', desc: Object.keys(HandBuilding.salvage(rec)).length ? `Some of the goods back: ${HandBuilding.needsText(HandBuilding.salvage(rec))}` : 'The ground clear again', hbId: rec.id });
                return out;
            }
            out.push({ type: 'header', label: `${d.icon} Your ${d.name}${rec.label ? `: "${rec.label}"` : ''}` });
            if (d.store) {
                const used = HandBuilding.storeUsed(rec);
                out.push({ type: 'action', action: 'hb_store', label: `Open the ${d.name}`, icon: '📦', desc: `${used}/${HandBuilding.storeRules(rec.kind).capacity} stored. Put things in, take them out`, hbId: rec.id });
            }
            if (d.seat) out.push({ type: 'action', action: 'hb_sit', label: 'Sit a While', icon: '🪑', desc: 'Rest your feet and watch the world go by', hbId: rec.id });
            if (rec.kind === 'signpost') out.push({ type: 'action', action: 'hb_read', label: 'Read the Sign', icon: '🪧', desc: rec.label ? `"${rec.label}"` : 'Your board', hbId: rec.id });
            out.push({ type: 'action', action: 'hb_down', label: `Take Down the ${d.name}`, icon: '🪓', desc: `Back into your packs: ${HandBuilding.needsText(HandBuilding.salvage(rec))}`, hbId: rec.id });
            return out;
        }
        if (tile && (tile._isInterior || tile.building)) return out;
        const g = InnerMap.handBuildGround(q, r, game.world);
        if (g.ok) {
            const where = { lot: 'your lot', home: 'your own ground', estate: 'your estate', camp: 'your camp' }[g.why] || 'your ground';
            out.push({ type: 'separator' });
            out.push({ type: 'action', action: 'hb_start', label: 'Build by Hand', icon: '🔨', desc: `Fences, a gate, a shed, a well, a bench… on ${where}, with your own hands` });
            const camp = hex ? HandBuilding.camp(game.world, hex.q, hex.r) : null;
            if (g.why === 'camp' && camp && camp.q === q && camp.r === r) out.push({ type: 'action', action: 'hb_strike', label: 'Strike Your Camp', icon: '⛺', desc: 'Give up this ground (only once nothing of yours stands on it)' });
            return out;
        }
        const tileOk = tile && tile.subTerrain && tile.subTerrain.passable && !tile._wet && !tile.isRoad;
        if (tileOk && !this._settlement() && hex) {
            const cc = InnerMap.handBuildCampCheck(game.world);
            const camp = HandBuilding.camp(game.world, hex.q, hex.r);
            if (cc.ok && !(camp && HandBuilding.at(game.world, hex.q, hex.r).length)) {
                const R = _num(HandBuilding.config().ground.campRadius, 7);
                out.push({ type: 'separator' });
                out.push({ type: 'action', action: 'hb_camp', label: camp ? 'Move Your Camp Here' : 'Stake Out a Camp Here', icon: '⛺', desc: `Claim the ground ${R} paces about this spot as yours, to build on by hand`, campQ: q, campR: r });
            }
        }
        return out;
    },

    handle(game, item) {
        if (!item || !/^hb_/.test(item.action || '')) return false;
        this._bind(game);
        switch (item.action) {
            case 'hb_start': this.start(game); return true;
            case 'hb_work': this.workOn(game, item.hbId); return true;
            case 'hb_hire': this.hire(game, item.hbId); return true;
            case 'hb_down': this.dismantle(game, item.hbId); return true;
            case 'hb_store': this.openStore(game, item.hbId); return true;
            case 'hb_sit': this.sit(game, item.hbId); return true;
            case 'hb_read': {
                const rec = this._rec(game, item.hbId);
                _note(game, '🪧 The Sign', rec && rec.label ? `Painted on the board in your own hand: "${rec.label}".` : 'The board is blank.', 'info');
                return true;
            }
            case 'hb_camp': {
                const hex = this._hex();
                const at = Number.isFinite(item.campQ) ? { q: item.campQ, r: item.campR } : { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
                if (!hex) return true;
                const cc = InnerMap.handBuildCampCheck(game.world);
                if (!cc.ok) { _note(game, '⛺ Not Here', cc.reason, 'warning'); return true; }
                const res = HandBuilding.stakeCamp(game.world, hex.q, hex.r, at.q, at.r);
                if (!res.ok) { _note(game, '⛺ Not Here', res.reason, 'warning'); return true; }
                _note(game, '⛺ Your Camp', `You pace out the ground about the spot and mark it with a cairn of stones: ${_num(HandBuilding.config().ground.campRadius, 7)} paces every way are yours to build on. Build by Hand from here.`, 'success');
                if (this.active) this._ground = this._ownCells(game);
                return true;
            }
            case 'hb_strike': {
                const hex = this._hex();
                const res = hex ? HandBuilding.strikeCamp(game.world, hex.q, hex.r) : { ok: false, reason: 'Nowhere.' };
                _note(game, '⛺ Your Camp', res.ok ? 'You kick the cairn over: the ground is nobody\'s again.' : res.reason, res.ok ? 'info' : 'warning');
                if (res.ok && this.active) this.stop();
                return true;
            }
            default: return false;
        }
    },

    /** Each frame on the street map. */
    update(game) {
        if (this.active && !this.available()) this.stop();
        // (walked off the work: the chain is broken — InnerMapDigging dropped the job)
        if (this.workingId && !(InnerMapDigging._job && (InnerMapDigging._job.kind === 'hb_work'))) this.workingId = null;
        if (this.active && game) this._game = game;
    },

    // ──────────── THE PANEL ────────────

    renderPanel() {
        if (typeof document === 'undefined') return;
        let el = document.getElementById(PANEL_ID);
        if (!this.active) { if (el) el.remove(); return; }
        const game = this._game;
        const player = game && game.player;
        if (!el) {
            el = document.createElement('div');
            el.id = PANEL_ID;
            el.style.cssText = 'position:fixed;top:132px;left:16px;width:300px;max-height:68vh;overflow:auto;zoom:var(--ui-zoom,1);z-index:950;'
                + 'background:rgba(20,16,12,0.94);border:1px solid rgba(245,197,66,0.45);border-radius:8px;padding:10px 12px;'
                + 'font-family:var(--font-body,Georgia,serif);font-size:12px;color:#e8dcc0;box-shadow:0 6px 24px rgba(0,0,0,0.5);';
            el.addEventListener('click', (e) => this._onPanelClick(e));
            document.body.appendChild(el);
        }
        const btn = (act, label, extra = '', style = BTN_PLAIN) => `<button data-hb="${act}" ${extra} style="${style}">${label}</button>`;
        let html = '<div style="font-family:var(--font-display,\'Cinzel\',serif);color:#f5c542;font-size:14px;margin-bottom:4px;">🔨 Build by Hand</div>';
        const inv = (player && player.inventory) || {};
        const hex = this._hex();
        const rec = this.storeOf ? this._rec(game, this.storeOf) : null;
        if (rec && rec.done) {
            const d = HandBuilding.def(rec.kind);
            const R = HandBuilding.storeRules(rec.kind);
            html += `<div style="color:#aaa;font-size:11px;margin-bottom:6px;">${esc(d.icon)} Your ${esc(d.name)} · ${HandBuilding.storeUsed(rec)}/${R ? R.capacity : 0} stored</div>`;
            const stored = Object.entries(rec.store || {}).filter(([, n]) => n > 0);
            html += '<div style="color:#f5c542;font-weight:bold;">In it</div>';
            if (!stored.length) html += '<div style="color:#888;font-size:11px;padding:3px 0;">Nothing yet.</div>';
            for (const [g, n] of stored) {
                html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-top:1px solid rgba(255,255,255,0.05);"><span>${esc(HandBuilding.goodName(g))} ×${n}</span><span>${btn('take', 'Take 1', `data-g="${esc(g)}" data-n="1"`)}${btn('take', 'All', `data-g="${esc(g)}" data-n="${n}"`)}</span></div>`;
            }
            const packs = Object.entries(inv).filter(([g, n]) => g !== 'gold' && _num(n) > 0 && (!R || !R.goods || R.goods.includes(g)));
            html += '<div style="color:#f5c542;font-weight:bold;margin-top:6px;">In your packs</div>';
            if (!packs.length) html += `<div style="color:#888;font-size:11px;padding:3px 0;">${R && R.goods ? `Only ${esc(R.goods.map(x => HandBuilding.goodName(x).toLowerCase()).join(', '))} go in it.` : 'Nothing to put in.'}</div>`;
            for (const [g, n] of packs.slice(0, 30)) {
                html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-top:1px solid rgba(255,255,255,0.05);"><span>${esc(HandBuilding.goodName(g))} ×${Math.floor(n)}</span><span>${btn('put', 'Put 1', `data-g="${esc(g)}" data-n="1"`)}${btn('put', 'All', `data-g="${esc(g)}" data-n="${Math.floor(n)}"`)}</span></div>`;
            }
            html += `<div style="margin-top:8px;text-align:right;">${btn('back', '← Back')}${btn('done', 'Done (Esc)')}</div>`;
            el.innerHTML = html;
            return;
        }
        if (this.held) {
            const d = HandBuilding.def(this.held);
            html += '<div style="background:rgba(245,197,66,0.1);border-radius:6px;padding:6px 8px;margin-bottom:6px;">';
            html += `<div>In hand: <b>${esc(d.icon)} ${esc(d.name)}</b></div>`;
            html += `<div style="color:#aaa;font-size:11px;">Click your ground to stake it out${d.repeat ? ' — and again for the next length' : ''}. Right-click or Esc to put it back.</div>`;
            html += btn('cancel', '✖ Put Back');
            html += '</div>';
        } else {
            html += '<div style="color:#aaa;font-size:11px;margin-bottom:6px;">Pick something to build, then click your ground (tinted gold) to stake it out. Then Work on It.</div>';
        }
        for (const d of HandBuilding.kinds()) {
            const needs = HandBuilding.totalNeeds(d.id);
            const miss = HandBuilding.missing(player, needs);
            const short = Object.keys(miss).length;
            const fp = InnerMap.handBuildFootprint(d.id);
            const cost = Object.entries(needs).map(([g, n]) => `<span style="color:${_num(inv[g]) >= n ? '#9fd89f' : '#f0a090'};">${n} ${esc(HandBuilding.goodName(g).toLowerCase())}</span>`).join(', ') || 'only work';
            html += `<div style="padding:4px 0;border-top:1px solid rgba(255,255,255,0.05);">`;
            html += `<div style="display:flex;justify-content:space-between;align-items:center;"><span>${esc(d.icon)} <b>${esc(d.name)}</b> <span style="color:#888;">${fp[0]}×${fp[1]} · ${HandBuilding.totalHours(d.id)}h</span></span>${btn('pick', this.held === d.id ? 'In hand' : 'Place', `data-k="${esc(d.id)}"`, this.held === d.id ? BTN_OFF : BTN_GOLD)}</div>`;
            html += `<div style="color:#aaa;font-size:11px;">${cost}${short ? ' <span style="color:#888;">(gather the rest before its stage)</span>' : ''}</div></div>`;
        }
        const sites = hex && game ? HandBuilding.at(game.world, hex.q, hex.r).filter(x => !x.done) : [];
        if (sites.length) {
            html += `<div style="color:#f5c542;font-weight:bold;margin-top:6px;">🪧 Going up here (${sites.length})</div>`;
            for (const s of sites.slice(0, 12)) {
                const d = HandBuilding.def(s.kind);
                const st = HandBuilding.stageOf(s);
                html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-top:1px solid rgba(255,255,255,0.05);"><span>${esc(d.icon)} ${esc(d.name)} <span style="color:#888;">${Math.round(HandBuilding.fraction(s) * 100)}% · ${esc(st ? st.stage.name.toLowerCase() : '')}</span></span>${btn('work', this.workingId === s.id ? 'Working' : 'Work', `data-id="${esc(s.id)}"`, this.workingId === s.id ? BTN_OFF : BTN_PLAIN)}</div>`;
            }
        }
        html += `<div style="margin-top:8px;text-align:right;">${btn('done', 'Done (Esc)', '', BTN_RED)}</div>`;
        el.innerHTML = html;
    },

    _onPanelClick(e) {
        const b = e.target && e.target.closest ? e.target.closest('[data-hb]') : null;
        if (!b) return;
        e.stopPropagation();
        const game = this._game;
        switch (b.dataset.hb) {
            case 'pick': this.pick(b.dataset.k); return;
            case 'cancel': this.held = null; break;
            case 'done': this.stop(); return;
            case 'back': this.storeOf = null; break;
            case 'work': if (game) this.workOn(game, b.dataset.id); break;
            case 'put': case 'take': {
                const rec = game && this.storeOf ? this._rec(game, this.storeOf) : null;
                if (!rec) break;
                const n = Math.max(1, Math.floor(Number(b.dataset.n) || 1));
                const res = b.dataset.hb === 'put' ? HandBuilding.putIn(game.player, rec, b.dataset.g, n) : HandBuilding.takeOut(game.player, rec, b.dataset.g, n);
                if (!res.ok) _note(game, '📦 Store', res.reason, 'warning');
                _refresh(game);
                break;
            }
            default: break;
        }
        this.renderPanel();
    },

    // ──────────── THE DRAWING ────────────

    /** The ghost of the thing in hand, and the tint of your ground (drawn after the highlights). */
    render(ctx, camera) {
        if (!this.active) return;
        if (!this.available()) { this.stop(); return; }
        const T = InnerMapRenderer.TILE_SIZE;
        const ds = T * camera.zoom;
        const hov = InnerMapRenderer._hoveredInnerHex;
        ctx.save();
        // Your ground, faintly gold, about the cursor (or about you)
        if (this._ground && this._ground.size) {
            const cq = hov ? hov.q : InnerMap.playerInnerQ, cr = hov ? hov.r : InnerMap.playerInnerR;
            ctx.fillStyle = 'rgba(245,197,66,0.10)';
            for (let r = cr - 14; r <= cr + 14; r++) for (let q = cq - 18; q <= cq + 18; q++) {
                if (!this._ground.has(`${q},${r}`)) continue;
                const s = camera.worldToScreenFast(q * T, r * T);
                ctx.fillRect(Math.floor(s.x), Math.floor(s.y), Math.ceil(ds), Math.ceil(ds));
            }
        }
        if (this.held && hov) {
            const game = this._game;
            const chk = InnerMap.handBuildCheck(this.held, hov.q, hov.r, { world: game && game.world, cropAt: this._cropAt(game) });
            const fp = InnerMap.handBuildFootprint(this.held);
            const top = camera.worldToScreenFast(hov.q * T, (hov.r - fp[1] + 1) * T);
            const box = { x: top.x, y: top.y, w: fp[0] * ds, h: fp[1] * ds, ds };
            ctx.globalAlpha = 0.6;
            this._drawFinished(ctx, { kind: this.held, q: hov.q, r: hov.r, label: null }, box);
            ctx.globalAlpha = 1;
            for (const c of chk.cells || []) {
                const s = camera.worldToScreenFast(c.q * T, c.r * T);
                const x = Math.floor(s.x), y = Math.floor(s.y);
                ctx.fillStyle = chk.ok ? 'rgba(93,219,106,0.26)' : 'rgba(224,80,70,0.32)';
                ctx.fillRect(x, y, ds, ds);
                ctx.strokeStyle = chk.ok ? 'rgba(93,219,106,0.9)' : 'rgba(224,80,70,0.9)';
                ctx.lineWidth = 2;
                ctx.strokeRect(x + 1, y + 1, ds - 2, ds - 2);
            }
            if (!chk.ok && chk.reason && ds >= 14) {
                const s = camera.worldToScreenFast(hov.q * T, (hov.r - fp[1] + 1) * T);
                ctx.font = 'bold 12px Georgia, serif';
                const tw = ctx.measureText(chk.reason).width + 10;
                ctx.fillStyle = 'rgba(20,10,8,0.85)';
                ctx.fillRect(s.x, s.y - 20, tw, 17);
                ctx.fillStyle = '#f0a090';
                ctx.textBaseline = 'middle';
                ctx.fillText(chk.reason, s.x + 5, s.y - 11);
            }
        }
        ctx.restore();
    },

    /**
     * The sites, the hand-drawn structures and the hands at work, into the
     * depth-sorted pass (innerMapLayers/entities.js). A finished structure with a
     * prop is drawn by the object layer as the town's own props are.
     */
    collect(items, ctx, camera, T) {
        if (!this._outdoors()) return;
        const world = InnerMap._hbWorld;
        const hex = this._hex();
        if (!world || !hex) return;
        const list = HandBuilding.at(world, hex.q, hex.r);
        if (!list.length) return;
        const ds = T * camera.zoom;
        const W = ctx.canvas.width, H = ctx.canvas.height;
        const day = _num(world.day);
        const working = this.workingId && InnerMapDigging.isWorking() ? this.workingId : null;
        for (const rec of list) {
            const d = HandBuilding.def(rec.kind);
            if (!d) continue;
            const anchor = InnerMap.getTile(rec.q, rec.r);
            if (!anchor || !anchor._hb || anchor._hb.id !== rec.id || !anchor.explored) continue;
            const fp = InnerMap.handBuildFootprint(rec.kind);
            const s0 = camera.worldToScreenFast(rec.q * T, (rec.r - fp[1] + 1) * T);
            const box = { x: s0.x, y: s0.y, w: fp[0] * ds, h: fp[1] * ds, ds };
            if (box.x > W + ds * 2 || box.y > H + ds * 3 || box.x + box.w < -ds * 2 || box.y + box.h < -ds * 3) continue;
            const propDone = rec.done && d.prop && anchor.customObject && anchor.customObject.handBuilt === rec.id;
            if (!propDone) {
                const sortY = (rec.r + 1) * T;
                items.push({ sortY, zLayer: 1, sortX: rec.q, draw: () => {
                    if (rec.done) this._drawFinished(ctx, rec, box);
                    else this._drawSite(ctx, rec, box);
                } });
            }
            // The hands hired today, at work beside it while you are
            if (!rec.done) {
                const hands = HandBuilding.handsToday(rec, day);
                const spots = hands.length ? this._handSpots(rec, fp, hands.length) : [];
                hands.forEach((h, i) => {
                    const sp = spots[i];
                    if (!sp) return;
                    const p = camera.worldToScreenFast(sp.q * T + T / 2, sp.r * T + T / 2);
                    const px = p.x, py = p.y;
                    const dir = InnerMapCharacters.getDirection(sp.fq - sp.q, sp.fr - sp.r);
                    const anim = working === rec.id ? 'slash' : 'idle';
                    items.push({ sortY: sp.r * T + T / 2, zLayer: 2, sortX: sp.q, draw: () => this._drawHand(ctx, h, px, py, ds, anim, dir, i) });
                });
            }
        }
    },

    /** Open cells beside a footprint for the hands to stand on, each facing the cell it works. */
    _handSpots(rec, fp, n) {
        const cells = HandBuilding.cellsAt(rec.q, rec.r, fp);
        const inside = new Set(cells.map(c => `${c.q},${c.r}`));
        const out = [];
        const used = new Set([`${InnerMap.playerInnerQ},${InnerMap.playerInnerR}`]);
        for (const c of cells) {
            for (const [dq, dr] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
                const q = c.q + dq, r = c.r + dr, k = `${q},${r}`;
                if (inside.has(k) || used.has(k)) continue;
                const t = InnerMap.getTile(q, r);
                if (!t || !t.subTerrain || !t.subTerrain.passable || t._wet || t.building || t.customObject) continue;
                used.add(k);
                out.push({ q, r, fq: c.q, fr: c.r });
                if (out.length >= n) return out;
            }
        }
        return out;
    },

    _drawHand(ctx, h, px, py, ds, anim, dir, i) {
        const cw = ds * 1.2, ch = ds * 1.8;
        const t = (typeof performance !== 'undefined' ? performance.now() : 0) / 1000 + i * 0.37;
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.beginPath(); ctx.ellipse(px, py + ds * 0.28, cw * 0.2, ds * 0.07, 0, 0, Math.PI * 2); ctx.fill();
        const ok = h.preset && InnerMapCharacters.drawCharacter(ctx, h.preset, anim, dir, t, px - cw / 2, py - ch + ds * 0.45, cw, ch);
        if (!ok) {
            ctx.fillStyle = '#6a5a44';
            ctx.beginPath(); ctx.ellipse(px, py - ds * 0.15, ds * 0.17, ds * 0.32, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#d9b58c';
            ctx.beginPath(); ctx.arc(px, py - ds * 0.55, ds * 0.12, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    },

    // ── the pieces ──

    _px(ds) { return Math.max(1, ds / 32); },

    _post(ctx, x, yTop, yFoot, ds) {
        const w = Math.max(2, ds * 0.1);
        ctx.fillStyle = C.post;
        ctx.fillRect(x - w / 2, yTop, w, yFoot - yTop);
        ctx.fillStyle = C.postHi;
        ctx.fillRect(x - w / 2, yTop, Math.max(1, w * 0.35), yFoot - yTop);
        ctx.fillStyle = C.postLo;
        ctx.fillRect(x - w / 2, yTop, w, Math.max(1, w * 0.35));
    },

    _rail(ctx, x0, x1, y, ds) {
        const h = Math.max(2, ds * 0.07);
        ctx.fillStyle = C.plank;
        ctx.fillRect(x0, y - h / 2, x1 - x0, h);
        ctx.fillStyle = C.plankLo;
        ctx.fillRect(x0, y + h / 2 - Math.max(1, h * 0.3), x1 - x0, Math.max(1, h * 0.3));
    },

    _stone(ctx, x, y, rx, ry, k) {
        ctx.fillStyle = k % 3 === 0 ? C.stoneHi : k % 3 === 1 ? C.stone : C.stoneLo;
        ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(40,38,34,0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
    },

    /** Stakes at the corners and string round the ground: every site. */
    _drawStakes(ctx, box) {
        const { x, y, w, h, ds } = box;
        const i = ds * 0.12;
        ctx.fillStyle = C.earth;
        ctx.fillRect(x + i * 0.5, y + i * 0.5, w - i, h - i);
        const pts = [[x + i, y + i], [x + w - i, y + i], [x + w - i, y + h - i], [x + i, y + h - i]];
        ctx.strokeStyle = C.string;
        ctx.lineWidth = Math.max(1, ds * 0.025);
        ctx.beginPath();
        pts.forEach(([px, py], k) => (k ? ctx.lineTo(px, py - ds * 0.12) : ctx.moveTo(px, py - ds * 0.12)));
        ctx.closePath();
        ctx.stroke();
        for (const [px, py] of pts) this._post(ctx, px, py - ds * 0.2, py + ds * 0.04, ds * 0.8);
    },

    /** Is this kind drawn as a little building (frame → walls → roof over its footprint)? */
    _isHut(kind) {
        return kind === 'shed' || kind === 'coop' || kind === 'lean_to';
    },

    /** The hut's geometry over its ground box: wall foot, wall top, roof top. */
    _hutGeom(box, kind) {
        const { x, y, w, h, ds } = box;
        const foot = y + h - ds * 0.12;
        const wallH = kind === 'coop' ? ds * 0.75 : kind === 'lean_to' ? ds * 0.5 : ds * 0.95;
        const lift = kind === 'coop' ? ds * 0.3 : 0;
        const wallTop = foot - lift - wallH;
        const roofTop = y + (kind === 'lean_to' ? ds * 0.6 : ds * 0.05) - (kind === 'shed' ? ds * 0.55 : ds * 0.25);
        return { x0: x + ds * 0.1, x1: x + w - ds * 0.1, foot, base: foot - lift, wallTop, roofTop };
    },

    _drawLook(ctx, rec, look, box, k = 1) {
        const { x, y, w, h, ds } = box;
        const kind = rec.kind;
        const cx = x + w / 2, foot = y + h - ds * 0.18;
        const p = this._px(ds);
        if (this._isHut(kind)) {
            const g = this._hutGeom(box, kind);
            if (look === 'frame') {
                const xs = [g.x0 + p * 2, g.x1 - p * 2];
                if (w > ds * 2) xs.splice(1, 0, cx);
                const top = g.foot - (g.foot - g.wallTop) * k;
                for (const px of xs) this._post(ctx, px, top, g.foot, ds);
                if (k >= 1) {
                    this._rail(ctx, g.x0, g.x1, g.wallTop + p, ds);
                    // the rafters up to the ridge
                    ctx.strokeStyle = C.post; ctx.lineWidth = Math.max(2, ds * 0.07);
                    ctx.beginPath();
                    ctx.moveTo(g.x0, g.wallTop); ctx.lineTo(cx, g.roofTop + ds * 0.1); ctx.lineTo(g.x1, g.wallTop);
                    ctx.stroke();
                }
            } else if (look === 'walls') {
                const top = g.base - (g.base - g.wallTop) * k;
                ctx.fillStyle = C.plank;
                ctx.fillRect(g.x0, top, g.x1 - g.x0, g.base - top);
                ctx.strokeStyle = C.plankLo; ctx.lineWidth = 1;
                for (let px = g.x0 + ds * 0.18; px < g.x1; px += ds * 0.18) { ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, g.base); ctx.stroke(); }
                ctx.fillStyle = C.plankHi; ctx.fillRect(g.x0, top, g.x1 - g.x0, Math.max(1, p));
                if (k >= 1) {
                    // the door (a shed), the hens' hatch and ladder (a coop)
                    ctx.fillStyle = C.door;
                    if (kind === 'shed') ctx.fillRect(cx - ds * 0.22, g.base - ds * 0.75, ds * 0.44, ds * 0.75);
                    else if (kind === 'coop') {
                        ctx.fillRect(cx - ds * 0.12, g.base - ds * 0.3, ds * 0.24, ds * 0.3);
                        ctx.strokeStyle = C.postLo; ctx.lineWidth = Math.max(1, p * 1.5);
                        ctx.beginPath(); ctx.moveTo(cx - ds * 0.1, g.base); ctx.lineTo(cx - ds * 0.3, g.foot); ctx.moveTo(cx + ds * 0.1, g.base); ctx.lineTo(cx - ds * 0.1, g.foot); ctx.stroke();
                        for (const px of [g.x0 + p * 2, g.x1 - p * 2]) this._post(ctx, px, g.base, g.foot, ds * 0.8);
                    }
                }
            } else if (look === 'roof') {
                ctx.save();
                ctx.globalAlpha *= 0.35 + 0.65 * k;
                const over = ds * 0.12;
                ctx.fillStyle = C.thatch;
                ctx.beginPath();
                ctx.moveTo(g.x0 - over, g.wallTop + ds * 0.12);
                ctx.lineTo(cx, g.roofTop);
                ctx.lineTo(g.x1 + over, g.wallTop + ds * 0.12);
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = C.thatchLo; ctx.lineWidth = 1;
                for (let i = 1; i < 6; i++) {
                    const t = i / 6;
                    ctx.beginPath();
                    ctx.moveTo(g.x0 - over + (cx - g.x0 + over) * t, g.wallTop + ds * 0.12 - (g.wallTop + ds * 0.12 - g.roofTop) * t);
                    ctx.lineTo(g.x1 + over - (g.x1 + over - cx) * t, g.wallTop + ds * 0.12 - (g.wallTop + ds * 0.12 - g.roofTop) * t);
                    ctx.stroke();
                }
                ctx.strokeStyle = C.thatchHi; ctx.lineWidth = Math.max(1, p * 1.5);
                ctx.beginPath(); ctx.moveTo(g.x0 - over, g.wallTop + ds * 0.12); ctx.lineTo(cx, g.roofTop); ctx.lineTo(g.x1 + over, g.wallTop + ds * 0.12); ctx.stroke();
                ctx.restore();
            }
            return;
        }
        switch (look) {
            case 'posts': {
                const xs = w > ds * 1.2 ? [x + ds * 0.25, x + w - ds * 0.25] : kind === 'gate' ? [x + ds * 0.12, x + w - ds * 0.12] : [cx];
                const tall = kind === 'scarecrow' ? ds * 1.3 : kind === 'signpost' ? ds * 1.15 : kind === 'bench' ? ds * 0.35 : kind === 'woodpile' ? ds * 0.7 : ds * 0.75;
                for (const px of xs) this._post(ctx, px, foot - tall * k, foot, ds);
                if (kind === 'scarecrow' && k >= 1) this._rail(ctx, cx - ds * 0.38, cx + ds * 0.38, foot - ds * 0.95, ds);
                break;
            }
            case 'rails': {
                if (kind === 'gate') {
                    ctx.fillStyle = C.plank;
                    ctx.fillRect(x + ds * 0.16, foot - ds * 0.62, (w - ds * 0.32) * k, ds * 0.5);
                    ctx.strokeStyle = C.plankLo; ctx.lineWidth = Math.max(1, ds * 0.05);
                    ctx.beginPath(); ctx.moveTo(x + ds * 0.16, foot - ds * 0.12); ctx.lineTo(x + ds * 0.16 + (w - ds * 0.32) * k, foot - ds * 0.62); ctx.stroke();
                } else {
                    this._rail(ctx, x, x + w * k, foot - ds * 0.55, ds);
                    this._rail(ctx, x, x + w * k, foot - ds * 0.28, ds);
                }
                break;
            }
            case 'stones': {
                if (kind === 'well') {
                    const n = Math.max(1, Math.round(10 * k));
                    for (let i = 0; i < n; i++) {
                        const a = (i / 10) * Math.PI * 2;
                        this._stone(ctx, cx + Math.cos(a) * w * 0.32, y + h * 0.55 + Math.sin(a) * h * 0.26, ds * 0.16, ds * 0.1, i);
                    }
                } else if (!(kind === 'stone_wall' && rec.done)) {
                    // (the footing stones, while the wall is going up: the finished wall stands on them)
                    const n = Math.max(1, Math.round(3 * k));
                    for (let i = 0; i < n; i++) this._stone(ctx, x + w * (0.2 + i * 0.3), foot - ds * 0.06, ds * 0.17, ds * 0.11, i);
                }
                break;
            }
            case 'walls': {
                if (kind === 'stone_wall') {
                    // Dry-stone courses, squared and staggered, joined to the walls either side; a cap of flat stones
                    const left = this._neighbour(rec, -1, 0), right = this._neighbour(rec, 1, 0);
                    const x0 = Math.round(left ? x : x + ds * 0.06), x1 = Math.round(right ? x + w : x + w - ds * 0.06);
                    const wallH = ds * 0.62, courseH = wallH / 4;
                    const rows = Math.max(1, Math.round(4 * k));
                    const base = Math.round(foot);
                    const hsh = (i, j) => { const v = Math.sin((rec.q * 31 + rec.r * 17 + i * 7.3 + j * 13.1)) * 43758.5453; return v - Math.floor(v); };
                    // the body (the joints show as its dark)
                    const top = Math.round(base - courseH * rows);
                    ctx.fillStyle = C.stoneLo;
                    ctx.fillRect(x0, top, x1 - x0, base - top);
                    const gap = Math.max(1, Math.round(p));
                    for (let row = 0; row < rows; row++) {
                        const y1 = Math.round(base - courseH * row), y0 = Math.round(base - courseH * (row + 1));
                        let px = x0 - ((row % 2) ? Math.round(ds * 0.12) : 0);
                        for (let i = 0; px < x1; i++) {
                            const sw = Math.round(ds * (0.18 + hsh(row, i) * 0.14));
                            const a0 = Math.max(x0, px), a1 = Math.min(x1, px + sw) - gap;
                            if (a1 > a0) {
                                const v = hsh(i, row);
                                ctx.fillStyle = v < 0.33 ? C.stoneHi : v < 0.7 ? C.stone : '#77746c';
                                ctx.fillRect(a0, y0 + gap, a1 - a0, y1 - y0 - gap);
                                // a lit top edge and a shadowed foot on each stone
                                ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(a0, y0 + gap, a1 - a0, gap);
                                ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(a0, y1 - gap, a1 - a0, gap);
                            }
                            px += sw;
                        }
                    }
                    if (rows >= 4) {
                        // the coping: flat stones set on edge, a little moss
                        const cy = top - Math.round(courseH * 0.55);
                        ctx.fillStyle = C.stoneLo; ctx.fillRect(x0, cy, x1 - x0, top - cy);
                        for (let i = 0, px = x0; px < x1; i++) {
                            const sw = Math.round(ds * (0.1 + hsh(9, i) * 0.06));
                            ctx.fillStyle = hsh(i, 9) < 0.5 ? C.stone : C.stoneHi;
                            ctx.fillRect(px, cy + gap, Math.max(1, Math.min(x1, px + sw) - px - gap), top - cy - gap);
                            px += sw;
                        }
                        ctx.fillStyle = 'rgba(110,140,70,0.6)';
                        ctx.fillRect(Math.round(x0 + (x1 - x0) * 0.15), cy, Math.round((x1 - x0) * 0.25), gap * 2);
                    }
                    // its shadow on the ground
                    ctx.fillStyle = 'rgba(0,0,0,0.16)';
                    ctx.fillRect(x0, base, x1 - x0, Math.max(1, Math.round(ds * 0.06)));
                } else if (kind === 'well') {
                    // the head: a stone kerb, two posts, the winch and a little roof
                    this._post(ctx, x + w * 0.2, foot - ds * 1.2 * k, foot - h * 0.3, ds);
                    this._post(ctx, x + w * 0.8, foot - ds * 1.2 * k, foot - h * 0.3, ds);
                    if (k >= 1) {
                        this._rail(ctx, x + w * 0.2, x + w * 0.8, foot - ds * 1.0, ds);
                        ctx.fillStyle = C.thatch;
                        ctx.beginPath(); ctx.moveTo(x + w * 0.1, foot - ds * 1.15); ctx.lineTo(cx, foot - ds * 1.55); ctx.lineTo(x + w * 0.9, foot - ds * 1.15); ctx.closePath(); ctx.fill();
                        ctx.strokeStyle = C.ink; ctx.lineWidth = 1;
                        ctx.beginPath(); ctx.moveTo(cx, foot - ds * 1.0); ctx.lineTo(cx, foot - h * 0.45); ctx.stroke();
                    }
                }
                break;
            }
            case 'pit': {
                ctx.fillStyle = 'rgba(120,88,52,0.9)';
                ctx.beginPath(); ctx.ellipse(x + w * 0.85, y + h * 0.8, ds * 0.3 * Math.max(0.3, k), ds * 0.16 * Math.max(0.3, k), 0, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = C.hole;
                ctx.beginPath(); ctx.ellipse(cx, y + h * 0.55, w * 0.26 * Math.max(0.3, k), h * 0.2 * Math.max(0.3, k), 0, 0, Math.PI * 2); ctx.fill();
                break;
            }
            case 'pile': {
                const n = Math.max(1, Math.round(6 * k));
                for (let i = 0; i < n; i++) {
                    const row = i < 3 ? 0 : i < 5 ? 1 : 2;
                    const col = i < 3 ? i : i < 5 ? i - 3 : 0;
                    const lx = x + w * (0.25 + col * 0.25 + row * 0.12), ly = foot - ds * 0.12 - row * ds * 0.22;
                    ctx.fillStyle = C.plankLo; ctx.beginPath(); ctx.arc(lx, ly, ds * 0.13, 0, Math.PI * 2); ctx.fill();
                    ctx.fillStyle = C.plankHi; ctx.beginPath(); ctx.arc(lx, ly, ds * 0.08, 0, Math.PI * 2); ctx.fill();
                }
                break;
            }
            case 'figure': {
                ctx.save();
                ctx.globalAlpha *= 0.35 + 0.65 * k;
                ctx.fillStyle = C.coat;
                ctx.beginPath();
                ctx.moveTo(cx - ds * 0.38, foot - ds * 1.0); ctx.lineTo(cx + ds * 0.38, foot - ds * 1.0);
                ctx.lineTo(cx + ds * 0.22, foot - ds * 0.45); ctx.lineTo(cx - ds * 0.22, foot - ds * 0.45); ctx.closePath(); ctx.fill();
                ctx.fillStyle = C.coatLo; ctx.fillRect(cx - ds * 0.03, foot - ds * 1.0, ds * 0.06, ds * 0.55);
                ctx.fillStyle = C.straw;
                for (const sx of [-0.4, 0.4]) { ctx.beginPath(); ctx.moveTo(cx + sx * ds, foot - ds * 1.0); ctx.lineTo(cx + sx * ds * 1.15, foot - ds * 0.88); ctx.lineTo(cx + sx * ds * 0.95, foot - ds * 0.9); ctx.fill(); }
                ctx.fillStyle = '#c9b48a'; ctx.beginPath(); ctx.arc(cx, foot - ds * 1.15, ds * 0.14, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = C.hat; ctx.fillRect(cx - ds * 0.24, foot - ds * 1.27, ds * 0.48, ds * 0.05);
                ctx.fillRect(cx - ds * 0.13, foot - ds * 1.42, ds * 0.26, ds * 0.16);
                ctx.restore();
                break;
            }
            case 'board': {
                const bw = ds * 0.95 * Math.max(0.3, k), bh = ds * 0.36;
                ctx.fillStyle = C.plank; ctx.fillRect(cx - bw / 2, foot - ds * 1.1, bw, bh);
                ctx.strokeStyle = C.plankLo; ctx.lineWidth = Math.max(1, p); ctx.strokeRect(cx - bw / 2, foot - ds * 1.1, bw, bh);
                if (k >= 1 && rec.label && ds >= 16) {
                    ctx.fillStyle = C.paint;
                    ctx.font = `bold ${Math.max(6, Math.round(ds * 0.16))}px Georgia, serif`;
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillText(String(rec.label).slice(0, 18), cx, foot - ds * 1.1 + bh / 2, bw - 2);
                    ctx.textAlign = 'start';
                }
                break;
            }
            case 'seat': {
                const sw = (w - ds * 0.2) * Math.max(0.3, k);
                ctx.fillStyle = C.plank; ctx.fillRect(x + ds * 0.1, foot - ds * 0.42, sw, ds * 0.14);
                ctx.fillStyle = C.plankHi; ctx.fillRect(x + ds * 0.1, foot - ds * 0.42, sw, Math.max(1, p));
                ctx.fillStyle = C.plankLo; ctx.fillRect(x + ds * 0.1, foot - ds * 0.3, sw, Math.max(1, p));
                break;
            }
            default: break;
        }
    },

    /** The record of the same kind next door (dq, dr), for joining walls. */
    _neighbour(rec, dq, dr) {
        const t = InnerMap.getTile(rec.q + dq, rec.r + dr);
        const o = t && t._hb ? InnerMap.handBuiltAt(rec.q + dq, rec.r + dr) : null;
        return !!(o && o.kind === rec.kind && o.done);
    },

    /** A site: its stakes, the stages done, the one under way rising. */
    _drawSite(ctx, rec, box) {
        const d = HandBuilding.def(rec.kind);
        this._drawStakes(ctx, box);
        const stages = d.stages || [];
        stages.forEach((st, i) => {
            if (i < rec.stage) this._drawLook(ctx, rec, st.look, box, 1);
            else if (i === rec.stage && _num(rec.progress) > 0) this._drawLook(ctx, rec, st.look, box, Math.min(1, _num(rec.progress) / Math.max(0.01, _num(st.hours, 1))));
        });
    },

    /** A finished hand-drawn structure (and the ghost of one in hand): every stage's look, in order. */
    _drawFinished(ctx, rec, box) {
        const d = HandBuilding.def(rec.kind);
        if (!d) return;
        ctx.save();
        for (const st of d.stages || []) this._drawLook(ctx, rec, st.look, box, 1);
        ctx.restore();
    },
};

InnerMapRenderer.onHandBuildLayer = (ctx, camera) => InnerMapHandBuild.render(ctx, camera);
