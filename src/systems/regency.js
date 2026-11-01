// ============================================
// REGENCY — the reign of a child, and the one who rules in their name
// ============================================
// When the heir who takes up the mantle is under age, the reign begins under
// a regent (Relationships.succeedAsHeir with opts.regency — the existing
// fragmentation of House.processSuccession still applies). The player plays
// the child's court: the child keeps their real age and grows up on the
// throne; the regent governs in their name until majority.
//
//   The regent: the late ruler's spouse (the heir's parent), a grown sibling,
//   or a lord of the regency council. Each has loyalty and ambition (0–100),
//   drifting every week toward what the House can command (Prestige, favours
//   given). A disloyal regent skims the treasury (Ledger 'regency'); a
//   disloyal and ambitious one plots — rumours first, then a coup that
//   strips the House's office and coin.
//   The child's court can: gift the regent (gold), honour them (Prestige),
//   replace them with a council lord (cheap if a plot is exposed), or assert
//   majority up to two years early (Prestige).
//   Limits: no war declared, no siege laid while a regent rules
//   (Regency.forbids — Councils.declareWar, Sieges.invest); the company
//   fights under the regent's captains unless one of the blood commands it
//   (HeirAgency.commandMultiplier).
//   Majority: a coming-of-age event and a choice — keep the regent's men,
//   purge them, or reward them — answered in the Dynasty panel (defaults to
//   keep after a fortnight).
//
// State: player.regency (saved by SaveLoad). Weekly drift draws from its own
// seeded stream (world seed + day), never the shared one. Content:
// data/upbringing.json → regency. No import-time side effects.

import { Utils } from '../core/utils.js';
import { DataLoader } from '../core/dataLoader.js';
import { House } from './house.js';
import { Ledger } from './ledger.js';
import { Relationships } from './relationships.js';
import { Upbringing } from './upbringing.js';

const DEFAULTS = {
    majorityAge: 16, earlyMajorityYears: 2, earlyMajorityPrestige: 12,
    cadence: 7, baseLoyalty: { spouse: 72, sibling: 58, council: 55 }, baseAmbition: { spouse: 25, sibling: 55, council: 40 },
    ambitionSpread: 30, drift: 3, prestigeLoyalty: 0.05, favourDecayDays: 60,
    embezzleBelow: 45, embezzleRate: 0.03, embezzleMax: 120,
    plotBelow: 25, plotAmbition: 50, plotRumourAt: 50, coupGoldShare: 0.25, coupPrestige: 10,
    giftGold: 100, giftLoyalty: 8, honourPrestige: 8, honourLoyalty: 12, honourAmbition: -5,
    replacePrestige: 15, replaceExposedPrestige: 5, exposedRecovery: 0.5,
    endingDays: 14, keepDiplomacy: 1, keepRenown: 10, keepLoyalSkill: 50,
    purgeRecovery: 0.5, purgePrestige: -5, purgePlotterPrestige: 6,
    rewardGold: 200, rewardPrestige: 6, rewardRoleLoyalty: 10,
    councilNames: ['Lord Aubrey Tench', 'Lady Isolde Marrow', 'Lord Cedric Vane'],
    forbidden: ['war', 'siege'],
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _day = (world) => _num(world && world.day);

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

function _hash01(key) {
    return ((Utils.hashStr(String(key)) >>> 0) % 10000) / 10000;
}

const KIND_LABEL = { spouse: 'the late ruler\'s widow(er)', sibling: 'an elder sibling', council: 'a lord of the regency council' };

export const Regency = {
    config() {
        const d = _obj(DataLoader.upbringing && DataLoader.upbringing.regency) || {};
        return {
            ...DEFAULTS, ...d,
            baseLoyalty: { ...DEFAULTS.baseLoyalty, ...(_obj(d.baseLoyalty) || {}) },
            baseAmbition: { ...DEFAULTS.baseAmbition, ...(_obj(d.baseAmbition) || {}) },
        };
    },

    /** Is a regent ruling in the player's name? */
    active(player) {
        return !!(player && player.regency && player.regency.active);
    },

    /** A coming-of-age choice waiting? */
    endingPending(player) {
        return !!(player && player.regency && player.regency.ending);
    },

    /** Why an action is closed to a child ruler, or null. action: 'war' | 'siege' | … */
    forbids(player, action) {
        if (!Regency.active(player)) return null;
        if (!(Regency.config().forbidden || []).includes(action)) return null;
        const r = player.regency.regent || {};
        const what = action === 'siege' ? 'lay a siege' : 'declare war';
        return `You are not of age: ${r.name || 'the regent'} will not let a child ${what}. Wait for your majority, or assert it.`;
    },

    // ──────────── THE CHOICE OF REGENT ────────────

    /** A regent's ambition: their kind, their traits, and a little of their own (hash of who). */
    _ambition(kind, id, traits) {
        const cfg = Regency.config();
        let a = _num(cfg.baseAmbition[kind], 40) + Math.round((_hash01(`regent:${kind}:${id}`) - 0.5) * cfg.ambitionSpread);
        const has = (t) => (traits || []).some(x => (x && x.id ? x.id : x) === t);
        if (has('ambitious') || has('greedy')) a += 20;
        if (has('loyal') || has('content') || has('honest') || has('honorable')) a -= 15;
        return Utils.clamp(Math.round(a), 0, 100);
    },

    /**
     * Who could rule in the heir's name, from the dying ruler's household
     * (call before the succession clears it): the spouse, grown siblings at
     * home, a council lord. [{ kind, id, name, loyalty, ambition, blurb }].
     */
    candidates(player, world, heirId) {
        const cfg = Regency.config();
        const out = [];
        const house = player && player.house;
        if (player && player.spouse) {
            const sp = Relationships.getNPC(player.spouse);
            if (sp && sp.isAlive !== false) {
                out.push({
                    kind: 'spouse', id: sp.id, name: `${sp.firstName}${sp.dynasty ? ` ${sp.dynasty}` : ''}`,
                    loyalty: cfg.baseLoyalty.spouse, ambition: Regency._ambition('spouse', sp.id, sp.traits),
                });
            }
        }
        for (const c of (player && player.children) || []) {
            if (!c || c.id === heirId || c.isAlive === false) continue;
            const up = Upbringing.ensure(c);
            if (!up.comeOfAge || Upbringing.isAway(c) || up.heldBy) continue;
            const roleLoyalty = house && house.roleLoyalty && Number.isFinite(house.roleLoyalty[c.id]) ? house.roleLoyalty[c.id] : null;
            const traits = [...(c.traits || []), ...(up.adultTraits || [])];
            out.push({
                kind: 'sibling', id: c.id, name: `${c.firstName}${c.dynasty ? ` ${c.dynasty}` : ''}`,
                loyalty: roleLoyalty != null ? Math.round((roleLoyalty + cfg.baseLoyalty.sibling) / 2) : cfg.baseLoyalty.sibling,
                ambition: Regency._ambition('sibling', c.id, traits),
            });
        }
        const names = Array.isArray(cfg.councilNames) && cfg.councilNames.length ? cfg.councilNames : DEFAULTS.councilNames;
        const name = names[(Utils.hashStr(`${_seed(world)}|council|${_day(world)}|${heirId}`) >>> 0) % names.length];
        out.push({ kind: 'council', id: `council:${name}`, name, loyalty: cfg.baseLoyalty.council, ambition: Regency._ambition('council', name, []) });
        for (const c of out) c.blurb = KIND_LABEL[c.kind] || c.kind;
        return out;
    },

    /** The regent picked by kind/id (or the first candidate). */
    pick(player, world, heirId, choice = null) {
        const list = Regency.candidates(player, world, heirId);
        if (!list.length) return null;
        if (choice) {
            const id = typeof choice === 'string' ? choice : choice.id;
            const hit = list.find(c => c.id === id) || (choice.kind ? list.find(c => c.kind === choice.kind) : null);
            if (hit) return hit;
        }
        return list[0];
    },

    // ──────────── THE REGENCY ────────────

    /**
     * Begin the regency (Relationships.succeedAsHeir, after the heir took
     * over). `regent` comes from pick(). Returns player.regency.
     */
    begin(player, world, regent) {
        if (!player) return null;
        const cfg = Regency.config();
        const day = _day(world);
        const r = regent || { kind: 'council', id: 'council', name: 'the regency council', loyalty: cfg.baseLoyalty.council, ambition: cfg.baseAmbition.council };
        player.regency = {
            active: true, since: day, startAge: _num(player.age), majorityAge: cfg.majorityAge,
            regent: { kind: r.kind, id: r.id, name: r.name, loyalty: Math.round(r.loyalty), ambition: Math.round(r.ambition) },
            favour: 0, embezzled: 0, skimMonth: 0, plot: 0, rumoured: false, coups: 0, regents: 1,
            ending: null, done: false,
        };
        if (player.house) {
            House._chronicle(player.house, world, `${r.name}, ${KIND_LABEL[r.kind] || 'regent'}, rules as regent for the young ${player.firstName || player.name}, aged ${player.age}.`, ['regency', 'heirs']);
        }
        return player.regency;
    },

    /** The regent's weekly drift: where their loyalty settles. */
    loyaltyTarget(player) {
        const cfg = Regency.config();
        const st = player.regency;
        const r = st.regent;
        const prestige = _num(player.house && player.house.prestige);
        return Utils.clamp(_num(cfg.baseLoyalty[r.kind], 55) + prestige * cfg.prestigeLoyalty - (_num(r.ambition) - 40) * 0.3 + _num(st.favour), 0, 100);
    },

    /**
     * One day of the regency. Weekly: loyalty drifts, a disloyal regent skims,
     * an ambitious one plots. At majority the regency ends. Draws only from
     * its own seeded stream. Returns { notices: [{ icon, title, text, type }] }.
     */
    processDay(player, world) {
        const out = { notices: [] };
        const st = player && player.regency;
        if (!st || !world) return out;
        const cfg = Regency.config();
        const day = _day(world);
        if (st.ending) {
            if (day >= _num(st.ending.due)) {
                const res = Regency.resolveEnding(player, world, 'keep', { lapsed: true });
                if (res.success) out.notices.push({ icon: '👑', title: 'The Regent\'s Men Stay', text: res.text, type: 'info' });
            }
            return out;
        }
        if (!st.active) return out;

        // The regent dies or is gone: the council takes the reins
        if (!Regency._regentAlive(player, st.regent)) {
            const old = st.regent.name;
            Regency._council(player, world, st);
            out.notices.push({ icon: '🕯️', title: 'A New Regent', text: `${old} can rule no longer; ${st.regent.name} of the regency council takes up the regency.`, type: 'warning' });
        }

        if (_num(player.age) >= _num(st.majorityAge, cfg.majorityAge)) {
            const res = Regency.endRegency(player, world, 'majority');
            out.notices.push({ icon: '👑', title: 'You Come of Age', text: res.text, type: 'success' });
            return out;
        }

        const cad = Math.max(1, cfg.cadence);
        if (day <= _num(st.since) || (day - _num(st.since)) % cad !== 0) return out;
        const rng = Utils.seededRandom(((Utils.hashStr(`${_seed(world)}|regency|${day}`) >>> 0) % 233279) + 1);
        Utils.withRng(rng, () => Regency._week(player, world, st, out));
        return out;
    },

    _regentAlive(player, r) {
        if (!r) return false;
        if (r.kind === 'spouse') {
            const npc = Relationships.getNPC(r.id);
            return !npc || npc.isAlive !== false;
        }
        if (r.kind === 'sibling') {
            const c = ((player && player.children) || []).find(x => x && x.id === r.id);
            return !!(c && c.isAlive !== false);
        }
        return true;
    },

    _council(player, world, st) {
        const cfg = Regency.config();
        const names = Array.isArray(cfg.councilNames) && cfg.councilNames.length ? cfg.councilNames : DEFAULTS.councilNames;
        const name = names[(Utils.hashStr(`${_seed(world)}|council|${_day(world)}|${st.regents}`) >>> 0) % names.length];
        st.regent = { kind: 'council', id: `council:${name}`, name, loyalty: cfg.baseLoyalty.council, ambition: Regency._ambition('council', `${name}:${st.regents}`, []) };
        st.regents = _num(st.regents, 1) + 1;
        st.plot = 0;
        st.rumoured = false;
        st.favour = 0;
        if (player.house) House._chronicle(player.house, world, `${name} of the regency council becomes regent.`, ['regency', 'heirs']);
    },

    _week(player, world, st, out) {
        const cfg = Regency.config();
        const r = st.regent;
        const day = _day(world);
        // Loyalty settles toward what the House can command; favours fade
        const target = Regency.loyaltyTarget(player);
        const diff = target - r.loyalty;
        const step = Math.sign(diff) * Math.min(Math.abs(diff), cfg.drift) + Utils.randInt(-1, 1);
        r.loyalty = Utils.clamp(Math.round(r.loyalty + step), 0, 100);
        if (st.favour > 0) st.favour = Math.max(0, st.favour - cfg.cadence * (10 / Math.max(1, cfg.favourDecayDays)));

        // A disloyal regent's hand in the coffers
        if (r.loyalty < cfg.embezzleBelow && _num(player.gold) > 0) {
            const share = cfg.embezzleRate * (cfg.embezzleBelow - r.loyalty) / cfg.embezzleBelow;
            const amt = Math.min(cfg.embezzleMax, Math.floor(_num(player.gold) * share));
            if (amt > 0) {
                player.gold -= amt;
                Ledger.record(player, 'regency', -amt);
                st.embezzled += amt;
                st.skimMonth += amt;
            }
        }
        if (st.skimMonth > 0 && day % 30 < cfg.cadence) {
            out.notices.push({ icon: '🧾', title: 'The Accounts Are Short', text: `Your steward finds ${st.skimMonth} gold missing from the treasury this month. ${r.name}'s people keep the books.`, type: 'warning' });
            st.skimMonth = 0;
        }

        // A disloyal and ambitious regent plots
        if (r.loyalty < cfg.plotBelow && r.ambition >= cfg.plotAmbition) {
            st.plot = Math.min(100, st.plot + Math.round(r.ambition / 10) + Utils.randInt(0, 3));
            if (!st.rumoured && st.plot >= cfg.plotRumourAt) {
                st.rumoured = true;
                out.notices.push({ icon: '🕵️', title: 'Whispers of a Plot', text: `It is whispered that ${r.name} means to rule in more than name. Win them back — or replace them while the plot can still be exposed.`, type: 'warning' });
            }
            if (st.plot >= 100) Regency._coup(player, world, st, out);
        } else if (st.plot > 0 && r.loyalty >= cfg.embezzleBelow) {
            st.plot = Math.max(0, st.plot - 5);
        }
    },

    _coup(player, world, st, out) {
        const cfg = Regency.config();
        const r = st.regent;
        const day = _day(world);
        const gold = Math.floor(_num(player.gold) * cfg.coupGoldShare);
        if (gold > 0) {
            player.gold -= gold;
            Ledger.record(player, 'regency', -gold);
        }
        const lost = House._fragmentHoldings(player, 1);
        if (player.house) {
            const amt = Math.min(cfg.coupPrestige, Math.max(0, _num(player.house.prestige)));
            if (amt > 0) House.spend(player.house, amt, `${r.name}'s coup`, day);
            House._chronicle(player.house, world, `${r.name} seizes power in the young ruler's name, carrying off ${gold} gold${lost.some(l => l.type === 'title') ? ' and the House\'s office' : ''}.`, ['regency', 'betrayal']);
        }
        st.coups++;
        st.plot = 0;
        st.rumoured = false;
        r.loyalty = 40;
        out.notices.push({ icon: '🗡️', title: 'The Regent\'s Coup', text: `${r.name} has seized the treasury and the seals: ${gold} gold gone${lost.some(l => l.type === 'title') ? ', and your office lost' : ''}. Replace them, or bend them back to you.`, type: 'error' });
    },

    // ──────────── THE CHILD'S COURT ────────────

    /** Win the regent's goodwill: how = 'gift' (gold) | 'honour' (Prestige). */
    favour(player, world, how) {
        const cfg = Regency.config();
        const st = player && player.regency;
        if (!Regency.active(player)) return { success: false, reason: 'No regent rules in your name.' };
        const r = st.regent;
        const day = _day(world);
        if (how === 'gift') {
            if (_num(player.gold) < cfg.giftGold) return { success: false, reason: `A fitting gift is ${cfg.giftGold} gold.` };
            player.gold -= cfg.giftGold;
            Ledger.record(player, 'regency', -cfg.giftGold);
            r.loyalty = Utils.clamp(r.loyalty + cfg.giftLoyalty, 0, 100);
            st.favour = Math.min(30, _num(st.favour) + 4);
            return { success: true, text: `${r.name} accepts your gift graciously (+${cfg.giftLoyalty} loyalty).` };
        }
        if (how === 'honour') {
            if (!player.house || !House.spend(player.house, cfg.honourPrestige, `honours for ${r.name}`, day)) return { success: false, reason: `Honours cost ${cfg.honourPrestige} Prestige.` };
            r.loyalty = Utils.clamp(r.loyalty + cfg.honourLoyalty, 0, 100);
            r.ambition = Utils.clamp(r.ambition + cfg.honourAmbition, 0, 100);
            st.favour = Math.min(30, _num(st.favour) + 6);
            return { success: true, text: `You name ${r.name} first of your council before the court (+${cfg.honourLoyalty} loyalty).` };
        }
        return { success: false, reason: 'Unknown favour.' };
    },

    /** Put the regent aside for a council lord. Cheap if their plot is exposed. */
    replace(player, world) {
        const cfg = Regency.config();
        const st = player && player.regency;
        if (!Regency.active(player)) return { success: false, reason: 'No regent rules in your name.' };
        const r = st.regent;
        const day = _day(world);
        const exposed = !!st.rumoured || st.coups > 0;
        const cost = exposed ? cfg.replaceExposedPrestige : cfg.replacePrestige;
        if (cost > 0) {
            if (_num(player.house && player.house.prestige) < cost) return { success: false, reason: `Putting a regent aside costs ${cost} Prestige.` };
            House.spend(player.house, cost, `${r.name} put aside`, day);
        }
        let recovered = 0;
        if (exposed && st.embezzled > 0) {
            recovered = Math.floor(st.embezzled * cfg.exposedRecovery);
            player.gold = _num(player.gold) + recovered;
            Ledger.record(player, 'regency', recovered);
            st.embezzled -= recovered;
        }
        // A sibling put aside without cause nurses a claim (House._disputeChance)
        if (r.kind === 'sibling' && !exposed && player.house) player.house._pendingClaim = true;
        if (player.house) House._chronicle(player.house, world, `${r.name} is put aside as regent${exposed ? ', their plot exposed' : ''}.`, ['regency', 'heirs']);
        Regency._council(player, world, st);
        return { success: true, text: `${r.name} is put aside${exposed ? `; the plot exposed, ${recovered} gold is recovered` : ''}. ${st.regent.name} becomes regent.`, recovered, cost };
    },

    /** Take the reins early (within earlyMajorityYears of majority), for Prestige. */
    assertMajority(player, world) {
        const cfg = Regency.config();
        const st = player && player.regency;
        if (!Regency.active(player)) return { success: false, reason: 'No regent rules in your name.' };
        const need = _num(st.majorityAge, cfg.majorityAge) - cfg.earlyMajorityYears;
        if (_num(player.age) < need) return { success: false, reason: `You may assert your majority from age ${need}.` };
        if (!player.house || !House.spend(player.house, cfg.earlyMajorityPrestige, 'majority asserted', _day(world))) {
            return { success: false, reason: `Asserting your majority costs ${cfg.earlyMajorityPrestige} Prestige.` };
        }
        return Regency.endRegency(player, world, 'asserted');
    },

    /** The regency ends; the coming-of-age choice waits (resolveEnding). */
    endRegency(player, world, how = 'majority') {
        const cfg = Regency.config();
        const st = player.regency;
        const day = _day(world);
        st.active = false;
        st.ending = { day, due: day + cfg.endingDays, how };
        const name = player.firstName || player.name;
        const text = how === 'asserted'
            ? `${name} takes the reins at ${player.age}, before their time; ${st.regent.name}'s regency ends.`
            : `${name} comes of age at ${player.age}, and ${st.regent.name}'s regency ends.`;
        if (player.house) House._chronicle(player.house, world, text, ['regency', 'heirs']);
        return { success: true, text: `${text} Decide what becomes of the regent's men (Dynasty panel).` };
    },

    /** The choices at majority, with what each will do. */
    endingChoices(player) {
        const cfg = Regency.config();
        const st = player && player.regency;
        if (!st || !st.ending) return [];
        const r = st.regent;
        const loyal = r.loyalty >= cfg.keepLoyalSkill;
        const plotted = st.rumoured || st.coups > 0;
        return [
            { id: 'keep', label: 'Keep the regent\'s men', blurb: loyal ? `Steady hands: +${cfg.keepDiplomacy} diplomacy, +${cfg.keepRenown} renown.` : 'They stay — and their hands stay in the coffers a while longer.' },
            { id: 'purge', label: 'Purge them', blurb: `Recover ${Math.floor(st.embezzled * cfg.purgeRecovery)} of ${st.embezzled} gold skimmed; ${plotted ? `+${cfg.purgePlotterPrestige}` : cfg.purgePrestige} Prestige${r.kind === 'sibling' ? '; a sibling purged nurses a claim' : ''}.` },
            { id: 'reward', label: 'Reward their service', blurb: `${cfg.rewardGold} gold: +${cfg.rewardPrestige} Prestige, and the House's officers' loyalty +${cfg.rewardRoleLoyalty}.`, gold: cfg.rewardGold },
        ];
    },

    /** Answer the coming-of-age choice: 'keep' | 'purge' | 'reward'. */
    resolveEnding(player, world, choice, opts = {}) {
        const cfg = Regency.config();
        const st = player && player.regency;
        if (!st || !st.ending) return { success: false, reason: 'There is nothing to decide.' };
        const r = st.regent;
        const day = _day(world);
        const house = player.house;
        let text = '';
        if (choice === 'keep') {
            if (r.loyalty >= cfg.keepLoyalSkill) {
                if (!player.skills) player.skills = {};
                player.skills.diplomacy = _num(player.skills.diplomacy) + cfg.keepDiplomacy;
                player.renown = _num(player.renown) + cfg.keepRenown;
                text = `${r.name}'s men stay on: steady hands, and the realm sees continuity (+${cfg.keepDiplomacy} diplomacy, +${cfg.keepRenown} renown).`;
            } else {
                const loss = Math.min(cfg.embezzleMax * 2, Math.floor(_num(player.gold) * cfg.embezzleRate * 2));
                if (loss > 0) { player.gold -= loss; Ledger.record(player, 'regency', -loss); }
                text = `${r.name}'s men stay on — and ${loss} more gold leaves the treasury before you learn their ways.`;
            }
        } else if (choice === 'purge') {
            const back = Math.floor(_num(st.embezzled) * cfg.purgeRecovery);
            if (back > 0) { player.gold = _num(player.gold) + back; Ledger.record(player, 'regency', back); }
            const plotted = st.rumoured || st.coups > 0;
            const pr = plotted ? cfg.purgePlotterPrestige : cfg.purgePrestige;
            if (house) {
                if (pr > 0) House.award(house, pr, `${r.name}'s men purged`, day);
                else if (pr < 0) House.spend(house, Math.min(-pr, Math.max(0, _num(house.prestige))), `${r.name}'s men purged`, day);
                if (r.kind === 'sibling') house._pendingClaim = true;
            }
            text = `You purge ${r.name}'s men from your household${back ? `, recovering ${back} gold` : ''}. ${plotted ? 'The court approves: they had it coming.' : 'The court whispers that you are ungrateful.'}`;
        } else if (choice === 'reward') {
            if (_num(player.gold) < cfg.rewardGold) return { success: false, reason: `A fitting reward is ${cfg.rewardGold} gold.` };
            player.gold -= cfg.rewardGold;
            Ledger.record(player, 'regency', -cfg.rewardGold);
            if (house) {
                House.award(house, cfg.rewardPrestige, `${r.name} rewarded`, day);
                for (const id of Object.keys(house.roleLoyalty || {})) house.roleLoyalty[id] = Utils.clamp(_num(house.roleLoyalty[id]) + cfg.rewardRoleLoyalty, 0, 100);
            }
            text = `You reward ${r.name} with lands and gold for keeping your seat warm. The House's servants take note (+${cfg.rewardPrestige} Prestige).`;
        } else {
            return { success: false, reason: 'No such choice.' };
        }
        st.ending = null;
        st.done = true;
        st.resolved = { choice, day, lapsed: !!opts.lapsed };
        if (house) House._chronicle(house, world, `At ${player.firstName || player.name}'s majority: ${text}`, ['regency', 'heirs']);
        return { success: true, text, choice };
    },

    /** For the Dynasty panel. */
    view(player, world) {
        const st = player && player.regency;
        if (!st || (!st.active && !st.ending)) return null;
        const cfg = Regency.config();
        const majority = _num(st.majorityAge, cfg.majorityAge);
        const r = st.regent;
        return {
            active: st.active, regent: { ...r, label: KIND_LABEL[r.kind] || r.kind },
            yearsLeft: Math.max(0, majority - _num(player.age)), majority,
            canAssert: st.active && _num(player.age) >= majority - cfg.earlyMajorityYears,
            embezzled: st.embezzled, rumoured: st.rumoured, coups: st.coups,
            loyaltyTarget: st.active ? Math.round(Regency.loyaltyTarget(player)) : null,
            ending: st.ending, choices: Regency.endingChoices(player), cfg,
            forbidden: cfg.forbidden || [],
        };
    },

    // ──────────── SAVE ────────────

    serialize(player) {
        return player && player.regency ? JSON.parse(JSON.stringify(player.regency)) : null;
    },

    /** Backfill for older saves (no regency) and partial records. */
    loadState(player) {
        if (!player) return;
        const st = player.regency;
        if (!_obj(st)) { player.regency = null; return; }
        const cfg = Regency.config();
        if (!_obj(st.regent)) st.regent = { kind: 'council', id: 'council', name: 'the regency council', loyalty: cfg.baseLoyalty.council, ambition: cfg.baseAmbition.council };
        for (const k of ['embezzled', 'skimMonth', 'plot', 'coups', 'favour']) if (!Number.isFinite(st[k])) st[k] = 0;
        if (!Number.isFinite(st.regents)) st.regents = 1;
        if (!Number.isFinite(st.majorityAge)) st.majorityAge = cfg.majorityAge;
        if (st.ending === undefined) st.ending = null;
        st.active = !!st.active;
        st.rumoured = !!st.rumoured;
    },
};
