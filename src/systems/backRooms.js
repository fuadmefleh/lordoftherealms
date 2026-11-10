// ============================================
// BACK ROOMS — dice and cards where gaming is forbidden
// ============================================
// Where the realm's vice law forbids gaming, or the town bans it by its own
// ordinance (Laws.gambling), no gaming house opens: the tavern's tables, the
// town's Gambling Den, a tavern of the player's can't run dice in the open.
// The game goes underground, and an underground game needs a legitimate
// front, a real business with a back room:
//
//   a gang's den  each den a gang runs (systems/gangs.js) sits behind a
//                 front in town (a chandler's, a bathhouse, a cookshop...,
//                 a hash of the town and the gang, the same all game)
//   a local game  a town with no gangs (a village): a share of them keep a
//                 game in some back room all the same, run by locals
//   your tavern   a tavern of the player's fitted with a hidden back room
//                 (fitBackRoom): its gambling tables earn there as before
//
// Getting in: one of the gang (or a guild hand) walks in; anyone else pays
// the doorman, more if they're a stranger with no contact; the fee goes to the
// gang's purse (a local game's to the town's). Each day the player sits down
// the watch may raid: the stakes on the table are lost, a fine to the town
// under the realm's punishment law, and heat. A back room in the player's own
// tavern risks a raid each night (processDay): a fine, its tables seized.
//
// Tunables in data/laws.json → backRooms. Randomness through Utils (the
// shared seeded stream); world and player passed in. No import-time side effects.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { Economy } from '../world/economy.js';
import { Laws } from './laws.js';
import { Gangs } from './gangs.js';
import { Underworld } from './underworld.js';

const DEFAULTS = {
    fronts: ['a chandler\'s', 'the bathhouse', 'a cooper\'s yard', 'a cookshop', 'a pawnbroker\'s', 'a tannery', 'a dyer\'s', 'the old granary', 'a wine cellar', 'a smithy'],
    localShare: 0.6,
    doorFee: 10, strangerFee: 3,
    raidBase: 0.04, raidPerCrackdown: 0.0025, boughtCaptain: 0.35,
    fine: 40, heat: 2,
    fitCost: 250, tavernRaid: 0.02, seizeShare: 1, tavernFine: 80, tavernHeat: 3,
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);

function _hash01(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return ((h >>> 0) % 100000) / 100000;
}

export const BackRooms = {
    config() {
        const d = _obj(DataLoader._gamedata && DataLoader._gamedata.laws) || {};
        return { ...DEFAULTS, ...(_obj(d.backRooms) || {}) };
    },

    /** Is gaming open here? (Laws.gambling) */
    status(world, settlement) {
        return Laws.gambling(world, settlement);
    },

    /** The front a back room hides behind: a hash of the town and the game's keeper. */
    frontName(settlement, keeper) {
        const F = BackRooms.config().fronts;
        const list = Array.isArray(F) && F.length ? F : DEFAULTS.fronts;
        const i = Math.floor(_hash01(`${settlement && settlement.name}|${keeper}|front`) * list.length) % list.length;
        return list[i];
    },

    /** The player's tavern on this tile, if any. */
    ownTavern(tile) {
        if (!tile) return null;
        const props = [...(Array.isArray(tile.playerProperties) ? tile.playerProperties : []), tile.playerProperty];
        return props.find(p => p && p.type === 'tavern' && !p.underConstruction) || null;
    },

    /**
     * The back-room games in a town where gaming is forbidden:
     * [{ id, kind: 'gang'|'local'|'own', name, front, gang? }]. Empty where gaming is legal.
     */
    games(world, tile) {
        const s = tile && tile.settlement;
        if (!s || BackRooms.status(world, s).legal) return [];
        const out = [];
        const own = BackRooms.ownTavern(tile);
        if (own && own.backRoom && _num(own.gamblingTables) > 0) {
            out.push({ id: 'own', kind: 'own', name: 'Your back room', front: 'your tavern' });
        }
        if (Gangs.hasGangs(s)) {
            for (const g of Gangs.gangsAt(world, tile)) {
                if (_num(g.dens) <= 0) continue;
                out.push({ id: `gang:${g.id}`, kind: 'gang', name: `${g.name}'s tables`, front: BackRooms.frontName(s, g.id), gang: g });
            }
        } else if (_hash01(`${s.name}|${s.q},${s.r}|localgame`) < _num(BackRooms.config().localShare, 0.6)) {
            out.push({ id: 'local', kind: 'local', name: 'A quiet game', front: BackRooms.frontName(s, 'local') });
        }
        return out;
    },

    /** What getting in costs the player: { fee, free, why }. */
    entry(player, world, tile, game) {
        const C = BackRooms.config();
        if (!game) return { fee: 0, free: false, why: 'No such game' };
        if (game.kind === 'own') return { fee: 0, free: true, why: 'Your own back room' };
        const m = game.kind === 'gang' ? Gangs.membership(player, tile) : null;
        if (m && game.gang && m.gangId === game.gang.id) return { fee: 0, free: true, why: 'One of the crew' };
        const guild = player && player.underworld && player.underworld.guild;
        const known = !!(guild && (guild.member || guild.contactMet)) || !!m;
        const fee = Math.round(_num(C.doorFee, 10) * (known ? 1 : _num(C.strangerFee, 3)));
        return { fee, free: false, why: known ? 'The doorman knows your face' : 'A stranger pays the doorman well to be let in' };
    },

    /** The chance the watch raids a back room tonight. */
    raidChance(world, tile, game) {
        const C = BackRooms.config();
        const st = Gangs.hasGangs(tile && tile.settlement) ? Gangs.town(world, tile) : null;
        const crackdown = _num(st && st.watch && st.watch.crackdown, 10);
        let p = _num(C.raidBase, 0.04) + crackdown * _num(C.raidPerCrackdown, 0.0025);
        // A gang that has bought the captain is warned before the watch comes
        const captain = st && st.watch && st.watch.captain;
        if (game && game.gang && captain && captain.bribedBy != null && captain.bribedBy === game.gang.id) p *= _num(C.boughtCaptain, 0.35);
        return Math.max(0, Math.min(0.9, p));
    },

    /** Has the player already been let into a back room here today? */
    admitted(player, world, tile) {
        const a = player && player._backRoom;
        return !!(a && a.day === _day(world) && a.q === tile.q && a.r === tile.r && !a.raided);
    },

    /**
     * Walk in: pay the doorman and take the night's chance of a raid.
     * → { success, raided?, fine?, lost?, text, game }.
     */
    enter(player, world, tile, gameId) {
        const s = tile && tile.settlement;
        const game = BackRooms.games(world, tile).find(g => g.id === gameId);
        if (!s || !game) return { success: false, reason: 'There is no such game here.' };
        if (BackRooms.admitted(player, world, tile)) return { success: true, game, text: 'You are already at the tables.' };
        const door = BackRooms.entry(player, world, tile, game);
        if (!door.free && _num(player.gold) < door.fee) return { success: false, reason: `The doorman wants ${door.fee}g to let you in.` };
        if (!door.free && door.fee > 0) {
            player.gold -= door.fee;
            if (game.gang) game.gang.purse = _num(game.gang.purse) + door.fee;
            else Economy.payTown(s, door.fee);
        }
        player._backRoom = { day: _day(world), q: tile.q, r: tile.r, gameId, raided: false };
        if (Utils.random() < BackRooms.raidChance(world, tile, game)) {
            const out = BackRooms._raid(player, world, tile, game);
            return { success: true, raided: true, game, ...out };
        }
        return { success: true, game, text: `Through ${game.front}, past the doorman, down the stair: the tables are full.` };
    },

    /** The watch kicks the door in: the stakes are lost, a fine, heat. */
    _raid(player, world, tile, game) {
        const C = BackRooms.config();
        const s = tile.settlement;
        const pun = Laws.punishment(world, s.kingdom);
        // The coin on the table (a tenth of the purse, at most a hundred) goes with the watch
        const lost = Math.min(100, Math.floor(_num(player.gold) * 0.1));
        const fine = Math.min(Math.max(0, _num(player.gold) - lost), Math.round(_num(C.fine, 40) * pun.fine));
        player.gold = _num(player.gold) - lost - fine;
        Economy.payTown(s, lost + fine);
        if (s.kingdom != null) Underworld.addHeat(player, s.kingdom, _num(C.heat, 2), world);
        if (player._backRoom) player._backRoom.raided = true;
        return { lost, fine, text: `The watch comes down the stair behind ${game.front}. The coin on the table is gone (${lost}g), and the magistrate fines you ${fine}g.` };
    },

    // ──────────── YOUR OWN TAVERN ────────────

    /** May this tavern's tables run? → { open, hidden, why }. */
    tablesRun(world, tile, property) {
        const s = tile && tile.settlement;
        const st = BackRooms.status(world, s);
        if (st.legal) return { open: true, hidden: false, why: '' };
        if (property && property.backRoom) return { open: true, hidden: true, why: `${st.why} The tables run in the back room.` };
        return { open: false, hidden: false, why: `${st.why} The tables stand idle until a back room hides them.` };
    },

    /** Fit a hidden back room in the player's tavern (only where gaming is forbidden). */
    fitBackRoom(player, world, tile) {
        const C = BackRooms.config();
        const tav = BackRooms.ownTavern(tile);
        if (!tav) return { success: false, reason: 'You own no tavern here.' };
        if (tav.backRoom) return { success: false, reason: 'The tavern already has its back room.' };
        if (BackRooms.status(world, tile.settlement).legal) return { success: false, reason: 'Gaming is lawful here: the tables may stand in the taproom.' };
        const cost = _num(C.fitCost, 250);
        if (_num(player.gold) < cost) return { success: false, reason: `Fitting out a back room costs ${cost}g.` };
        player.gold -= cost;
        Economy.payTown(tile.settlement, cost); // the joiners and masons are paid in town
        tav.backRoom = true;
        return { success: true, cost, text: 'A false wall, a stair down to the cellar, a doorman: your tavern has its back room.' };
    },

    /**
     * Each night: a back room in one of the player's taverns may be raided.
     * → { notices: [{ icon, title, text, type }] }.
     */
    processDay(player, world) {
        const out = { notices: [] };
        if (!player || !world || !Array.isArray(player.properties)) return out;
        const C = BackRooms.config();
        for (const ref of player.properties) {
            if (!ref || ref.type !== 'tavern') continue;
            const tile = world.getTile && world.getTile(ref.q, ref.r);
            const tav = BackRooms.ownTavern(tile);
            if (!tav || !tav.backRoom || _num(tav.gamblingTables) <= 0) continue;
            const s = tile.settlement;
            if (!s || BackRooms.status(world, s).legal) continue;
            const p = BackRooms.raidChance(world, tile, null) / Math.max(1e-6, _num(C.raidBase, 0.04)) * _num(C.tavernRaid, 0.02);
            if (Utils.random() >= p) continue;
            const pun = Laws.punishment(world, s.kingdom);
            const fine = Math.min(_num(player.gold), Math.round(_num(C.tavernFine, 80) * pun.fine));
            player.gold = _num(player.gold) - fine;
            Economy.payTown(s, fine);
            const seized = Math.ceil(_num(tav.gamblingTables) * _num(C.seizeShare, 1));
            tav.gamblingTables = Math.max(0, _num(tav.gamblingTables) - seized);
            if (s.kingdom != null) Underworld.addHeat(player, s.kingdom, _num(C.tavernHeat, 3), world);
            out.notices.push({ icon: '🚨', title: 'The Back Room Raided', text: `The watch found the stair behind your tavern in ${s.name}: ${seized} table${seized === 1 ? '' : 's'} seized, and a ${fine}g fine.`, type: 'error' });
        }
        return out;
    },
};
