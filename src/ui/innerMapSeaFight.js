// ============================================
// SEA FIGHT ON THE WATER — ships under sail around your deck
// ============================================
// The rules are systems/seaFights.js; this puts the fight on the inner map
// of the open sea, aboard your ship (ui/innerMapDeck.js). Your flagship is
// the deck you stand on — drawn, as always, heading west — so the fight is
// drawn in her frame: the enemy and your squadron sail round her, turned as
// she turns; a compass shows the wind and her true heading. Enemy ships and
// your consorts are the LPC hulls (world/shipHulls.js) drawn free on the
// water, flipped to their heading; broadsides throw smoke, flashes and
// splashes; a sunk ship settles and goes; a struck one shows a white flag.
//
// The captain's orders come from a side panel: the helm (close, rake, keep
// at range, grapple, flee, heave to), the target, the shot (round, chain,
// grape), the squadron (follow, engage, hold), strike your colours, or hand
// the fight to the sailing master (SeaFights.autoResolve). Grappled with the
// flagship, it becomes the deck's own hand-to-hand fight
// (InnerMapDeck.startSeaBoarding: the enemy hull laid alongside, her crew
// over the rail); its end goes back to the fight. When the fight is over
// it hands back to the scene it came from — the pirates' phased scene
// (Pirates' victory, defeat, aftermath), the blockade scene or a patrol's
// interception — through the scene's '__fought' choice (ui/actionMenu/
// seaScenes.js, blockadeScenes.js).
// Leaving the deck, or the day ending, sails it out by the dice.
//
// begin(game, { kind: 'pirates' | 'blockade' | 'intercept', state }) from those scenes;
// update(dt, game) and renderHud from ui/game/gameLoop.js; abandon(game)
// from exitInnerMap. Not merged into anything; Math.random only for smoke.

import { InnerMap } from '../world/innerMap.js';
import { InnerMapRenderer } from './innerMapRenderer.js';
import { InnerMapDeck } from './innerMapDeck.js';
import { InnerMapReactions } from './innerMapReactions.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { ActionMenu } from './actionMenu.js';
import { CustomObjects } from '../world/customObjects.js';
import { ShipHulls } from '../world/shipHulls.js';
import { SeaFights } from '../systems/seaFights.js';
import { BlockadeRunning } from '../systems/blockadeRunning.js';
import { SeaInterception } from '../systems/seaInterception.js';
import { Ships } from '../systems/ships.js';
import { drawMapText } from './mapInk.js';

// Fights begun from a naval scene: its enemy line and its own settling (the pirates' scene is 'sea')
const NAVAL = { blockade: BlockadeRunning, intercept: SeaInterception };
import { audioManager } from '../systems/audio.js';

const BTN = 'padding:6px 9px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;';
const BTN_ON = `${BTN}border:1px solid rgba(245,197,66,0.75);background:linear-gradient(180deg,#f6cf57,#d9a92a);color:#1a1a1a;`;
const BTN_OFF = `${BTN}border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:var(--text-primary);`;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const HELM = [
    ['close', '⛵', 'Close', 'Steer for her'],
    ['rake', '💥', 'Rake', 'Cross her bow or stern and pour it in'],
    ['broadside', '🎯', 'Keep at range', 'Hold her on the beam and pound her'],
    ['grapple', '⚓', 'Grapple', 'Come alongside and board'],
    ['flee', '💨', 'Flee', 'Crowd on sail and run'],
    ['hold', '🛑', 'Heave to', 'Lie still, guns run out'],
];
const SHOT = [['round', 'Round shot', 'Hulls'], ['chain', 'Chain shot', 'Rigging: slows her'], ['grape', 'Grape', 'Clears her deck of men']];
const SQUADRON = [['follow', 'Follow me'], ['engage', 'Engage'], ['hold', 'Hold']];

/** Hull drawn for a fight ship: its type's LPC hull. */
// How much wider the fight is drawn than it is sailed (see _toWorld)
const SPREAD = 1.5;

function _hullOf(s) {
    return s.hullId || ShipHulls.hullFor(s.typeId) || 'hull_sloop';
}

export const InnerMapSeaFight = {
    fight: null,
    ctx: null,
    _game: null,
    _fx: [],
    _prevSeaLayer: null,
    _hooked: false,
    _day: null,
    _boarding: false,
    _centres: new Map(),
    _panelT: 0,

    active() {
        return !!this.fight;
    },

    /**
     * Start a sea fight on the water. ctx: { kind: 'pirates'|'blockade'|'intercept', state }.
     * Goes on deck first if need be; where the deck can't be had (in port,
     * no ship), the fight is sailed out at once.
     */
    async begin(game, ctx) {
        const p = game && game.player;
        if (!p || !ctx || this.fight) return false;
        const tile = game.world.getTile(p.q, p.r);
        const atSea = p.boardedShip != null && Ships.isWaterTile(tile);
        if (atSea && !InnerMapDeck.active(game)) {
            if (InnerMap.active && typeof game.exitInnerMap === 'function') game.exitInnerMap({ force: true });
            try { await game.enterInnerMap(p.q, p.r); } catch (err) { console.warn('[SeaFight] could not go on deck', err); }
        }
        const specs = SeaFights.playerSide(p, game.world);
        const enemy = NAVAL[ctx.kind] ? NAVAL[ctx.kind].enemySpecs(game.world, ctx.state) : SeaFights.enemyFromPirates(ctx.state.enemy || {});
        const hour = InnerMap.timeOfDay;
        const night = ctx.state && ctx.state.night ? true : (typeof hour === 'number' ? hour >= 20 || hour < 6 : false);
        const weather = (InnerMap.weather && InnerMap.weather.type) || 'clear';
        if (!specs.length) return false;
        const f = SeaFights.create(specs, enemy, { night, weather, context: ctx.kind });
        f.gunnery = Math.max(0, Number((p.skills && p.skills.combat) || 0));
        // Fallen on at dusk, or under false colours: their guns are not run out yet
        if (ctx.state && ctx.state.unready) for (const s of SeaFights.ships(f, 'enemy')) { s.reloadLeft += 10; s.speed *= 0.3; }
        if (!InnerMapDeck.active(game)) {
            // No deck to fight on: the sailing master fights her
            SeaFights.autoResolve(f);
            this.fight = f; this.ctx = ctx; this._game = game;
            this._finish(game);
            return true;
        }
        this.fight = f;
        this.ctx = ctx;
        this._game = game;
        this._fx = [];
        this._boarding = false;
        this._day = game.world.day;
        // The crew to the guns (data/deckLife.json situations.battle)
        InnerMapDeck.situationOverride = { kind: 'battle' };
        InnerMapDeck._sitKey = null;
        this._prevSeaLayer = InnerMapRenderer.onSeaLayer;
        this._hooked = true;
        const prev = this._prevSeaLayer;
        InnerMapRenderer.onSeaLayer = (c, cam, canvas, dt) => {
            if (typeof prev === 'function') prev(c, cam, canvas, dt);
            this.render(c, cam, canvas);
        };
        // Zoom out to the water round her: the deck camera shows a few yards of planking, and
        // a foe a dozen lengths off (or alongside, her hull merging with yours) can't be read.
        // About 64 tiles across: both ships and the sea between them (min zoom put back after)
        const cam = game.innerMapCamera;
        if (cam) {
            const fitZ = ((game.canvas && game.canvas.width) || 1600) / (64 * InnerMapRenderer.TILE_SIZE);
            this._camBefore = { minZoom: cam.minZoom, zoom: cam.zoom };
            cam.minZoom = Math.min(cam.minZoom || fitZ, fitZ);
            cam.targetZoom = Math.min(cam.zoom, fitZ);
        }
        game.ui.showNotification('⚔️ Clear for Action', `${f.log[0] || ''} Give your orders from the panel: the helm, the shot, the squadron.`, 'warning');
        this.showPanel(game);
        return true;
    },

    /* ── Every frame ──────────────────────────────────────────── */

    update(dt, game) {
        const f = this.fight;
        if (!f || this._boarding) { this._tickFx(dt); return; }
        // Off the deck, or the day gone by under the fight: sail it out
        if (!InnerMapDeck.active(game) || game.world.day !== this._day) { this.abandon(game); return; }
        const before = f.log.length;
        SeaFights.advance(f, dt);
        this._readEvents(game);
        if (f.log.length !== before) {
            const last = f.log[f.log.length - 1];
            if (last && /strikes|goes down|Grapnels|carried|draw away/.test(last)) game.ui.showNotification('⚓ Sea Fight', last, 'info');
        }
        this._tickFx(dt);
        this._panelT -= dt;
        if (f.outcome) {
            if (f.outcome.kind === 'boarding') this._startBoarding(game);
            else this._finish(game);
            return;
        }
        if (this._panelT <= 0) { this._panelT = 2; this._refreshPanelStatus(); }
    },

    /** Broadsides, sinkings and grapnels from the rules: smoke, flashes, splashes, the crew crying out. */
    _readEvents(game) {
        const f = this.fight;
        const evs = f.events.splice(0);
        for (const e of evs) {
            if (e.type === 'broadside' || e.type === 'chase') {
                const from = SeaFights.ship(f, e.from);
                const to = SeaFights.ship(f, e.to);
                if (!from || !to) continue;
                const n = e.type === 'chase' ? 2 : 6;
                for (let i = 0; i < n; i++) {
                    const along = (i / Math.max(1, n - 1) - 0.5) * 2.4;
                    const side = e.type === 'chase' ? 0 : (e.side === 'starboard' ? 1 : -1);
                    const hx = Math.cos(from.heading), hy = Math.sin(from.heading);
                    // (starboard is to the right of the bow: heading + 90°)
                    const px = -hy * side, py = hx * side;
                    this._fx.push({ kind: 'smoke', x: from.x + hx * along + px * 0.9, y: from.y + hy * along + py * 0.9, vx: px * 0.4 + (Math.random() - 0.5) * 0.2, vy: py * 0.4 + (Math.random() - 0.5) * 0.2, t: 0, life: 2.4 + Math.random(), delay: i * 0.06 });
                    this._fx.push({ kind: 'flash', x: from.x + hx * along + px * 0.8, y: from.y + hy * along + py * 0.8, t: 0, life: 0.18, delay: i * 0.06 });
                }
                const hits = Math.round(n * e.hit);
                for (let i = 0; i < n; i++) {
                    const miss = i >= hits;
                    const ox = (Math.random() - 0.5) * (miss ? 3.5 : 1.6), oy = (Math.random() - 0.5) * (miss ? 3.5 : 1.2);
                    this._fx.push({ kind: miss ? 'splash' : 'splinter', x: to.x + ox, y: to.y + oy, t: 0, life: miss ? 0.9 : 0.6, delay: 0.25 + i * 0.07 });
                }
                const near = from.flagship || to.flagship;
                // the guns going off down her side, then the shot striking home or throwing up the sea
                // (recorded cannon: systems/audio/samples.js; thunder stands in while they load)
                try {
                    const far = near ? 1 : 0.45;
                    const guns = audioManager.sampleReady && audioManager.sampleReady('cannon_fire');
                    if (!guns) audioManager.playSFX(near ? 'thunder' : 'thunder_far');
                    for (let i = 0; i < Math.min(n, 4); i++) audioManager.playSFX('cannon_fire', { gain: far * (0.65 + 0.35 * Math.random()), delay: i * 0.09 + Math.random() * 0.05, lowpass: near ? undefined : 1500 });
                    const toUs = !!to.flagship;
                    for (let i = 0; i < Math.min(n, 3); i++) {
                        const miss = i >= hits;
                        audioManager.playSFX(miss ? 'cannon_miss' : 'cannon_hit', { gain: (toUs ? 1 : 0.4) * (miss ? 0.8 : 1), delay: 0.45 + i * 0.12 + Math.random() * 0.06, lowpass: toUs ? undefined : 1800 });
                    }
                } catch { /* sound is best-effort */ }
                if (to.flagship && e.hull + e.rig > 0.5) {
                    const T = InnerMapRenderer.TILE_SIZE;
                    const L = InnerMap._deck;
                    if (L) InnerMapCombat._spawnFloat(((L.minQ + L.maxQ) / 2) * T, L.minR * T, Math.max(1, Math.round(e.hull)), 'player_hit', e.rake ? 'Raked!' : null);
                    const crew = InnerMapDeck._crew();
                    const who = crew[Math.floor(Math.random() * crew.length)];
                    if (who) InnerMapReactions.bark(who, e.rake ? 'She\'s raking us!' : (e.crew ? 'Men down!' : 'We\'re hit!'), 2.5);
                } else if (from.flagship) {
                    const crew = InnerMapDeck._crew();
                    const who = crew[Math.floor(Math.random() * crew.length)];
                    if (who && Math.random() < 0.5) InnerMapReactions.bark(who, e.rake ? 'Raked her, by God!' : (hits ? 'Hulled her!' : 'Fire!'), 2.2);
                }
            } else if (e.type === 'sunk') {
                const s = SeaFights.ship(f, e.id);
                if (s) s._sinkT = 0;
            }
        }
    },

    _tickFx(dt) {
        for (const x of this._fx) {
            if (x.delay > 0) { x.delay -= dt; continue; }
            x.t += dt;
            if (x.vx) { x.x += x.vx * dt; x.y += x.vy * dt; }
        }
        this._fx = this._fx.filter(x => x.t < x.life);
        const f = this.fight;
        if (f) for (const s of f.ships) if (s._sinkT != null) s._sinkT += dt;
    },

    /* ── Grappled: the deck's hand-to-hand fight ─────────────── */

    _startBoarding(game) {
        const f = this.fight;
        const o = f.outcome;
        const foe = SeaFights.ship(f, o.enemyId);
        this._boarding = true;
        InnerMapDeck.situationOverride = { kind: 'boarding', scene: foe && foe.kind === 'navy' ? 'navy' : 'pirates' };
        const ok = InnerMapDeck.startSeaBoarding(game, {
            enemy: SeaFights.boardingStrength(f, o.enemyId),
            crewKind: foe && foe.kind ? foe.kind : 'pirate',
            hullId: foe ? _hullOf(foe) : 'hull_sloop',
            title: foe ? foe.name : 'Boarders',
            lead: o.by === 'player' ? `You lash on to ${foe ? foe.name : 'her'} and her crew meet yours at the rail.` : `${foe ? foe.name : 'She'} grapples and her crew come over the rail.`,
            onEnd: (won) => {
                SeaFights.finishBoarding(f, won == null ? null : !!won);
                this._finish(game);
            },
        });
        if (!ok) {
            SeaFights.finishBoarding(f, null);
            this._finish(game);
            return;
        }
        game.ui.hideCustomPanel();
    },

    /* ── The end ─────────────────────────────────────────────── */

    /** Leaving the deck or the day ending mid-fight: the sailing master sails it out. */
    abandon(game) {
        const f = this.fight;
        if (!f) return;
        // A boarding on deck is settled by the deck's own onExit (its onEnd comes back here)
        if (this._boarding) return;
        SeaFights.autoResolve(f);
        this._finish(game, true);
    },

    /** Hand the fight to the sailing master from the panel. */
    handOver(game) {
        const f = this.fight;
        if (!f || this._boarding) return;
        SeaFights.autoResolve(f);
        this._finish(game);
    },

    _finish(game, quiet = false) {
        const f = this.fight;
        const ctx = this.ctx;
        if (!f) return;
        this.fight = null;
        this.ctx = null;
        this._boarding = false;
        this._fx = [];
        InnerMapDeck.situationOverride = null;
        InnerMapDeck._sitKey = null;
        if (this._hooked) InnerMapRenderer.onSeaLayer = this._prevSeaLayer;
        this._hooked = false;
        this._prevSeaLayer = null;
        // The deck camera as it was before the guns ran out
        if (this._camBefore && game.innerMapCamera) {
            game.innerMapCamera.minZoom = this._camBefore.minZoom;
            game.innerMapCamera.targetZoom = this._camBefore.zoom;
        }
        this._camBefore = null;
        const p = game.player;
        const w = game.world;
        const res = NAVAL[ctx.kind] ? NAVAL[ctx.kind].settleFight(p, w, ctx.state, f) : SeaFights.settlePirates(p, w, ctx.state, f);
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(p, w);
        // Back into the scene it came from: its '__fought' choice shows what came of it
        const kind = NAVAL[ctx.kind] ? ctx.kind : 'sea';
        game._scene = { kind, state: { ...ctx.state, _fought: res } };
        if (quiet && !res.state) {
            game._scene = null;
            const n = res.notification;
            if (n) game.ui.showNotification(n.title, n.body, n.type);
            return;
        }
        ActionMenu.sceneAct(game, '__fought');
    },

    /* ── The orders panel ─────────────────────────────────────── */

    showPanel(game) {
        const f = this.fight;
        if (!f) return;
        const F = SeaFights.flagship(f);
        const enemies = SeaFights.ships(f, 'enemy');
        const consorts = SeaFights.ships(f, 'player').filter(s => !s.flagship);
        const tgt = F && F.target ? SeaFights.ship(f, F.target) : SeaFights._targetOf(f, F);
        let html = '<div style="font-size:12px;">';
        html += '<div id="seaFightStatus" style="margin-bottom:8px;">' + this._statusHtml() + '</div>';
        html += '<div style="font-size:11px;font-weight:bold;margin:6px 0 4px;">🧭 The helm</div><div style="display:flex;flex-wrap:wrap;gap:5px;">';
        for (const [id, icon, label, hint] of HELM) {
            html += `<button onclick="window._seaFightHelm('${id}')" title="${esc(hint)}" style="${!f.auto && F && F.order === id ? BTN_ON : BTN_OFF}">${icon} ${label}</button>`;
        }
        html += '</div>';
        if (enemies.filter(SeaFights.active).length > 1) {
            html += `<div style="margin-top:6px;"><button onclick="window._seaFightTarget()" style="${BTN_OFF}">🎯 Target: ${esc(tgt ? tgt.name : '—')} (next)</button></div>`;
        }
        html += '<div style="font-size:11px;font-weight:bold;margin:8px 0 4px;">💣 Shot</div><div style="display:flex;flex-wrap:wrap;gap:5px;">';
        for (const [id, label, hint] of SHOT) html += `<button onclick="window._seaFightShot('${id}')" title="${esc(hint)}" style="${F && F.shot === id ? BTN_ON : BTN_OFF}">${label}</button>`;
        html += '</div>';
        if (consorts.length) {
            html += `<div style="font-size:11px;font-weight:bold;margin:8px 0 4px;">🚩 Your squadron (${consorts.length})</div><div style="display:flex;flex-wrap:wrap;gap:5px;">`;
            for (const [id, label] of SQUADRON) html += `<button onclick="window._seaFightSquadron('${id}')" style="${f.squadronOrder === id ? BTN_ON : BTN_OFF}">${label}</button>`;
            html += '</div>';
        }
        html += `<div style="display:flex;gap:6px;margin-top:10px;"><button onclick="window._seaFightAuto()" style="flex:1;${BTN_OFF}" title="Let the sailing master fight her out">🎲 Sailing master's orders</button><button onclick="window._seaFightStrike()" style="flex:1;${BTN_OFF}">🏳️ Strike colours</button></div>`;
        html += '<div style="font-size:10px;color:var(--text-secondary);margin-top:8px;">Broadsides bear on the beam; crossing her bow or stern rakes her. Close and grapple to board — then it is steel on your deck.</div>';
        html += '</div>';
        game.ui.showCustomPanel('⚔️ Sea Fight', html);
        window._seaFightHelm = (id) => { SeaFights.orderFlagship(this.fight, id); this.showPanel(game); };
        window._seaFightTarget = () => { SeaFights.cycleTarget(this.fight); this.showPanel(game); };
        window._seaFightShot = (id) => { SeaFights.orderShot(this.fight, id); this.showPanel(game); };
        window._seaFightSquadron = (id) => { SeaFights.orderSquadron(this.fight, id); this.showPanel(game); };
        window._seaFightAuto = () => this.handOver(game);
        window._seaFightStrike = () => { if (this.fight && SeaFights.strike(this.fight)) this._finish(game); };
    },

    _bar(v, color) {
        const w = Math.max(0, Math.min(100, Math.round(v)));
        return `<span style="display:inline-block;width:46px;height:6px;border-radius:3px;background:rgba(255,255,255,0.1);vertical-align:middle;"><span style="display:block;width:${w}%;height:100%;border-radius:3px;background:${color};"></span></span>`;
    },

    _statusHtml() {
        const f = this.fight;
        if (!f) return '';
        const row = (s) => {
            const state = s.sunk ? 'sunk' : s.struck ? 'struck' : s.fled ? 'fled' : s.taken ? 'taken' : '';
            return `<div style="display:flex;align-items:center;gap:6px;font-size:11px;margin:2px 0;${state ? 'opacity:0.5;' : ''}">`
                + `<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${s.side === 'enemy' ? '#ff9a8a' : '#a9d4ff'};">${s.flagship ? '⭐ ' : ''}${esc(s.name)}${state ? ` (${state})` : ''}</span>`
                + `${this._bar(s.hull, '#d9a92a')}${this._bar(s.rigging, '#9ecbff')}<span style="width:34px;text-align:right;">👥${Math.round(s.crew)}</span></div>`;
        };
        return '<div style="font-size:10px;color:var(--text-secondary);">hull · rigging · crew</div>' + f.ships.map(row).join('');
    },

    _refreshPanelStatus() {
        if (typeof document === 'undefined') return;
        const el = document.getElementById('seaFightStatus');
        if (el) el.innerHTML = this._statusHtml();
    },

    /* ── Drawing ──────────────────────────────────────────────── */

    /** The flagship's frame: the deck's centre in world pixels, and the turn that puts her bow to the west. */
    _frame() {
        const f = this.fight;
        const L = InnerMap._deck;
        const F = f && SeaFights.flagship(f);
        if (!L || !F) return null;
        const T = InnerMapRenderer.TILE_SIZE;
        // Half the length and beam of your deck and of the (first) foe's hull, in tiles
        const ours = { a: Math.max(1, (L.maxQ - L.minQ + 1) / 2), b: Math.max(1, (L.maxR - L.minR + 1) / 2) };
        const foeShip = f.ships.find(s => s.side === 'enemy');
        const foe = (foeShip && this._halfOf(_hullOf(foeShip))) || { a: 6, b: 3 };
        return { F, T, ours, foe, rot: Math.PI - F.heading, cx: ((L.minQ + L.maxQ) / 2 + 0.5) * T, cy: ((L.minR + L.maxR) / 2 + 0.5) * T };
    },

    /** Half a hull's drawn length and beam (tiles): { a, b }, or null. */
    _halfOf(hullId) {
        const key = `half:${hullId}`;
        if (this._centres.has(key)) return this._centres.get(key);
        const def = CustomObjects.getDef(hullId);
        const foot = def ? ShipHulls.footprint(def) : [];
        let out = null;
        if (foot.length) {
            const cols = foot.map(m => m.localCol), rows = foot.map(m => m.localRow);
            out = { a: Math.max(1, (Math.max(...cols) - Math.min(...cols) + 1) / 2), b: Math.max(1, (Math.max(...rows) - Math.min(...rows) + 1) / 2) };
        }
        this._centres.set(key, out);
        return out;
    },

    /**
     * A point of the fight (tiles) → world pixels on the inner map, in the flagship's frame.
     * The fight is sailed in yards (grapples at 1.6 tiles) but the hulls are drawn many tiles
     * long and never turned: drawn 1:1 the foe sits inside your deck. So the drawing spreads
     * the distances out a little and stands every point off by the two hulls' half-extents
     * that way (an ellipse each): alongside at grapple range, clear water otherwise.
     */
    _toWorld(fr, x, y) {
        const dx = x - fr.F.x, dy = y - fr.F.y;
        const c = Math.cos(fr.rot), s = Math.sin(fr.rot);
        let sx = dx * c - dy * s, sy = dx * s + dy * c;
        const d = Math.hypot(sx, sy);
        if (d > 1e-6 && fr.ours && fr.foe) {
            const ux = sx / d, uy = sy / d;
            const rad = (h) => 1 / Math.sqrt((ux / h.a) ** 2 + (uy / h.b) ** 2);
            // (points about your own ship, a gun's flash or smoke, stay on her)
            const clear = (rad(fr.ours) + rad(fr.foe)) * 0.85 * Math.min(1, d);
            const k = (d * SPREAD + clear) / d;
            sx *= k; sy *= k;
        }
        return { x: fr.cx + sx * fr.T, y: fr.cy + sy * fr.T };
    },

    /** The middle of a hull's footprint, in tiles from its anchor. */
    _centre(def) {
        if (this._centres.has(def.id)) return this._centres.get(def.id);
        const foot = ShipHulls.footprint(def);
        const c = foot.length
            ? { col: foot.reduce((a, m) => a + m.localCol, 0) / foot.length + 0.5, row: foot.reduce((a, m) => a + m.localRow, 0) / foot.length + 0.5 }
            : { col: 0, row: 0 };
        this._centres.set(def.id, c);
        return c;
    },

    _drawHull(ctx, hullId, x, y, ds, flip, alpha = 1, sink = 0) {
        const def = CustomObjects.getDef(hullId);
        if (!def || !def.tiles) return false;
        const c = this._centre(def);
        ctx.save();
        ctx.globalAlpha *= alpha;
        ctx.translate(x, y + sink * ds);
        if (flip) ctx.scale(-1, 1);
        for (const td of def.tiles) {
            const img = td.sheetPath ? CustomObjects.getImage(td.sheetPath) : null;
            if (!img || !img.complete || !img.naturalWidth) continue;
            const dx = (td.localCol - c.col) * ds;
            const dy = (td.localRow - c.row) * ds;
            // (a sinking hull goes under from the keel up)
            if (sink > 0 && dy > (1.5 - sink) * ds * 2) continue;
            ctx.drawImage(img, td.sx, td.sy, td.sw || 32, td.sh || 32, Math.floor(dx), Math.floor(dy), Math.ceil(ds) + 1, Math.ceil(ds) + 1);
        }
        ctx.restore();
        return true;
    },

    /** The fight on the water: called from the sea layer (InnerMapRenderer.onSeaLayer). */
    render(ctx, camera, canvas) {
        const f = this.fight;
        const fr = this._frame();
        if (!f || !fr || !InnerMapDeck.active(this._game)) return;
        const z = camera.zoom;
        const ds = fr.T * z;
        const t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
        ctx.save();
        // Wakes first, under the hulls
        for (const s of f.ships) {
            if (s.flagship || s.sunk) continue;
            const w = this._toWorld(fr, s.x, s.y);
            const p = camera.worldToScreenFast(w.x, w.y);
            const h = s.heading + fr.rot;
            if (s.speed > 0.05) {
                ctx.strokeStyle = 'rgba(235,245,255,0.45)';
                ctx.lineWidth = Math.max(1, 1.5 * z);
                ctx.beginPath();
                for (const side of [-1, 1]) {
                    const bx = p.x - Math.cos(h) * ds * 1.6, by = p.y - Math.sin(h) * ds * 1.6;
                    ctx.moveTo(bx, by);
                    ctx.lineTo(bx - Math.cos(h + side * 0.35) * ds * (1.5 + s.speed * 2), by - Math.sin(h + side * 0.35) * ds * (1.5 + s.speed * 2));
                }
                ctx.stroke();
            }
        }
        // The ships
        // (the ship grappled to yours is the hull the deck lays alongside: not drawn twice)
        const lashed = this._boarding && f.outcome ? f.outcome.enemyId : null;
        for (const s of f.ships) {
            if (s.flagship || s.id === lashed) continue;
            const w = this._toWorld(fr, s.x, s.y);
            const p = camera.worldToScreenFast(w.x, w.y);
            const off = p.x < -ds * 4 || p.x > canvas.width + ds * 4 || p.y < -ds * 4 || p.y > canvas.height + ds * 4;
            if (off) { if (SeaFights.active(s)) this._edgeMarker(ctx, canvas, p, s, fr); continue; }
            const h = s.heading + fr.rot;
            const flip = Math.cos(h) > 0;
            const sinkT = s._sinkT != null ? s._sinkT : (s.sunk ? 99 : null);
            if (sinkT != null && sinkT > 5) {
                // Wreckage on the water
                ctx.fillStyle = 'rgba(70,50,35,0.8)';
                for (let i = 0; i < 6; i++) ctx.fillRect(p.x + ((i * 37) % 50 - 25) * z, p.y + ((i * 23) % 24 - 12) * z, 6 * z, 2 * z);
                continue;
            }
            const sink = sinkT != null ? Math.min(1.5, sinkT / 3) : 0;
            const bob = Math.sin(t * 1.3 + s.x) * 1.5 * z;
            const drawn = this._drawHull(ctx, _hullOf(s), p.x, p.y + bob, ds, flip, sinkT != null ? Math.max(0, 1 - sinkT / 5) : 1, sink);
            if (!drawn) {
                ctx.fillStyle = s.side === 'enemy' ? 'rgba(90,40,30,0.9)' : 'rgba(40,60,90,0.9)';
                ctx.beginPath(); ctx.ellipse(p.x, p.y, ds * 2, ds * 0.6, h, 0, Math.PI * 2); ctx.fill();
            }
            // Colours at the masthead: theirs red, yours blue, white when struck
            const fx = p.x, fy = p.y - ds * 3.4 + bob;
            ctx.fillStyle = s.struck ? '#f4efe4' : (s.side === 'enemy' ? '#d23a2a' : '#3a7ad2');
            ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx + (flip ? -1 : 1) * 12 * z, fy + 4 * z); ctx.lineTo(fx, fy + 8 * z); ctx.closePath(); ctx.fill();
            if (z > 0.35) {
                const label = `${s.name}${s.struck ? ' (struck)' : s.taken ? ' (taken)' : ''}`;
                drawMapText(ctx, label, p.x, p.y + ds * 1.6, { size: 11, weight: 700, color: s.side === 'enemy' ? '#ffb0a0' : '#bcdcff' });
                if (SeaFights.active(s)) {
                    const bw = ds * 2.4;
                    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(p.x - bw / 2, p.y + ds * 2.05, bw, 4 * z);
                    ctx.fillStyle = '#d9a92a'; ctx.fillRect(p.x - bw / 2, p.y + ds * 2.05, bw * s.hull / 100, 4 * z);
                }
            }
        }
        // Smoke, flashes, splashes
        for (const x of this._fx) {
            if (x.delay > 0) continue;
            const w = this._toWorld(fr, x.x, x.y);
            const p = camera.worldToScreenFast(w.x, w.y);
            const k = x.t / x.life;
            if (x.kind === 'smoke') {
                ctx.fillStyle = `rgba(215,215,210,${0.55 * (1 - k)})`;
                ctx.beginPath(); ctx.arc(p.x, p.y, (6 + k * 22) * z, 0, Math.PI * 2); ctx.fill();
            } else if (x.kind === 'flash') {
                ctx.fillStyle = `rgba(255,220,120,${1 - k})`;
                ctx.beginPath(); ctx.arc(p.x, p.y, 7 * z, 0, Math.PI * 2); ctx.fill();
            } else if (x.kind === 'splash') {
                ctx.strokeStyle = `rgba(240,248,255,${0.8 * (1 - k)})`;
                ctx.lineWidth = 2 * z;
                ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - Math.sin(k * Math.PI) * 18 * z); ctx.stroke();
                ctx.beginPath(); ctx.ellipse(p.x, p.y, (4 + k * 10) * z, (1.5 + k * 3) * z, 0, 0, Math.PI * 2); ctx.stroke();
            } else if (x.kind === 'splinter') {
                ctx.fillStyle = `rgba(140,100,60,${1 - k})`;
                for (let i = 0; i < 4; i++) ctx.fillRect(p.x + Math.cos(i * 1.7) * k * 14 * z, p.y + Math.sin(i * 1.7) * k * 10 * z - k * 6 * z, 3 * z, 2 * z);
            }
        }
        ctx.restore();
    },

    /** A ship off the screen: an arrow at the edge with her name and how far. */
    _edgeMarker(ctx, canvas, p, s, fr) {
        const cx = canvas.width / 2, cy = canvas.height / 2;
        const a = Math.atan2(p.y - cy, p.x - cx);
        const m = 34;
        const ex = Math.max(m, Math.min(canvas.width - m, cx + Math.cos(a) * canvas.width));
        const ey = Math.max(m + 40, Math.min(canvas.height - m, cy + Math.sin(a) * canvas.height));
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(a);
        ctx.fillStyle = s.side === 'enemy' ? 'rgba(230,90,70,0.9)' : 'rgba(90,150,230,0.9)';
        ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-6, -8); ctx.lineTo(-6, 8); ctx.closePath(); ctx.fill();
        ctx.restore();
        const d = Math.round(SeaFights._dist(fr.F, s));
        drawMapText(ctx, `${s.name} · ${d}`, ex, ey + 16, { size: 10, weight: 600, family: 'body', color: s.side === 'enemy' ? '#ffb0a0' : '#bcdcff' });
    },

    /** The compass, the wind, the order and the last of the log (gameLoop, after the deck's HUD). */
    renderHud(ctx, camera, canvas) {
        const f = this.fight;
        if (!f || !this._game || !InnerMapDeck.active(this._game)) return;
        const F = SeaFights.flagship(f);
        if (!F) return;
        const rot = Math.PI - F.heading;
        const R = 30;
        // (top left, under the Leave/World map buttons: the right side is the HUD's panels')
        const x = R + 30, y = Math.round(canvas.height * 0.17) + R + 20;
        ctx.save();
        ctx.fillStyle = 'rgba(12,16,24,0.6)';
        ctx.beginPath(); ctx.arc(x, y, R + 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(230,220,196,0.6)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
        // North, turned with the ship
        const n = -Math.PI / 2 + rot;
        drawMapText(ctx, 'N', x + Math.cos(n) * (R - 8), y + Math.sin(n) * (R - 8), { size: 10, weight: 700, color: '#f4efe4' });
        // The wind: an arrow the way it blows
        const wd = f.wind.dir + rot;
        ctx.strokeStyle = '#9ecbff';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x - Math.cos(wd) * R * 0.8, y - Math.sin(wd) * R * 0.8); ctx.lineTo(x + Math.cos(wd) * R * 0.6, y + Math.sin(wd) * R * 0.6); ctx.stroke();
        ctx.fillStyle = '#9ecbff';
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(wd) * R * 0.85, y + Math.sin(wd) * R * 0.85);
        ctx.lineTo(x + Math.cos(wd + 2.6) * R * 0.35 + Math.cos(wd) * R * 0.5, y + Math.sin(wd + 2.6) * R * 0.35 + Math.sin(wd) * R * 0.5);
        ctx.lineTo(x + Math.cos(wd - 2.6) * R * 0.35 + Math.cos(wd) * R * 0.5, y + Math.sin(wd - 2.6) * R * 0.35 + Math.sin(wd) * R * 0.5);
        ctx.closePath(); ctx.fill();
        // Your bow: always to the west on the deck
        ctx.fillStyle = '#ffd36b';
        ctx.beginPath(); ctx.moveTo(x - R + 2, y); ctx.lineTo(x - R + 12, y - 5); ctx.lineTo(x - R + 12, y + 5); ctx.closePath(); ctx.fill();
        drawMapText(ctx, 'wind', x, y + R + 14, { size: 9, weight: 600, family: 'body', color: '#9ecbff' });
        ctx.restore();
        const order = f.auto ? "sailing master's orders" : (HELM.find(h => h[0] === F.order) || [null, '', F.order])[2];
        const sail = Math.round(SeaFights.sailFactor(f, F) * 100);
        const line = `⚔️ ${order} · ${F.shot} shot · ${sail}% of her sail drawing · hull ${Math.round(F.hull)}% · crew ${Math.round(F.crew)}`;
        // (above the hotbar and the day panel: the orders panel covers the top, the day panel the foot)
        const y0 = Math.round(canvas.height * 0.70);
        drawMapText(ctx, line, canvas.width / 2, y0, { size: 12, weight: 700, color: '#ffd36b' });
        const log = f.log.slice(-3);
        log.forEach((l, i) => drawMapText(ctx, l, canvas.width / 2, y0 + 20 + i * 17, { size: 11, weight: 600, family: 'body', color: '#f4efe4', alpha: 0.6 + 0.4 * (i / Math.max(1, log.length - 1)) }));
    },
};
