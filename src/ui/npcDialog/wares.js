// npcDialog — buying straight from a townsperson (systems/townTrade.js): a
// producer's own wares ("Will you sell me some of your eggs?") or a pedlar's
// pack. What they sell is their real stock: it leaves their wares (or the
// pack) for your packs, and the coin goes into their purse.
import { TownTrade } from '../../systems/townTrade.js';
import { NpcDisposition } from '../../systems/npcDisposition.js';
import { InnerMap } from '../../world/innerMap.js';
import { dialogState } from './shared.js';
import { _render } from './render.js';
import { _animateDispositionChange } from './choices.js';

function _ctx() {
    const game = dialogState._game;
    const npc = dialogState._npc;
    if (!game || !game.world || !game.player || !npc || !TownTrade.enabled()) return null;
    const ref = InnerMap._currentWorldTileRef;
    const fromFolk = npc._folk && game.world.getTile ? game.world.getTile(npc._folk.q, npc._folk.r) : null;
    const settlement = (fromFolk && fromFolk.settlement) || (ref && ref.settlement) || null;
    if (!settlement) return null;
    return { game, npc, world: game.world, player: game.player, settlement };
}

function _asked(action) {
    return dialogState._lines.some(l => l._action === action);
}

function _say(action, said, fn) {
    const c = _ctx();
    if (!c) return;
    dialogState._lines.push({ speaker: 'You', text: said, isNpc: false, _action: action });
    const res = fn(c) || { text: '…' };
    dialogState._lines.push({ speaker: c.npc.name, icon: c.npc.icon, text: res.text || '…', isNpc: true, _action: action });
    dialogState._lineIndex = dialogState._lines.length - 1;
    if (res.change) _animateDispositionChange(NpcDisposition.adjustDisposition(c.npc, res.change, c.player));
    if (res.ok && c.game.ui && c.game.ui.updateStats) c.game.ui.updateStats(c.player, c.world);
    _render();
}

/** The buying choices for this conversation: up to three of their goods. */
export function _waresChoices() {
    const c = _ctx();
    if (!c) return [];
    const L = (TownTrade.config().lines && TownTrade.config().lines.sell) || {};
    const ped = c.npc._pedlar ? TownTrade.pedlars(c.settlement).find(p => p.id === c.npc._pedlar) : null;
    const stock = ped ? TownTrade.pedlarStock(c.world, c.settlement, ped)
        : c.npc._person ? TownTrade.personStock(c.world, c.settlement, c.npc._person) : {};
    const out = [];
    const list = Object.entries(stock).filter(([, e]) => e && e.qty >= 1).sort((a, b) => b[1].qty - a[1].qty || (a[0] < b[0] ? -1 : 1)).slice(0, 3);
    for (const [g, e] of list) {
        const action = `wares_${g}`;
        if (_asked(action)) continue;
        const name = TownTrade.goodName(g);
        const ask = String(L.ask || 'Will you sell me some of your {good}?').replace('{good}', name);
        out.push({
            icon: ped ? '🎒' : '🧺', label: `${ask} (${e.price} gold)`, group: 'deal',
            tooltip: `${e.qty} to spare. Bought from ${ped ? 'the pack' : 'their own stock'}: the coin goes into their purse.`,
            onPick: () => _say(action, ask, (k) => {
                const r = ped ? TownTrade.sellFromPedlar(k.player, k.world, k.settlement, ped, g, 1)
                    : TownTrade.sellToPlayer(k.player, k.world, k.settlement, k.npc._person, g, 1);
                // The last of the pack: the pedlar packs up and walks off down the road (npcs.js: a
                // traveller with no visits left heads for the map's edge)
                if (r.ok && r.packedUp) {
                    k.npc._pedlar = null;
                    k.npc.visitsLeft = 0;
                }
                return { ok: r.ok, text: r.ok ? `${String(L.yes || 'For {price} gold it\'s yours.').replace('{price}', r.price)} ${r.text}` : r.text, change: r.ok ? 1 : 0 };
            }),
        });
    }
    return out;
}

/**
 * A pedlar sold out (their pack empty, door to door): they say so, rather than
 * "Show me your wares" opening the town's whole market as if it were their pack.
 * null for anyone else, or while the pack holds anything (_waresChoices lists it).
 */
export function _pedlarEmptyChoice() {
    const c = _ctx();
    if (!c || !c.npc._pedlar) return null;
    const ped = TownTrade.pedlars(c.settlement).find(p => p.id === c.npc._pedlar);
    const stock = ped ? TownTrade.pedlarStock(c.world, c.settlement, ped) : {};
    if (Object.values(stock).some(e => e && e.qty >= 1) || _asked('wares_empty')) return null;
    return {
        icon: '🎒', label: 'Show me your wares.', group: 'deal', cls: 'npc-dialog-choice-muted',
        tooltip: 'The pack is empty: sold door to door.',
        onPick: () => _say('wares_empty', 'Show me your wares.', () => ({ text: 'Sold the lot door to door, I have. Nothing left in the pack till I fill it for the next town.' })),
    };
}
