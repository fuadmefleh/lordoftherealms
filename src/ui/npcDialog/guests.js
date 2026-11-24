// npcDialog — calling on a household (player/guests.js): sit a while with
// them at home (or be asked round), share their meal (out of their own
// larder), and ask for a bed for the night — which, given, lets you sleep in
// the house's bed without a trespass (ui/objectActions/furniture.js reads
// player.guestAt). Their parents', kin's and friends' houses need no asking;
// a lord of a seat takes the player in by regard and standing.
import { Guests } from '../../player/guests.js';
import { NpcDisposition } from '../../systems/npcDisposition.js';
import { InnerMap } from '../../world/innerMap.js';
import { dialogState } from './shared.js';
import { _render } from './render.js';
import { _animateDispositionChange } from './choices.js';
import { _advanceTime } from '../objectActions/logic.js';

const _HOMES = ['house', 'cottage', 'farm', 'manor', 'castle', 'palace'];

function _asked(action) {
    return dialogState._lines.some(l => l._action === action);
}

/** Who we're talking to, and the house they keep in this town. */
function _ctx() {
    const game = dialogState._game;
    const npc = dialogState._npc;
    if (!game || !game.player || !game.world || !npc) return null;
    const wt = InnerMap.currentWorldTile;
    if (!wt) return null;
    const seat = (InnerMap.seatBuildings ? InnerMap.seatBuildings() : []).find(b => b && b.ownerId != null && b.ownerId === npc.id) || null;
    const home = seat || (npc._home && _HOMES.includes(String(npc._home.type || '').replace(/^player_/, '')) ? npc._home : null);
    if (!home || home.isPlayerOwned || home.isPlayerProperty) return null;
    const ib = InnerMap._insideBuilding;
    const tile = game.world.getTile ? game.world.getTile(wt.q, wt.r) : null;
    const residents = InnerMap.householdOf ? InnerMap.householdOf(home) : [];
    return {
        game, npc, home, player: game.player, world: game.world,
        key: Guests.key(wt.q, wt.r, home),
        lord: !!seat,
        atHome: !!(ib && ib.q === home.q && ib.r === home.r),
        settlement: tile && tile.settlement,
        welcome: Guests.welcomeIn(game.player, game.world, residents.includes(npc) ? residents : [npc, ...residents], { building: home, worldQ: wt.q, worldR: wt.r }),
        disposition: NpcDisposition.getMemory(npc).disposition,
    };
}

function _ask(c, what, said) {
    dialogState._lines.push({ speaker: 'You', text: said, isNpc: false, _action: `guest_${what}` });
    const res = Guests.ask(c.player, c.world, what, {
        folk: c.npc._folk, p: c.npc._person, name: c.npc.name, key: c.key, disposition: c.disposition,
        lord: c.lord, atHome: c.atHome, settlement: c.settlement, welcome: c.welcome,
    });
    dialogState._lines.push({ speaker: c.npc.name, icon: c.npc.icon, text: res.text || '…', isNpc: true, _action: `guest_${what}` });
    dialogState._lineIndex = dialogState._lines.length - 1;
    if (res.regard) _animateDispositionChange(NpcDisposition.adjustDisposition(c.npc, res.regard, c.player));
    if (res.hours > 0) _advanceTime(res.hours);
    const ui = c.game.ui;
    if (res.ok && ui) {
        if (ui.updateStats) ui.updateStats(c.player, c.world);
        const house = c.home.name || (c.lord ? 'the house' : 'their house');
        if (what === 'stay' && ui.showNotification) setTimeout(() => ui.showNotification('🛏️ A Bed for the Night', `You may sleep at ${house} tonight as ${c.npc.name || 'their'}'s guest.`, 'success'), 900);
        if (what === 'meal' && ui.showNotification && res.gains) {
            const g = Object.entries(res.gains).map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`).join(', ');
            setTimeout(() => ui.showNotification('🍲 At Their Table', `You share the household's meal${g ? `: ${g}` : ''}.`, 'info'), 900);
        }
    }
    _render();
}

/** The guest's choices for this conversation. */
export function _guestChoices() {
    const c = _ctx();
    if (!c) return [];
    const out = [];
    const who = c.npc.name || 'them';
    const w = c.welcome && c.welcome.ok ? c.welcome : null;
    const odds = Guests.hostChance(c.player, { welcome: w, disposition: c.disposition, lord: c.lord });
    const pct = `${Math.round(odds * 100)}% they'll say yes`;
    const why = w ? (w.kind === 'parents' ? 'Your parents\' house: no need to ask.' : w.kind === 'kin' ? 'Family: no need to ask.' : 'A friend: no need to ask.') : pct;
    if (!c.lord && !_asked('guest_visit')) {
        out.push(c.atHome
            ? { icon: '💺', label: 'Mind if I sit a while?', group: 'talk', tooltip: `An hour with ${who} at their hearth: company and goodwill. ${why}`, onPick: () => _ask(_ctx(), 'visit', 'Mind if I sit with you a while?') }
            : { icon: '🏠', label: 'I\'d like to call on you at home.', group: 'talk', tooltip: `Be asked round to ${c.home.name || 'their house'}. ${why}`, onPick: () => _ask(_ctx(), 'visit', 'I\'d like to call on you at home some time.') });
    }
    if (c.atHome && !c.lord && !_asked('guest_meal')) {
        out.push({ icon: '🍲', label: 'Could I share your table?', group: 'talk', tooltip: `Eat with the household, from their own larder (an hour). ${why}`, onPick: () => _ask(_ctx(), 'meal', 'Could I share your table tonight?') });
    }
    const staying = Guests.sleepsAt(c.player, c.world, c.key);
    if (!staying && !w && !_asked('guest_stay')) {
        out.push({
            icon: '🛏️', label: c.lord ? 'Might I beg your hospitality for the night?' : 'Could I stay the night?', group: 'talk',
            tooltip: `A bed under their roof tonight: sleep there as their guest, not a trespasser. ${pct}.`,
            onPick: () => _ask(_ctx(), 'stay', c.lord ? 'My lord, might I beg your hospitality for the night?' : 'Could I stay the night under your roof?'),
        });
    }
    return out;
}
