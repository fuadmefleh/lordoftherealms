// ============================================
// THE DECK — time aboard your ship on the inner map
// ============================================
// "Go on Deck" at sea opens the open-sea map with your ship and its walkable
// deck (world/innerMap/harbour.js). This makes it a place where things happen:
//
//   The crew   — the ship's hands (systems/deckLife.js roster) on deck at
//                their stations (world/innerMap/deckLife.js), working: the
//                helmsman at the wheel, the lookout at the bow, topmen at the
//                masts, deckhands swabbing. They talk among themselves (barks)
//                and to you: the mate reports and takes orders; any hand will
//                say how things stand.
//   The helm   — the wheel at the stern: the voyage and its orders (sail
//                through the day, heave to, make for port), the event the sea
//                has sent, the captain's orders to the crew. The hatch: the
//                hold's manifest (goods only cross to shore by dock or boat).
//   The sea    — a storm (the weather at the ship) darkens the deck, raises
//                whitecaps and sends the crew to the masts and pumps; an event
//                waiting on the captain shows on the water (a man in the wake,
//                a sail, whales, a derelict, coils, fog, a shoal, blue fire
//                aloft) and is answered on deck, with the captain's own
//                choices (Ships.describeVoyageEvent { onDeck: true }).
//   Boarders   — pirates who close are fought hand to hand: a pirate hull
//                alongside, boarders over the rail, the crew and you against
//                them (the inner-map combat for your blows, deck blows for the
//                crew's). Ships.finishBoarding settles it by the event's own
//                win/lose outcome; leave the deck and the dice settle it.
//
// One clock: the hours are the inner map's (InnerMap.timeOfDay); a day ends
// as it does anywhere on the inner map (the day-end modal, or "Sail through
// the day" at the helm), and the day's end is game.endDay — where the voyage
// moves (Ships.processDaily). onVoyageDay keeps the world-map voyage panel's
// auto-sail from ending days under you while you are on deck.

import { InnerMap } from '../world/innerMap.js';
import { InnerMapRenderer } from './innerMapRenderer.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { InnerMapReactions } from './innerMapReactions.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { ActionMenu } from './actionMenu.js';
import { Ships } from '../systems/ships.js';
import { DeckLife } from '../systems/deckLife.js';
import { drawMapText } from './mapInk.js';

const BTN = 'padding:7px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;transition:all 0.12s;';
const BTN_PRIMARY = `${BTN}border:1px solid rgba(245,197,66,0.55);background:linear-gradient(180deg,#f6cf57,#d9a92a);color:#1a1a1a;`;
const BTN_SECONDARY = `${BTN}border:1px solid rgba(255,255,255,0.14);background:rgba(255,255,255,0.05);color:var(--text-primary);`;
const BTN_OFF = `${BTN_SECONDARY}opacity:0.5;cursor:not-allowed;`;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const _now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const _cheb = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));

function pill(label, value, color = null) {
    return `<span style="font-size:11px;padding:2px 7px;border:1px solid var(--border);border-radius:999px;background:rgba(255,255,255,0.03);${color ? `color:${color};` : ''}">${label} ${value}</span>`;
}

export const InnerMapDeck = {
    _sit: null,
    _sitKey: null,
    _sitTimer: 0,
    _chatTimer: 6,
    _day: null,
    _fight: null,
    _game: null,

    /* ── Where we are ─────────────────────────────────────────── */

    /** The ship the player stands aboard, or null. */
    ship(game) {
        const p = game && game.player;
        return p && p.boardedShip != null ? Ships.getShipById(p, p.boardedShip) : null;
    },

    /** On deck: the inner map of the sea, aboard your own ship. */
    active(game) {
        return !!(InnerMap.active && InnerMap._deck && !InnerMap._insideBuilding && this.ship(game));
    },

    /** Is the player on deck right now (for the voyage panel)? */
    onDeck(game) {
        return this.active(game);
    },

    _crew() {
        return (InnerMap.npcs || []).filter(n => n.deckRole);
    },

    _member(role) {
        return this._crew().find(n => n.deckRole === role) || null;
    },

    /* ── Coming aboard, leaving, a new day ───────────────────── */

    /** After InnerMap.enter (ui/game/innerMap.js): man the deck when this is the sea aboard ship. */
    onEnter(game) {
        this._game = game;
        this._fight = null;
        this._sit = null;
        this._sitKey = null;
        InnerMap._deck = null;
        const ship = this.ship(game);
        const wt = game && game.world && InnerMap.currentWorldTile ? game.world.getTile(InnerMap.currentWorldTile.q, InnerMap.currentWorldTile.r) : null;
        if (!ship || !wt || !Ships.isWaterTile(wt)) return false;
        InnerMap._manDeck(DeckLife.roster(ship));
        if (!InnerMap._deck) return false;
        // (a pirate hull left on the cached map by a fight that was saved or left)
        InnerMap._clearPirateHull();
        this._day = game.world.day;
        this._snapWeather(game);
        // The sea's own scene, under the night and the weather (innerMapRenderer.js Layer 8b)
        InnerMapRenderer.onSeaLayer = (ctx, camera, canvas) => this.renderSea(ctx, camera, canvas);
        this._refresh(game, true);
        const v = ship.voyage;
        game.ui.showNotification(`⛵ Aboard the ${ship.name}`,
            v ? `Bound for ${v.destName}. The helm is at the stern; speak to the mate, or give your orders from the wheel. The day passes here as anywhere.`
                : 'Hove to on the open sea. Take the helm at the stern to make for port.', 'info');
        // Boarders from before (a save, a step off the deck): back at it
        if (Ships.getBoarding(game.player)) this._startBoarding(game, false);
        return true;
    },

    /** Leaving the deck (exitInnerMap): an unfinished fight is settled by the dice. */
    onExit(game) {
        if (this._fight) {
            this._clearFight();
            const res = Ships.finishBoarding(game.player, game.world, null);
            if (res.success) game.ui.showNotification(res.won ? '⚔️ The Crew Fights On' : '🏴‍☠️ Overrun', `You left the deck to them. ${res.text}`, res.won ? 'success' : 'error');
        }
        this._fight = null;
        if (InnerMap._clearPirateHull && InnerMap.tiles) InnerMap._clearPirateHull();
        InnerMap._deck = null;
        this._sit = null;
        this._sitKey = null;
    },

    /** The weather at the ship's hex, for the rain and the dark (InnerMap.weather). */
    _snapWeather(game) {
        const p = game.player;
        if (game.world && game.world.weather && typeof game.world.weather.getWeather === 'function') {
            InnerMap.weather = game.world.weather.getWeather(p.q, p.r);
        }
    },

    /** A day has ended aboard: the ship is somewhere new, the crew may be fewer. */
    _newDay(game) {
        this._day = game.world.day;
        const p = game.player;
        const wt = game.world.getTile(p.q, p.r);
        InnerMap.currentWorldTile = { q: p.q, r: p.r };
        InnerMap._currentWorldTileRef = wt;
        this._snapWeather(game);
        // A fight the day's end settled by the dice (Ships._voyageDay): its boarders are gone
        if (this._fight && !Ships.getBoarding(p)) this._clearFight();
        const ship = this.ship(game);
        if (ship && !this._fight && DeckLife.roster(ship).length !== this._crew().length) InnerMap._manDeck(DeckLife.roster(ship));
        for (const n of this._crew()) n._deckWounded = false;
        this._sitKey = null;
        this._refresh(game, true);
    },

    /**
     * The day's voyage report (ui/actionMenu/voyage.js onVoyageDay) while on
     * deck: the morning on deck instead of the panel that sails on by
     * itself. Returns true when handled here; false to let the panel show
     * (landfall: the deck is left first).
     */
    onVoyageDay(game, day) {
        if (!this.active(game) && !(InnerMap.active && InnerMap._deck)) return false;
        // (a day run out at midnight goes on from 12:01; one slept through wakes at 8)
        if (InnerMap._midnightDay !== game.world.day) {
            InnerMap.timeOfDay = 8;
            InnerMap._timeAccumulator = 0;
        }
        InnerMap.dayEnded = false;
        game._innerMapDayEndShown = false;
        if (day.arrived || !game.player.boardedShip) {
            this.onExit(game);
            if (typeof game.exitInnerMap === 'function') game.exitInnerMap({ force: true });
            return false;
        }
        if (day.autoBoarding && day.autoBoarding.success) {
            game.ui.showNotification(day.autoBoarding.won ? '⚔️ Boarders Beaten Off' : '🏴‍☠️ Boarded', day.autoBoarding.text, day.autoBoarding.won ? 'success' : 'error');
        }
        const lines = (day.log || []).map(e => `${e.icon || '•'} ${e.text}`);
        const v = Ships.getVoyage(game.player);
        const head = v ? `⛵ Day ${v.day} at sea` : '⛵ A new day at sea';
        game.ui.showNotification(head, lines.slice(0, 3).join(' ') || 'Fair winds.', day.notable ? 'warning' : 'info');
        if (this._day !== game.world.day) this._newDay(game);
        return true;
    },

    /* ── Every frame ──────────────────────────────────────────── */

    update(dt, game) {
        if (!InnerMap.active || !InnerMap._deck) return;
        // Off the ship (it made port, it was taken, it sank): off the deck
        if (!this.ship(game)) {
            this.onExit(game);
            if (typeof game.exitInnerMap === 'function') game.exitInnerMap({ force: true });
            return;
        }
        if (InnerMap._insideBuilding) return;
        if (this._day !== game.world.day) this._newDay(game);
        this._sitTimer -= dt;
        if (this._sitTimer <= 0) {
            this._sitTimer = 1;
            this._refresh(game, false);
        }
        if (this._fight) this._fightTick(dt, game);
        // The hands talk among themselves
        this._chatTimer -= dt;
        if (this._chatTimer <= 0) {
            this._chatTimer = 7 + Math.random() * 9;
            const crew = this._crew().filter(n => !n._dialogFrozen && n.state !== 'dialog');
            const who = crew[Math.floor(Math.random() * crew.length)];
            const line = who ? DeckLife.chatter(who.deckMember, this.ship(game), this._sit) : null;
            if (line) InnerMapReactions.bark(who, line, 3.2);
        }
    },

    /** Read the situation; when it changes, send the crew where it wants them. */
    _refresh(game, force) {
        const ship = this.ship(game);
        if (!ship) return;
        const sit = DeckLife.situation(game.player, game.world, ship, { hour: InnerMap.timeOfDay });
        const key = `${sit.kind}|${sit.eventId || ''}`;
        const prev = this._sit;
        this._sit = sit;
        // Under way or hove to: how the water runs past (ui/innerMapLayers/waterFx.js)
        if (InnerMap._deck) InnerMap._deck.underway = !!ship.voyage;
        if (sit.landNear && !(prev && prev.landNear)) this._landHo(game, ship);
        if (!force && key === this._sitKey) return;
        this._sitKey = key;
        const pace = DeckLife.pace(sit);
        for (const n of this._crew()) {
            const m = { ...n.deckMember, wounded: !!n._deckWounded };
            const st = DeckLife.stationFor(m, sit);
            const typeDef = (InnerMap.NPC_TYPES && InnerMap.NPC_TYPES[n.type]) || { speed: 0.5 };
            n.speed = (typeDef.speed || 0.5) * pace;
            if (st === n.deckStation && !force) continue;
            n.deckStation = st;
            n.deckWork = DeckLife.workAt(st);
            if (st !== 'fight') n.deckTarget = null;
            // Drop what they were at and go (staggered, as men do)
            if (!n._dialogFrozen && n.state !== 'dialog' && n.state !== 'walking') {
                n.activity = null;
                n.state = 'idle';
                n.idleTimer = Math.random() * 1.2;
            }
        }
        if (force) return;
        // The cry goes up
        const call = DeckLife.callout(sit);
        const caller = call && (this._member(call.role) || this._member('mate') || this._crew()[0]);
        if (call && caller) InnerMapReactions.bark(caller, call.text, 4);
        if (sit.kind === 'storm' && !(prev && prev.kind === 'storm')) {
            game.ui.showNotification('⛈️ Storm at Sea', 'All hands! The topmen go aloft to reef, the rest to the pumps. She will make little way today.', 'warning');
        } else if (sit.eventId && (!prev || prev.eventId !== sit.eventId) && sit.kind !== 'boarding') {
            const ev = Ships.describeVoyageEvent(game.player, { onDeck: true });
            if (ev) game.ui.showNotification(`${ev.icon} ${ev.title}`, `${ev.text} Take the helm, or speak to the mate, to give your orders.`, 'warning');
        }
    },

    _landHo(game, ship) {
        const res = DeckLife.noteLandSighted(ship);
        if (!res) return;
        const look = this._member('lookout') || this._crew()[0];
        if (look) InnerMapReactions.bark(look, DeckLife.config().landSighted.callout || 'Land ho!', 4);
        const v = ship.voyage;
        game.ui.showNotification('🏝️ Land Ho!', `The lookout sights land: ${v ? v.destName : 'the coast'} by tomorrow. The crew's spirits lift.`, 'success');
    },

    /* ── The context menu on deck (ui/innerMapUI.js) ──────────── */

    /**
     * Replace the generic object menu the hull would give ("Strike Galleon")
     * with the deck's own: walk here, the helm, the hold, the orders.
     */
    menuItems(game, menuItems, tile, q, r, npcsHere) {
        const ship = this.ship(game);
        const L = InnerMap._deck;
        if (!ship || !L) return;
        const keep = new Set(['wait_here', 'rest', 'pickup_ground_item', 'fish_here', 'search_body', 'carry_body', 'drop_body', 'ko_finish', 'ko_rob', 'ko_leave',
            // over the side, under the water, back aboard (ui/innerMapDiving.js)
            'dive_overboard', 'dive_jump', 'dive_climb', 'dive_under', 'dive_surface', 'dive_pickup']);
        // In the water alongside her, a swimmer still swims where they will
        if (!InnerMap.isOnDeck(InnerMap.playerInnerQ, InnerMap.playerInnerR)) keep.add('move_here');
        const out = [];
        let header = null;
        for (const it of menuItems) {
            if (it.type === 'header') { header = it; continue; }
            if (it.type === 'separator') { header = null; continue; }
            const ok = it.type === 'person' || (it.type === 'action' && keep.has(it.action));
            if (!ok) continue;
            if (header) { if (out.length) out.push({ type: 'separator' }); out.push(header); header = null; }
            out.push(it);
        }
        const deck = [];
        const isMe = q === InnerMap.playerInnerQ && r === InnerMap.playerInnerR;
        if (!isMe && InnerMap.isOnDeck(q, r)) deck.push({ type: 'action', action: 'move_here', label: 'Move Here', icon: '🚶', desc: 'Walk to this spot on deck' });
        const ev = Ships.describeVoyageEvent(game.player, { onDeck: true });
        if (this._fight) deck.push({ type: 'action', action: 'deck_helm', label: 'Boarders on Deck!', icon: '⚔️', desc: `${this._fight.boarders.filter(b => !b._down).length} left — fight them, or strike your colours at the helm` });
        else if (ev) deck.push({ type: 'action', action: 'deck_helm', label: `${ev.title}: Give Orders`, icon: ev.icon, desc: 'At the helm' });
        deck.push({ type: 'action', action: 'deck_helm', label: tile && tile._helm ? 'Take the Helm' : 'Go to the Helm', icon: '🧭', desc: ship.voyage ? `Bound for ${ship.voyage.destName}` : 'Make for port' });
        deck.push({ type: 'action', action: 'deck_hold', label: 'Go Below to the Hold', icon: '📦', desc: `${Ships.getCargoUsed(ship)}/${Ships.getShipEffectiveStats(ship).cargoCapacity} stowed · ${this._foodText(ship)}` });
        for (const o of DeckLife.ordersFor(game.player, game.world, ship)) {
            if (o.available) deck.push({ type: 'action', action: 'deck_order', order: o.id, label: o.label, icon: o.icon, desc: o.desc });
            else deck.push({ type: 'disabled', label: `${o.label} — ${o.why}` });
        }
        const head = [{ type: 'header', label: `⛵ The ${ship.name}` }, ...deck];
        menuItems.splice(0, menuItems.length, ...head, ...(out.length ? [{ type: 'separator' }, ...out] : []));
    },

    /** Deck actions from the context menu. → true when handled. */
    handle(game, item) {
        if (!item || !this.active(game)) return false;
        const L = InnerMap._deck;
        if (item.action === 'talk_npc' && item.npc && item.npc.deckRole) {
            const npc = item.npc;
            const talk = () => this.talk(game, npc);
            if (InnerMap.approachAndThen(npc.q, npc.r, talk) === 'unreachable') talk();
            return true;
        }
        if (item.action === 'deck_helm') {
            const go = () => this.showHelm(game);
            if (InnerMap.approachAndThen(L.helm.q, L.helm.r, go) === 'unreachable') go();
            return true;
        }
        if (item.action === 'deck_hold') {
            const go = () => this.showHold(game);
            if (InnerMap.approachAndThen(L.hatch.q, L.hatch.r, go) === 'unreachable') go();
            return true;
        }
        if (item.action === 'deck_order') {
            this.order(game, item.order);
            return true;
        }
        return false;
    },

    _foodText(ship) {
        const d = Ships.getProvisionDays(ship);
        return d === Infinity ? 'no mouths to feed' : `victuals for ${d} day${d === 1 ? '' : 's'}`;
    },

    /* ── Panels: the helm, the hold, a word with the crew ─────── */

    _pills(ship) {
        const food = Ships.getProvisionDays(ship);
        const foodColor = food === Infinity ? null : food <= 2 ? '#e57373' : food <= 5 ? '#f0ad4e' : '#5cb85c';
        return '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">'
            + pill('🍞', food === Infinity ? '—' : `${food}d`, foodColor)
            + pill('👥', `${Ships.getCrew(ship)}/${Ships.getShipEffectiveStats(ship).crewRequired}`)
            + pill('🙂', Ships.getMorale(ship))
            + pill('🔧', `${ship.condition}%`)
            + '</div>';
    },

    /** The waiting event and its choices (deck-only ones marked), as panel HTML. */
    _eventHtml(game) {
        const ev = Ships.describeVoyageEvent(game.player, { onDeck: true });
        if (!ev) return '';
        let html = '<div style="padding:8px;border:1px solid rgba(79,195,247,0.45);border-radius:8px;background:rgba(79,195,247,0.06);margin-bottom:8px;">';
        html += `<div style="font-weight:bold;margin-bottom:4px;">${ev.icon} ${esc(ev.title)}</div>`;
        html += `<div style="font-size:12px;margin-bottom:8px;">${esc(ev.text)}</div><div style="display:flex;flex-direction:column;gap:6px;">`;
        for (const c of ev.choices) {
            const tag = c.deckOnly ? ' <span style="font-size:10px;opacity:0.75;">(on deck)</span>' : '';
            html += c.available
                ? `<button onclick="window._deckChoose('${esc(c.id)}')" style="${BTN_PRIMARY}text-align:left;">${esc(c.label)}${tag}</button>`
                : `<button disabled style="${BTN_OFF}text-align:left;">${esc(c.label)} — ${esc(c.why)}</button>`;
        }
        return html + '</div></div>';
    },

    _ordersHtml(game, ship) {
        let html = '<div style="font-size:11px;font-weight:bold;margin:6px 0 4px;">📣 Orders to the crew</div><div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">';
        for (const o of DeckLife.ordersFor(game.player, game.world, ship)) {
            html += o.available
                ? `<button onclick="window._deckOrder('${esc(o.id)}')" title="${esc(o.desc)}" style="${BTN_SECONDARY}">${o.icon} ${esc(o.label)}</button>`
                : `<button disabled title="${esc(o.why)}" style="${BTN_OFF}">${o.icon} ${esc(o.label)}</button>`;
        }
        return html + '</div>';
    },

    _bindPanel(game, back) {
        window._deckChoose = (id) => this.choose(game, id, back);
        window._deckOrder = (id) => this.order(game, id, back);
        window._deckSailDay = () => this.sailThroughDay(game);
        window._deckHeaveTo = () => this.heaveTo(game);
        window._deckMakePort = () => this.makeForPort(game);
        window._deckHelm = () => this.showHelm(game);
        window._deckHold = () => this.showHold(game);
        window._deckStrike = () => this.strikeColours(game);
        window._deckRation = () => this.breakOutRation(game);
        window._deckLeave = () => { game.ui.hideCustomPanel(); if (typeof game.exitInnerMap === 'function') game.exitInnerMap(); };
        window._deckClose = () => game.ui.hideCustomPanel();
    },

    /** The wheel: the voyage, the sea's event, the crew's orders. */
    showHelm(game, outcome = null) {
        const ship = this.ship(game);
        if (!ship) return;
        const v = ship.voyage;
        let html = '<div style="max-height:470px;overflow-y:auto;">';
        html += `<h4 style="margin:0 0 4px;">🧭 The helm of the ${esc(ship.name)}</h4>`;
        if (v) {
            const left = Ships.voyageDays(game.player, ship, Math.max(1, v.route.length - v.step));
            html += `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;">Bound for ${esc(v.destName)} · day ${v.day} at sea · about ${left} day${left === 1 ? '' : 's'} to go${v.delay > 0 ? ' · lying to' : ''} · ${esc(InnerMap.getTimeString ? InnerMap.getTimeString() : '')}</div>`;
        } else {
            html += '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;">Hove to on the open sea. No course set.</div>';
        }
        html += this._pills(ship);
        if (outcome) html += `<div style="padding:8px;border:1px solid rgba(245,197,66,0.35);border-radius:8px;background:rgba(245,197,66,0.06);font-size:12px;margin-bottom:8px;">${outcome.icon || ''} ${esc(outcome.text)}</div>`;
        if (this._fight) {
            const left = this._fight.boarders.filter(b => !b._down).length;
            html += `<div style="padding:8px;border:1px solid rgba(229,115,115,0.5);border-radius:8px;background:rgba(229,115,115,0.07);margin-bottom:8px;font-size:12px;">⚔️ <b>Boarders on deck</b> — ${left} still fighting. Strike them down (click one → Attack), or strike your colours and let them take what they came for.`;
            html += `<div style="margin-top:6px;"><button onclick="window._deckStrike()" style="${BTN_SECONDARY}">🏳️ Strike your colours</button></div></div>`;
        } else {
            html += this._eventHtml(game);
        }
        if (!this._fight) {
            html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">';
            if (v) {
                const waiting = !!Ships.describeVoyageEvent(game.player);
                html += `<button onclick="window._deckSailDay()" ${waiting ? 'disabled' : ''} style="flex:1;${waiting ? BTN_OFF : BTN_PRIMARY}" title="End the day: the ship sails on">⛵ Sail through the day</button>`;
                html += `<button onclick="window._deckHeaveTo()" style="flex:1;${BTN_SECONDARY}">⚓ Heave to</button>`;
            } else {
                html += `<button onclick="window._deckMakePort()" style="flex:1;${BTN_PRIMARY}">🧭 Make for port</button>`;
                html += `<button onclick="window._deckSailDay()" style="flex:1;${BTN_SECONDARY}" title="End the day here at sea">🌙 Lie to for the day</button>`;
            }
            html += '</div>';
            html += this._ordersHtml(game, ship);
        }
        const log = (v || ship.lastVoyage) ? ((v || ship.lastVoyage).log || []).slice(-3) : [];
        if (log.length) {
            html += '<div style="font-size:11px;font-weight:bold;margin:4px 0;">📜 Ship\'s log</div><div style="padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:rgba(255,255,255,0.02);margin-bottom:8px;">';
            html += log.map(e => `<div style="font-size:11px;padding:2px 0;">${e.icon || '•'} ${esc(e.text)}</div>`).join('') + '</div>';
        }
        html += `<div style="display:flex;gap:6px;"><button onclick="window._deckHold()" style="flex:1;${BTN_SECONDARY}">📦 The hold</button><button onclick="window._deckLeave()" style="flex:1;${BTN_SECONDARY}">🗺️ Leave the deck</button></div>`;
        html += '</div>';
        game.ui.showCustomPanel('🧭 The Helm', html);
        this._bindPanel(game, () => this.showHelm(game));
    },

    /**
     * The hold: what is aboard (goods cross to shore only by dock or boat,
     * Ships.getShipsWithHoldAccess) and a ration broken out for the captain.
     */
    showHold(game, note = null) {
        const ship = this.ship(game);
        if (!ship) return;
        const stats = Ships.getShipEffectiveStats(ship);
        let html = '<div style="max-height:440px;overflow-y:auto;">';
        html += `<h4 style="margin:0 0 4px;">📦 Below decks in the ${esc(ship.name)}</h4>`;
        html += `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;">${Ships.getCargoUsed(ship)} / ${stats.cargoCapacity} stowed · ${this._foodText(ship)}. Goods come and go by the dock or the ship's boat — load and unload in port or at anchor.</div>`;
        if (note) html += `<div style="padding:6px 8px;border:1px solid rgba(245,197,66,0.35);border-radius:8px;font-size:12px;margin-bottom:8px;">${esc(note)}</div>`;
        const hold = Object.entries(ship.cargo || {}).filter(([, n]) => n > 0);
        if (!hold.length) html += '<div style="font-size:11px;color:var(--text-secondary);margin-bottom:6px;">The hold is empty but for the bilge.</div>';
        for (const [id, n] of hold) {
            html += `<div style="display:flex;justify-content:space-between;padding:5px 8px;border:1px solid var(--border);border-radius:8px;margin-bottom:4px;font-size:12px;"><span>${esc(id.replace(/_/g, ' '))}</span><span style="color:var(--text-secondary);">×${n}</span></div>`;
        }
        const canEat = Ships.getProvisions(ship) > 0 && game.player.needsEnabled && game.player.needs;
        html += '<div style="display:flex;gap:6px;margin-top:8px;">';
        html += `<button onclick="window._deckRation()" ${canEat ? '' : 'disabled'} style="flex:1;${canEat ? BTN_PRIMARY : BTN_OFF}">🍞 Break out a ration for yourself</button>`;
        html += `<button onclick="window._deckHelm()" style="flex:1;${BTN_SECONDARY}">🧭 Back to the helm</button></div></div>`;
        game.ui.showCustomPanel("📦 The Ship's Hold", html);
        this._bindPanel(game, () => this.showHold(game));
    },

    /** Eat a ration from the hold now (the captain's share; the crew's stores). */
    breakOutRation(game) {
        const ship = this.ship(game);
        const p = game.player;
        if (!ship || !p.needs) return;
        const food = Ships.feedCaptain(p);
        if (!food) { this.showHold(game, 'Nothing left to eat.'); return; }
        if (typeof p.modifyNeed === 'function') p.modifyNeed('hunger', 30);
        game.ui.updateStats(p, game.world);
        this.showHold(game, `You eat a ration of ${food.replace(/_/g, ' ')} with the hands.`);
    },

    /**
     * A word with a hand. The mate (or whoever is senior) reports on the
     * ship and takes your orders; the helmsman offers the wheel; anyone says
     * what they think of it all.
     */
    talk(game, npc) {
        const ship = this.ship(game);
        if (!ship || !npc) return false;
        // They stop what they're doing and turn to you
        npc.path = null;
        npc.moveProgress = 0;
        npc.state = 'idle';
        npc.idleTimer = 8;
        npc.activity = null;
        npc.facing = InnerMapCharacters.getDirection(InnerMap.playerInnerQ - npc.q, InnerMap.playerInnerR - npc.r);
        if (game.player.modifyNeed) game.player.modifyNeed('social', 4);
        const officer = DeckLife.officerOf(this._crew().map(n => n.deckMember));
        const isOfficer = officer && npc.crewSlot === officer.slot;
        let html = '<div style="max-height:470px;overflow-y:auto;">';
        html += `<h4 style="margin:0 0 2px;">${esc(npc.name)}</h4><div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;">${esc(npc.roleTitle || 'hand')} of the ${esc(ship.name)}</div>`;
        const say = (t) => `<div style="font-size:12px;margin-bottom:6px;font-style:italic;">“${esc(t)}”</div>`;
        if (this._fight) {
            html += say(DeckLife.chatter(npc.deckMember, ship, { kind: 'boarding' }) || 'Not now, Captain!');
        } else if (isOfficer) {
            for (const line of DeckLife.mateReport(game.player, game.world, ship)) html += say(line);
            html += this._eventHtml(game);
            html += this._ordersHtml(game, ship);
        } else {
            html += say(DeckLife.chatter(npc.deckMember, ship, this._sit) || 'Aye, Captain.');
            const work = npc.deckWork ? npc.deckWork.label : null;
            if (work) html += `<div style="font-size:11px;color:var(--text-secondary);margin-bottom:8px;">${esc(work)}.</div>`;
            const lend = DeckLife.orderReason(game.player, game.world, ship, 'lend');
            html += `<div style="display:flex;gap:6px;margin-bottom:6px;"><button onclick="window._deckOrder('lend')" ${lend ? 'disabled' : ''} title="${esc(lend || '')}" style="flex:1;${lend ? BTN_OFF : BTN_SECONDARY}">💪 Lend them a hand</button></div>`;
        }
        html += '<div style="display:flex;gap:6px;">';
        if (npc.deckRole === 'helmsman' || isOfficer) html += `<button onclick="window._deckHelm()" style="flex:1;${BTN_PRIMARY}">🧭 Take the helm</button>`;
        html += `<button onclick="window._deckClose()" style="flex:1;${BTN_SECONDARY}">Carry on</button></div></div>`;
        game.ui.showCustomPanel(`💬 ${npc.name}`, html);
        this._bindPanel(game, () => this.talk(game, npc));
        return true;
    },

    /* ── What the captain does ────────────────────────────────── */

    /** Answer the sea's event from the deck (deck-only choices open; pirates board). */
    choose(game, choiceId) {
        const res = Ships.resolveVoyageEvent(game.player, game.world, choiceId, { onDeck: true });
        if (!res.success) { game.ui.showNotification('At Sea', res.message, 'error'); return; }
        game.ui.updateStats(game.player, game.world);
        this._sitKey = null;
        this._refresh(game, false);
        if (res.boarding) this._startBoarding(game, true);
        this.showHelm(game, res);
    },

    /** An order to the crew (systems/deckLife.js); an order that takes time moves the clock. */
    order(game, id, back = null) {
        const ship = this.ship(game);
        const res = ship ? DeckLife.giveOrder(game.player, game.world, ship, id) : { success: false, message: 'You are not aboard.' };
        if (!res.success) { game.ui.showNotification('Orders', res.message, 'error'); return; }
        if (res.hours > 0) {
            InnerMap.passHours(res.hours);
        }
        const o = (DeckLife.config().orders || {})[id] || {};
        const delta = res.morale ? ` (morale ${res.morale > 0 ? '+' : ''}${res.morale})` : '';
        game.ui.showNotification(`${o.icon || '📣'} ${o.label || 'Orders'}`, `${res.message}${delta}`, res.morale >= 0 ? 'success' : 'warning');
        // The crew answers
        const crew = this._crew();
        if (id === 'rally' && crew.length) for (const n of crew.slice(0, 4)) InnerMapReactions.bark(n, res.morale > 0 ? 'Huzzah!' : '...', 2.5);
        if (id === 'grog' && crew.length) InnerMapReactions.bark(crew[Math.floor(Math.random() * crew.length)], 'To the Captain!', 3);
        game.ui.updateStats(game.player, game.world);
        if (back) back();
    },

    /** End the day at sea: the voyage sails on (Ships.processDaily), the deck wakes to the next morning. */
    sailThroughDay(game) {
        if (this._fight) { game.ui.showNotification('Boarders!', 'Not with boarders on deck!', 'error'); return; }
        if (Ships.describeVoyageEvent(game.player)) { this.showHelm(game); return; }
        game.ui.hideCustomPanel();
        game._endDayConfirmed = true;
        game.endDay();
        InnerMap.timeOfDay = 8;
        InnerMap._timeAccumulator = 0;
        InnerMap.dayEnded = false;
        game._innerMapDayEndShown = false;
    },

    heaveTo(game) {
        const res = Ships.heaveTo(game.player, game.world);
        game.ui.showNotification('⚓ Heave To', res.message, res.success ? 'info' : 'error');
        this._sitKey = null;
        this._refresh(game, false);
        this.showHelm(game);
    },

    /** Plot a voyage from here (the Sail To menu; on deck it does not sail on by itself). */
    makeForPort(game) {
        const ship = this.ship(game);
        if (!ship) return;
        const tile = game.world.getTile(game.player.q, game.player.r);
        ActionMenu._showSailToMenu(game, tile, ship.id);
    },

    /** Give up the fight on deck: they take what they came for (the event's lose block). */
    strikeColours(game) {
        if (!this._fight) return;
        this._endFight(game, false, 'You strike your colours.');
    },

    /* ── Boarders ─────────────────────────────────────────────── */

    /** Pirates come alongside and over the rail (voyage.boarding). */
    _startBoarding(game, fresh) {
        const b = Ships.getBoarding(game.player);
        if (!b || this._fight) return;
        const party = DeckLife.boardingParty(b);
        InnerMap._layPirateHull(b.enemy >= 22 ? 'hull_brig' : 'hull_sloop');
        const boarders = InnerMap._spawnBoarders(party.names.map(name => ({ name, hp: party.hp })));
        for (const n of boarders) {
            InnerMapCombat._npcHealth.set(n.id, { current: party.hp, max: party.hp });
            // A fair fight: no crime in cutting down a boarder, and one beaten low goes over the side
            n._taskFoe = { onYield: () => this._boarderDown(game, n, 'goes over the side') };
            n._struckPlayerFirst = true;
        }
        for (const n of this._crew()) n._deckHp = DeckLife.crewHp();
        this._fight = { boarders, blowTimer: 0, started: _now() };
        this._sitKey = null;
        this._refresh(game, false);
        if (fresh || boarders.length) {
            game.ui.showNotification('🏴‍☠️ Boarders!', `${boarders.length} of them come over the rail, steel out. Fight beside your crew — click a boarder to attack — or strike your colours at the helm.`, 'error');
        }
    },

    _clearFight() {
        const f = this._fight;
        if (!f) return;
        for (const b of f.boarders) this._removeNpc(b);
        for (const n of this._crew()) { n.deckTarget = null; n.activity = null; }
        if (InnerMap._clearPirateHull) InnerMap._clearPirateHull();
        this._fight = null;
    },

    _removeNpc(npc) {
        const i = (InnerMap.npcs || []).indexOf(npc);
        if (i >= 0) InnerMap.npcs.splice(i, 1);
        if (InnerMapCombat._attackState && InnerMapCombat._attackState.npc === npc) InnerMapCombat.cancelAttack();
        InnerMapCombat._npcHealth.delete(npc.id);
        InnerMapCombat._npcReactions.delete(npc.id);
    },

    _boarderDown(game, npc, how) {
        if (npc._down) return;
        npc._down = true;
        const T = InnerMapRenderer.TILE_SIZE;
        InnerMapCombat._spawnFloat(npc.q * T + T / 2, npc.r * T, 0, 'killed', how === 'falls' ? 'Struck down' : 'Over the side');
        this._removeNpc(npc);
    },

    _endFight(game, won, lead = '') {
        this._clearFight();
        const res = Ships.finishBoarding(game.player, game.world, won);
        this._sitKey = null;
        this._refresh(game, false);
        if (!res.success) return;
        const crew = this._crew();
        if (won) for (const n of crew.slice(0, 5)) InnerMapReactions.bark(n, 'Huzzah!', 3);
        game.ui.showNotification(won ? '⚔️ Boarders Beaten Off' : '🏴‍☠️ Boarded and Beaten', `${lead ? `${lead} ` : ''}${res.text}`, won ? 'success' : 'error');
        game.ui.updateStats(game.player, game.world);
        this.showHelm(game, { icon: won ? '⚔️' : '🏴‍☠️', text: `${lead ? `${lead} ` : ''}${res.text}` });
    },

    /** The fight on deck: boarders go for you or the nearest hand; the crew for the nearest boarder. */
    _fightTick(dt, game) {
        const f = this._fight;
        const ship = this.ship(game);
        const live = f.boarders.filter(b => !b._down && (InnerMap.npcs || []).includes(b));
        if (!live.length) { this._endFight(game, true); return; }
        if (InnerMapCombat._playerOut) { this._endFight(game, false, 'You went down, and the deck with you.'); return; }
        const standing = this._crew().filter(n => !n._deckWounded && n.deckStation === 'fight');
        if (!standing.length && _cheb({ q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR }, live[0]) > 8) {
            this._endFight(game, false, 'Your crew is down.');
            return;
        }
        const me = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR };
        const nearest = (from, list) => list.reduce((best, x) => (!best || _cheb(from, x) < _cheb(from, best) ? x : best), null);
        // Boarders pick their man
        for (const b of live) {
            const hand = nearest(b, standing);
            const goMe = !hand || _cheb(b, me) <= 4 || _cheb(b, me) <= _cheb(b, hand);
            const t = goMe ? me : hand;
            b.deckTarget = { q: t.q, r: t.r };
            b._fightingPlayer = goMe;
            // Beside you: they swing at you (InnerMapCombat's blows)
            if (goMe && _cheb(b, me) <= 1 && !InnerMapCombat._npcReactions.has(b.id)) {
                InnerMapCombat._npcReactions.set(b.id, { mode: 'fight', attackTimer: InnerMapCombat.NPC_ATTACK_INTERVAL });
            }
        }
        // The crew goes for the nearest boarder
        for (const n of standing) {
            const foe = nearest(n, live);
            if (foe) n.deckTarget = { q: foe.q, r: foe.r };
        }
        // Blows between hands and boarders standing together
        f.blowTimer -= dt;
        if (f.blowTimer > 0) return;
        f.blowTimer = DeckLife.config().boarding.blowSecs || 1.1;
        const T = InnerMapRenderer.TILE_SIZE;
        for (const n of standing) {
            const foe = live.find(b => !b._down && _cheb(b, n) <= 1);
            if (!foe) { if (n.activity && n.activity.type === 'fight') n.activity = null; continue; }
            n.facing = InnerMapCharacters.getDirection(foe.q - n.q, foe.r - n.r);
            n.activity = { type: 'fight', icon: '⚔️', label: 'Fighting', anim: 'halfslash' };
            const hp = InnerMapCombat._npcHealth.get(foe.id);
            if (hp) {
                const dmg = DeckLife.crewBlow(ship);
                hp.current = Math.max(0, hp.current - dmg);
                InnerMapCombat._spawnFloat(foe.q * T + T / 2, foe.r * T + T * 0.1, dmg, 'hit');
                if (hp.current <= 0) { this._boarderDown(game, foe, 'falls'); continue; }
            }
            // ...and the boarder answers, if it isn't you they're after
            if (!foe._fightingPlayer || _cheb(foe, me) > 1) {
                foe.facing = InnerMapCharacters.getDirection(n.q - foe.q, n.r - foe.r);
                foe.activity = { type: 'boarder', icon: '⚔️', label: 'Boarding', anim: 'halfslash' };
                const blow = DeckLife.boarderBlow();
                n._deckHp = (n._deckHp == null ? DeckLife.crewHp() : n._deckHp) - blow;
                InnerMapCombat._spawnFloat(n.q * T + T / 2, n.r * T + T * 0.1, blow, 'player_hit');
                if (n._deckHp <= 0) {
                    n._deckWounded = true;
                    n.deckTarget = null;
                    n.deckStation = 'wounded';
                    n.deckWork = DeckLife.workAt('wounded');
                    n.activity = null;
                    n.state = 'idle';
                    n.idleTimer = 0.2;
                    InnerMapReactions.bark(n, 'Argh! I\'m hit!', 2.5);
                }
            }
        }
    },

    /* ── Drawing ──────────────────────────────────────────────── */

    /** World-pixel → screen for a tile cell's centre. */
    _at(camera, q, r, dy = 0) {
        const T = InnerMapRenderer.TILE_SIZE;
        const s = camera.worldToScreenFast(q * T + T / 2, r * T + T / 2 + dy * T);
        return { x: s.x, y: s.y };
    },

    /**
     * The sea's own scene, drawn over the world and under the night and the
     * weather (InnerMapRenderer.onSeaLayer): whitecaps and spray in a storm,
     * fog, and whatever the sea has sent — on the water beside the ship.
     */
    renderSea(ctx, camera, canvas) {
        const game = this._game;
        const L = InnerMap._deck;
        if (!game || !L || !this.active(game) || !this._sit) return;
        const t = _now() / 1000;
        const z = camera.zoom;
        const T = InnerMapRenderer.TILE_SIZE * z;
        const sit = this._sit;
        const midQ = Math.round((L.minQ + L.maxQ) / 2);
        ctx.save();
        // A storm: whitecaps racing across the swell, spray over the bow, lightning
        if (sit.storm) {
            const W = canvas.width, H = canvas.height;
            ctx.strokeStyle = 'rgba(235,245,255,0.55)';
            ctx.lineWidth = Math.max(1, 1.6 * z);
            ctx.beginPath();
            for (let i = 0; i < 70; i++) {
                const sx = ((i * 197.3 + t * 90 * (1 + (i % 3) * 0.3)) % (W + 120)) - 60;
                const sy = (i * 131.7) % H;
                const len = (14 + (i % 5) * 6) * z;
                ctx.moveTo(sx, sy);
                ctx.quadraticCurveTo(sx + len * 0.5, sy - 4 * z, sx + len, sy);
            }
            ctx.stroke();
            if (InnerMap.weather && InnerMap.weather.type !== 'storm') {
                ctx.fillStyle = 'rgba(15,20,40,0.25)';
                ctx.fillRect(0, 0, W, H);
            }
            const bow = this._at(camera, L.bow.q - 1, L.bow.r);
            ctx.fillStyle = 'rgba(230,240,255,0.5)';
            for (let i = 0; i < 12; i++) {
                const ph = (t * 1.7 + i * 0.37) % 1;
                ctx.beginPath();
                ctx.arc(bow.x - ph * T * 1.5, bow.y - Math.sin(ph * Math.PI) * T * 1.2 + (i % 4) * 3 * z, (2 + (i % 3)) * z, 0, Math.PI * 2);
                ctx.fill();
            }
            if (Math.sin(t * 0.9) > 0.995 || Math.sin(t * 2.3 + 1) > 0.998) {
                ctx.fillStyle = 'rgba(255,255,255,0.35)';
                ctx.fillRect(0, 0, W, H);
            }
        }
        switch (sit.scene) {
            case 'overboard': {
                const p = this._at(camera, midQ + 3, L.maxR + 3);
                const bob = Math.sin(t * 3) * 3 * z;
                for (let i = 0; i < 3; i++) {
                    const ph = (t * 0.8 + i / 3) % 1;
                    ctx.strokeStyle = `rgba(255,255,255,${0.6 * (1 - ph)})`;
                    ctx.lineWidth = 1.5 * z;
                    ctx.beginPath();
                    ctx.ellipse(p.x, p.y + 4 * z, (6 + ph * 18) * z, (2 + ph * 6) * z, 0, 0, Math.PI * 2);
                    ctx.stroke();
                }
                ctx.fillStyle = '#d9a37a';
                ctx.beginPath(); ctx.arc(p.x, p.y + bob, 5 * z, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = '#d9a37a'; ctx.lineWidth = 2.5 * z;
                ctx.beginPath(); ctx.moveTo(p.x + 4 * z, p.y + bob); ctx.lineTo(p.x + 10 * z, p.y + bob - 9 * z - Math.abs(Math.sin(t * 5)) * 4 * z); ctx.stroke();
                break;
            }
            case 'sail': case 'convoy': {
                const n = sit.scene === 'convoy' ? 3 : 1;
                for (let i = 0; i < n; i++) this._drawSail(ctx, this._at(camera, midQ - 6 + i * 5, L.minR - 12 - i * 2), z * (0.8 - i * 0.12), t + i);
                break;
            }
            case 'derelict': {
                const p = this._at(camera, L.minQ - 4, L.minR - 6);
                ctx.fillStyle = 'rgba(40,30,22,0.9)';
                ctx.beginPath(); ctx.moveTo(p.x - 40 * z, p.y); ctx.lineTo(p.x + 36 * z, p.y - 6 * z); ctx.lineTo(p.x + 30 * z, p.y + 10 * z); ctx.lineTo(p.x - 34 * z, p.y + 12 * z); ctx.closePath(); ctx.fill();
                ctx.strokeStyle = 'rgba(40,30,22,0.9)'; ctx.lineWidth = 3 * z;
                ctx.beginPath(); ctx.moveTo(p.x - 4 * z, p.y - 2 * z); ctx.lineTo(p.x + 10 * z, p.y - 34 * z); ctx.stroke();
                ctx.fillStyle = 'rgba(200,190,160,0.5)';
                ctx.fillRect(p.x + 2 * z, p.y - 30 * z, 10 * z, 12 * z);
                break;
            }
            case 'coils': {
                const p = this._at(camera, L.minQ - 8, L.bow.r);
                ctx.strokeStyle = 'rgba(30,70,50,0.9)';
                ctx.lineWidth = 7 * z;
                ctx.lineCap = 'round';
                for (let i = 0; i < 3; i++) {
                    const up = Math.max(0, Math.sin(t * 0.8 + i * 1.3));
                    const x = p.x - i * 26 * z;
                    ctx.beginPath(); ctx.arc(x, p.y, 10 * z, Math.PI, Math.PI + Math.PI * up); ctx.stroke();
                }
                break;
            }
            case 'whales': {
                for (let i = 0; i < 3; i++) {
                    const p = this._at(camera, midQ - 6 + i * 6, L.maxR + 4 + (i % 2) * 2);
                    const up = Math.sin(t * 0.7 + i * 2);
                    if (up > 0) {
                        ctx.fillStyle = 'rgba(40,52,66,0.9)';
                        ctx.beginPath(); ctx.ellipse(p.x, p.y, 22 * z, 6 * z * up, 0, Math.PI, Math.PI * 2); ctx.fill();
                    }
                    if (up > 0.8) {
                        ctx.fillStyle = 'rgba(235,245,255,0.7)';
                        for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.arc(p.x - 6 * z + k * 2 * z, p.y - (10 + k * 3) * z, 2.4 * z, 0, Math.PI * 2); ctx.fill(); }
                    }
                }
                break;
            }
            case 'shoal': {
                const p = this._at(camera, midQ, L.maxR + 4);
                ctx.fillStyle = 'rgba(230,240,255,0.85)';
                for (let i = 0; i < 40; i++) {
                    if (Math.sin(t * 6 + i * 2.1) < 0.6) continue;
                    ctx.fillRect(p.x + ((i * 37) % 160 - 80) * z, p.y + ((i * 53) % 50 - 25) * z, 3 * z, 1.5 * z);
                }
                break;
            }
            case 'castaway': case 'bottle': {
                const p = this._at(camera, midQ + 5, L.maxR + 4);
                const bob = Math.sin(t * 2) * 2 * z;
                if (sit.scene === 'castaway') {
                    ctx.fillStyle = '#7a5a3a'; ctx.fillRect(p.x - 12 * z, p.y + bob, 24 * z, 6 * z);
                    ctx.fillStyle = '#d9a37a'; ctx.beginPath(); ctx.arc(p.x, p.y - 6 * z + bob, 4 * z, 0, Math.PI * 2); ctx.fill();
                    ctx.strokeStyle = 'rgba(200,200,200,0.5)'; ctx.lineWidth = 3 * z;
                    ctx.beginPath(); ctx.moveTo(p.x + 8 * z, p.y + bob); ctx.bezierCurveTo(p.x + 14 * z, p.y - 20 * z, p.x + 2 * z, p.y - 30 * z, p.x + 12 * z, p.y - 46 * z); ctx.stroke();
                } else {
                    ctx.fillStyle = 'rgba(60,140,90,0.9)';
                    ctx.save(); ctx.translate(p.x, p.y + bob); ctx.rotate(0.6 + Math.sin(t) * 0.2);
                    ctx.fillRect(-3 * z, -8 * z, 6 * z, 14 * z); ctx.fillRect(-1.5 * z, -12 * z, 3 * z, 4 * z);
                    ctx.restore();
                }
                break;
            }
            case 'elmo': {
                for (const top of L.mastTops || []) {
                    const p = this._at(camera, top.q, top.r);
                    const a = 0.35 + 0.25 * Math.sin(t * 7 + top.q);
                    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 16 * z);
                    g.addColorStop(0, `rgba(160,210,255,${a + 0.3})`);
                    g.addColorStop(1, 'rgba(120,170,255,0)');
                    ctx.fillStyle = g;
                    ctx.beginPath(); ctx.arc(p.x, p.y, 16 * z, 0, Math.PI * 2); ctx.fill();
                }
                break;
            }
            case 'fog': {
                const c = this._at(camera, midQ, Math.round((L.minR + L.maxR) / 2));
                const R = Math.max(canvas.width, canvas.height);
                const g = ctx.createRadialGradient(c.x, c.y, T * 4, c.x, c.y, R * 0.6);
                g.addColorStop(0, 'rgba(220,225,230,0)');
                g.addColorStop(1, 'rgba(220,225,230,0.85)');
                ctx.fillStyle = g;
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                break;
            }
            default: break;
        }
        // Land on the western horizon, the day before landfall
        if (sit.landNear && sit.kind !== 'storm') {
            const p = this._at(camera, L.minQ - 18, L.minR - 4);
            ctx.fillStyle = 'rgba(60,80,70,0.55)';
            ctx.beginPath();
            ctx.moveTo(p.x - 160 * z, p.y + 40 * z);
            for (let i = 0; i <= 12; i++) ctx.lineTo(p.x - 160 * z + i * 28 * z, p.y - (8 + Math.abs(Math.sin(i * 1.7)) * 22) * z);
            ctx.lineTo(p.x + 180 * z, p.y + 40 * z);
            ctx.closePath();
            ctx.fill();
        }
        ctx.restore();
    },

    _drawSail(ctx, p, z, t) {
        const bob = Math.sin(t * 1.2) * 1.5 * z;
        ctx.fillStyle = 'rgba(70,50,35,0.85)';
        ctx.beginPath(); ctx.moveTo(p.x - 18 * z, p.y + bob); ctx.lineTo(p.x + 18 * z, p.y + bob); ctx.lineTo(p.x + 12 * z, p.y + 6 * z + bob); ctx.lineTo(p.x - 12 * z, p.y + 6 * z + bob); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(235,228,210,0.9)';
        ctx.beginPath(); ctx.moveTo(p.x - 2 * z, p.y - 30 * z + bob); ctx.lineTo(p.x - 2 * z, p.y - 2 * z + bob); ctx.lineTo(p.x - 16 * z, p.y - 4 * z + bob); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(p.x + 2 * z, p.y - 26 * z + bob); ctx.lineTo(p.x + 2 * z, p.y - 2 * z + bob); ctx.lineTo(p.x + 14 * z, p.y - 4 * z + bob); ctx.closePath(); ctx.fill();
    },

    /** A line of the voyage on screen: where you are bound and what waits on you. */
    renderHud(ctx, camera, canvas) {
        const game = this._game;
        if (!game || !this.active(game)) return;
        const ship = this.ship(game);
        const v = ship && ship.voyage;
        let text = v ? `⛵ ${ship.name} → ${v.destName} · day ${v.day} · ~${Ships.voyageDays(game.player, ship, Math.max(1, v.route.length - v.step))}d to go` : `⛵ ${ship.name} · hove to`;
        let warn = null;
        if (this._fight) warn = `⚔️ Boarders on deck: ${this._fight.boarders.filter(b => !b._down).length} left`;
        else if (v && v.pending) {
            const ev = Ships.getVoyageEvent(v.pending.id);
            if (ev) warn = `${ev.icon} ${ev.title} — orders at the helm`;
        } else if (this._sit && this._sit.storm) warn = '⛈️ Storm — all hands';
        const y = Math.round(canvas.height * 0.11);
        drawMapText(ctx, text, canvas.width / 2, y, { size: 13, weight: 700, color: '#f4efe4' });
        if (warn) drawMapText(ctx, warn, canvas.width / 2, y + 20, { size: 12, weight: 700, color: this._fight ? '#ff8a80' : '#ffd36b' });
    },
};
