// ============================================
// BELOW DECKS — the rooms under your ship's deck, and her officers
// ============================================
// From the deck (ui/innerMapDeck.js: "Go Below", at the hatch) down the ladder
// into the ship: the crew berths, the galley, the hold with her actual cargo,
// the captain's cabin (systems/belowDecks.js plans them by her hull;
// world/innerMap/belowDecks.js lays them). The hands below are the deck's own
// named hands: the off-watch asleep in their hammocks at night, the mess at
// its meals, the cook at the stove, the navigator at the chart table, the sick
// and the surgeon with them. On deck, whoever is below is not on deck (syncDeck:
// they walk to the hatch and go down; they come back up the same way).
//
// The cabin: the ship's log (this voyage's and the logbook of past ones), the
// charts (the route laid off, the navigator's reckoning) and the officers'
// roll (systems/shipOfficers.js: promote from the hands, praise, reprimand,
// break, pay what is owed, flog a man at the gangway). The cot: turn in (the
// day ends at sea, as at the helm). The galley: eat with the hands. The hold:
// each crate, barrel and sack is cargo aboard; the manifest is the deck's.

import { InnerMap } from '../world/innerMap.js';
import { InnerMapReactions } from './innerMapReactions.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { InnerMapDeck } from './innerMapDeck.js';
import { Ships } from '../systems/ships.js';
import { DeckLife } from '../systems/deckLife.js';
import { BelowDecks } from '../systems/belowDecks.js';
import { ShipOfficers } from '../systems/shipOfficers.js';
import { Ailments } from '../systems/ailments.js';
import { Water } from '../systems/water.js';
import { Utils } from '../core/utils.js';

const BTN = 'padding:7px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;transition:all 0.12s;';
const BTN_PRIMARY = `${BTN}border:1px solid rgba(245,197,66,0.55);background:linear-gradient(180deg,#f6cf57,#d9a92a);color:#1a1a1a;`;
const BTN_SECONDARY = `${BTN}border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:var(--text-primary);`;
const BTN_OFF = `${BTN_SECONDARY}opacity:0.5;cursor:not-allowed;`;
const CARD = 'padding:7px 9px;border:1px solid var(--border);border-radius:8px;background:rgba(255,255,255,0.02);margin-bottom:6px;';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _cheb = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));
const _bar = (v, color) => `<span style="display:inline-block;width:60px;height:6px;border-radius:3px;background:rgba(255,255,255,0.08);vertical-align:middle;"><span style="display:block;width:${Math.max(0, Math.min(100, v))}%;height:100%;border-radius:3px;background:${color};"></span></span>`;

function _btn(label, call, why = null, primary = false) {
    if (why) return `<button disabled title="${esc(why)}" style="${BTN_OFF}">${label}</button>`;
    return `<button onclick="${call}" style="${primary ? BTN_PRIMARY : BTN_SECONDARY}">${label}</button>`;
}

export const InnerMapBelowDecks = {
    _game: null,
    _stowed: [],
    _syncTimer: 0,
    _chatTimer: 6,
    _key: null,

    /* ── Where we are ─────────────────────────────────────────── */

    ship(game) {
        return InnerMapDeck.ship(game);
    },

    /** Below decks on your own ship. */
    active(game) {
        return !!(InnerMap.active && InnerMap.inBelowDecks && InnerMap.inBelowDecks() && this.ship(game));
    },

    /** The situation and the hour, for who is where (systems/belowDecks.js whereIs). */
    _ctx(game, ship, plan = null) {
        const hour = InnerMap.timeOfDay;
        const sit = DeckLife.situation(game.player, game.world, ship, { hour });
        const st = Ailments.getState ? Ailments.getState(game.player) : null;
        const ob = st && st.crews ? st.crews[String(ship.id)] : null;
        return { hour, sit, outbreak: ob ? ob.id : null, plan: plan || this._plan() };
    },

    _plan() {
        const b = InnerMap._insideBuilding;
        return (b && b._shipBelow && b._shipBelow.plan) || null;
    },

    /** The room the player stands in below. */
    _roomHere() {
        const t = InnerMap.getTile(InnerMap.playerInnerQ, InnerMap.playerInnerR);
        const plan = this._plan();
        return plan && t && t._belowRoom ? plan.rooms.find(r => r.id === t._belowRoom) || null : null;
    },

    /* ── Going below, coming up ──────────────────────────────── */

    /** Down the ladder from the deck. → true when below. */
    goBelow(game) {
        const ship = this.ship(game);
        const why = BelowDecks.reason(ship);
        if (why) { game.ui.showNotification('⚓ Below', why, 'warning'); return false; }
        if (InnerMapDeck._fight) { game.ui.showNotification('⚔️ Boarders!', 'Not with boarders on deck!', 'error'); return false; }
        const L = InnerMap._deck;
        if (!L || InnerMap._insideBuilding) return false;
        const plan = BelowDecks.plan(ship);
        const stowage = BelowDecks.stowage(ship, plan.holdSlots);
        const building = {
            type: 'ship_below', name: 'Below Decks', icon: '⚓', q: L.hatch.q, r: L.hatch.r,
            _shipBelow: { shipId: ship.id, plan, stowage },
        };
        const wt = InnerMap.currentWorldTile || {};
        // (laid afresh each time: the cargo and the casks change)
        if (InnerMap._interiorCache) delete InnerMap._interiorCache[`${wt.q},${wt.r}_${building.type}_${building.q}_${building.r}`];
        this._game = game;
        if (!InnerMap.enterBuilding(building, game, { force: true })) return false;
        // One deck below, no stairs (world/innerMap/floors.js counts it as one floor)
        InnerMap._floorCount = 1;
        for (const row of InnerMap.tiles) for (const t of row) if (t && t._stairs) { t._stairs = null; if (t._furniture && t._furniture.type === 'stairs') t._furniture = null; }
        const landing = InnerMap.belowLanding();
        if (landing) { InnerMap.playerInnerQ = landing.q; InnerMap.playerInnerR = landing.r; }
        InnerMap.npcs = [];
        this._key = null;
        this._sync(game, true);
        if (typeof game._configureInnerMapCamera === 'function') game._configureInnerMapCamera('interior');
        if (typeof game._updateBuildingExitButton === 'function') game._updateBuildingExitButton();
        const asleep = (InnerMap.npcs || []).filter(n => n._asleep).length;
        const rooms = plan.rooms.map(r => r.name.replace(/^The /, 'the ')).join(', ');
        game.ui.showNotification(`🔼 Below Decks in the ${ship.name}`,
            `Down the ladder: ${rooms}.${asleep ? ` ${asleep} of the hands asleep in their hammocks.` : ''} The ladder takes you back up.`, 'info');
        return true;
    },

    /** Up the ladder onto the deck. */
    climbUp(game) {
        if (!this.active(game)) return false;
        if (!InnerMap.exitBuilding(game)) return false;
        if (typeof game._configureInnerMapCamera === 'function') game._configureInnerMapCamera('outer');
        if (typeof game._updateBuildingExitButton === 'function') game._updateBuildingExitButton();
        // (the deck reads the hour again: who has come up, who has gone down)
        InnerMapDeck._sitKey = null;
        if (InnerMapDeck._refresh) InnerMapDeck._refresh(game, false);
        game.ui.showNotification('🔼 On Deck', 'Up the ladder and out through the hatch into the wind.', 'info');
        return true;
    },

    /** Who is below now, laid in or walked to their places. */
    _sync(game, instant = false) {
        const ship = this.ship(game);
        if (!ship) return;
        const ctx = this._ctx(game, ship);
        const list = BelowDecks.below(ship, ctx);
        InnerMap._belowSync(list, instant);
        // (an officer is known by their post)
        for (const n of InnerMap.npcs || []) {
            if (!n._belowHand) continue;
            const post = ShipOfficers.postOfSlot(ship, n.crewSlot);
            n.roleTitle = post ? ShipOfficers.post(post).title : (n.deckMember && n.deckMember.title) || 'hand';
        }
        this._key = this._keyOf(ctx);
    },

    _keyOf(ctx) {
        return `${Math.floor(ctx.hour * 2)}|${ctx.sit.kind}|${ctx.outbreak || ''}`;
    },

    /** Every frame below. */
    update(dt, game) {
        if (!this.active(game)) return;
        this._game = game;
        this._syncTimer -= dt;
        if (this._syncTimer <= 0) {
            this._syncTimer = 1;
            const ship = this.ship(game);
            const key = this._keyOf(this._ctx(game, ship));
            if (key !== this._key) this._sync(game, false);
            InnerMap._belowClearLeavers();
        }
        this._chatTimer -= dt;
        if (this._chatTimer <= 0) {
            this._chatTimer = 8 + Utils.random() * 10;
            const awake = (InnerMap.npcs || []).filter(n => n._belowHand && !n._asleep && !n._belowLeaving && n.state !== 'dialog');
            const who = awake.length ? awake[Math.floor(Utils.random() * awake.length)] : null;
            const line = who ? BelowDecks.chatter(who.belowAct, Utils.randInt(0, 99)) : null;
            if (line) InnerMapReactions.bark(who, line, 3.2);
        }
    },

    /* ── On deck: those below are not on deck ────────────────── */

    resetDeck() {
        this._stowed = [];
    },

    stowedCount() {
        return this._stowed.length;
    },

    /**
     * The deck's crew against who is below at this hour (ui/innerMapDeck.js
     * _refresh): a hand due below walks to the hatch and goes down; a hand
     * below who is wanted on deck comes up through it.
     */
    syncDeck(game, ship, sit) {
        const L = InnerMap._deck;
        if (!L || !ship || InnerMap._insideBuilding || !BelowDecks.tier(ship)) {
            if (this._stowed.length && L && !InnerMap._insideBuilding) this._bringUp(L, this._stowed.splice(0));
            return;
        }
        const plan = BelowDecks.plan(ship);
        const ctx = { hour: InnerMap.timeOfDay, sit, outbreak: this._ctx(game, ship, plan).outbreak, plan };
        ctx.sick = BelowDecks.sickSlots(ship, BelowDecks.hands(ship), ctx.outbreak);
        for (const n of (InnerMap.npcs || []).filter(x => x.deckRole && !x._belowHand)) {
            const post = ShipOfficers.postOfSlot(ship, n.crewSlot);
            n.roleTitle = post ? ShipOfficers.post(post).title : (n.deckMember && n.deckMember.title) || n.roleTitle;
            const below = !n._deckWounded && BelowDecks.isBelow(ship, n.deckMember, ctx);
            if (below) {
                if (!n._goingBelow) {
                    n.activity = null;
                    if (n.state !== 'walking' && !n._dialogFrozen && n.state !== 'dialog') { n.state = 'idle'; n.idleTimer = 0.2 + Utils.random(); }
                }
                n._goingBelow = true;
                // (the deck's own orders clear a hand's target when the situation turns: set it again)
                n.deckTarget = { q: L.hatch.q, r: L.hatch.r };
            } else if (n._goingBelow) {
                n._goingBelow = false;
                n.deckTarget = null;
            }
        }
        const up = this._stowed.filter(n => !BelowDecks.isBelow(ship, n.deckMember, ctx));
        if (up.length) {
            this._stowed = this._stowed.filter(n => !up.includes(n));
            this._bringUp(L, up, sit);
        }
    },

    _bringUp(L, list, sit = null) {
        for (const n of list) {
            n._goingBelow = false;
            n.deckTarget = null;
            n.q = n.prevQ = L.hatch.q;
            n.r = n.prevR = L.hatch.r;
            n.path = null;
            n.moveProgress = 0;
            n.state = 'idle';
            n.idleTimer = 0.3;
            n.activity = null;
            const st = DeckLife.stationFor(n.deckMember, sit || InnerMapDeck._sit);
            n.deckStation = st;
            n.deckWork = DeckLife.workAt(st);
            if (!InnerMap.npcs.includes(n)) InnerMap.npcs.push(n);
        }
    },

    /** Every frame on deck: hands at the hatch go down through it. */
    tickDeck(game) {
        const L = InnerMap._deck;
        if (!L || InnerMap._insideBuilding || InnerMapDeck._fight) return;
        const going = (InnerMap.npcs || []).filter(n => n._goingBelow && n.state !== 'walking' && _cheb(n, L.hatch) <= 1);
        if (!going.length) return;
        InnerMap.npcs = InnerMap.npcs.filter(n => !going.includes(n));
        for (const n of going) { n.deckTarget = null; this._stowed.push(n); }
    },

    /* ── The context menu below (ui/innerMapUI.js) ────────────── */

    menuItems(game, menuItems, tile, q, r) {
        const ship = this.ship(game);
        if (!ship) return;
        const keep = new Set(['wait_here', 'rest', 'move_here', 'pickup_ground_item']);
        const out = [];
        let header = null;
        for (const it of menuItems) {
            if (it.type === 'header') { header = it; continue; }
            if (it.type === 'separator') { header = null; continue; }
            if (!(it.type === 'person' || (it.type === 'action' && keep.has(it.action)))) continue;
            if (header) { if (out.length) out.push({ type: 'separator' }); out.push(header); header = null; }
            out.push(it);
        }
        const plan = this._plan();
        const room = tile && tile._belowRoom && plan ? plan.rooms.find(x => x.id === tile._belowRoom) : this._roomHere();
        const items = [];
        const f = tile && tile._furniture;
        if (tile && tile._ladder) items.push({ type: 'action', action: 'below_up', label: 'Climb to the Deck', icon: '🔼', desc: 'Up the ladder and out through the hatch', q, r });
        if (tile && tile._cargo) {
            const c = tile._cargo;
            items.push({ type: 'action', action: 'below_cargo', label: `Look at the ${c.kind === 'barrel' ? 'barrels' : c.kind === 'sack' ? 'sacks' : 'crates'} of ${f ? f.name.toLowerCase() : c.good}`, icon: c.kind === 'barrel' ? '🛢️' : c.kind === 'sack' ? '🌾' : '📦', desc: `${(ship.cargo || {})[c.good] || 0} ${c.good.replace(/_/g, ' ')} aboard`, good: c.good, q, r });
        }
        if (room && room.id === 'hold') items.push({ type: 'action', action: 'below_manifest', label: "The Hold's Manifest", icon: '📜', desc: `${Ships.getCargoUsed(ship)}/${Ships.getShipEffectiveStats(ship).cargoCapacity} stowed` });
        if (tile && tile._water) items.push({ type: 'disabled', label: `💧 Water casks: ${Math.floor(Water.shipWater(ship))} days' water aboard` });
        if (room && room.id === 'cabin') {
            items.push({ type: 'action', action: 'below_log', label: "Read the Ship's Log", icon: '📖', desc: 'This voyage, and the logbook of those before' });
            items.push({ type: 'action', action: 'below_charts', label: 'Study the Charts', icon: '🗺️', desc: ship.voyage ? `The course laid off for ${ship.voyage.destName}` : 'No course is set' });
            items.push({ type: 'action', action: 'below_officers', label: "The Officers' Roll", icon: '📯', desc: `${ShipOfficers.list(ship).length}/${ShipOfficers.postsFor(ship).length} posts filled` });
        }
        if (f && f.type === 'bed' && room && room.id === 'cabin') {
            const waiting = !!Ships.describeVoyageEvent(game.player);
            if (waiting) items.push({ type: 'disabled', label: '🛏️ Turn In — the hands wait on your orders on deck' });
            else items.push({ type: 'action', action: 'below_sleep', label: 'Turn In for the Night', icon: '🛏️', desc: 'Sleep in your cot: the day ends, the ship sails on' });
        }
        const galley = BelowDecks.galleyRoom(plan);
        if (room && galley && room.id === galley.id) {
            const canEat = Ships.getProvisions(ship) > 0 && game.player.needsEnabled && game.player.needs;
            if (canEat) items.push({ type: 'action', action: 'below_eat', label: 'Eat with the Hands', icon: '🍲', desc: "A ration from the ship's stores" });
            else items.push({ type: 'disabled', label: '🍲 Eat with the Hands — nothing to eat, or no need' });
        }
        items.push({ type: 'action', action: 'below_up', label: 'Back on Deck', icon: '⛵', desc: 'To the ladder and up' });
        const head = [{ type: 'header', label: `⚓ ${room ? room.name : 'Below Decks'} — the ${ship.name}` }, ...items];
        menuItems.splice(0, menuItems.length, ...head, ...(out.length ? [{ type: 'separator' }, ...out] : []));
    },

    /** Actions below. → true when handled. */
    handle(game, item) {
        if (!item || !this.active(game)) return false;
        if ((item.action === 'talk_npc' || item.action === 'wake_npc') && item.npc && item.npc._belowHand) {
            const npc = item.npc;
            const talk = () => this.talk(game, npc);
            if (npc._asleep) { talk(); return true; }
            if (InnerMap.approachAndThen(npc.q, npc.r, talk) === 'unreachable') talk();
            return true;
        }
        switch (item.action) {
            case 'below_up': {
                const l = InnerMap.belowLanding();
                const go = () => this.climbUp(game);
                if (!l || InnerMap.approachAndThen(l.q, l.r, go) === 'unreachable') go();
                return true;
            }
            case 'below_cargo': this.showCargo(game, item.good); return true;
            case 'below_manifest': InnerMapDeck.showHold(game); return true;
            case 'below_log': this.showLog(game); return true;
            case 'below_charts': this.showCharts(game); return true;
            case 'below_officers': this.showOfficers(game); return true;
            case 'below_sleep': this.turnIn(game); return true;
            case 'below_eat': this.eat(game); return true;
            default: return false;
        }
    },

    /* ── What the captain does below ─────────────────────────── */

    /** Sleep in your cot: the day ends at sea (as "Sail through the day" at the helm). */
    turnIn(game) {
        if (InnerMapDeck._fight) return;
        if (Ships.describeVoyageEvent(game.player)) { game.ui.showNotification('🛏️ Not Yet', 'The hands are waiting on your orders on deck.', 'warning'); return; }
        game.ui.hideCustomPanel();
        game._endDayConfirmed = true;
        game.endDay();
        InnerMap.timeOfDay = 7;
        InnerMap._timeAccumulator = 0;
        InnerMap.dayEnded = false;
        game._innerMapDayEndShown = false;
        if (this.active(game)) this._sync(game, true);
    },

    /** A ration at the galley with the hands. */
    eat(game) {
        const ship = this.ship(game);
        const p = game.player;
        if (!ship || !p.needs) return;
        const food = Ships.feedCaptain(p);
        if (!food) { game.ui.showNotification('🍲 Galley', 'Nothing left to eat.', 'warning'); return; }
        if (typeof p.modifyNeed === 'function') { p.modifyNeed('hunger', 30); p.modifyNeed('social', 3); }
        game.ui.updateStats(p, game.world);
        const eaters = (InnerMap.npcs || []).filter(n => n._belowHand && n.belowAct === 'eat');
        if (eaters.length) InnerMapReactions.bark(eaters[0], 'Make room for the Captain!', 3);
        game.ui.showNotification('🍲 At Mess', `You eat a ration of ${food.replace(/_/g, ' ')} with the hands${eaters.length ? ', elbow to elbow at the mess table' : ''}.`, 'success');
    },

    /** A word with a hand below (an officer: their post and how they stand). */
    talk(game, npc) {
        const ship = this.ship(game);
        if (!ship || !npc) return false;
        if (npc._asleep) {
            const sick = npc.belowAct === 'sick';
            game.ui.showNotification(sick ? `🤒 ${npc.name}` : `💤 ${npc.name}`, sick
                ? `${npc.name} lies sweating in a hammock, too sick to stand a watch. ${ShipOfficers.of(ship, 'surgeon') ? 'The surgeon has been at them.' : 'There is no surgeon aboard to physic them.'}`
                : `${npc.name} is asleep in a hammock, off watch. A sailor sleeps when they can — you leave them be.`, 'info');
            return true;
        }
        npc.path = null;
        npc.moveProgress = 0;
        npc.state = 'idle';
        npc.idleTimer = 8;
        npc.facing = InnerMapCharacters.getDirection(InnerMap.playerInnerQ - npc.q, InnerMap.playerInnerR - npc.r);
        if (game.player.modifyNeed) game.player.modifyNeed('social', 3);
        const post = ShipOfficers.postOfSlot(ship, npc.crewSlot);
        let html = '<div style="max-height:470px;overflow-y:auto;">';
        html += `<h4 style="margin:0 0 2px;">${esc(npc.name)}</h4><div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;">${esc(npc.roleTitle || 'hand')} of the ${esc(ship.name)}${npc.belowWork ? ` · ${esc(npc.belowWork.label.toLowerCase())}` : ''}</div>`;
        const line = BelowDecks.chatter(npc.belowAct, npc.crewSlot + Math.floor(InnerMap.timeOfDay)) || DeckLife.chatter(npc.deckMember, ship, null) || 'Aye, Captain.';
        html += `<div style="font-size:12px;margin-bottom:8px;font-style:italic;">“${esc(line)}”</div>`;
        if (post) html += this._officerCard(game, ship, post, true);
        html += `<div style="display:flex;gap:6px;"><button onclick="window._bdOfficers()" style="flex:1;${BTN_SECONDARY}">📯 The officers' roll</button><button onclick="window._bdClose()" style="flex:1;${BTN_SECONDARY}">Carry on</button></div></div>`;
        game.ui.showCustomPanel(`💬 ${npc.name}`, html);
        this._bind(game, () => this.talk(game, npc));
        return true;
    },

    _bind(game, back) {
        window._bdClose = () => game.ui.hideCustomPanel();
        window._bdOfficers = () => this.showOfficers(game);
        window._bdLog = () => this.showLog(game);
        window._bdCharts = () => this.showCharts(game);
        window._bdPromote = (post, slot) => this._act(game, ShipOfficers.promote(game.player, game.world, this.ship(game), post, slot), back);
        window._bdDismiss = (post) => this._act(game, ShipOfficers.dismiss(game.player, game.world, this.ship(game), post), back);
        window._bdPraise = (post) => this._act(game, ShipOfficers.praise(game.player, game.world, this.ship(game), post), back);
        window._bdReprimand = (post) => this._act(game, ShipOfficers.reprimand(game.player, game.world, this.ship(game), post), back);
        window._bdPayArrears = () => this._act(game, ShipOfficers.payArrears(game.player, game.world, this.ship(game)), back);
        window._bdFlog = () => this._act(game, ShipOfficers.flog(game.player, game.world, this.ship(game)), back);
    },

    _act(game, res, back) {
        game.ui.showNotification(res.success ? '📯 Orders' : '📯 Not Done', res.message, res.success ? 'success' : 'warning');
        if (res.success) {
            game.ui.updateStats(game.player, game.world);
            if (this.active(game)) this._sync(game, false);
        }
        if (back) back();
    },

    /* ── Panels: the log, the charts, the officers, a crate ──── */

    showCargo(game, good) {
        const ship = this.ship(game);
        if (!ship) return;
        const n = (ship.cargo || {})[good] || 0;
        const kind = BelowDecks.goodKind(good);
        const what = kind === 'barrel' ? 'barrels' : kind === 'sack' ? 'sacks' : 'crates';
        const prov = Ships._getProvisionSettings().foods.includes(good);
        game.ui.showNotification(`${kind === 'barrel' ? '🛢️' : kind === 'sack' ? '🌾' : '📦'} ${good.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())}`,
            `${n} ${good.replace(/_/g, ' ')} stowed in ${what}, lashed against the roll.${prov ? ' Ship\'s provisions: the crew eats from these.' : ' Goods come ashore by the dock or the boat.'}`, 'info');
    },

    showLog(game) {
        const ship = this.ship(game);
        if (!ship) return;
        const pages = ShipOfficers.logPages(ship);
        let html = '<div style="max-height:470px;overflow-y:auto;">';
        html += `<h4 style="margin:0 0 6px;">📖 The log of the ${esc(ship.name)}</h4>`;
        if (!pages.length) html += '<div style="font-size:12px;color:var(--text-secondary);">The log is blank: she has made no voyage yet.</div>';
        for (const pg of pages) {
            html += `<div style="${CARD}"><div style="font-weight:bold;font-size:12px;margin-bottom:4px;">${pg.current ? '⛵' : '📜'} ${esc(pg.title)}</div>`;
            let lastDay = null;
            for (const e of pg.entries) {
                if (e.day !== lastDay) { html += `<div style="font-size:10px;color:var(--text-secondary);margin-top:4px;">Day ${esc(e.day)}</div>`; lastDay = e.day; }
                html += `<div style="font-size:11px;padding:1px 0 1px 6px;">${e.icon || '•'} ${esc(e.text)}</div>`;
            }
            html += '</div>';
        }
        html += `<div style="display:flex;gap:6px;"><button onclick="window._bdCharts()" style="flex:1;${BTN_SECONDARY}">🗺️ The charts</button><button onclick="window._bdClose()" style="flex:1;${BTN_SECONDARY}">Close the log</button></div></div>`;
        game.ui.showCustomPanel("📖 The Ship's Log", html);
        this._bind(game, () => this.showLog(game));
    },

    /** The route as a little chart (SVG): sailed solid, to come dashed, the ship where she is. */
    _chartSvg(game, chart) {
        const pts = chart.route.map(p => [p[0], p[1]]);
        if (pts.length < 2) return '';
        const W = (game.world && game.world.width) || 0;
        // (the world wraps east-west: keep the line on one side of the seam)
        for (let i = 1; i < pts.length; i++) {
            if (!W) break;
            while (pts[i][0] - pts[i - 1][0] > W / 2) pts[i][0] -= W;
            while (pts[i - 1][0] - pts[i][0] > W / 2) pts[i][0] += W;
        }
        const xs = pts.map(p => p[0] + (p[1] % 2) * 0.5), ys = pts.map(p => p[1] * 0.87);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        const bw = 280, bh = 150, pad = 14;
        const s = Math.min((bw - pad * 2) / Math.max(1, maxX - minX), (bh - pad * 2) / Math.max(1, maxY - minY));
        const X = (i) => (pad + (xs[i] - minX) * s + (bw - pad * 2 - (maxX - minX) * s) / 2).toFixed(1);
        const Y = (i) => (pad + (ys[i] - minY) * s + (bh - pad * 2 - (maxY - minY) * s) / 2).toFixed(1);
        const line = (a, b) => pts.slice(a, b + 1).map((_, k) => `${X(a + k)},${Y(a + k)}`).join(' ');
        const at = Math.min(chart.step, pts.length - 1);
        let svg = `<svg viewBox="0 0 ${bw} ${bh}" style="width:100%;max-width:${bw}px;display:block;margin:0 auto 6px;background:#e9dcb8;border-radius:6px;border:1px solid #8a6a3a;">`;
        svg += `<polyline points="${line(0, at)}" fill="none" stroke="#6b3e1e" stroke-width="2"/>`;
        if (at < pts.length - 1) svg += `<polyline points="${line(at, pts.length - 1)}" fill="none" stroke="#6b3e1e" stroke-width="1.5" stroke-dasharray="4 3"/>`;
        svg += `<circle cx="${X(0)}" cy="${Y(0)}" r="3" fill="#6b3e1e"/><circle cx="${X(pts.length - 1)}" cy="${Y(pts.length - 1)}" r="4" fill="none" stroke="#a02a1a" stroke-width="2"/>`;
        svg += `<circle cx="${X(at)}" cy="${Y(at)}" r="4" fill="#1d4f7a"/>`;
        svg += `<text x="${X(0)}" y="${Math.max(10, Number(Y(0)) - 6)}" font-size="9" fill="#3b2410" text-anchor="middle">${esc(chart.from || '')}</text>`;
        svg += `<text x="${X(pts.length - 1)}" y="${Math.max(10, Number(Y(pts.length - 1)) - 7)}" font-size="9" fill="#7a1a10" text-anchor="middle">${esc(chart.dest || '')}</text>`;
        return `${svg}</svg>`;
    },

    showCharts(game) {
        const ship = this.ship(game);
        if (!ship) return;
        const chart = BelowDecks.chart(game.player, ship);
        let html = '<div style="max-height:470px;overflow-y:auto;">';
        html += `<h4 style="margin:0 0 6px;">🗺️ The charts</h4>`;
        if (chart.route.length) {
            html += this._chartSvg(game, chart);
            html += `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;">${esc(chart.from || 'Port')} → ${esc(chart.dest)} · ${chart.done}/${chart.leagues} leagues sailed · about ${chart.daysLeft} day${chart.daysLeft === 1 ? '' : 's'} to go</div>`;
        }
        html += `<div style="font-size:12px;margin-bottom:8px;font-style:italic;">${esc(chart.advice)}</div>`;
        const nav = ShipOfficers.of(ship, 'navigator');
        if (nav) {
            const sp = Math.round(ShipOfficers.bonus(ship, 'speed', game.world) * 100), sf = Math.round(ShipOfficers.bonus(ship, 'routeSafety', game.world) * 100);
            html += `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;">${esc(nav.name)}'s reckoning is worth +${sp}% speed and ${sf}% safer passage.</div>`;
        } else if (ShipOfficers.hasPost(ship, 'navigator')) {
            html += '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;">No navigator aboard: promote one from the hands (the officers\' roll).</div>';
        }
        html += `<div style="display:flex;gap:6px;"><button onclick="window._bdLog()" style="flex:1;${BTN_SECONDARY}">📖 The log</button><button onclick="window._bdOfficers()" style="flex:1;${BTN_SECONDARY}">📯 The officers</button><button onclick="window._bdClose()" style="flex:1;${BTN_SECONDARY}">Roll them up</button></div></div>`;
        game.ui.showCustomPanel('🗺️ The Charts', html);
        this._bind(game, () => this.showCharts(game));
    },

    /** One officer: skill, loyalty, pay and what is owed; praise, reprimand, break. */
    _officerCard(game, ship, post, compact = false) {
        const P = ShipOfficers.post(post);
        const o = ShipOfficers.of(ship, post);
        if (!o) return '';
        const L = ShipOfficers.config().loyalty;
        const lc = o.loyalty >= 60 ? '#5cb85c' : o.loyalty >= _num(L.sulkAt) ? '#f0ad4e' : '#e57373';
        const mood = o.loyalty >= 75 ? 'devoted' : o.loyalty >= 50 ? 'steady' : o.loyalty >= _num(L.sulkAt) ? 'grumbling' : o.loyalty >= _num(L.desertAt) ? 'sullen — half a heart in it' : 'talking of going ashore for good';
        let html = `<div style="${CARD}"><div style="font-weight:bold;font-size:12px;">${P.icon || ''} ${esc(P.title.replace(/^./, c => c.toUpperCase()))}: ${esc(o.name)}</div>`;
        html += `<div style="font-size:11px;margin:3px 0;">Skill ${Math.round(o.skill)} ${_bar(o.skill, '#4fc3f7')} · Loyalty ${Math.round(o.loyalty)} ${_bar(o.loyalty, lc)}</div>`;
        html += `<div style="font-size:11px;color:var(--text-secondary);">${esc(mood)} · ${Utils.formatGold(P.pay)}g a day${o.arrears > 0 ? ` · <span style="color:#e57373;">owed ${Utils.formatGold(o.arrears)}g</span>` : ''}${o.victories ? ` · ${o.victories} fight${o.victories === 1 ? '' : 's'} won` : ''}</div>`;
        if (!compact) html += `<div style="font-size:10px;color:var(--text-secondary);margin-top:2px;">${esc(P.desc || '')}</div>`;
        html += `<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:5px;">${_btn('👏 Praise', `window._bdPraise('${post}')`, ShipOfficers.praiseReason(ship, game.world, post))}${_btn('🗣️ Reprimand', `window._bdReprimand('${post}')`)}${compact ? '' : _btn('⬇️ Break to the hands', `window._bdDismiss('${post}')`)}</div></div>`;
        return html;
    },

    showOfficers(game) {
        const ship = this.ship(game);
        if (!ship) return;
        let html = '<div style="max-height:480px;overflow-y:auto;">';
        html += `<h4 style="margin:0 0 4px;">📯 The officers of the ${esc(ship.name)}</h4>`;
        html += '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;">Promote from the named hands. Pay them, feed them, win with them and they hold; leave them owed, hungry or flogged at and they sour — and in port a sour officer walks.</div>';
        for (const post of ShipOfficers.POSTS) {
            const P = ShipOfficers.post(post);
            if (!ShipOfficers.hasPost(ship, post)) {
                html += `<div style="${CARD}opacity:0.55;font-size:11px;">${P.icon || ''} ${esc(P.title)} — she is too small to carry one (needs a crew of ${P.minCrew}).</div>`;
                continue;
            }
            if (ShipOfficers.of(ship, post)) { html += this._officerCard(game, ship, post); continue; }
            html += `<div style="${CARD}"><div style="font-weight:bold;font-size:12px;">${P.icon || ''} ${esc(P.title.replace(/^./, c => c.toUpperCase()))}: <span style="color:var(--text-secondary);">vacant</span></div><div style="font-size:10px;color:var(--text-secondary);margin-bottom:4px;">${esc(P.desc || '')} ${Utils.formatGold(P.pay)}g a day.</div>`;
            const cands = ShipOfficers.candidates(ship, post).slice(0, 3);
            if (!cands.length) html += '<div style="font-size:11px;color:var(--text-secondary);">No hand fit for it.</div>';
            for (const c of cands) {
                html += `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:11px;padding:2px 0;"><span>${esc(c.name)} <span style="color:var(--text-secondary);">(${esc(c.title)}) · skill ${c.skill} · loyalty ${c.loyalty}</span></span>${_btn('⬆️ Promote', `window._bdPromote('${post}', ${c.slot})`, null, true)}</div>`;
            }
            html += '</div>';
        }
        const pay = ShipOfficers.dailyPay(ship), owed = ShipOfficers.arrears(ship);
        const weekFlogs = ShipOfficers.floggingsSince(ship, game.world, 7);
        html += `<div style="font-size:11px;margin:6px 0;">Officers' pay ${Utils.formatGold(pay)}g a day${owed > 0 ? ` · <span style="color:#e57373;">${Utils.formatGold(owed)}g owed</span>` : ''} · ${weekFlogs} flogging${weekFlogs === 1 ? '' : 's'} this week</div>`;
        html += `<div style="display:flex;gap:6px;flex-wrap:wrap;">${_btn('💰 Pay what is owed', 'window._bdPayArrears()', owed > 0 ? null : 'Nothing is owed')}${_btn('➰ Flog a man at the gangway', 'window._bdFlog()', ShipOfficers.flogReason(ship, game.world))}<button onclick="window._bdClose()" style="${BTN_SECONDARY}">Close</button></div></div>`;
        game.ui.showCustomPanel("📯 The Officers' Roll", html);
        this._bind(game, () => this.showOfficers(game));
    },
};

function _num(v, d = 0) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }
