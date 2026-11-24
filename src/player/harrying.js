// ============================================
// HARRYING — the player's riders loose in the enemy's land
// ============================================
// At a village or town of a realm the player is at war with — personally
// (systems/realmWars.js) or as the ruler or a sworn man of a realm at war
// with it — and with soldiers at their back (data/harrying.json minStrength),
// the player may harry it (the deeds themselves and what they do to the town
// are systems/harrying.js):
//
//   torch      burn the village, or a town's outlying farmsteads (the men
//              carry off what food fits in the packs first)
//   fields     fire the standing crops, or the barns out of season
//   mill       burn the mill
//   herds      drive off the herds: to a place of the player's that can keep
//              them (systems/livestock.js), else butchered for the camp
//   scatter    drive the peasants off as refugees
//   slaughter  put them to the sword
//
// The first harrying of a day at a place meets the levy (PlayerMilitary.combat
// against a share of its defence: data/harrying.json resist); beaten off, the
// deed is not done. Every deed brands the player (systems/atrocities.js
// 'harry' — once a town a day — or 'slaughter': karma, cruelty and dread, the
// court's severity, the realm's regard, its lord's memory, the gossip, the
// town's memory, the chronicle) and provokes the realm (Harrying.provoke: a
// pursuit host after you, if its crown can pay for one).
//
// No coin is made: the food and beasts taken were the town's; the AP are the
// day's. Explicit params, randomness through Utils' seedable stream.

import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { PlayerInventory } from '../core/inventory.js';
import { NPCLords } from '../world/npcLords.js';
import { Seasons } from '../world/seasons.js';
import { Harrying } from '../systems/harrying.js';
import { Atrocities } from '../systems/atrocities.js';
import { RealmWars } from '../systems/realmWars.js';
import { Throne } from '../systems/throne.js';
import { Livestock } from '../systems/livestock.js';
import { PlayerMilitary } from './playerMilitary.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = (world) => _num(world && world.day);

const ROWS = {
    torch: { icon: '🔥' },
    fields: { icon: '🌾' },
    mill: { icon: '⚙️' },
    herds: { icon: '🐄' },
    scatter: { icon: '🏃' },
    slaughter: { icon: '⚔️' },
};

export const PlayerHarrying = {
    ROWS,

    /** The realm the player fights for: the one they rule, else their liege's. */
    ownRealm(player, world) {
        let k = null;
        try { k = Throne.ruledKingdom(player, world); } catch (e) { k = null; }
        if (!k && player && player.allegiance != null && world && typeof world.getKingdom === 'function') k = world.getKingdom(player.allegiance);
        return k && k.isAlive !== false ? k : null;
    },

    /** Is the player at war with the realm `kid` (their own war, or their realm's)? */
    atWar(player, world, kid) {
        if (!player || kid == null) return false;
        if (player.allegiance != null && player.allegiance === kid) return false;
        if (RealmWars.atWarWith(player, kid)) return true;
        const own = PlayerHarrying.ownRealm(player, world);
        return !!(own && own.id !== kid && Array.isArray(own.wars) && own.wars.includes(kid));
    },

    /** Why the player cannot harry this tile's town at all ('' when they can). */
    why(player, world, tile) {
        const s = tile && tile.settlement;
        if (!s) return 'There is no village or town here.';
        if (s.kingdom == null) return `${s.name} owes no realm: there is no war to wage on it.`;
        if ((s.colony && s.colony.isPlayerColony) || s.holding) return `${s.name} is yours.`;
        if (!PlayerHarrying.atWar(player, world, s.kingdom)) return `You are not at war with ${PlayerHarrying._realmName(world, s.kingdom)}.`;
        const min = _num(Harrying.config().minStrength, 30);
        if (PlayerMilitary.getArmyStrength(player) < min) return `You need soldiers to harry a countryside (strength ${min}+).`;
        return '';
    },

    _realmName(world, kid) {
        const k = world && typeof world.getKingdom === 'function' ? world.getKingdom(kid) : null;
        return k ? k.name : 'that realm';
    },

    /** Should the action list offer harrying here? (at war with the town's realm, with soldiers) */
    available(player, world, tile) {
        return Harrying.enabled() && !PlayerHarrying.why(player, world, tile);
    },

    /** The levy that turns out: a share of the town's defence (0 when it is too few to fight). */
    resistance(player, world, s) {
        const R = Harrying.config().resist;
        const h = s && s.harried;
        if (h && h.foughtDay === _day(world)) return 0;
        const n = Math.floor(PlayerMilitary.getSettlementDefense(s, world) * _num((R.share || {})[s.type || 'village'], 0.3));
        return n >= _num(R.min, 5) ? n : 0;
    },

    /** The deeds open here: [{ id, icon, name, desc, ap, ok, why }]. */
    options(player, world, tile) {
        const s = tile && tile.settlement;
        if (!s) return [];
        const C = Harrying.config();
        const A = C.acts;
        const base = PlayerHarrying.why(player, world, tile);
        const ap = _num(player && player.actionPoints);
        const town = s.type && s.type !== 'village';
        const pop = Math.round(_num(s.population));
        const pens = Harrying.pens(world, s);
        const head = Object.values(pens).reduce((a, b) => a + b, 0);
        const standing = ['Spring', 'Summer'].includes(PlayerHarrying._season(world));
        const desc = {
            torch: town
                ? `Burn the farmsteads and outlying houses of ${s.name}. Its people lose homes and stores; many take to the roads. Your men carry off what food fits in your packs first. Rebuilding takes the town a year or more, and timber.`
                : `Put ${s.name} to the torch. Most of its houses burn; the granary and stores with them; many of its people take to the roads. Your men carry off what food fits in your packs first.`,
            fields: standing
                ? `Fire the standing crops. This year's harvest is ruined (${Math.round(A.fields.share * 100)}% off its grain now, ${Math.round(A.fields.nextShare * 100)}% off the next reckoning): less bread at market, less tax and rent for its lord, hunger.`
                : `Nothing stands in the fields now: fire the barns and ricks instead. The winter's grain burns (${Math.round(A.fields.barns * 100)}% of the market's).`,
            mill: `Burn the mill. No flour will be ground until it is rebuilt (${_num((A.mill.days || {})[s.type || 'village'], 75)} days, then the millwrights want timber).`,
            herds: head
                ? `Drive off ${Math.floor(head * A.herds.share)} of the ${head} head in its pens. Home to a pasture or estate of yours that can keep them, else butchered for your camp. The pens fill back slowly.`
                : 'Drive off its herds.',
            scatter: `Drive the peasants off their land: about ${Math.floor(pop * A.scatter.share)} of its ${pop} people flee to the realm's other towns. Its fields go untended until they come home.`,
            slaughter: `Put about ${Math.floor(pop * A.slaughter.share)} of its people to the sword. The realm will never forget it, and every lord will hear.`,
        };
        const names = {
            torch: town ? `Burn the farmsteads of ${s.name}` : `Torch ${s.name}`,
            fields: standing ? 'Fire the standing crops' : 'Fire the barns and ricks',
            mill: 'Burn the mill',
            herds: 'Drive off the herds',
            scatter: 'Scatter the peasants',
            slaughter: 'Put the peasants to the sword',
        };
        return Harrying.ACTS.map(id => {
            const cost = _num(A[id].apCost, 2);
            const why = base || Harrying.blocked(world, s, id) || (ap < cost ? `Needs ${cost} AP (you have ${ap}).` : '');
            return { id, icon: ROWS[id].icon, name: names[id], desc: desc[id], ap: cost, ok: !why, why };
        });
    },

    _season(world) {
        return Seasons.seasonOf(_day(world));
    },

    /** Whole units of a good into the packs, as many as fit. → units taken. */
    _give(player, good, n) {
        if (!PlayerInventory.hasSlotFor(player, good)) return 0;
        const k = Math.min(Math.floor(_num(n)), Math.floor(_num(PlayerInventory.loadRoomFor(player, good), 0)));
        return k > 0 && PlayerInventory.addItem(player, good, k).success ? k : 0;
    },

    /**
     * Do the deed `id` to the town the player stands in.
     * → { success, message, resisted?, battle?, pursuit?, ...the deed's numbers } | { success: false, reason }
     */
    act(player, world, id) {
        const tile = world && typeof world.getTile === 'function' ? world.getTile(player.q, player.r) : null;
        const opt = PlayerHarrying.options(player, world, tile).find(o => o.id === id);
        if (!opt) return { success: false, reason: 'That cannot be done here.' };
        if (!opt.ok) return { success: false, reason: opt.why };
        const s = tile.settlement;
        const day = _day(world);
        const kid = s.kingdom;
        player.actionPoints = _num(player.actionPoints) - opt.ap;
        // The levy turns out against the first harrying of the day
        const levy = PlayerHarrying.resistance(player, world, s);
        let battle = null;
        if (levy > 0) {
            battle = PlayerMilitary.combat(player, levy, `the levy of ${s.name}`, {
                terrainId: tile.terrain && tile.terrain.id, world,
                enemyComposition: PlayerMilitary._getSettlementComposition(s, tile),
                lootTown: s, // (what the fallen carried comes out of the town's purse)
            });
            if (!battle.victory) {
                NPCLords.rememberRealm(world, kid, 'raid_failed', { note: s.name });
                Harrying.provoke(world, player, s);
                return { success: true, resisted: true, battle, message: Harrying.line('resisted', { town: s.name }) };
            }
        }
        Harrying.scar(s).foughtDay = day;
        const by = Atrocities._by(player);
        const opts = { by, kid: PlayerHarrying.ownRealm(player, world) ? PlayerHarrying.ownRealm(player, world).id : null, byPlayer: true };
        const branded = s.harried && s.harried.brandDay === day;
        let res;
        let message = '';
        if (id === 'torch') {
            res = Harrying.torch(world, s, { ...opts, carry: (g, n) => PlayerHarrying._give(player, g, n) });
            message = Harrying.line(s.type && s.type !== 'village' ? 'torchTown' : 'torch', { town: s.name, dead: res.dead, fled: res.fled });
            const got = Object.entries(res.carried).map(([g, n]) => `${n} ${g}`).join(', ');
            if (got) message += ` Into your packs: ${got}.`;
        } else if (id === 'fields') {
            res = Harrying.fields(world, s, opts);
            message = Harrying.line(res.standing ? 'fieldsStanding' : 'fieldsBarns', { town: s.name });
        } else if (id === 'mill') {
            res = Harrying.mill(world, s, opts);
            message = Harrying.line('mill', { town: s.name });
        } else if (id === 'herds') {
            let drove = null;
            res = Harrying.herds(world, s, { ...opts, receive: (taken) => { drove = PlayerHarrying._takeHerds(player, world, s, taken); } });
            drove = drove || { home: 0, butchered: 0, place: null, goods: {} };
            message = drove.home ? Harrying.line('herdsHome', { town: s.name, n: drove.home, place: drove.place }) : '';
            if (drove.butchered) {
                const goods = Object.entries(drove.goods).map(([g, n]) => `${n} ${g}`).join(', ');
                message += `${message ? ' ' : ''}${Harrying.line('herdsCamp', { town: s.name, n: drove.butchered })}${goods ? ` Into your packs: ${goods}.` : ' Your packs are full: the camp eats it.'}`;
            }
            res.drove = drove;
        } else if (id === 'scatter') {
            res = Harrying.scatter(world, s, opts);
            message = Harrying.line('scatter', { town: s.name, n: res.fled });
        } else if (id === 'slaughter') {
            res = Harrying.slaughter(world, s, opts);
            message = Harrying.line('slaughter', { town: s.name, n: res.killed });
        }
        // The name it leaves you: the slaughter always; the rest once a town a day
        if (id === 'slaughter') Atrocities._brand(player, world, 'slaughter', s, { kingdomId: kid, n: res.killed, everyRealm: true });
        else if (!branded) Atrocities._brand(player, world, 'harry', s, { kingdomId: kid });
        Harrying.scar(s).brandDay = day;
        // The realm answers
        const pursuit = Harrying.provoke(world, player, s);
        if (pursuit) message += ` ${Harrying.line('pursuit', { realm: PlayerHarrying._realmName(world, kid), host: pursuit.name, n: pursuit.strength, from: pursuit.from })}`;
        return { success: true, id, message, battle, pursuit, ...res };
    },

    /** Beasts driven off: home to a place of yours that can keep them (within a drover's reach), else butchered. */
    _takeHerds(player, world, s, taken) {
        const out = { home: 0, butchered: 0, place: null, goods: {} };
        const M = Livestock.config().market || {};
        const reach = _num(M.droveMax, 12);
        let places = [];
        try { places = Livestock.places(world, player).filter(p => Hex.distance(s.q, s.r, p.q, p.r) <= reach); } catch (e) { places = []; }
        for (const [sp, n0] of Object.entries(taken)) {
            let n = n0;
            const def = Livestock.species(sp);
            if (!def) continue;
            for (const pl of places) {
                if (n <= 0) break;
                const chk = Livestock.canKeep(world, player, pl, sp, 1);
                if (!chk.ok) continue;
                const k = Math.min(n, Math.max(1, _num(chk.room, 1)));
                const herd = Livestock.herd(player, pl.key, pl.place);
                herd.place = { ...pl.place };
                for (let i = 0; i < k; i++) {
                    const age = Math.round(_num(def.matureDays, 60) + Utils.random() * _num(def.lifespanDays, 1000) * 0.3);
                    Livestock._addHead(player, herd, sp, i === 0 && k >= 2 ? 'm' : 'f', age);
                }
                n -= k;
                out.home += k;
                out.place = out.place || pl.name;
            }
            // The rest butchered for the camp: meat and hides into the packs, what will not fit eaten on the march
            for (let i = 0; i < n; i++) {
                for (const g of Livestock._slaughterYield(def, { age: _num(def.matureDays, 60) * 2 }, Utils.random)) {
                    const added = PlayerHarrying._give(player, g.good, g.qty);
                    if (added > 0) out.goods[g.good] = (out.goods[g.good] || 0) + added;
                }
                out.butchered++;
            }
        }
        return out;
    },
};
