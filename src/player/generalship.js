// ============================================
// GENERALSHIP — a commission in a realm's army
// ============================================
// The player may seek a commission at a realm's capital and rise through
// its ranks (Captain → Commander → General → Marshal of the Realm) by merit
// and the crown's favour, or fall by defeat and disobedience.
//
// THE HOST  A commission puts a share of the realm's own standing army
//   (kingdom.military) under the player's command: c.men are the realm's men,
//   never minted; the host's battle losses, desertions and failed coup are
//   the realm's losses, and the crown sends levies back toward the rank's
//   share. Morale, veterancy, lieutenants (skill, trait, loyalty) and
//   supplies make its quality.
// THE MONEY  Wages by rank come out of the crown's treasury each week
//   (CrownBooks 'army' line); what it cannot pay is owed as arrears. While the
//   realm is at war the host eats real grain: drawn from the granaries of the
//   realm's towns within supply range, the crown paying the town's purse for
//   it (the player may pay out of their own purse when the crown is broke).
//   Plunder comes out of the plundered town's purse and granary and is split
//   between the crown's treasury, the men (spent in the realm's towns) and the
//   player. Bonuses for orders carried out come out of the treasury too.
// THE WAR   Battles against the enemy's field army near the front, sieges of
//   its towns (a captured town changes realm through KingdomAI.takeTile, the
//   same path the AI's battles take), raids on its villages. While the general
//   is near the front the realm's own battles go better (kingdom.fieldCommand,
//   read by KingdomAI.simulateBattle), and they are credited or blamed on the
//   general. The crown issues orders (hold a town, take a town, break the
//   field army, raid, patrol the marches in peace) with deadlines.
// THE COURT A rival at court slanders the general; the crown fears a general
//   grown too strong and may recall them; a general with a loyal host may turn
//   it on the crown (a coup: crowned through Throne._takeThrone, or exiled and
//   at war with the realm).
//
// BATTLE HOOK  Every battle the general fights is a plain spec object:
//   prepareBattle(player, world, kind, opts) → spec  (who, the host, the
//   enemy, where, the order it serves, the odds); autoResolve(spec) → outcome;
//   settleBattle(player, world, spec, outcome) applies it. A battlefield
//   screen can take a spec, fight it, and hand back an outcome
//   { victory, hostLost, enemyLost, retinueLost } to settleBattle.
//
// State: player.commission (saved), player.commissionPast (the record).
// Tuning: data/generalship.json. Randomness: Utils only.

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { DataLoader } from '../core/dataLoader.js';
import { Difficulty } from '../core/difficulty.js';
import { Economy } from '../world/economy.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { CrownBooks } from '../world/crownBooks.js';
import { NPCLords } from '../world/npcLords.js';
import { Characters } from '../world/characters.js';
import { Estates } from '../world/estates.js';
import { Harvests } from '../world/harvests.js';
import { MoneySupply } from '../world/moneySupply.js';
import { LordInfluence } from '../world/kingdomState.js';
import { House } from '../systems/house.js';
import { Throne } from '../systems/throne.js';
import { RealmWars } from '../systems/realmWars.js';
import { LandMarket } from '../systems/landMarket.js';
import { Ledger } from '../systems/ledger.js';
import { PlayerMilitary } from './playerMilitary.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = world => _num(world && world.day);
const _r2 = v => Math.round(v * 100) / 100;

function _dist(world, a, b) {
    return Hex.wrappingDistance(a.q, a.r, b.q, b.r, world.width);
}

function _kingdom(world, id) {
    if (id == null || !world) return null;
    return typeof world.getKingdom === 'function' ? world.getKingdom(id) : (world.kingdoms || []).find(k => k.id === id) || null;
}

/** A realm's living towns: [{ q, r, settlement }]. */
function _towns(world, k) {
    return Economy.realmTowns(k, world);
}

function _isCapital(k, q, r) {
    return !!(k && k.capital && k.capital.q === q && k.capital.r === r);
}

export const Generalship = {

    // ── Data ────────────────────────────────────────

    config() {
        return _obj(DataLoader._gamedata && DataLoader._gamedata.generalship) || {};
    },

    enabled() {
        return Array.isArray(Generalship.config().ranks) && Generalship.config().ranks.length > 0;
    },

    ranks() {
        return Generalship.config().ranks || [];
    },

    rankDef(c) {
        const R = Generalship.ranks();
        return R[Utils.clamp(_num(c && c.rank), 0, Math.max(0, R.length - 1))] || null;
    },

    state(player) {
        return (player && _obj(player.commission)) || null;
    },

    liege(player, world) {
        const c = Generalship.state(player);
        return c ? _kingdom(world, c.kingdomId) : null;
    },

    /** The living realms the liege is at war with. */
    enemies(world, k) {
        if (!k) return [];
        return (k.wars || []).map(id => _kingdom(world, id)).filter(e => e && e.isAlive !== false);
    },

    _who(player) {
        return `${player.name || ''}|${_num(player.birthDay)}`;
    },

    _log(c, world, text) {
        if (!Array.isArray(c.log)) c.log = [];
        c.log.unshift({ day: _day(world), text });
        if (c.log.length > 30) c.log.length = 30;
    },

    _martial(player) {
        const s = player.skills || {};
        return _num(s.combat) + _num(s.leadership);
    },

    // ── Seeking a commission ─────────────────────────

    /** Can the player seek a commission at this tile (a realm's capital)? → { ok, reason, kingdom } */
    canSeek(player, world, tile) {
        if (!Generalship.enabled()) return { ok: false, reason: 'No realm is raising officers.' };
        const s = tile && tile.settlement;
        const k = s && s.kingdom != null ? _kingdom(world, s.kingdom) : null;
        if (!k || k.isAlive === false) return { ok: false, reason: 'Only a crown grants commissions.' };
        if (!_isCapital(k, tile.q, tile.r)) return { ok: false, reason: `Commissions are granted at ${k.name}'s capital.`, kingdom: k };
        if (Generalship.state(player)) return { ok: false, reason: 'You already hold a commission.', kingdom: k };
        if (Throne.ruledKingdom(player, world)) return { ok: false, reason: 'You wear a crown: you command, you do not serve.', kingdom: k };
        if (Throne.state(player).civilWar) return { ok: false, reason: 'You are fighting for a crown of your own.', kingdom: k };
        if (RealmWars.atWarWith(player, k.id)) return { ok: false, reason: `${k.name} is at war with you.`, kingdom: k };
        if (Throne.isExiledFrom(player, world, k.id)) return { ok: false, reason: `You are exiled from ${k.name}.`, kingdom: k };
        if (player.allegiance != null && player.allegiance !== k.id) return { ok: false, reason: 'You are sworn to another crown. Renounce that oath first.', kingdom: k };
        const S = Generalship.config().seek || {};
        const rep = _num(player.reputation && player.reputation[k.id]);
        if (rep < _num(S.minReputation)) return { ok: false, reason: `${k.name} does not trust you (reputation ${Math.round(rep)}; needs ${_num(S.minReputation)}).`, kingdom: k };
        if (Generalship._martial(player) < _num(S.minMartial)) return { ok: false, reason: `You know too little of war (combat + leadership ${Generalship._martial(player)}; needs ${_num(S.minMartial)}).`, kingdom: k };
        if (_num(player.renown) < _num(S.minRenown)) return { ok: false, reason: `No one has heard of you (renown ${Math.round(_num(player.renown))}; needs ${_num(S.minRenown)}).`, kingdom: k };
        return { ok: true, kingdom: k };
    },

    /** Seek a commission at the capital: sworn to the realm, a Captain with a company of its men. */
    seek(player, world, tile) {
        const can = Generalship.canSeek(player, world, tile);
        if (!can.ok) return { success: false, reason: can.reason };
        const k = can.kingdom;
        const S = Generalship.config().seek || {};
        const c = Generalship._grant(player, world, k, { rank: 0, favour: _num(S.startFavour, 50), morale: _num(S.startMorale, 60) });
        Generalship._supplyFrom(player, world, c, tile.settlement, { days: _num(S.startSupplyDays, 8) });
        NPCLords.rememberDeed(world, k.lord, 'office_accepted', { note: 'a commission in the army' });
        const rd = Generalship.rankDef(c);
        return { success: true, message: `${k.ruler || 'The crown'} grants you a commission: ${rd.name} in the army of ${k.name}, at the head of ${c.men} of its men.` };
    },

    /** Create the commission record (also used by the General start). */
    _grant(player, world, k, opts = {}) {
        const day = _day(world);
        const c = {
            kingdomId: k.id, kingdomName: k.name, holder: Generalship._who(player),
            rank: Math.max(0, Math.floor(_num(opts.rank))), since: day, rankSince: day,
            merit: _num(opts.merit), favour: _num(opts.favour, 50), fear: 0,
            owed: 0, lastPaidDay: day,
            men: 0, morale: _num(opts.morale, 60), supplies: 0, veterancy: _num(opts.veterancy),
            lieutenants: [], ltSeq: 0,
            siege: null, siegePolicy: 'spare',
            order: null, nextOrderDay: day + _num((Generalship.config().orders || {}).firstDelay, 2),
            rival: null, raided: {},
            lastBattleDay: -1, lastAddressDay: -99, lastRaidDay: -99, lastAnswerDay: -99,
            seenWar: _num(world.warHistorySeq),
            record: { battlesWon: 0, battlesLost: 0, townsTaken: 0, raids: 0, ordersDone: 0, ordersFailed: 0, plunder: 0, wages: 0, realmWon: 0, realmLost: 0, promotions: 0 },
            log: [],
        };
        player.commission = c;
        player.allegiance = k.id;
        if (!player.reputation) player.reputation = {};
        if (player.reputation[k.id] == null) player.reputation[k.id] = 0;
        c.men = Generalship.targetMen(c, k);
        const slots = _num(Generalship.rankDef(c).lieutenants, 1);
        for (let i = 0; i < Math.min(slots, Math.max(1, Math.floor(_num(opts.lieutenants, 1)))); i++) c.lieutenants.push(Generalship._makeLieutenant(c, k));
        c.rival = Generalship._makeRival(k, _num(opts.rivalInfluence, 25));
        Generalship._title(player, c, k);
        Generalship._log(c, world, `Commissioned ${Generalship.rankDef(c).name} in the army of ${k.name}.`);
        if (player.house) House._chronicle(player.house, world, `${player.name || 'The head of the House'} takes a commission as ${Generalship.rankDef(c).name} in the army of ${k.name}.`, ['war']);
        return c;
    },

    _title(player, c, k) {
        const rd = Generalship.rankDef(c);
        player.title = `${rd.name} of ${k.name}`;
    },

    _names(k) {
        const pool = Characters.FIRST_NAMES && (Characters.FIRST_NAMES[k && k.culture] || Characters.FIRST_NAMES.Imperial);
        return pool || { male: ['Aldric', 'Bram', 'Cedric'], female: ['Alys', 'Bryn', 'Cora'] };
    },

    _makeLieutenant(c, k) {
        const L = Generalship.config().lieutenants || {};
        const names = Generalship._names(k);
        const female = Utils.random() < 0.2;
        const list = (female ? names.female : names.male) || names.male || ['Aldric'];
        const traits = Object.keys(L.traits || { veteran: {} });
        const trait = Utils.randPick(traits);
        const t = (L.traits || {})[trait] || {};
        const [s0, s1] = L.skill || [2, 7];
        const [l0, l1] = L.loyalty || [45, 80];
        c.ltSeq = _num(c.ltSeq) + 1;
        return {
            id: `lt${c.ltSeq}`, name: Utils.randPick(list), female, trait,
            skill: Utils.randInt(s0, s1), loyalty: Utils.clamp(Utils.randInt(l0, l1) + _num(t.loyalty), 0, 100),
        };
    },

    _makeRival(k, influence) {
        const C = Generalship.config().court || {};
        const names = Generalship._names(k);
        return { name: `${Utils.randPick(C.rivalNames || ['Lord'])} ${Utils.randPick(names.male || ['Osric'])}`, influence: Utils.clamp(influence, 0, 100) };
    },

    // ── The host ─────────────────────────────────────

    /** The share of the realm's army the rank commands. */
    targetMen(c, k) {
        const rd = Generalship.rankDef(c);
        if (!rd || !k) return 0;
        return Math.max(0, Math.min(_num(rd.maxMen, 200), Math.floor(_num(k.military) * _num(rd.share, 0.05))));
    },

    /** The host's daily food need. */
    dailyNeed(c) {
        return _num(c.men) * _num((Generalship.config().supply || {}).perMan, 0.02);
    },

    /** Days of food carried. */
    supplyDays(c) {
        const need = Generalship.dailyNeed(c);
        return need > 0 ? _num(c.supplies) / need : 0;
    },

    /** The host's fighting quality (×): leadership, lieutenants, veterancy, morale, food. */
    quality(player, c) {
        const B = Generalship.config().battle || {};
        const L = (Generalship.config().lieutenants || {}).traits || {};
        let q = 1 + _num((player.skills || {}).leadership) * _num(B.perLeadership, 0.04);
        for (const lt of c.lieutenants || []) q += _num(lt.skill) * _num(B.perLieutenantSkill, 0.012) + _num((L[lt.trait] || {}).battle);
        q *= 1 + _num(c.veterancy) * _num(B.veteranBonus, 0.35);
        q *= 0.5 + Utils.clamp(_num(c.morale), 0, 100) / 100;
        if (_num(c.supplies) <= 0 && Generalship._consuming(c, null)) q *= _num(B.supplyless, 0.75);
        return Math.max(0.2, q);
    },

    /** Strength the player's own retinue adds (it rides with the host). */
    retinue(player) {
        return (player.army || []).length ? PlayerMilitary.getArmyStrength(player) : 0;
    },

    power(player, c) {
        return (_num(c.men) + Generalship.retinue(player)) * Generalship.quality(player, c);
    },

    /** Is the host eating its own supplies (a war on, or a siege)? */
    _consuming(c, world) {
        if (c.siege) return true;
        if (!world) return !!c._atWar;
        const k = _kingdom(world, c.kingdomId);
        return Generalship.enemies(world, k).length > 0;
    },

    /** Hexes from the player to the nearest tile of a realm. */
    distanceTo(world, player, k) {
        let best = Infinity;
        for (const t of (k && k.territory) || []) {
            const d = _dist(world, player, t);
            if (d < best) best = d;
            if (best === 0) break;
        }
        return best;
    },

    /** The enemy realms whose land is within the battle range of the player. */
    frontEnemies(player, world) {
        const c = Generalship.state(player);
        const k = c && _kingdom(world, c.kingdomId);
        const range = _num((Generalship.config().battle || {}).frontRange, 3);
        return Generalship.enemies(world, k).filter(e => Generalship.distanceTo(world, player, e) <= range);
    },

    // ── Supplies ─────────────────────────────────────

    /**
     * Draw grain out of a town's granary into the host's wagons, the crown
     * (or, with opts.ownPurse, the player) paying the town's purse for it.
     * → { food, paid, by }.
     */
    _supplyFrom(player, world, c, s, opts = {}) {
        const out = { food: 0, paid: 0, by: null };
        const S = Generalship.config().supply || {};
        if (!s) return out;
        // A real town not yet given its economy record gets it first (its granary and purse)
        if (!s.economy && _num(s.population) > 0) Economy.initSettlement(s);
        if (!s.economy) return out;
        const k = _kingdom(world, c.kingdomId);
        const days = _num(opts.days, _num(S.topUpDays, 10));
        const want = Math.max(0, Generalship.dailyNeed(c) * days - _num(c.supplies));
        const avail = Math.max(0, _num(s.economy.food)) * _num(S.maxTownShare, 0.35);
        let take = Math.min(want, avail);
        if (!(take > 0)) return out;
        const price = _num(S.foodPrice, 1.2);
        if (opts.ownPurse) {
            take = Math.min(take, Math.max(0, _num(player.gold)) / price);
            const cost = _r2(take * price);
            player.gold = _r2(_num(player.gold) - cost);
            Ledger.record(player, 'armyUpkeep', -cost);
            out.by = 'you';
            out.paid = cost;
        } else {
            take = Math.min(take, Math.max(0, _num(k && k.treasury)) / price);
            const cost = _r2(take * price);
            if (k) {
                k.treasury = _r2(_num(k.treasury) - cost);
                CrownBooks.note(k, 'army', cost);
            }
            out.by = 'crown';
            out.paid = cost;
        }
        take = Math.floor(take * 100) / 100;
        if (!(take > 0)) return out;
        s.economy.food = _r2(_num(s.economy.food) - take);
        Economy.payTown(s, out.paid);
        c.supplies = _r2(_num(c.supplies) + take);
        out.food = take;
        return out;
    },

    /** The realm's town within supply range of the player with the most grain, or null. */
    _supplyTown(player, world, c) {
        const k = _kingdom(world, c.kingdomId);
        const range = _num((Generalship.config().supply || {}).rangeHexes, 3);
        let best = null;
        for (const t of _towns(world, k)) {
            if (_dist(world, player, t) > range) continue;
            if (!best || _num(t.settlement.economy && t.settlement.economy.food) > _num(best.settlement.economy && best.settlement.economy.food)) best = t;
        }
        return best;
    },

    /** Requisition grain from the realm's town in reach (the crown pays, or you). */
    requisition(player, world, opts = {}) {
        const c = Generalship.state(player);
        if (!c) return { success: false, reason: 'You hold no commission.' };
        const t = Generalship._supplyTown(player, world, c);
        if (!t) return { success: false, reason: `No town of ${c.kingdomName} is within reach of your wagons.` };
        const got = Generalship._supplyFrom(player, world, c, t.settlement, { ownPurse: !!opts.ownPurse });
        if (!(got.food > 0)) return { success: false, reason: opts.ownPurse ? `${t.settlement.name} has no grain to spare, or you cannot pay for it.` : `${t.settlement.name} has no grain to spare, or the crown cannot pay for it. You may pay yourself.` };
        return { success: true, message: `${Math.round(got.food)} measures of grain from ${t.settlement.name}'s granary (${Math.round(got.paid)}g paid by ${got.by === 'you' ? 'you' : 'the crown'}). The host has ${Math.round(Generalship.supplyDays(c))} days of food.` };
    },

    // ── Battles (the hook) ───────────────────────────

    /**
     * The spec of a battle the general is about to fight: who, the host, the
     * enemy, where, the order it serves, the odds. kind: 'field' (opts.enemyId),
     * 'assault' (the siege's town), 'raid' (opts.q, opts.r). → { spec } or { reason }.
     */
    prepareBattle(player, world, kind, opts = {}) {
        const c = Generalship.state(player);
        if (!c) return { reason: 'You hold no commission.' };
        const k = _kingdom(world, c.kingdomId);
        const B = Generalship.config().battle || {};
        let enemy = null;
        let force = 0;
        let mult = 1;
        let where = { q: player.q, r: player.r, townName: null };
        if (kind === 'field') {
            enemy = Generalship.frontEnemies(player, world).find(e => e.id === opts.enemyId) || null;
            if (!enemy) return { reason: 'That enemy is not within reach of your host.' };
            force = Utils.clamp(Math.floor(_num(enemy.military) * _num(B.enemyShare, 0.25)), _num(B.minEnemy, 20), _num(B.maxEnemy, 800));
            force = Math.min(force, Math.floor(_num(enemy.military)));
        } else if (kind === 'assault') {
            const sg = c.siege;
            if (!sg) return { reason: 'You are not besieging a town.' };
            enemy = _kingdom(world, sg.kingdomId);
            force = Math.min(_num(sg.garrison), Math.floor(_num(enemy && enemy.military)) || _num(sg.garrison));
            mult = _num(sg.walls, 1.25) * (1 + Math.max(0, 100 - _num(sg.progress)) / 100);
            where = { q: sg.q, r: sg.r, townName: sg.name };
        } else if (kind === 'raid') {
            const tile = world.getTile(opts.q, opts.r);
            const s = tile && tile.settlement;
            enemy = s ? _kingdom(world, s.kingdom) : null;
            const R = Generalship.config().raid || {};
            force = Math.max(_num(R.minGarrison, 8), Math.floor(_num(enemy && enemy.military) * _num(R.garrisonShare, 0.03)));
            where = { q: opts.q, r: opts.r, townName: s ? s.name : null };
        } else {
            return { reason: 'No such battle.' };
        }
        if (!enemy) return { reason: 'There is no enemy there.' };
        const t = world.getTile(where.q, where.r);
        where.terrainId = t && t.terrain ? t.terrain.id : null;
        const enemyQuality = (0.9 + 0.05 * _num(enemy.lord && enemy.lord.martial, 5) / 5) * mult * Difficulty.mult(player, 'enemyStrength');
        const spec = {
            id: `gb_${_day(world)}_${kind}_${enemy.id}`,
            kind, day: _day(world),
            where,
            objective: c.order ? { kind: c.order.kind, text: c.order.text, target: c.order.target || null } : null,
            host: {
                kingdomId: k ? k.id : c.kingdomId, kingdomName: c.kingdomName,
                general: player.name || 'you', rank: Generalship.rankDef(c).name,
                men: _num(c.men), morale: _num(c.morale), veterancy: _num(c.veterancy),
                quality: _r2(Generalship.quality(player, c)),
                composition: k ? KingdomAI._getKingdomComposition(k) : null,
                lieutenants: (c.lieutenants || []).map(lt => ({ id: lt.id, name: lt.name, skill: lt.skill, trait: lt.trait })),
                retinue: Generalship.retinue(player),
                retinueUnits: (player.army || []).length,
            },
            enemy: {
                kingdomId: enemy.id, kingdomName: enemy.name,
                men: force, quality: _r2(enemyQuality),
                composition: KingdomAI._getKingdomComposition(enemy),
            },
        };
        const hp = (spec.host.men + spec.host.retinue) * spec.host.quality;
        const ep = spec.enemy.men * spec.enemy.quality;
        spec.odds = _r2(Utils.clamp(0.5 + (hp - ep) / Math.max(1, hp + ep) * 1.6, 0.03, 0.97));
        return { spec };
    },

    /** Fight a spec out on the one-roll path: → { victory, hostLost, enemyLost, retinueLost }. */
    autoResolve(spec) {
        const B = Generalship.config().battle || {};
        const sp = _num(B.spread, 0.15);
        const hp = (spec.host.men + spec.host.retinue) * spec.host.quality * Utils.randFloat(1 - sp, 1 + sp);
        const ep = spec.enemy.men * spec.enemy.quality * Utils.randFloat(1 - sp, 1 + sp);
        const victory = hp > ep;
        let hostShare = victory ? _num(B.winLoss, 0.06) : _num(B.loseLoss, 0.16);
        let enemyShare = victory ? _num(B.enemyWinLoss, 0.35) : _num(B.enemyLoseLoss, 0.1);
        if (spec.kind === 'assault') {
            const S = Generalship.config().siege || {};
            hostShare = _num(S.assaultLoss, 0.18) * (victory ? 0.7 : 1.2);
            enemyShare = victory ? 1 : _num(S.assaultEnemyLoss, 0.5) * 0.4;
        }
        // Cautious lieutenants spare men
        const L = (Generalship.config().lieutenants || {}).traits || {};
        const care = (spec.host.lieutenants || []).reduce((s, lt) => s + _num((L[lt.trait] || {}).loss), 0);
        hostShare = Math.max(0.01, hostShare * (1 + care));
        return {
            victory,
            hostLost: Math.round(spec.host.men * hostShare),
            enemyLost: Math.round(spec.enemy.men * enemyShare),
            retinueLost: victory ? 0 : Math.ceil(spec.host.retinueUnits * _num(B.retinueLoss, 0.15)),
        };
    },

    /** Apply a battle's outcome (from autoResolve or a battlefield screen). → result with a message. */
    settleBattle(player, world, spec, outcome) {
        const c = Generalship.state(player);
        if (!c || !spec || !outcome) return { success: false, reason: 'No battle to settle.' };
        const B = Generalship.config().battle || {};
        const M = Generalship.config().morale || {};
        const LT = Generalship.config().lieutenants || {};
        const k = _kingdom(world, c.kingdomId);
        const enemy = _kingdom(world, spec.enemy.kingdomId);
        const day = _day(world);
        const hostLost = Math.max(0, Math.min(_num(c.men), Math.round(_num(outcome.hostLost))));
        const enemyLost = Math.max(0, Math.round(_num(outcome.enemyLost)));
        // The host's dead are the realm's dead; the enemy's are its realm's
        c.men -= hostLost;
        if (k) k.military = Math.max(0, _num(k.military) - hostLost);
        if (enemy) enemy.military = Math.max(0, _num(enemy.military) - enemyLost);
        let retinueLost = 0;
        if (_num(outcome.retinueLost) > 0 && (player.army || []).length) {
            const cas = PlayerMilitary._applyCasualties(player, 'land', Math.round(outcome.retinueLost)).casualties;
            retinueLost = Array.isArray(cas) ? cas.length : _num(cas);
        }
        if (enemy) Harvests.noteBattle(world, enemy.id);
        c.lastBattleDay = day;
        const res = { success: true, victory: !!outcome.victory, hostLost, enemyLost, retinueLost, spec };
        if (outcome.victory) {
            c.record.battlesWon++;
            c.morale = Utils.clamp(_num(c.morale) + _num(M.victory, 8), 0, 100);
            c.veterancy = Utils.clamp(_num(c.veterancy) + _num(B.veterancy, 0.05), 0, 1);
            for (const lt of c.lieutenants) lt.loyalty = Utils.clamp(lt.loyalty + _num(LT.victoryLoyalty, 2), 0, 100);
            if (spec.kind === 'field') {
                c.merit += _num(B.merit, 6);
                Generalship._favour(c, _num(B.favour, 4));
                player.renown = _num(player.renown) + _num(B.renown, 4);
                if (k && enemy) KingdomAI._warState(k, enemy.id, world).gains += _num(B.warGains, 1);
                if (c.order && c.order.kind === 'battle' && c.order.enemyId === spec.enemy.kingdomId) c.order.progress = _num(c.order.progress) + 1;
                if (k) NPCLords.rememberDeed(world, k.lord, 'war_aid', { note: `against ${spec.enemy.kingdomName}` });
                if (enemy) NPCLords.rememberDeed(world, enemy.lord, 'war_on_us', { weight: -4, note: `for ${c.kingdomName}` });
                House.recordPlayerDeed(player, world, 'battleWon', { reason: `broke a ${spec.enemy.kingdomName} army in the field` });
            }
            res.message = `Victory! The host of ${c.kingdomName} breaks ${spec.enemy.kingdomName}'s ${spec.kind === 'field' ? 'army' : 'defenders'}: ${enemyLost} of theirs fall, ${hostLost} of yours.`;
        } else {
            c.record.battlesLost++;
            c.morale = Utils.clamp(_num(c.morale) + _num(M.defeat, -12), 0, 100);
            for (const lt of c.lieutenants) lt.loyalty = Utils.clamp(lt.loyalty + _num(LT.defeatLoyalty, -3), 0, 100);
            if (spec.kind === 'field') Generalship._favour(c, _num(B.lossFavour, -6));
            if (c.rival) c.rival.influence = Utils.clamp(c.rival.influence + 4, 0, 100);
            let fallen = null;
            if (c.lieutenants.length && Utils.random() < _num(B.lieutenantDeath, 0.25)) {
                fallen = Utils.randPick(c.lieutenants);
                c.lieutenants = c.lieutenants.filter(lt => lt !== fallen);
            }
            res.message = `Defeat. ${spec.enemy.kingdomName} throws back the host: ${hostLost} of your men fall${retinueLost ? `, and ${retinueLost} of your own retinue` : ''}.${fallen ? ` Your lieutenant ${fallen.name} is among the dead.` : ''}`;
        }
        Generalship._log(c, world, res.message);
        return res;
    },

    /** Give battle to an enemy army within reach of the front. */
    giveBattle(player, world, enemyId) {
        const c = Generalship.state(player);
        if (!c) return { success: false, reason: 'You hold no commission.' };
        if (c.siege) return { success: false, reason: `Your host is tied down before ${c.siege.name}.` };
        if (c.lastBattleDay === _day(world)) return { success: false, reason: 'The host fought today. It needs a night to re-form.' };
        if (_num(c.men) < _num((Generalship.config().host || {}).minMen, 10)) return { success: false, reason: 'Your host is too few to give battle.' };
        const prep = Generalship.prepareBattle(player, world, 'field', { enemyId });
        if (!prep.spec) return { success: false, reason: prep.reason };
        return Generalship.settleBattle(player, world, prep.spec, Generalship.autoResolve(prep.spec));
    },

    // ── Sieges ───────────────────────────────────────

    /** The enemy town at or next to the player, or null. */
    _enemyTownNear(player, world, c) {
        const k = _kingdom(world, c.kingdomId);
        const foes = new Set(Generalship.enemies(world, k).map(e => e.id));
        const spots = [{ q: player.q, r: player.r }, ...Hex.neighbors(player.q, player.r).map(n => ({ q: Hex.wrapQ(n.q, world.width), r: n.r }))];
        for (const p of spots) {
            const t = world.getTile(p.q, p.r);
            if (t && t.settlement && foes.has(t.settlement.kingdom)) return { q: p.q, r: p.r, s: t.settlement };
        }
        return null;
    },

    /** Lay siege to the enemy town at or beside the player. policy: 'spare' | 'sack'. */
    besiege(player, world, policy = null) {
        const c = Generalship.state(player);
        if (!c) return { success: false, reason: 'You hold no commission.' };
        if (c.siege) return { success: false, reason: `You are already besieging ${c.siege.name}.` };
        if (_num(c.men) < _num((Generalship.config().host || {}).minMen, 10)) return { success: false, reason: 'Your host is too few to invest a town.' };
        const target = Generalship._enemyTownNear(player, world, c);
        if (!target) return { success: false, reason: 'No enemy town lies at or beside you.' };
        const S = Generalship.config().siege || {};
        const enemy = _kingdom(world, target.s.kingdom);
        const type = _isCapital(enemy, target.q, target.r) ? 'capital' : (target.s.type || 'town');
        const walls = _num((S.walls || {})[type], 1.25);
        const garrison = Math.max(_num(S.minGarrison, 15), Math.floor(_num(enemy.military) * _num(S.garrisonShare, 0.08)));
        if (policy === 'sack' || policy === 'spare') c.siegePolicy = policy;
        c.siege = { q: target.q, r: target.r, name: target.s.name, kingdomId: enemy.id, kingdomName: enemy.name, progress: 0, garrison, walls, since: _day(world) };
        Generalship._log(c, world, `The host invests ${target.s.name} (${enemy.name}): ${garrison} defenders behind its walls.`);
        return { success: true, message: `Your host invests ${target.s.name}. ${garrison} of ${enemy.name}'s men hold its walls. Each day the siege tightens and eats into both granaries; storm it when you judge the moment.` };
    },

    setSiegePolicy(player, policy) {
        const c = Generalship.state(player);
        if (!c || !['sack', 'spare'].includes(policy)) return { success: false, reason: 'No such order.' };
        c.siegePolicy = policy;
        return { success: true, message: policy === 'sack' ? 'The town will be sacked when it falls.' : 'The town will be spared when it falls.' };
    },

    liftSiege(player, world) {
        const c = Generalship.state(player);
        if (!c || !c.siege) return { success: false, reason: 'There is no siege to lift.' };
        const name = c.siege.name;
        c.siege = null;
        c.morale = Utils.clamp(_num(c.morale) - 4, 0, 100);
        Generalship._log(c, world, `The siege of ${name} is lifted.`);
        return { success: true, message: `You lift the siege of ${name}.` };
    },

    /** Storm the besieged town now. */
    assault(player, world) {
        const c = Generalship.state(player);
        if (!c || !c.siege) return { success: false, reason: 'You are not besieging a town.' };
        if (c.lastBattleDay === _day(world)) return { success: false, reason: 'The host fought today.' };
        const prep = Generalship.prepareBattle(player, world, 'assault');
        if (!prep.spec) return { success: false, reason: prep.reason };
        const out = Generalship.autoResolve(prep.spec);
        const res = Generalship.settleBattle(player, world, prep.spec, out);
        if (!res.success) return res;
        if (res.victory) {
            const taken = Generalship._capture(player, world, c, 'stormed');
            res.message = `${res.message} ${taken.message}`;
        } else {
            c.siege.garrison = Math.max(1, c.siege.garrison - res.enemyLost);
            const enemy = _kingdom(world, c.siege.kingdomId);
            if (enemy) NPCLords.rememberDeed(world, enemy.lord, 'assault_failed');
        }
        return res;
    },

    _siegeTick(player, world, c, out) {
        const sg = c.siege;
        const S = Generalship.config().siege || {};
        const tile = world.getTile(sg.q, sg.r);
        const s = tile && tile.settlement;
        const k = _kingdom(world, c.kingdomId);
        const enemy = _kingdom(world, sg.kingdomId);
        if (!s || !enemy || enemy.isAlive === false || s.kingdom !== sg.kingdomId || !(k && (k.wars || []).includes(enemy.id))) {
            out.notices.push({ icon: '🏰', title: 'Siege Ends', text: `The siege of ${sg.name} is over: ${s && k && s.kingdom === k.id ? 'the town is already ours' : 'the war has moved on'}.`, type: 'info' });
            c.siege = null;
            return;
        }
        if (_dist(world, player, sg) > 1) {
            out.notices.push({ icon: '🏰', title: 'Siege Abandoned', text: `With its general gone, the host draws off from ${sg.name}.`, type: 'warning' });
            c.siege = null;
            c.morale = Utils.clamp(_num(c.morale) - 5, 0, 100);
            return;
        }
        // Hunger inside the walls: the town eats its granary down, faster with the roads cut
        if (s.economy) s.economy.food = Math.max(0, _num(s.economy.food) * 0.93 - _num(s.population) * 0.002);
        const starving = s.economy && _num(s.economy.food) <= 1;
        const ratio = Utils.clamp(Generalship.power(player, c) / Math.max(1, sg.garrison * sg.walls), 0.3, 3);
        sg.progress = _num(sg.progress) + _num(S.progressPerDay, 9) * ratio * (starving ? 2 : 1) * (_num(c.supplies) > 0 ? 1 : 0.5);
        if (sg.progress >= _num(S.surrenderAt, 100)) {
            const taken = Generalship._capture(player, world, c, 'surrendered');
            out.notices.push({ icon: '🏳️', title: 'Town Surrenders', text: taken.message, type: 'success' });
        }
    },

    /**
     * A besieged town falls to the general: it passes to the liege (the
     * AI's own capture path), is sacked or spared, and the garrison is gone.
     */
    _capture(player, world, c, how) {
        const sg = c.siege;
        const S = Generalship.config().siege || {};
        const k = _kingdom(world, c.kingdomId);
        const enemy = _kingdom(world, sg.kingdomId);
        const tile = world.getTile(sg.q, sg.r);
        const s = tile && tile.settlement;
        c.siege = null;
        if (!k || !enemy || !s) return { message: 'The town is lost to the war.' };
        enemy.military = Math.max(0, _num(enemy.military) - (how === 'surrendered' ? sg.garrison : 0));
        // Old estates of the conquered crown and its nobles: one to the general (rank General or higher)
        const grant = _num(c.rank) >= 2 ? Generalship._grantEstateAt(player, world, sg.q, sg.r, enemy.id) : null;
        KingdomAI.takeTile(k, enemy, world, sg.q, sg.r);
        const fell = KingdomAI.afterTownLoss(enemy, k, world);
        c.record.townsTaken++;
        c.merit += _num(S.merit, 15);
        Generalship._favour(c, _num(S.favour, 8));
        player.renown = _num(player.renown) + _num(S.renown, 10);
        NPCLords.rememberDeed(world, enemy.lord, 'conquest', { note: s.name });
        NPCLords.rememberDeed(world, k.lord, 'war_aid', { note: `took ${s.name}` });
        House.recordPlayerDeed(player, world, 'battleWon', { scale: 2, reason: `took ${s.name} for ${k.name}` });
        let text = `${s.name} ${how === 'stormed' ? 'is stormed' : 'opens its gates'} and passes to ${k.name}.`;
        const loot = Generalship._plunder(player, world, c, s, enemy, c.siegePolicy === 'sack' ? S.sack : S.spare, c.siegePolicy === 'sack');
        text += ` ${loot.text}`;
        if (grant) text += ` The crown grants you the estate of ${grant}.`;
        if (fell === 'collapsed') text += ` ${enemy.name} is no more.`;
        Generalship._log(c, world, text);
        if (Array.isArray(world.events)) world.events.push({ text: `🏰 ${player.name || 'A general'} takes ${s.name} for ${k.name}.`, type: 'military', category: 'MILITARY' });
        return { message: text };
    },

    /**
     * Take coin and grain from a town: crown's share to the liege's treasury,
     * the men's share spent in the realm's towns, the rest to the player.
     */
    _plunder(player, world, c, s, enemy, P, harsh) {
        P = P || {};
        const k = _kingdom(world, c.kingdomId);
        const purse = Economy.townPurse(s);
        const taken = Economy.drawTown(s, _r2(_num(purse) * _num(P.purse)));
        const crown = _r2(taken * _num(P.crownShare));
        const men = _r2(taken * _num(P.menShare));
        const mine = _r2(Math.max(0, taken - crown - men));
        if (k && crown > 0) {
            k.treasury = _r2(_num(k.treasury) + crown);
            if (enemy && enemy.id !== k.id) MoneySupply.transfer(world, enemy.id, k.id, crown, 'plunder', 1);
        }
        if (men > 0) {
            // The soldiers spend their share in the realm's towns
            const home = _towns(world, k).sort((a, b) => _dist(world, a, s) - _dist(world, b, s))[0];
            if (home) Economy.payTown(home.settlement, men);
        }
        if (mine > 0) {
            player.gold = _r2(_num(player.gold) + mine);
            Ledger.record(player, 'plunder', mine);
            c.record.plunder = _r2(_num(c.record.plunder) + mine);
        }
        let food = 0;
        if (_num(P.food) > 0 && s.economy) {
            food = Math.floor(_num(s.economy.food) * _num(P.food));
            s.economy.food = _num(s.economy.food) - food;
            c.supplies = _r2(_num(c.supplies) + food);
        }
        if (_num(P.population) > 0) s.population = Math.max(10, Math.round(_num(s.population) * (1 - _num(P.population))));
        if (_num(P.happiness) && Number.isFinite(s.happiness)) s.happiness = Utils.clamp(s.happiness + _num(P.happiness), 0, 100);
        if (_num(P.karma)) player.karma = _num(player.karma) + _num(P.karma);
        c.morale = Utils.clamp(_num(c.morale) + _num(P.morale), 0, 100);
        const text = harsh
            ? `The town is sacked: ${Math.round(taken)}g out of its purse (${Math.round(crown)}g to the crown, ${Math.round(men)}g to the men, ${Math.round(mine)}g yours)${food ? ` and ${food} measures of grain` : ''}.`
            : `The town is spared; its burghers pay ${Math.round(taken)}g for it (${Math.round(crown)}g to the crown, ${Math.round(mine)}g yours).`;
        return { taken, crown, men, mine, food, text };
    },

    /** An estate at a conquered town, held by the old crown or its nobles, to the player. → its name or null. */
    _grantEstateAt(player, world, q, r, oldKid) {
        if (!Estates.enabled()) return null;
        Estates.derive(world, _day(world));
        const ests = Estates.estatesOf(world, q, r).filter(e => {
            const kind = Estates.kindOf(e.holder);
            const h = Estates.holder(world, e.holder);
            return (kind === 'crown' || kind === 'noble') && h && String(h.kid) === String(oldKid);
        });
        const e = ests[0];
        if (!e) return null;
        LandMarket._setHolder(world, e, 'player', _day(world));
        return e.name;
    },

    /** A crown estate of the liege (nearest the player first) granted for a promotion. → its name or null. */
    _grantCrownEstate(player, world, k) {
        if (!Estates.enabled() || !k) return null;
        Estates.derive(world, _day(world));
        const at = e => { const [q, r] = String(e.town || '').split(',').map(Number); return { q, r }; };
        const ests = Estates.heldBy(world, `crown:${k.id}`)
            .filter(e => e && Number.isFinite(at(e).q))
            .sort((a, b) => _dist(world, at(a), player) - _dist(world, at(b), player));
        const e = ests[0];
        if (!e) return null;
        LandMarket._setHolder(world, e, 'player', _day(world));
        return e.name;
    },

    // ── Raids ────────────────────────────────────────

    raid(player, world) {
        const c = Generalship.state(player);
        if (!c) return { success: false, reason: 'You hold no commission.' };
        if (c.siege) return { success: false, reason: 'Your host is tied down by the siege.' };
        const R = Generalship.config().raid || {};
        const day = _day(world);
        if (day - _num(c.lastRaidDay, -99) < _num(R.cooldown, 2)) return { success: false, reason: 'The host is still gathering its last plunder.' };
        const target = Generalship._enemyTownNear(player, world, c);
        if (!target) return { success: false, reason: 'No enemy village or town lies at or beside you.' };
        const key = `${target.q},${target.r}`;
        if (_num(c.raided[key], -999) > day - 30) return { success: false, reason: `${target.s.name} has been stripped already.` };
        const prep = Generalship.prepareBattle(player, world, 'raid', { q: target.q, r: target.r });
        if (!prep.spec) return { success: false, reason: prep.reason };
        const res = Generalship.settleBattle(player, world, prep.spec, Generalship.autoResolve(prep.spec));
        c.lastRaidDay = day;
        if (!res.victory) return res;
        c.raided[key] = day;
        const enemy = _kingdom(world, target.s.kingdom);
        const loot = Generalship._plunder(player, world, c, target.s, enemy, R, true);
        c.record.raids++;
        c.merit += _num(R.merit, 4);
        Generalship._favour(c, _num(R.favour, 1));
        if (c.order && c.order.kind === 'raid' && c.order.enemyId === enemy.id) c.order.progress = _num(c.order.progress) + 1;
        NPCLords.rememberDeed(world, enemy.lord, 'raid', { note: target.s.name });
        res.message = `The host falls on ${target.s.name}. ${loot.text}`;
        Generalship._log(c, world, res.message);
        return res;
    },

    // ── The men ──────────────────────────────────────

    addressTroops(player, world) {
        const c = Generalship.state(player);
        if (!c) return { success: false, reason: 'You hold no commission.' };
        const A = (Generalship.config().morale || {}).address || {};
        const day = _day(world);
        if (day - _num(c.lastAddressDay, -99) < _num(A.cooldown, 3)) return { success: false, reason: 'You spoke to them lately; more words would ring hollow.' };
        c.lastAddressDay = day;
        const gain = Math.round(_num(A.base, 3) + _num((player.skills || {}).leadership) * _num(A.perLeadership, 1) + _num(player.charisma, 5) * _num(A.perCharisma, 0.5) * Utils.randFloat(0.5, 1.2));
        const before = c.morale;
        c.morale = Math.max(c.morale, Math.min(_num(A.max, 85), c.morale + gain));
        return { success: true, message: `You ride the lines and speak to the men. Morale ${Math.round(before)} → ${Math.round(c.morale)}.` };
    },

    /** Give the men coin from your own purse: they spend it in the realm's towns. */
    shareSpoils(player, world, amount) {
        const c = Generalship.state(player);
        if (!c) return { success: false, reason: 'You hold no commission.' };
        const g = Math.floor(_num(amount));
        if (!(g > 0) || _num(player.gold) < g) return { success: false, reason: 'You do not have that much.' };
        const P = (Generalship.config().morale || {}).spoils || {};
        const per = Math.max(1, _num(c.men) * _num(P.goldPerMan, 0.5));
        const gain = Math.min(_num(P.max, 20), Math.round(g / per * _num(P.perShare, 10)));
        const k = _kingdom(world, c.kingdomId);
        const home = _towns(world, k).sort((a, b) => _dist(world, a, player) - _dist(world, b, player))[0];
        player.gold = _r2(_num(player.gold) - g);
        Ledger.record(player, 'armyUpkeep', -g);
        if (home) Economy.payTown(home.settlement, g);
        c.morale = Utils.clamp(_num(c.morale) + gain, 0, 100);
        for (const lt of c.lieutenants) lt.loyalty = Utils.clamp(lt.loyalty + 1, 0, 100);
        return { success: true, message: `${g}g shared among the men${home ? ` (spent in ${home.settlement.name}'s taverns)` : ''}. Morale +${gain}.` };
    },

    appointLieutenant(player, world) {
        const c = Generalship.state(player);
        if (!c) return { success: false, reason: 'You hold no commission.' };
        const slots = _num(Generalship.rankDef(c).lieutenants, 1);
        if (c.lieutenants.length >= slots) return { success: false, reason: `A ${Generalship.rankDef(c).name} keeps ${slots} lieutenant${slots > 1 ? 's' : ''}.` };
        if (_num(c.men) < 20) return { success: false, reason: 'There is no one in the ranks fit to raise.' };
        const lt = Generalship._makeLieutenant(c, _kingdom(world, c.kingdomId));
        c.lieutenants.push(lt);
        const T = ((Generalship.config().lieutenants || {}).traits || {})[lt.trait] || {};
        return { success: true, message: `You raise ${lt.name} from the ranks: skill ${lt.skill}, ${T.label || lt.trait}.` };
    },

    dismissLieutenant(player, world, id) {
        const c = Generalship.state(player);
        if (!c) return { success: false, reason: 'You hold no commission.' };
        const lt = c.lieutenants.find(x => x.id === id);
        if (!lt) return { success: false, reason: 'No such officer.' };
        c.lieutenants = c.lieutenants.filter(x => x !== lt);
        for (const o of c.lieutenants) o.loyalty = Utils.clamp(o.loyalty - 2, 0, 100);
        return { success: true, message: `${lt.name} is sent back to the ranks.` };
    },

    // ── The court ────────────────────────────────────

    _favour(c, delta) {
        c.favour = Utils.clamp(_num(c.favour) + delta, 0, 100);
    },

    /** Answer your rival's slanders at court: gifts to the courtiers (spent in the capital). */
    answerRival(player, world) {
        const c = Generalship.state(player);
        if (!c || !c.rival) return { success: false, reason: 'No one at court speaks against you.' };
        const C = Generalship.config().court || {};
        const day = _day(world);
        if (day - _num(c.lastAnswerDay, -99) < _num(C.answerCooldown, 10)) return { success: false, reason: 'Your friends at court spoke for you lately.' };
        const cost = _num(C.answerGold, 80);
        if (_num(player.gold) < cost) return { success: false, reason: `Gifts to the courtiers cost ${cost}g.` };
        const k = _kingdom(world, c.kingdomId);
        const capTile = k && k.capital ? world.getTile(k.capital.q, k.capital.r) : null;
        player.gold = _r2(_num(player.gold) - cost);
        Ledger.record(player, 'diplomacy', -cost);
        if (capTile && capTile.settlement) Economy.payTown(capTile.settlement, cost);
        c.lastAnswerDay = day;
        Generalship._favour(c, _num(C.answerFavour, 6));
        c.rival.influence = Utils.clamp(c.rival.influence - 6, 0, 100);
        return { success: true, message: `Your gifts loosen tongues at ${k ? k.name : 'the'} court: ${c.rival.name}'s whispers lose their bite. Favour +${_num(C.answerFavour, 6)}.` };
    },

    /** How much the crown fears its general (0–100). */
    fear(player, world, c) {
        const F = Generalship.config().fear || {};
        const k = _kingdom(world, c.kingdomId);
        let f = _num(c.rank) * _num(F.perRank, 10)
            + (_num(c.men) / Math.max(1, _num(k && k.military))) * _num(F.perShare, 120)
            + _num(player.renown) * _num(F.perRenown, 0.05)
            + _num(c.merit) * _num(F.perMerit, 0.12)
            + _num(c.favour) * _num(F.perFavour, -0.3);
        const traits = (k && k.lord && k.lord.traits) || [];
        if (traits.includes('paranoid')) f += _num(F.paranoid, 15);
        if (k) f += LordInfluence.lean(k, 'ambition') * _num(F.ambition, 10);
        return Math.round(Utils.clamp(f, 0, 100));
    },

    // ── The coup ─────────────────────────────────────

    /** → { ok, reason, chance, betrayers } */
    coupOdds(player, world) {
        const c = Generalship.state(player);
        if (!c) return { ok: false, reason: 'You hold no commission.' };
        const C = Generalship.config().coup || {};
        const k = _kingdom(world, c.kingdomId);
        if (!k || !k.capital) return { ok: false, reason: 'There is no throne to take.' };
        if (_num(c.rank) < _num(C.minRank, 2)) return { ok: false, reason: `Only a ${(Generalship.ranks()[_num(C.minRank, 2)] || {}).name || 'General'} commands men enough to turn on the crown.` };
        if (_num(c.morale) < _num(C.minMorale, 55)) return { ok: false, reason: `The men would not follow you against the crown (morale ${Math.round(c.morale)}; needs ${_num(C.minMorale, 55)}).` };
        if (c.siege) return { ok: false, reason: 'Your host is tied down by a siege.' };
        if (_dist(world, player, k.capital) > 2) return { ok: false, reason: `March the host to ${k.name}'s capital first.` };
        const lts = c.lieutenants || [];
        const loyal = lts.length ? lts.reduce((s, lt) => s + lt.loyalty, 0) / lts.length : 50;
        const rebels = Generalship.power(player, c) * (0.5 + loyal / 100);
        const loyalists = Math.max(0, _num(k.military) - _num(c.men)) * _num(C.capitalDefense, 1.5) * (1 + LordInfluence.lean(k, 'martial') * 0.1);
        const betrayers = lts.filter(lt => lt.loyalty < _num(C.disloyalBelow, 40));
        const chance = Utils.clamp(rebels / Math.max(1, rebels + loyalists), _num(C.minChance, 0.05), _num(C.maxChance, 0.9));
        return { ok: true, chance: _r2(chance), betrayers: betrayers.map(lt => lt.name), rebels: Math.round(rebels), loyalists: Math.round(loyalists) };
    },

    /** Turn the host on the crown. */
    stageCoup(player, world) {
        const odds = Generalship.coupOdds(player, world);
        if (!odds.ok) return { success: false, reason: odds.reason };
        const C = Generalship.config().coup || {};
        const c = Generalship.state(player);
        const k = _kingdom(world, c.kingdomId);
        const day = _day(world);
        let chance = odds.chance;
        let betrayedBy = null;
        for (const lt of c.lieutenants.filter(x => x.loyalty < _num(C.disloyalBelow, 40))) {
            if (Utils.random() < _num(C.betrayChance, 0.5)) { betrayedBy = lt.name; chance *= 0.5; break; }
        }
        const oldRuler = k.ruler || 'the crown';
        if (Utils.random() < chance) {
            Generalship._end(player, world, 'crowned', null);
            Throne._takeThrone(player, world, k);
            player.renown = _num(player.renown) + _num(C.renown, 60);
            if (player.house) House.award(player.house, _num(C.prestige, 50), `seized the crown of ${k.name}`, day);
            const text = `👑 The host of ${k.name} marches into the capital. ${oldRuler} is cast down, and ${k.ruler} takes the throne.`;
            Throne._log(player, world, text);
            if (Array.isArray(world.events)) world.events.push({ text, type: 'political', category: 'political', kingdom: k.id });
            return { success: true, crowned: true, message: text };
        }
        // Crushed: the mutinous men are cut down or scattered; the would-be usurper flees
        k.military = Math.max(0, _num(k.military) - Math.round(_num(c.men) * _num(C.failLoss, 0.5)));
        Generalship._end(player, world, 'traitor', null);
        Throne.state(player).exile[k.id] = day + _num(C.exileDays, 720);
        if (!player.reputation) player.reputation = {};
        player.reputation[k.id] = Math.min(_num(player.reputation[k.id]), _num(C.failReputation, -100));
        player.allegiance = null;
        player.kingdomTitle = null;
        player.title = `Traitor to ${k.name}`;
        NPCLords.rememberDeed(world, k.lord, 'oath_broken', { note: 'turned the host on the crown' });
        RealmWars.declareWar(player, world, k, 'treason');
        const text = `${betrayedBy ? `${betrayedBy} betrayed the plot. ` : ''}The loyalists hold the capital and your host breaks. You flee ${k.name} with a price on your head.`;
        return { success: true, crowned: false, failed: true, message: text };
    },

    // ── Ending a commission ──────────────────────────

    resign(player, world) {
        const c = Generalship.state(player);
        if (!c) return { success: false, reason: 'You hold no commission.' };
        const D = Generalship.config().dismissal || {};
        const kid = c.kingdomId;
        Generalship._end(player, world, 'resigned', null);
        if (player.reputation) player.reputation[kid] = _num(player.reputation[kid]) + _num(D.resignReputation, -3);
        return { success: true, message: `You lay down your commission in the army of ${c.kingdomName}. The men go back to the realm's host.` };
    },

    /** End the commission (how: resigned, dismissed, crowned, traitor, lapsed, fallen). */
    _end(player, world, how, out) {
        const c = Generalship.state(player);
        if (!c) return;
        const k = _kingdom(world, c.kingdomId);
        if (k) delete k.fieldCommand;
        if (!Array.isArray(player.commissionPast)) player.commissionPast = [];
        player.commissionPast.unshift({
            kingdomId: c.kingdomId, kingdomName: c.kingdomName, rank: Generalship.rankDef(c).name,
            since: c.since, ended: _day(world), how, record: { ...c.record },
        });
        if (player.commissionPast.length > 10) player.commissionPast.length = 10;
        player.commission = null;
        if (player.title && /^(Captain|Commander|General|Marshal of the Realm) of /.test(player.title)) player.title = null;
        if (player.house && how !== 'lapsed') {
            House._chronicle(player.house, world, `${player.name || 'The head of the House'} leaves the army of ${c.kingdomName} (${how}) after ${c.record.battlesWon} battles won and ${c.record.townsTaken} towns taken.`, ['war']);
        }
        if (out && out.notices) out.notices.push({ icon: '🎖️', title: 'Commission Ended', text: `Your commission in the army of ${c.kingdomName} is ended: ${how}.`, type: how === 'dismissed' ? 'error' : 'info' });
    },

    _dismiss(player, world, out, why) {
        const c = Generalship.state(player);
        const D = Generalship.config().dismissal || {};
        const kid = c.kingdomId;
        const name = c.kingdomName;
        Generalship._end(player, world, 'dismissed', null);
        if (player.reputation) player.reputation[kid] = _num(player.reputation[kid]) + _num(D.reputation, -20);
        out.notices.push({ icon: '🎖️', title: 'Dismissed', text: `${why} The crown of ${name} strips you of your commission.`, type: 'error' });
    },

    // ── Ranks ────────────────────────────────────────

    _promote(player, world, c, out) {
        const next = Generalship.ranks()[_num(c.rank) + 1];
        if (!next) return;
        const k = _kingdom(world, c.kingdomId);
        c.rank++;
        c.rankSince = _day(world);
        c.record.promotions++;
        player.renown = _num(player.renown) + _num(next.renown);
        if (player.house && _num(next.prestige)) House.award(player.house, _num(next.prestige), `raised to ${next.name} of ${c.kingdomName}`, _day(world));
        let grant = null;
        if (_num(next.landGrant) > 0) grant = Generalship._grantCrownEstate(player, world, k);
        Generalship._title(player, c, k);
        const text = `${k && k.ruler ? k.ruler : 'The crown'} raises you to ${next.name}: ${Math.round(next.share * 100)}% of the realm's army is yours to command${grant ? `, and the crown estate of ${grant} is yours` : ''}.`;
        Generalship._log(c, world, text);
        out.notices.push({ icon: next.icon || '🎖️', title: 'Promoted', text, type: 'success' });
    },

    _demote(player, world, c, out, why) {
        const F = Generalship.config().favour || {};
        const k = _kingdom(world, c.kingdomId);
        c.rank = Math.max(0, _num(c.rank) - 1);
        c.rankSince = _day(world);
        c.favour = _num(F.demoteBelow, 20) + 10;
        c.lieutenants = c.lieutenants.slice(0, _num(Generalship.rankDef(c).lieutenants, 1));
        Generalship._title(player, c, k);
        const text = `${why} You are reduced to ${Generalship.rankDef(c).name}.`;
        Generalship._log(c, world, text);
        out.notices.push({ icon: '🎖️', title: 'Demoted', text, type: 'error' });
    },

    // ── Orders ───────────────────────────────────────

    _pickKind(weights) {
        const entries = Object.entries(weights || {}).filter(([, w]) => _num(w) > 0);
        if (!entries.length) return null;
        let x = Utils.random() * entries.reduce((s, [, w]) => s + w, 0);
        for (const [id, w] of entries) { if (x < w) return id; x -= w; }
        return entries[entries.length - 1][0];
    },

    _issueOrder(player, world, c, out) {
        const O = Generalship.config().orders || {};
        const k = _kingdom(world, c.kingdomId);
        const day = _day(world);
        const foes = Generalship.enemies(world, k);
        let order = null;
        if (foes.length) {
            const enemy = Utils.randPick(foes);
            const kind = Generalship._pickKind(O.warKinds);
            const due = day + _num((O.days || {})[kind], 20);
            if (kind === 'defend') {
                const own = _towns(world, k);
                const t = own.sort((a, b) => Generalship.distanceTo(world, a, enemy) - Generalship.distanceTo(world, b, enemy))[0];
                if (t) order = { kind, enemyId: enemy.id, target: { q: t.q, r: t.r, name: t.settlement.name }, need: _num(O.holdDays, 8), text: `Hold ${t.settlement.name} against ${enemy.name}: keep the host within ${_num(O.defendRadius, 2)} hexes of it for ${_num(O.holdDays, 8)} days.` };
            } else if (kind === 'besiege') {
                const theirs = _towns(world, enemy);
                const from = k.capital || player;
                const t = theirs.sort((a, b) => (_isCapital(enemy, a.q, a.r) ? 1 : 0) - (_isCapital(enemy, b.q, b.r) ? 1 : 0) || _dist(world, a, from) - _dist(world, b, from))[0];
                if (t) order = { kind, enemyId: enemy.id, target: { q: t.q, r: t.r, name: t.settlement.name }, need: 1, text: `Take ${t.settlement.name} from ${enemy.name}.` };
            } else if (kind === 'raid') {
                order = { kind, enemyId: enemy.id, need: _num(O.raids, 2), text: `Lay waste to ${enemy.name}'s lands: raid ${_num(O.raids, 2)} of its villages or towns.` };
            } else {
                order = { kind: 'battle', enemyId: enemy.id, need: _num(O.battles, 2), text: `Break ${enemy.name}'s army: win ${_num(O.battles, 2)} battles against it in the field.` };
            }
            if (order) order.due = due;
        } else {
            const own = _towns(world, k);
            const n = Math.min(_num(O.patrolTowns, 3), own.length);
            if (n > 0) {
                const picks = [];
                const pool = own.slice();
                for (let i = 0; i < n; i++) picks.push(pool.splice(Utils.randInt(0, pool.length - 1), 1)[0]);
                order = { kind: 'patrol', need: n, targets: picks.map(t => ({ q: t.q, r: t.r, name: t.settlement.name, seen: false })), text: `Ride the marches: show the host at ${picks.map(t => t.settlement.name).join(', ')}.`, due: day + _num((O.days || {}).patrol, 30) };
            }
        }
        if (!order) { c.nextOrderDay = day + _num(O.cadence, 6); return; }
        order.issued = day;
        order.progress = 0;
        c.order = order;
        Generalship._log(c, world, `Orders from the crown: ${order.text} By day ${order.due}.`);
        out.notices.push({ icon: '📜', title: 'Orders from the Crown', text: `${order.text} (by day ${order.due})`, type: 'info' });
    },

    _tickOrder(player, world, c, out) {
        const o = c.order;
        const O = Generalship.config().orders || {};
        const k = _kingdom(world, c.kingdomId);
        const day = _day(world);
        let done = false;
        let failed = null;
        if (o.enemyId != null && !(k.wars || []).includes(o.enemyId)) {
            c.order = null;
            c.nextOrderDay = day + _num(O.cadence, 6);
            Generalship._log(c, world, 'The war is over; the orders lapse.');
            return;
        }
        if (o.kind === 'defend') {
            const t = world.getTile(o.target.q, o.target.r);
            if (!t || !t.settlement || t.settlement.kingdom !== k.id) failed = `${o.target.name} has fallen to the enemy.`;
            else if (_dist(world, player, o.target) <= _num(O.defendRadius, 2)) o.progress++;
            if (!failed && o.progress >= o.need) done = true;
        } else if (o.kind === 'besiege') {
            const t = world.getTile(o.target.q, o.target.r);
            if (t && t.settlement && t.settlement.kingdom === k.id) done = true;
        } else if (o.kind === 'patrol') {
            for (const t of o.targets || []) if (!t.seen && player.q === t.q && player.r === t.r) { t.seen = true; o.progress++; }
            if (o.progress >= o.need) done = true;
        } else if (_num(o.progress) >= _num(o.need)) {
            done = true;
        }
        if (done) {
            c.record.ordersDone++;
            c.merit += _num((O.merit || {})[o.kind], 8);
            Generalship._favour(c, _num(O.doneFavour, 10));
            if (c.rival) c.rival.influence = Utils.clamp(c.rival.influence - 3, 0, 100);
            const want = _num((O.bonus || {})[o.kind]);
            const bonus = Math.max(0, Math.min(want, Math.floor(_num(k.treasury))));
            if (bonus > 0) {
                k.treasury = _r2(_num(k.treasury) - bonus);
                CrownBooks.note(k, 'army', bonus);
                player.gold = _r2(_num(player.gold) + bonus);
                Ledger.record(player, 'crownWages', bonus);
            }
            const text = `Orders carried out: ${o.text}${bonus ? ` The crown sends ${bonus}g.` : (want ? ' The crown is too poor to reward you.' : '')}`;
            Generalship._log(c, world, text);
            out.notices.push({ icon: '📜', title: 'Orders Carried Out', text, type: 'success' });
        } else if (failed || day > o.due) {
            c.record.ordersFailed++;
            Generalship._favour(c, failed ? _num(O.lostTownFavour, -20) : _num(O.failFavour, -14));
            if (c.rival) c.rival.influence = Utils.clamp(c.rival.influence + 5, 0, 100);
            const text = failed || `You did not carry out the crown's orders in time: ${o.text}`;
            Generalship._log(c, world, text);
            out.notices.push({ icon: '📜', title: 'Orders Failed', text: `${text} The crown's favour cools.`, type: 'warning' });
        } else {
            return;
        }
        c.order = null;
        c.nextOrderDay = day + _num(O.cadence, 6);
    },

    // ── The day ──────────────────────────────────────

    /** One day of the commission. Call from PlayerActions.endDay. → { notices } */
    processDay(player, world) {
        const out = { notices: [] };
        const c = Generalship.state(player);
        if (!c || !world || !Generalship.enabled()) return out;
        const day = _day(world);
        const k = _kingdom(world, c.kingdomId);
        // The commission belongs to the one who took it
        if (c.holder !== Generalship._who(player)) { Generalship._end(player, world, 'lapsed', out); return out; }
        if (!k || k.isAlive === false) { Generalship._end(player, world, 'fallen', out); return out; }
        if (Throne.ruledKingdom(player, world)) { Generalship._end(player, world, 'crowned', out); return out; }
        if (player.allegiance !== k.id) { Generalship._dismiss(player, world, out, 'You have broken your oath.'); return out; }

        const H = Generalship.config().host || {};
        const S = Generalship.config().supply || {};
        const M = Generalship.config().morale || {};
        const W = Generalship.config().wages || {};
        const LT = Generalship.config().lieutenants || {};

        // The host: the crown sends levies toward the rank's share; never more than the realm has
        const target = Generalship.targetMen(c, k);
        if (c.men < target) c.men += Math.ceil((target - c.men) * _num(H.reinforce, 0.1));
        if (c.men > target) c.men = target;
        c.men = Math.max(0, Math.min(c.men, Math.floor(_num(k.military))));

        // Wages: owed daily, paid weekly out of the treasury
        const rd = Generalship.rankDef(c);
        c.owed = _r2(_num(c.owed) + _num(rd.wage));
        if (day - _num(c.lastPaidDay) >= _num(W.cadence, 7)) {
            c.lastPaidDay = day;
            const paid = Math.max(0, Math.min(c.owed, Math.floor(_num(k.treasury))));
            if (paid > 0) {
                k.treasury = _r2(_num(k.treasury) - paid);
                CrownBooks.note(k, 'army', paid);
                player.gold = _r2(_num(player.gold) + paid);
                Ledger.record(player, 'crownWages', paid);
                c.record.wages = _r2(_num(c.record.wages) + paid);
                c.owed = _r2(c.owed - paid);
            }
            if (c.owed > _num(rd.wage) * _num(W.cadence, 7)) {
                c.morale = Utils.clamp(c.morale + _num(W.arrearsMorale, -2), 0, 100);
                for (const lt of c.lieutenants) lt.loyalty = Utils.clamp(lt.loyalty + _num(LT.arrearsLoyalty, -1), 0, 100);
                out.notices.push({ icon: '💰', title: 'Wages in Arrears', text: `The treasury of ${k.name} owes you ${Math.round(c.owed)}g. The officers grumble.`, type: 'warning' });
            }
        }

        // Supplies: eaten while the realm is at war or a siege is on; topped up from towns in reach
        const consuming = Generalship._consuming(c, world);
        c._atWar = consuming;
        if (consuming) {
            const need = Generalship.dailyNeed(c) * (c.siege ? _num(S.siegeMult, 1.5) : 1);
            if (Generalship.supplyDays(c) < _num(S.topUpDays, 10) / 2) {
                const t = Generalship._supplyTown(player, world, c);
                if (t) Generalship._supplyFrom(player, world, c, t.settlement);
            }
            if (_num(c.supplies) >= need) {
                c.supplies = _r2(c.supplies - need);
            } else {
                c.supplies = 0;
                c.morale = Utils.clamp(c.morale + _num(S.hungerMorale, -6), 0, 100);
                const gone = Math.ceil(c.men * _num(S.hungerDesert, 0.03));
                c.men -= gone;
                k.military = Math.max(0, _num(k.military) - gone);
                out.notices.push({ icon: '🍞', title: 'The Host Goes Hungry', text: `${gone} men desert for want of bread. Requisition grain from a town of ${k.name} in reach.`, type: 'warning' });
            }
        }

        // Morale drifts home; below the line the men slip away
        const hungry = consuming && c.supplies <= 0;
        if (!(hungry && c.morale < _num(M.base, 60))) c.morale = Utils.clamp(c.morale + (_num(M.base, 60) - c.morale) * _num(M.drift, 0.08), 0, 100);
        if (c.morale < _num(M.desertBelow, 25) && c.men > 0) {
            const gone = Math.ceil(c.men * _num(M.desertRate, 0.015));
            c.men -= gone;
            k.military = Math.max(0, _num(k.military) - gone);
        }

        if (c.siege) Generalship._siegeTick(player, world, c, out);

        // The realm's own battles, with the general at the front
        Generalship._tickFieldCommand(player, world, c, k, out);

        // The liege's wars that ended
        Generalship._tickWarEnds(player, world, c, k, out);

        // Orders
        if (c.order) Generalship._tickOrder(player, world, c, out);
        else if (day >= _num(c.nextOrderDay)) Generalship._issueOrder(player, world, c, out);

        // The court: the rival's whispers
        const C = Generalship.config().court || {};
        if (c.rival && day > 0 && (day - c.since) % _num(C.rivalCadence, 15) === 0 && day !== c.since) {
            const [lo, hi] = C.slander || [3, 8];
            const harm = Math.round(Utils.randInt(lo, hi) * c.rival.influence / 50);
            if (harm > 0) {
                Generalship._favour(c, -harm);
                out.notices.push({ icon: '🗣️', title: 'Whispers at Court', text: `${c.rival.name} speaks against you before ${k.ruler || 'the crown'}. Favour −${harm}.`, type: 'warning' });
            }
        }

        // Fear, promotion, demotion
        c.fear = Generalship.fear(player, world, c);
        const F = Generalship.config().fear || {};
        const FV = Generalship.config().favour || {};
        if (day % 7 === 0) {
            if (c.fear >= _num(F.recallAt, 70) && c.favour < _num(F.recallBelowFavour, 50) && Utils.random() < _num(F.recallChance, 0.12)) {
                Generalship._favour(c, _num(F.recallFavour, -10));
                if (c.rank > 0) Generalship._demote(player, world, c, out, `${k.ruler || 'The crown'} fears a general grown too strong.`);
                else { Generalship._dismiss(player, world, out, 'The crown fears you.'); return out; }
            } else {
                const next = Generalship.ranks()[c.rank + 1];
                if (next && c.merit >= _num(next.merit) && c.favour >= _num(next.minFavour)) Generalship._promote(player, world, c, out);
            }
        }
        if (c.favour < _num(FV.demoteBelow, 20)) {
            if (c.rank > 0) Generalship._demote(player, world, c, out, 'The crown has lost faith in you.');
            else if (c.favour < _num(FV.dismissBelow, 8)) { Generalship._dismiss(player, world, out, 'The crown has lost all faith in you.'); return out; }
        }
        return out;
    },

    _tickFieldCommand(player, world, c, k, out) {
        const R = Generalship.config().realmBattle || {};
        const FV = Generalship.config().favour || {};
        const B = Generalship.config().battle || {};
        // The realm's battles since yesterday (KingdomAI.simulateBattle logs them while we command)
        const fc = k.fieldCommand;
        if (fc && Array.isArray(fc.log) && fc.log.length) {
            let won = 0;
            let lost = 0;
            for (const e of fc.log) { if (e.won) won++; else lost++; }
            fc.log = [];
            c.record.realmWon += won;
            c.record.realmLost += lost;
            c.merit += won * _num(FV.realmMerit, 1);
            Generalship._favour(c, won * _num(FV.realmBattleWon, 1.5) + lost * _num(FV.realmBattleLost, -2));
            if (lost) c.morale = Utils.clamp(c.morale - 3 * lost, 0, 100);
            out.notices.push({ icon: won >= lost ? '🚩' : '⚔️', title: 'The Realm\'s Battles', text: `With you at the front, ${k.name}'s armies won ${won} and lost ${lost} battle${won + lost > 1 ? 's' : ''}.`, type: won >= lost ? 'success' : 'warning' });
        }
        const atFront = !c.siege && Generalship.enemies(world, k).some(e => Generalship.distanceTo(world, player, e) <= _num(B.frontRange, 3) + 2);
        if (!atFront || !(c.men > 0)) {
            if (k.fieldCommand) k.fieldCommand.mult = 1;
            return;
        }
        const share = c.men / Math.max(1, _num(k.military));
        const mult = Utils.clamp(1 + (Generalship.quality(player, c) - 1) * share * 2 + c.rank * _num(R.rankBonus, 0.02), _num(R.minMult, 0.85), _num(R.maxMult, 1.35));
        k.fieldCommand = { day: _day(world), mult: _r2(mult), by: 'player', log: (fc && fc.log) || [] };
    },

    _tickWarEnds(player, world, c, k, out) {
        const FV = Generalship.config().favour || {};
        for (const h of world.warHistory || []) {
            if (h.id <= _num(c.seenWar)) continue;
            if (h.a !== k.id && h.b !== k.id) continue;
            if (h.day < c.since) continue;
            const other = _kingdom(world, h.a === k.id ? h.b : h.a);
            if (h.victor === k.id) {
                Generalship._favour(c, _num(FV.warWon, 12));
                c.merit += _num(FV.warWonMerit, 10);
                out.notices.push({ icon: '🏆', title: 'The War Is Won', text: `${other ? other.name : 'The enemy'} sues ${k.name} for peace. The crown remembers who led its host.`, type: 'success' });
            } else if (h.victor) {
                Generalship._favour(c, _num(FV.warLost, -10));
                out.notices.push({ icon: '🏳️', title: 'The War Is Lost', text: `${k.name} buys peace from ${other ? other.name : 'the enemy'}. The court looks for someone to blame.`, type: 'warning' });
            }
        }
        c.seenWar = _num(world.warHistorySeq, c.seenWar);
    },

    // ── The panel's view ─────────────────────────────

    view(player, world) {
        const c = Generalship.state(player);
        if (!c) return { commission: null, past: player.commissionPast || [] };
        const k = _kingdom(world, c.kingdomId);
        const rd = Generalship.rankDef(c);
        const next = Generalship.ranks()[c.rank + 1] || null;
        const front = Generalship.frontEnemies(player, world).map(e => {
            const prep = Generalship.prepareBattle(player, world, 'field', { enemyId: e.id });
            return { id: e.id, name: e.name, force: prep.spec ? prep.spec.enemy.men : 0, odds: prep.spec ? prep.spec.odds : 0 };
        });
        const near = Generalship._enemyTownNear(player, world, c);
        return {
            commission: c, kingdom: k, rank: rd, next,
            quality: _r2(Generalship.quality(player, c)), power: Math.round(Generalship.power(player, c)),
            supplyDays: Math.floor(Generalship.supplyDays(c)), consuming: Generalship._consuming(c, world),
            enemies: Generalship.enemies(world, k), front, nearTown: near ? { q: near.q, r: near.r, name: near.s.name } : null,
            supplyTown: (Generalship._supplyTown(player, world, c) || {}).settlement || null,
            fear: Generalship.fear(player, world, c), coup: Generalship.coupOdds(player, world),
            mult: KingdomAI.fieldCommandMult(k, world),
            past: player.commissionPast || [],
        };
    },
};
