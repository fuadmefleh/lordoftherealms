// ============================================
// ROAD ENCOUNTERS — a hostile closes in: what do you do?
// ============================================
// When raiders, pirates, beasts, a legendary creature or a war host reach the
// player, the player chooses — with the odds shown — instead of the dice
// deciding alone:
//
//   FLEE      stealth, a horse, horse in the army, cover, the size of the
//             army, wounds and the foe's speed. Caught, the fight comes to
//             you (with an army, they fall on you from ambush).
//   TOLL      (men) pay a share of the purse to be let by — into the band's
//             own coffers. Certain, but it costs gold (and face with an army).
//   BAIT      (beasts) throw them food from your packs.
//   PARLEY    (men) talk them down or stare them down: diplomacy, charisma,
//             renown, Dread Lord / Brave / Champion, the army at your back.
//   FIRE      (beasts) drive them off with fire and noise; fuel in the packs
//             (firewood, wood, oil) helps.
//   HIDE      stealth and the ground (forest, hills, marsh); a big army
//             can't hide, beasts hunt by scent; never at sea.
//   FIGHT     with an army, a phased field battle (player/fieldBattle.js);
//             alone, a desperate fight at your own skill and strength.
//
// Each choice trains the matching skill and has real consequences (gold to
// the attacker's packs, Ledger entries, renown, deeds and traits). A band
// that let you go leaves you alone for a few days (unit.sparedUntilDay).
//
// ambush() is the old automatic resolution (robbed / mauled / one-shot
// battle), unchanged: the headless paths (the playtest harness, a closed
// dialog, a second encounter while one is pending) resolve with it, so the
// soak's dice are exactly what they were. resolve(..., 'fight', { auto:true })
// fights the field battle through with the default stances.
//
// Pure domain logic: explicit params, all randomness through Utils, no DOM.
// Tuning: data/military.json → encounters.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { PlayerMilitary } from './playerMilitary.js';
import { PlayerEffects } from './playerEffects.js';
import { FieldBattle } from './fieldBattle.js';
import { Ailments } from '../systems/ailments.js';
import { Bills } from '../systems/bills.js';
import { Traits } from '../systems/traits.js';
import { Quests } from '../systems/quests.js';
import { Ledger } from '../systems/ledger.js';
import { Difficulty } from '../core/difficulty.js';

const DEFAULTS = {
    minChance: 0.05,
    maxChance: 0.95,
    flee: { base: 0.4, stealth: 0.03, mount: 0.2, cavalry: 0.1, perUnit: 0.02, unitCap: 0.25, cover: 0.05, openGround: -0.05, woundMovement: 0.08, woundBattle: 0.3, speed: 0.03, craven: 0.05 },
    toll: { share: 0.25, armyShare: 0.08, armyRatioShare: 0.12, diplomacy: 0.01, min: 5, respiteDays: 7 },
    parley: { base: 0.12, diplomacy: 0.035, charisma: 0.01, renownPer: 400, renownCap: 0.15, dread: 0.15, brave: 0.05, champion: 0.08, craven: -0.1, armyRatio: 0.3, armyMin: -0.15, armyMax: 0.35, warHost: -0.15, respiteDays: 7 },
    hide: { base: 0.15, stealth: 0.05, forest: 0.25, hills: 0.15, marsh: 0.1, open: -0.1, perUnit: 0.04, unitCap: 0.4, mount: -0.03, scent: -0.1 },
    bait: { chance: 0.75, monsterChance: 0.35, stealth: 0.01, food: 3, monsterFood: 8, respiteDays: 5 },
    fire: { base: 0.3, combat: 0.03, fuel: 0.25, brave: 0.08, champion: 0.05, army: 0.25, monster: -0.25, respiteDays: 5 },
    duel: { combat: 5, strength: 1.5, base: 10, enemyMult: 3, enemyBase: 10, brave: 0.05, champion: 0.1, killBelow: 8, weaken: 0.7 },
    baitFoods: ['game_meat', 'cooked_meat', 'fish', 'cooked_fish', 'preserved_fish', 'bread', 'food', 'grain', 'fruit', 'berries', 'honey', 'crabs', 'mushrooms'],
    fuel: ['firewood', 'wood', 'lamp_oil', 'oil'],
    forest: ['woodland', 'boreal_forest', 'seasonal_forest', 'temperate_rainforest', 'tropical_rainforest', 'forest', 'jungle'],
    hills: ['hills', 'highlands', 'foothills', 'mountain', 'snow_peak'],
    marsh: ['swamp', 'marsh'],
    open: ['plains', 'grassland', 'steppe', 'savanna', 'desert', 'tundra', 'beach', 'snow', 'ice'],
};

function _merge(base, over) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
        if (k.startsWith('_')) continue;
        out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]))
            ? _merge(base[k], v) : v;
    }
    return out;
}

let _cfgCache = null;
let _cfgSource = null;

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** " You suffer a Deep Gash." — the wound a fight left you with, if any. */
function _woundText(wound) {
    return wound ? ` ${wound.icon} You suffer ${/^[aeiou]/i.test(wound.name) ? 'an' : 'a'} ${wound.name.toLowerCase()}.` : '';
}

function _train(player, skill, amount) {
    if (!player.skills) player.skills = {};
    player.skills[skill] = Math.min(10, _num(player.skills[skill], 1) + amount);
}

export const RoadEncounters = {
    DEFAULTS,

    /** Tuning: the defaults with data/military.json → encounters laid over them. */
    config() {
        const src = DataLoader.military && DataLoader.military.encounters;
        if (!_cfgCache || _cfgSource !== src) {
            _cfgCache = _merge(DEFAULTS, src || {});
            _cfgSource = src;
        }
        return _cfgCache;
    },

    /** 'beast' for creatures (beasts, legendary monsters), 'men' for the rest. */
    kindOf(attacker) {
        return attacker && (attacker.type === 'beast' || attacker.type === 'monster') ? 'beast' : 'men';
    },

    /** Has this unit agreed (or been made) to leave the player be? */
    isSparing(unit, day) {
        return !!unit && unit.sparedUntilDay != null && _num(day) < unit.sparedUntilDay;
    },

    /** The ground, the theatre and the two sides of an encounter. */
    situation(player, attacker, world) {
        const here = world && typeof world.getTile === 'function' && typeof player.q === 'number'
            ? world.getTile(player.q, player.r) : null;
        const theatre = PlayerMilitary.tileTheatre(here, player);
        const armyStrength = PlayerMilitary.getTheatreStrength(player, theatre);
        const units = (player.army || []).filter(u => PlayerMilitary._theatreParticipant(u, theatre)).length;
        return {
            kind: RoadEncounters.kindOf(attacker),
            theatre,
            terrainId: here?.terrain?.id || null,
            armyStrength,
            hasArmy: armyStrength > 0,
            units,
            comp: armyStrength > 0 ? PlayerMilitary.getArmyComposition(player) : { cavalry: 0, archer: 0, pikeman: 0 },
            enemyStrength: Math.max(1, _num(attacker.strength, 1)),
            monster: attacker.type === 'monster',
            warHost: attacker.type === 'war_host',
        };
    },

    _ground(terrainId) {
        const c = RoadEncounters.config();
        if (!terrainId) return null;
        for (const g of ['forest', 'hills', 'marsh', 'open']) if ((c[g] || []).includes(terrainId)) return g;
        return null;
    },

    _clampChance(v) {
        const c = RoadEncounters.config();
        return Math.max(c.minChance, Math.min(c.maxChance, v));
    },

    /** Your chance against them, re-weighed by the difficulty's enemyStrength (exact on Normal), then clamped. */
    _foeChance(player, v) {
        return RoadEncounters._clampChance(Difficulty.againstFoe(player, RoadEncounters._clampChance(v)));
    },

    _skill(player, id) {
        return _num(player.skills && player.skills[id], 1);
    },

    _countOf(player, ids) {
        const inv = player.inventory || {};
        return ids.reduce((n, id) => n + Math.max(0, _num(inv[id])), 0);
    },

    // ── The odds of each choice (deterministic; draw nothing) ─────────

    fleeChance(player, attacker, sit) {
        const f = RoadEncounters.config().flee;
        let c = f.base + RoadEncounters._skill(player, 'stealth') * f.stealth;
        if (player.mount) c += f.mount;
        if (sit.hasArmy) c += (sit.comp.cavalry || 0) * f.cavalry - Math.min(f.unitCap, sit.units * f.perUnit);
        const ground = RoadEncounters._ground(sit.terrainId);
        if (ground === 'forest' || ground === 'marsh') c += f.cover;
        if (ground === 'open') c += f.openGround;
        c -= Ailments.movementPenalty(player) * f.woundMovement;
        c -= (1 - Ailments.battleMultiplier(player)) * f.woundBattle;
        c -= (_num(attacker.speed, 5) - 5) * f.speed;
        if (Traits.has(player, 'craven')) c += f.craven;
        return RoadEncounters._foeChance(player, c);
    },

    tollAmount(player, sit) {
        const t = RoadEncounters.config().toll;
        let share = sit.hasArmy
            ? t.armyShare + t.armyRatioShare * Math.min(1.5, sit.enemyStrength / Math.max(1, sit.armyStrength))
            : t.share;
        share = Math.max(0.03, share - RoadEncounters._skill(player, 'diplomacy') * t.diplomacy);
        share *= Difficulty.mult(player, 'enemyStrength'); // a stronger band asks more (1 on Normal)
        return Math.max(t.min, Math.round(_num(player.gold) * share));
    },

    parleyChance(player, attacker, sit) {
        const p = RoadEncounters.config().parley;
        let c = p.base + RoadEncounters._skill(player, 'diplomacy') * p.diplomacy + _num(player.charisma, 5) * p.charisma
            + Math.min(p.renownCap, Math.max(0, _num(player.renown)) / p.renownPer);
        if (Traits.has(player, 'dread_lord')) c += p.dread;
        if (Traits.has(player, 'brave')) c += p.brave;
        if (Traits.has(player, 'champion')) c += p.champion;
        if (Traits.has(player, 'craven')) c += p.craven;
        if (sit.hasArmy) c += Math.max(p.armyMin, Math.min(p.armyMax, (sit.armyStrength / sit.enemyStrength - 0.5) * p.armyRatio));
        if (sit.warHost) c += p.warHost;
        return RoadEncounters._foeChance(player, c);
    },

    hideChance(player, attacker, sit) {
        const h = RoadEncounters.config().hide;
        let c = h.base + RoadEncounters._skill(player, 'stealth') * h.stealth;
        const ground = RoadEncounters._ground(sit.terrainId);
        if (ground && h[ground] != null) c += h[ground];
        if (sit.hasArmy) c -= Math.min(h.unitCap, sit.units * h.perUnit);
        if (player.mount) c += h.mount;
        if (sit.kind === 'beast') c += h.scent;
        return RoadEncounters._foeChance(player, c);
    },

    baitChance(player, attacker, sit) {
        const b = RoadEncounters.config().bait;
        return RoadEncounters._foeChance(player, (sit.monster ? b.monsterChance : b.chance) + RoadEncounters._skill(player, 'stealth') * b.stealth);
    },

    fireChance(player, attacker, sit) {
        const f = RoadEncounters.config().fire;
        let c = f.base + RoadEncounters._skill(player, 'combat') * f.combat;
        if (RoadEncounters._countOf(player, RoadEncounters.config().fuel) > 0) c += f.fuel;
        if (Traits.has(player, 'brave')) c += f.brave;
        if (Traits.has(player, 'champion')) c += f.champion;
        if (sit.hasArmy) c += f.army * Math.min(1, sit.armyStrength / sit.enemyStrength);
        if (sit.monster) c += f.monster;
        return RoadEncounters._foeChance(player, c);
    },

    /** Alone against them: your skill and strength against their numbers. */
    duelChance(player, attacker, sit) {
        const d = RoadEncounters.config().duel;
        const own = (RoadEncounters._skill(player, 'combat') * d.combat + _num(player.strength, 5) * d.strength + d.base)
            * PlayerEffects.ailmentBattleMultiplier(player);
        let c = own / (own + sit.enemyStrength * d.enemyMult + d.enemyBase);
        if (Traits.has(player, 'brave')) c += d.brave;
        if (Traits.has(player, 'champion')) c += d.champion;
        return RoadEncounters._foeChance(player, c);
    },

    /**
     * The choices, with odds, for the encounter dialog:
     * [{ id, icon, label, hint, chance, odds, can, reason, cost }]
     * (chance null = certain). Draws from Utils only to preview a battle,
     * and then on its own stream.
     */
    options(player, attacker, world) {
        const c = RoadEncounters.config();
        const sit = RoadEncounters.situation(player, attacker, world);
        const opt = (id, icon, label, hint, chance, extra = {}) => ({
            id, icon, label, hint, chance, odds: FieldBattle.oddsLabel(chance), can: true, reason: '', cost: '', ...extra,
        });
        const out = [];
        const fleeHint = [player.mount ? `on ${player.mount.name}` : 'on foot', sit.hasArmy ? `${sit.units} units to move` : null,
            Ailments.movementPenalty(player) > 0 || Ailments.battleMultiplier(player) < 1 ? 'your wounds slow you' : null].filter(Boolean).join(' · ');
        out.push(opt('flee', '🏃', 'Flee', `Stealth and speed (${fleeHint}). Caught, they fall on you.`, RoadEncounters.fleeChance(player, attacker, sit)));

        if (sit.kind === 'men') {
            const toll = RoadEncounters.tollAmount(player, sit);
            const can = !sit.warHost && _num(player.gold) >= toll;
            out.push(opt('toll', '💰', 'Pay the toll', sit.hasArmy ? 'Buy your way past rather than bleed for it. Costs face.' : 'Hand over part of your purse; they let you by unhurt.', null,
                { can, cost: `${toll} gold`, amount: toll, reason: sit.warHost ? 'A realm\'s army takes no tolls' : (can ? '' : `They want ${toll} gold`) }));
            const dread = Traits.has(player, 'dread_lord') || (sit.hasArmy && sit.armyStrength >= sit.enemyStrength * 1.5);
            out.push(opt('parley', dread ? '😠' : '🗣️', dread ? 'Intimidate' : 'Parley', dread ? 'Your name and your soldiers do the talking.' : 'Diplomacy, charisma and renown. Fail and they take offence.',
                RoadEncounters.parleyChance(player, attacker, sit)));
        } else {
            const need = sit.monster ? c.bait.monsterFood : c.bait.food;
            const have = RoadEncounters._countOf(player, c.baitFoods);
            out.push(opt('bait', '🍖', 'Throw them food', `Leave ${need} food behind and slip away while they feed.`, RoadEncounters.baitChance(player, attacker, sit),
                { can: have >= need, cost: `${need} food`, reason: have >= need ? '' : `Needs ${need} food (you have ${have})` }));
            const fuel = RoadEncounters._countOf(player, c.fuel) > 0;
            out.push(opt('fire', '🔥', 'Drive them off with fire', fuel ? 'Firebrands from your packs, and a lot of noise.' : 'Noise and a brand from the campfire (fuel in your packs would help).',
                RoadEncounters.fireChance(player, attacker, sit)));
        }

        const atSea = sit.theatre === 'sea';
        out.push(opt('hide', '🌲', 'Hide', `Lie low (${sit.terrainId ? sit.terrainId.replace(/_/g, ' ') : 'open ground'}${sit.kind === 'beast' ? ', they hunt by scent' : ''}).`,
            RoadEncounters.hideChance(player, attacker, sit), { can: !atSea, reason: atSea ? 'Nowhere to hide at sea' : '' }));

        if (sit.hasArmy) {
            const { enemy, ctx } = FieldBattle.unitEnemy(player, attacker, world);
            const est = FieldBattle.preview(player, enemy, world, { ...ctx, defending: true });
            out.push(opt('fight', '⚔️', 'Stand and fight', `A field battle in three phases — you choose the stance before each. ~${est ? Math.round(est.loss * 100) : '?'}% losses expected.`,
                est ? est.win : 0.5, { battle: true }));
        } else {
            out.push(opt('fight', '⚔️', 'Stand and fight', 'Alone, with your own blade. Win and they scatter; lose and they take what they like.',
                RoadEncounters.duelChance(player, attacker, sit)));
        }
        return out;
    },

    /** The default choice of a headless or abandoned encounter. */
    autoChoice() {
        return 'fight';
    },

    _spare(attacker, world, days) {
        attacker.targetQ = null;
        attacker.targetR = null;
        attacker.sparedUntilDay = _num(world && world.day) + days;
    },

    /** Caught after all: the old resolution, its money flows on the Ledger. */
    _caught(player, attacker, world, lead) {
        const out = RoadEncounters.ambush(player, attacker, world);
        if (out.goldStolen > 0) Ledger.record(player, 'robbery', -out.goldStolen);
        out.notification.body = `${lead} ${out.notification.body}`;
        return out;
    },

    /** Your army against theirs: a phased field battle (or fought through when auto). */
    _battle(player, attacker, world, opts, lead = '') {
        const { enemy, ctx } = FieldBattle.unitEnemy(player, attacker, world);
        const battle = FieldBattle.start(player, enemy, world, { ...ctx, defending: true, ambushed: !!opts.ambushed });
        if (battle.success === false) return RoadEncounters._caught(player, attacker, world, lead);
        battle.lead = lead;
        if (!opts.auto) return { kind: 'battle', battle, notification: null };
        const result = FieldBattle.auto(player, battle, world);
        return RoadEncounters.battleOutcome(player, attacker, world, result, lead);
    },

    /** A field battle from an encounter is over: wound roll and the report. */
    battleOutcome(player, attacker, world, result, lead = '') {
        const sea = result && result.theatre === 'sea';
        if (result.withdrew) {
            const body = `${lead}You broke off the fight with the ${attacker.name}${result.casualties ? `, losing ${result.casualties} soldiers to their pursuit` : ''}.`;
            return { kind: 'withdrew', result, notification: { title: '🏳️ Withdrawn', body: body.trim(), type: 'warning' } };
        }
        const wound = Ailments.afterBattle(player, world, !!result.victory, { sea });
        if (result.victory) {
            let msg = `${lead}Victory! You defeated the ${attacker.name}!`;
            if (result.casualties > 0) msg += ` Lost ${result.casualties} soldiers.`;
            if (result.wounded > 0) msg += ` ${result.wounded} wounded saved by surgeons.`;
            if (result.commanderSlain) msg += ' Your assassins slew their commander!';
            if (result.loot > 0) msg += ` Gained ${result.loot} gold.`;
            const items = Object.entries(result.inventoryLoot || {}).map(([k, v]) => `${v} ${k}`).join(', ');
            if (items) msg += ` Seized: ${items}.`;
            if (result.renownChange > 0) msg += ` +${result.renownChange} renown!`;
            msg += _woundText(wound);
            return { kind: 'victory', result, wound, notification: { title: '⚔️ Victory!', body: msg.trim(), type: 'success' } };
        }
        let msg = `${lead}Defeated by the ${attacker.name}!`;
        if (result.casualties > 0) msg += ` Lost ${result.casualties} soldiers.`;
        if (result.captured) {
            msg += ` You have been captured and forced into servitude for ${result.servitudeDays} days!`;
            if (result.goldConfiscated > 0) msg += ` ${result.goldConfiscated} gold confiscated.`;
        }
        msg += _woundText(wound);
        return { kind: 'defeat', result, wound, notification: { title: '💀 Defeat!', body: msg.trim(), type: 'error' } };
    },

    /**
     * Act on a choice. Mutates player / attacker / world. opts.auto fights a
     * battle through with the default stances; otherwise a battle comes back
     * as { kind:'battle', battle } for the caller to fight phase by phase.
     * Returns { kind, choice, success, notification, ... }.
     */
    resolve(player, attacker, world, choice, opts = {}) {
        const c = RoadEncounters.config();
        const sit = RoadEncounters.situation(player, attacker, world);
        const name = attacker.name || 'foe';
        const icon = attacker.icon || (sit.kind === 'beast' ? '🐺' : '⚔️');
        const roll = (chance) => Utils.random() < chance;
        const done = (kind, success, title, body, type, extra = {}) => ({ kind, choice, success, notification: { title, body, type }, ...extra });

        switch (choice) {
            case 'flee': {
                const ok = roll(RoadEncounters.fleeChance(player, attacker, sit));
                _train(player, 'stealth', ok ? 0.15 : 0.05);
                if (ok) {
                    // Running from a weaker foe at the head of an army is noticed
                    if (sit.hasArmy && sit.armyStrength > sit.enemyStrength) Traits.recordDeed(player, 'cowardice', 1);
                    RoadEncounters._spare(attacker, world, 1);
                    return done('escaped', true, '🏃 Escaped', `You slipped away from the ${name}${player.mount ? ` on ${player.mount.name}` : ''}.`, 'success');
                }
                if (sit.hasArmy) return { ...RoadEncounters._battle(player, attacker, world, { ...opts, ambushed: true }, `The ${name} ran you down. `), choice, success: false };
                return { ...RoadEncounters._caught(player, attacker, world, `The ${name} ran you down.`), choice, success: false };
            }
            case 'toll': {
                if (sit.kind !== 'men' || sit.warHost) return done('invalid', false, 'No Toll', 'They are not here for coin.', 'error');
                const toll = RoadEncounters.tollAmount(player, sit);
                if (_num(player.gold) < toll) return done('invalid', false, 'Purse Too Light', `They want ${toll} gold.`, 'error');
                player.gold -= toll;
                if (!attacker.inventory) attacker.inventory = {};
                attacker.inventory.gold = _num(attacker.inventory.gold) + toll;
                Ledger.record(player, 'banditTolls', -toll);
                _train(player, 'diplomacy', 0.05);
                // Paying off a band you could have beaten costs face
                if (sit.hasArmy) player.renown = Math.max(0, _num(player.renown) - (sit.armyStrength > sit.enemyStrength ? 2 : 1));
                RoadEncounters._spare(attacker, world, c.toll.respiteDays);
                if (world && world.events) world.events.push({ text: `${player.name || 'A traveller'} paid a ${name} ${toll} gold to pass.`, type: 'military' });
                return done('paid', true, `${icon} Toll Paid`, `You paid the ${name} ${toll} gold. They let you pass${sit.hasArmy ? ', smirking' : ''}.`, 'warning', { goldPaid: toll });
            }
            case 'parley': {
                if (sit.kind !== 'men') return done('invalid', false, 'No Parley', 'Beasts do not bargain.', 'error');
                const ok = roll(RoadEncounters.parleyChance(player, attacker, sit));
                const intimidate = Traits.has(player, 'dread_lord') || (sit.hasArmy && sit.armyStrength >= sit.enemyStrength * 1.5);
                _train(player, 'diplomacy', ok ? 0.2 : 0.05);
                if (ok) {
                    if (intimidate) {
                        Traits.recordDeed(player, 'dread', 1);
                        player.renown = _num(player.renown) + 1;
                    }
                    RoadEncounters._spare(attacker, world, c.parley.respiteDays);
                    return done('talked', true, intimidate ? '😠 They Back Down' : '🗣️ Parley', intimidate
                        ? `The ${name} took one look at you and thought better of it.${intimidate ? ' +1 renown.' : ''}`
                        : `Words, a joke and a show of empty hands: the ${name} let you go.`, 'success');
                }
                if (sit.hasArmy) return { ...RoadEncounters._battle(player, attacker, world, opts, `The ${name} would not hear it. `), choice, success: false };
                return { ...RoadEncounters._caught(player, attacker, world, `The ${name} laughed at your words.`), choice, success: false };
            }
            case 'bait': {
                if (sit.kind !== 'beast') return done('invalid', false, 'No', 'They want more than food.', 'error');
                const need = sit.monster ? c.bait.monsterFood : c.bait.food;
                if (RoadEncounters._countOf(player, c.baitFoods) < need) return done('invalid', false, 'Not Enough Food', `You need ${need} food to throw them.`, 'error');
                // The food is gone either way
                let left = need;
                for (const id of c.baitFoods) {
                    if (left <= 0) break;
                    const have = _num(player.inventory[id]);
                    if (have <= 0) continue;
                    const take = Math.min(have, left);
                    player.inventory[id] = have - take;
                    if (player.inventory[id] <= 0) delete player.inventory[id];
                    left -= take;
                }
                const ok = roll(RoadEncounters.baitChance(player, attacker, sit));
                _train(player, 'stealth', 0.05);
                if (ok) {
                    RoadEncounters._spare(attacker, world, c.bait.respiteDays);
                    return done('fed', true, `${icon} They Feed`, `You threw ${need} food to the ${name} and slipped away while they fed.`, 'success');
                }
                return { ...RoadEncounters._caught(player, attacker, world, `The ${name} wolfed the food down and came on.`), choice, success: false };
            }
            case 'fire': {
                if (sit.kind !== 'beast') return done('invalid', false, 'No', 'Fire will not frighten men.', 'error');
                const fuelId = c.fuel.find(id => _num((player.inventory || {})[id]) > 0);
                const chance = RoadEncounters.fireChance(player, attacker, sit);
                if (fuelId) {
                    player.inventory[fuelId] -= 1;
                    if (player.inventory[fuelId] <= 0) delete player.inventory[fuelId];
                }
                const ok = roll(chance);
                _train(player, 'combat', ok ? 0.1 : 0.05);
                if (ok) {
                    Traits.recordDeed(player, 'valor', 1);
                    player.renown = _num(player.renown) + 1;
                    RoadEncounters._spare(attacker, world, c.fire.respiteDays);
                    return done('driven_off', true, '🔥 Driven Off', `Firebrands and shouting: the ${name} fled into the dark. +1 renown.`, 'success');
                }
                if (sit.hasArmy) return { ...RoadEncounters._battle(player, attacker, world, opts, `The ${name} were not afraid of fire. `), choice, success: false };
                return { ...RoadEncounters._caught(player, attacker, world, `The ${name} were not afraid of fire.`), choice, success: false };
            }
            case 'hide': {
                if (sit.theatre === 'sea') return done('invalid', false, 'Nowhere to Hide', 'There is nowhere to hide at sea.', 'error');
                const ok = roll(RoadEncounters.hideChance(player, attacker, sit));
                _train(player, 'stealth', ok ? 0.2 : 0.05);
                if (ok) {
                    RoadEncounters._spare(attacker, world, 1);
                    return done('hidden', true, '🌲 Unseen', `You lay low and the ${name} passed you by.`, 'success');
                }
                if (sit.hasArmy) return { ...RoadEncounters._battle(player, attacker, world, { ...opts, ambushed: true }, `The ${name} found your hiding place. `), choice, success: false };
                return { ...RoadEncounters._caught(player, attacker, world, `The ${name} found your hiding place.`), choice, success: false };
            }
            case 'fight':
            default: {
                if (sit.hasArmy) return { ...RoadEncounters._battle(player, attacker, world, opts), choice: 'fight' };
                if (opts.legacy) return { ...RoadEncounters.ambush(player, attacker, world), choice: 'fight' };
                return { ...RoadEncounters._duel(player, attacker, world, sit), choice: 'fight' };
            }
        }
    },

    /** Alone against them. Win: they scatter (or fall); lose: the old ambush, and worse. */
    _duel(player, attacker, world, sit) {
        const d = RoadEncounters.config().duel;
        const name = attacker.name || 'foe';
        const ok = Utils.random() < RoadEncounters.duelChance(player, attacker, sit);
        _train(player, 'combat', ok ? 0.3 : 0.1);
        if (!ok) {
            const out = RoadEncounters._caught(player, attacker, world, `You stood alone against the ${name} and were beaten down.`);
            const extra = PlayerEffects.scaleDamage(player, Difficulty.foeHarm(player, Utils.randInt(3, 10)));
            player.health = Math.max(1, _num(player.health, 100) - extra);
            out.healthLost = _num(out.healthLost) + extra;
            out.success = false;
            return out;
        }
        const hurt = PlayerEffects.scaleDamage(player, Utils.randInt(3, 10));
        player.health = Math.max(1, _num(player.health, 100) - hurt);
        Traits.recordDeed(player, 'valor', 2);
        const renown = Math.floor(sit.enemyStrength / 5) + 1;
        player.renown = _num(player.renown) + renown;
        const weakened = Math.floor(sit.enemyStrength * d.weaken);
        let body;
        if (weakened < d.killBelow) {
            attacker.destroyed = true;
            attacker.slainByPlayer = true;
            const coin = _num(attacker.inventory && attacker.inventory.gold);
            if (coin > 0) {
                player.gold = _num(player.gold) + coin;
                attacker.inventory.gold = 0;
                Ledger.record(player, 'plunder', coin);
            }
            Quests.track(player, 'battles_won');
            body = `You fought the ${name} alone and cut them down to the last.${coin > 0 ? ` You take ${coin} gold from them.` : ''}`;
        } else {
            attacker.strength = weakened;
            RoadEncounters._spare(attacker, world, 3);
            body = `You fought the ${name} alone; bloodied, they scattered.`;
        }
        const wound = Ailments.maybeWound(player, world, sit.kind === 'beast' ? attacker.type : 'ambush');
        body += ` +${renown} renown. You lost ${hurt} health.${_woundText(wound)}`;
        if (world && world.events) world.events.push({ text: `${player.name || 'A traveller'} fought off a ${name} single-handed!`, type: 'military' });
        return { kind: 'duel_won', success: true, healthLost: hurt, wound, notification: { title: '⚔️ Single-handed!', body, type: 'success' } };
    },

    /**
     * The old automatic resolution of a hostile encounter — robbed, mauled or
     * a one-shot battle (ui/game/combat.logic.js resolveHostileEncounter).
     *
     * @returns {{kind:'robbed'|'victory'|'defeat',
     *            notification:{title:string, body:string, type:string},
     *            goldStolen?:number, healthLost?:number, stolenItems?:object,
     *            result?:object}}
     */
    ambush(player, attacker, world) {
        // Can anything of the player's fight here? Galleys can't defend you on
        // land; aboard ship your vessel and squadron can
        const here = world && typeof world.getTile === 'function' && typeof player.q === 'number'
            ? world.getTile(player.q, player.r) : null;
        const theatre = PlayerMilitary.tileTheatre(here, player);
        const playerArmySize = PlayerMilitary.getTheatreStrength(player, theatre) > 0 ? (player.army || []).length || 1 : 0;

        if (playerArmySize === 0 && (attacker.type === 'beast' || attacker.type === 'monster')) {
            // --- No army vs. a creature: mauled, nothing stolen ---
            // Armour and Divine Protection soften the blow
            const healthLost = PlayerEffects.scaleDamage(player, Difficulty.foeHarm(player, attacker.type === 'monster' ? Utils.randInt(25, 45) : Utils.randInt(8, 18)));
            player.health = Math.max(1, player.health - healthLost);
            // Sated, it goes its way for a day or two (not back at the throat every dawn)
            RoadEncounters._spare(attacker, world, 2);
            // Tooth and claw can leave a wound that lasts (systems/ailments.js)
            const wound = healthLost > 0 ? Ailments.maybeWound(player, world, attacker.type) : null;
            return {
                kind: 'robbed',
                goldStolen: 0,
                healthLost,
                stolenItems: {},
                wound,
                notification: {
                    title: `${attacker.icon || '🐺'} ${attacker.name} Attack!`,
                    body: `A ${attacker.name} fell on you! Without an army you barely escaped. You lost ${healthLost} health.${_woundText(wound)}`,
                    type: 'error',
                },
            };
        }

        if (playerArmySize === 0) {
            // --- No army: player is robbed / roughed up ---
            const goldStolen = Math.min(player.gold, Math.floor(player.gold * Utils.randFloat(0.15, 0.4) * Difficulty.mult(player, 'enemyStrength')));
            const healthLost = PlayerEffects.scaleDamage(player, Difficulty.foeHarm(player, Utils.randInt(5, 15)));

            player.gold -= goldStolen;
            player.health = Math.max(1, player.health - healthLost);

            // Steal random inventory items
            const stolenItems = {};
            if (player.inventory) {
                const itemKeys = Object.keys(player.inventory).filter(
                    (k) => k !== 'quest' && player.inventory[k] > 0
                );
                const itemsToSteal = Math.min(itemKeys.length, Utils.randInt(1, 3));
                for (let i = 0; i < itemsToSteal; i++) {
                    const key = Utils.randPick(itemKeys);
                    const qty = Math.min(
                        player.inventory[key],
                        Utils.randInt(1, Math.ceil(player.inventory[key] * 0.5))
                    );
                    if (qty > 0) {
                        player.inventory[key] -= qty;
                        stolenItems[key] = qty;
                        if (player.inventory[key] <= 0) delete player.inventory[key];
                    }
                }
            }

            // Bills of exchange go with the purse (systems/bills.js: stop them at the paying house)
            const billsTaken = Bills.onRobbed(player, world);

            // They have what they came for, and leave the player be for a while, as a
            // toll paid would: a band camped by a village otherwise robbed them every day
            RoadEncounters._spare(attacker, world, _num(RoadEncounters.config().toll.respiteDays, 7));

            // Transfer stolen goods to attacker
            attacker.inventory['gold'] = (attacker.inventory['gold'] || 0) + goldStolen;
            for (const [item, qty] of Object.entries(stolenItems)) {
                attacker.inventory[item] = (attacker.inventory[item] || 0) + qty;
            }

            // Build notification message
            let msg = `A ${attacker.name} ambushed you! Without an army you were defenseless.`;
            if (goldStolen > 0) msg += ` They stole ${goldStolen} gold.`;
            const stolenList = Object.entries(stolenItems)
                .map(([k, v]) => `${v} ${k}`)
                .join(', ');
            if (stolenList) msg += ` They also took: ${stolenList}.`;
            if (billsTaken.length) msg += ` They took ${billsTaken.length === 1 ? 'a bill of exchange' : `${billsTaken.length} bills of exchange`} (${billsTaken.reduce((a, b) => a + b.amount, 0)}g): stop ${billsTaken.length === 1 ? 'it' : 'them'} at the paying house before a forger cashes ${billsTaken.length === 1 ? 'it' : 'them'}.`;
            msg += ` You lost ${healthLost} health.`;
            const wound = healthLost > 0 ? Ailments.maybeWound(player, world, 'ambush') : null;
            msg += _woundText(wound);

            if (world && world.events) {
                world.events.push({
                    text: `${player.name || 'A traveller'} was robbed by a ${attacker.name}!`,
                    type: 'military',
                });
            }

            // The raider moves on after robbing (pick new target)
            attacker.targetQ = null;
            attacker.targetR = null;

            return {
                kind: 'robbed',
                goldStolen,
                healthLost,
                stolenItems,
                wound,
                notification: { title: `⚔️ ${attacker.name} Attack!`, body: msg, type: 'error' },
            };
        }

        // --- Player has army: full combat ---
        const result = PlayerMilitary.attackUnit(player, attacker, world, { defending: true });

        if (result.victory) {
            let lootMsg = `Victory! You defeated the ${attacker.name}!`;
            if (result.casualties > 0) lootMsg += ` Lost ${result.casualties} soldiers.`;
            if (result.wounded > 0) lootMsg += ` ${result.wounded} wounded saved by surgeons.`;
            if (result.commanderSlain) lootMsg += ` Your assassins slew their commander!`;
            if (result.loot > 0) lootMsg += ` Gained ${result.loot} gold.`;
            const itemLoot = Object.entries(result.inventoryLoot || {})
                .map(([k, v]) => `${v} ${k}`)
                .join(', ');
            if (itemLoot) lootMsg += ` Seized: ${itemLoot}.`;
            if (result.lootLeftBehind && Object.keys(result.lootLeftBehind).length > 0) {
                lootMsg += ` Packs full — left behind: ${Object.entries(result.lootLeftBehind).map(([k, v]) => `${v} ${k}`).join(', ')}.`;
            }
            if (result.renownChange > 0) lootMsg += ` +${result.renownChange} renown!`;
            // You fought in the line yourself (systems/ailments.js)
            const wound = result.noArmy ? null : Ailments.afterBattle(player, world, true, { sea: theatre === 'sea' });
            lootMsg += _woundText(wound);

            return { kind: 'victory', result, wound, notification: { title: `⚔️ Victory!`, body: lootMsg, type: 'success' } };
        }

        let defeatMsg = `Defeated by the ${attacker.name}!`;
        if (result.casualties > 0) defeatMsg += ` Lost ${result.casualties} soldiers.`;
        if (result.captured) {
            defeatMsg += ` You have been captured and forced into servitude for ${result.servitudeDays} days!`;
            if (result.goldConfiscated > 0) defeatMsg += ` ${result.goldConfiscated} gold confiscated.`;
        }
        const wound = result.noArmy ? null : Ailments.afterBattle(player, world, false, { sea: theatre === 'sea' });
        defeatMsg += _woundText(wound);
        return { kind: 'defeat', result, wound, notification: { title: `💀 Defeat!`, body: defeatMsg, type: 'error' } };
    },
};
