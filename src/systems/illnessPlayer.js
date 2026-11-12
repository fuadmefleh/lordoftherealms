// ============================================
// ILLNESS AND THE PLAYER — catching it, tending the sick, paying for physic
// ============================================
// The player's half of systems/illness.js:
//
//   - `processDay`: the towns' sicknesses (Illness.processDay), then the
//     player, in a town where folk are sick, may catch what they have (the
//     ailment of the same kind, data/ailments.json): a chance a contagious
//     case, more for each one met close on the street map today (ctx.contact
//     from ui/innerMapSickness.js), capped; their own strength and medicine
//     count (Ailments._catchMult);
//   - `giveToSick`: medicine or food given to a sick townsperson (the
//     dialog's gift, ui/npcDialog/choices.js): their care the better (the
//     death chance × giftMedicine / giftFood), now and then the fever breaks
//     at once, their regard up, a line in their life ('nursed');
//   - `fundPhysician`: gold for the town's healer to go round all its sick
//     for a month (folk.ill.fund — fees to the healer's purse, herbs bought
//     from the market into the town's purse, the rest the healer keeps);
//   - `giveAlms`: gold into the poorest households' purses; they eat better
//     (risk × alms) for a month;
//   - `greetLine`: what a sick townsperson (or one with sick kin) says first.
//
// Hash streams of the world seed and the day (never the shared RNG).

import { Utils } from '../core/utils.js';
import { Illness } from './illness.js';
import { Townsfolk } from './townsfolk.js';
import { Ailments } from './ailments.js';
import { Economy } from '../world/economy.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function _roll(world, key) {
    const seed = (world && world.generationParams && world.generationParams.seed) || 1;
    return ((Utils.hashStr(`${seed}|illp|${key}`) >>> 0) % 1000003) / 1000003;
}

function _town(world, player) {
    if (!world || !player || typeof world.getTile !== 'function') return null;
    const t = world.getTile(player.q, player.r);
    return (t && t.settlement) || null;
}

function _regard(p, delta) {
    if (!p || !p.mem) return;
    p.mem.disposition = Math.max(0, Math.min(100, _num(p.mem.disposition, 50) + delta));
}

export const IllnessPlayer = {
    /**
     * The day's sickness: every town's (Illness.processDay), then the player's
     * chance of catching what the town they stand in has.
     * @param {object} ctx { contact: { [illness]: n } — the sick met close on the street map today }
     * @returns {{ notices: Array, news: Array, caught: Array }}
     */
    processDay(world, player, ctx = {}) {
        const res = Illness.processDay(world, player);
        const out = { notices: res.notices.slice(), news: res.news, caught: [] };
        if (!player || !Illness.on()) return out;
        const s = _town(world, player);
        const folk = s && s.folk;
        if (!folk || !folk.ill || player.boardedShip) return out;
        const day = _num(world.day, 1);
        const P = Illness.config().player;
        const by = {};
        for (const p of Townsfolk.residents(folk)) if (Illness.isContagious(p, day)) by[p.ill.k] = (by[p.ill.k] || 0) + 1;
        const contact = (ctx && ctx.contact) || {};
        for (const [k, n] of Object.entries(by)) {
            const d = Illness.def(k);
            if (!d || !d.ailment || !Ailments.def(d.ailment) || Ailments.has(player, d.ailment)) continue;
            const close = _num(contact[k]);
            let chance = Math.min(_num(P.cap, 0.06), _num(P.perCase, 0.0035) * n * _num(d.contagion) / 0.05 + close * _num(P.perCase, 0.0035) * _num(P.contactMult, 4));
            chance *= Ailments._catchMult(player);
            if (!(_roll(world, `${day}|${k}|${player.q},${player.r}`) < chance)) continue;
            const rep = Ailments.inflict(player, world, d.ailment, { source: 'townsfolk' });
            if (!rep) continue;
            out.caught.push({ ...rep, source: 'townsfolk', from: k });
            out.notices.push({ icon: d.icon || '🤒', title: 'You Have Caught It', type: 'warning', text: `${d.name.charAt(0).toUpperCase() + d.name.slice(1)} is going round ${s.name}, and now you have it too: ${rep.name || d.label}.` });
        }
        return out;
    },

    /** What a sick townsperson, or one with sick kin at home, says first (or null). */
    greetLine(npc, world) {
        const p = npc && npc._person;
        const folk = npc && npc._folk;
        if (!p || !folk || !Illness.on()) return null;
        const day = _num(world && world.day, 1);
        const me = Illness.describe(p, day);
        if (me) return Illness.line('greet', me.k, `${p.id}|${day}`);
        const kin = [p.spouse, ...(p.kids || []), ...(p.parents || [])].map(id => Townsfolk.get(folk, id)).filter(o => o && Townsfolk.isHere(o));
        for (const o of kin) {
            const d = Illness.describe(o, day);
            if (!d || !(Illness.def(d.k) || {}).serious) continue;
            const rel = o.id === p.spouse ? 'spouse' : (p.kids || []).includes(o.id) ? 'child' : 'parent';
            return Illness.line('kinSick', null, `${p.id}|${o.id}|${day}`, { kin: Townsfolk.kinWord(o, rel), name: o.first, illness: d.name });
        }
        return null;
    },

    /** Is this a medicine or a food the sick can be given? → 'medicine' | 'food' | null */
    giftKind(itemId) {
        const C = Illness.config().care;
        if ((C.medicines || []).includes(itemId)) return 'medicine';
        if ((C.foods || []).includes(itemId)) return 'food';
        return null;
    },

    /**
     * The player gives a sick townsperson (or one with sick kin at home)
     * something (the item already taken from the inventory): → { text, boost,
     * eased, person } or null when no one there is sick or it is no help.
     */
    giveToSick(npc, itemId, world, player = null) {
        const giver = npc && npc._person;
        const folk = npc && npc._folk;
        if (!giver || !folk || !Illness.on()) return null;
        const day = _num(world && world.day, 1);
        // The sick themselves, else the sickest of their kin at home (a mother takes it for her child)
        let p = Illness.isSick(giver, day) ? giver : null;
        if (!p) {
            const kin = [giver.spouse, ...(giver.kids || []), ...(giver.parents || [])].map(id => Townsfolk.get(folk, id))
                .filter(o => o && Townsfolk.isHere(o) && Illness.isSick(o, day)).sort((a, b) => _num(b.ill.sv) - _num(a.ill.sv));
            p = kin[0] || null;
        }
        if (!p) return null;
        const kind = IllnessPlayer.giftKind(itemId);
        if (!kind) return null;
        const c = p.ill;
        const C = Illness.config().care;
        if (kind === 'medicine' || !c.gift) c.gift = kind;
        let eased = false;
        if (kind === 'medicine' && !c.eased && _roll(world, `${day}|save|${folk.q},${folk.r}#${p.id}`) < _num(C.giftSaveChance, 0.3) * (1.2 - _num(c.sv))) {
            // The fever breaks: the worst is over
            c.eased = true;
            c.end = Math.min(_num(c.end), day + 1);
            c.sv = Math.round(_num(c.sv) * 0.4 * 1000) / 1000;
            eased = true;
        }
        Townsfolk.note(p, day, 'nursed', null, kind);
        if (player) player.karma = _num(player.karma) + 1;
        const d = Illness.def(c.k) || {};
        let thanks = Illness.line('thanks', null, `${p.id}|${day}|${itemId}`) || 'Thank you.';
        if (p !== giver) thanks = `For ${p.first}? ${thanks}`;
        const text = eased ? `${thanks} *the ${d.label ? d.label.toLowerCase() : 'fever'} seems to ease at once*` : thanks;
        if (p !== giver) Townsfolk.note(giver, day, 'favour');
        return { text, boost: kind === 'medicine' ? 10 : 5, eased, person: p };
    },

    /** What paying the healer and giving alms cost here. */
    costs(s) {
        const F = Illness.config().fund;
        const t = (s && s.type) || 'village';
        return { physician: Math.round(_num((F.physician || {})[t], 70)), alms: Math.round(_num((F.alms || {})[t], 45)), days: _num(F.physicianDays, 30), almsDays: _num(F.almsDays, 30) };
    },

    /** Pay the town's healer to go round all its sick for a month. */
    fundPhysician(player, world, s) {
        const folk = s && s.folk;
        if (!player || !folk || !Illness.on()) return { success: false, reason: 'There is no one here to pay.' };
        const day = _num(world && world.day, 1);
        const doc = Illness.healer(s, world, day);
        if (!doc) return { success: false, reason: 'The town has no healer on their feet to send round.' };
        const cost = IllnessPlayer.costs(s).physician;
        if (_num(player.gold) < cost) return { success: false, reason: `You need ${cost} gold.` };
        const st = Illness.state(world, s, folk, day);
        player.gold -= cost;
        const F = Illness.config().fund;
        st.fund = { until: day + _num(F.physicianDays, 30), gold: _num(st.fund && st.fund.gold) + cost, by: 'player', d: day };
        player.karma = _num(player.karma) + _num(F.karma, 2);
        for (const p of Townsfolk.residents(folk)) if (Illness.isSick(p, day)) _regard(p, 4);
        return { success: true, cost, text: `You put ${cost} gold in ${doc.name}'s hand. For a month ${doc.name} will go round every sick house in ${s.name}, your coin paying the fees and the herbs.` };
    },

    /** Alms for the poor of the town: coin into the poorest households' purses; they eat better for a month. */
    giveAlms(player, world, s) {
        const folk = s && s.folk;
        if (!player || !folk || !Illness.on()) return { success: false, reason: 'There is no one here to give to.' };
        const day = _num(world && world.day, 1);
        const cost = IllnessPlayer.costs(s).alms;
        if (_num(player.gold) < cost) return { success: false, reason: `You need ${cost} gold.` };
        const st = Illness.state(world, s, folk, day);
        player.gold -= cost;
        const poor = Townsfolk.residents(folk).filter(p => ['beggar', 'villager', 'farmer'].includes(p.role) && Townsfolk.age(p, day) >= 16)
            .sort((a, b) => Townsfolk.purse(folk, a, world) - Townsfolk.purse(folk, b, world) || a.id - b.id);
        const n = Math.max(1, Math.min(poor.length, 8));
        const each = Math.floor(cost / n);
        let given = 0;
        const takers = poor.slice(0, n);
        for (const [i, p] of takers.entries()) {
            const share = i === takers.length - 1 ? cost - given : each;
            p.purse = Townsfolk.purse(folk, p, world) + share;
            given += share;
            _regard(p, 6);
        }
        // (no poor to give to: the parish takes it for them)
        if (given < cost && s.economy) Economy.payTown(s, cost - given);
        const F = Illness.config().fund;
        st.alms = { until: day + _num(F.almsDays, 30), gold: _num(st.alms && st.alms.gold) + cost, d: day };
        player.karma = _num(player.karma) + _num(F.karma, 2);
        return { success: true, cost, text: `You give ${cost} gold in alms to the poor of ${s.name}. They will eat better this month, and fall sick the less for it.` };
    },
};
