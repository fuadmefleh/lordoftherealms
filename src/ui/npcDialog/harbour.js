// npcDialog — the harbourmaster on the quay (ui/innerMapPort.js _keepMaster
// makes him one of the street's people): the port's business face to face,
// all through what already exists — the Harbour panel (berths, dues, the
// slip, careening, the strait ferry: ui/actionMenu/harbour.js on
// systems/ports.js), paying what you owe him (Ports.payOwed), news of the
// ships in and the fishing boats (Ports.berths / fleet / slipAt), hands for a
// short-crewed ship of yours (the hiring hall, ActionMenu.showHireSailorsMenu)
// and when the ferries go (world/ferries.js).
import { Ports } from '../../systems/ports.js';
import { Ships } from '../../systems/ships.js';
import { Ferries } from '../../world/ferries.js';
import { ActionMenu } from '../actionMenu.js';
import { DayClock } from '../game/dayClock.js';
import { dialogState } from './shared.js';
import { _render } from './render.js';
import { NpcDialog } from './index.js'; // call-time facade ref (ESM cycle-safe)

const _hh = (h) => `${String(Math.floor(h)).padStart(2, '0')}:00`;
const _n = (k, one, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

function _ctx() {
    const game = dialogState._game;
    const npc = dialogState._npc;
    if (!game || !game.world || !game.player || !npc || !npc.harbourmaster) return null;
    const { q, r } = game.player;
    const s = Ports.portAt(game.world, q, r);
    if (!s) return null;
    return { game, npc, world: game.world, player: game.player, s, q, r, tile: game.world.getTile ? game.world.getTile(q, r) : null };
}

function _asked(action) {
    return dialogState._lines.some(l => l._action === action);
}

function _say(action, said, fn) {
    const c = _ctx();
    if (!c) return;
    dialogState._lines.push({ speaker: 'You', text: said, isNpc: false, _action: action });
    const text = fn(c) || '…';
    dialogState._lines.push({ speaker: c.npc.name, icon: c.npc.icon, text, isNpc: true, _action: action });
    dialogState._lineIndex = dialogState._lines.length - 1;
    _render();
}

/** Leave the talk for one of the port's panels. */
function _open(fn) {
    const c = _ctx();
    if (!c) return;
    NpcDialog.close();
    fn(c);
}

function _hour() {
    try { return DayClock.now(); } catch (e) { return 12; }
}

/** What he says of the ships in and out of his harbour. */
function _shipNews(c) {
    const b = Ports.berths(c.world, c.player, c.q, c.r);
    const bits = [];
    if (b) {
        bits.push(`${_n(b.town, 'ship')} of the town's own at the pier`);
        if (b.traders) bits.push(`${_n(b.traders, 'trader')} in, loading and unloading`);
        if (b.yours) bits.push(`${_n(b.yours, 'of yours', 'of yours')}`);
    }
    let text = bits.length ? `${bits.join(', ')}. ` : '';
    if (b) text += b.free > 0 ? `${_n(b.free, 'berth')} free — come in and you tie up at the quay.` : 'Every berth is taken: a ship coming in now lies in the roads, and the lighters cost half as much again.';
    const slip = Ports.slipAt(c.world, c.player, c.q, c.r);
    for (const x of slip.slice(0, 2)) {
        const stage = String((x.stage && x.stage.name) || 'building').toLowerCase();
        text += x.kind === 'town' ? ` The shipwrights have a new hull of the town's on the slip — ${stage}, ${Math.round(x.progress * 100)}% of the way.` : ` Your ${x.name} is on the slip — ${stage}${x.waiting ? ', and the yard waiting on stores' : ''}.`;
    }
    const mine = (c.player.ships || []).filter(x => x && x.q === c.q && x.r === c.r && x.status === 'careened');
    for (const x of mine.slice(0, 1)) {
        const days = x.careen && Number.isFinite(x.careen.left) ? x.careen.left : null;
        text += ` Your ${x.name} is ${Ships.statusLabel('careened').text}${days != null ? ` — afloat again in ${_n(Math.max(1, Math.ceil(days)), 'day')}` : ''}.`;
    }
    const fl = Ports.fleet(c.world, c.q, c.r);
    if (fl && fl.boats > 0) {
        const F = Ports.config().fishing;
        const h = _hour();
        const out = !fl.kept && h >= F.out[0] && h < F.back[1];
        const boats = _n(fl.boats, 'fishing boat');
        const are = fl.boats === 1 ? 'is' : 'are';
        const go = fl.boats === 1 ? 'goes' : 'go';
        const stay = fl.boats === 1 ? 'stays' : 'stay';
        text += fl.kept === 'ice' ? ` The ${boats} ${are} frozen in.` : fl.kept ? ` The ${boats} ${stay} in for the ${fl.kept}.` : out ? ` The ${boats} ${are} out; back by ${_hh(F.back[1])}.` : ` The ${boats} ${go} out about ${_hh(F.out[0])}.`;
    }
    const owed = Math.round(Ports.state(c.s).owed || 0);
    if (owed > 0) text += ` And there's ${owed}g in my book against your ships.`;
    return text.trim() || 'Quiet. Nothing in, nothing out.';
}

/** When the ferries go from here. */
function _ferryNews(c) {
    const h = _hour();
    const lines = [];
    for (const o of Ports.straitOffers(c.world, c.player)) {
        const next = Ferries.nextSailing(o.ferry, h);
        lines.push(`${o.ferry.ferryman} takes the ferry over the strait to ${o.to.name} at ${_hh(next.hour)}${next.tomorrow ? ' tomorrow' : ''} — ${o.fare}g, and the day on her deck.`);
    }
    for (const f of Ferries.riverFerries(c.world).filter(x => x.town.q === c.q && x.town.r === c.r)) {
        const next = Ferries.nextSailing(f, h);
        lines.push(`${f.ferryman}'s ferry over the great river goes at ${f.hours.map(_hh).join(', ')} (the next at ${_hh(next.hour)}${next.tomorrow ? ', tomorrow' : ''}); ${f.fare}g, and walk onto its landing to cross.`);
    }
    return lines.join(' ') || 'No ferry plies from here. You want a ship of your own, or a berth on a trader.';
}

/** The harbourmaster's choices for this conversation. */
export function _harbourChoices() {
    const c = _ctx();
    if (!c) return [];
    const out = [];
    out.push({
        icon: '⚓', label: 'The harbour\'s business.', group: 'deal', tooltip: 'Berths, dues, the slip, careening, the fishing boats and the ferries (the Harbour panel).',
        onPick: () => _open((k) => ActionMenu.showHarbour(k.game)),
    });
    const owed = Math.round(Ports.state(c.s).owed || 0);
    if (owed > 0 && !_asked('hm_pay')) {
        out.push({
            icon: '📜', label: `Here's what I owe you — ${owed}g.`, group: 'deal', disabled: !((c.player.gold || 0) >= 1), disabledReason: 'You have no coin to pay with',
            tooltip: `The dues in his book against your ships (${owed}g).`,
            onPick: () => _say('hm_pay', `Here's what I owe you.`, (k) => {
                const res = Ports.payOwed(k.world, k.player, k.q, k.r);
                if (!res.ok) return res.reason;
                if (k.game.ui && k.game.ui.updateStats) k.game.ui.updateStats(k.player, k.world);
                return res.left > 0 ? `${res.paid}g. That's something — ${res.left}g still stands in the book.` : `${res.paid}g. Your ships' slate is clean.`;
            }),
        });
    }
    if (!_asked('hm_ships')) {
        out.push({ icon: '🚢', label: 'What ships are in?', group: 'talk', tooltip: 'The berths, the traders, the slip and the fishing boats.', onPick: () => _say('hm_ships', 'What ships are in?', _shipNews) });
    }
    const short = Ships.shortHandedAt ? Ships.shortHandedAt(c.player, c.world, c.q, c.r) : [];
    if (short.length && c.tile) {
        out.push({ icon: '👥', label: 'I need hands for my ship.', group: 'deal', tooltip: `${short.length === 1 ? `The ${short[0].ship.name} is` : `${short.length} of your ships are`} short-handed. Sailors sign on at the quay.`, onPick: () => _open((k) => ActionMenu.showHireSailorsMenu(k.game, k.tile)) });
    }
    const straits = Ports.straitOffers(c.world, c.player);
    const rivers = Ferries.riverFerries(c.world).filter(x => x.town.q === c.q && x.town.r === c.r);
    if ((straits.length || rivers.length) && !_asked('hm_ferry')) {
        out.push({ icon: '⛴️', label: 'When does the ferry go?', group: 'talk', tooltip: 'The ferries from here, their hours and fares.', onPick: () => _say('hm_ferry', 'When does the ferry go?', _ferryNews) });
    }
    for (const o of straits.filter(x => x.ok).slice(0, 2)) {
        out.push({
            icon: '⛴️', label: `Passage across to ${o.to.name}.`, group: 'deal', tooltip: `${o.ferry.ferryman}'s ferry: ${o.fare}g, and the day on her deck.`,
            onPick: () => _open((k) => ActionMenu.harbourAct(k.game, 'strait', o.ferry.id)),
        });
    }
    return out;
}
