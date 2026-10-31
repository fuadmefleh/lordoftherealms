// ============================================
// DEMANDS — the price of being rich and uncrowned
// ============================================
// A House that piles up gold without a crown of its own draws hands to its
// purse. Now and then (data/house.json `demands`), one of three comes asking:
//
//   CROWN   the liege's chests run low (Fiscal.reserveDays, arrears, war) and
//           the crown asks a *benevolence* (a gift) or a *forced loan* (repaid
//           with interest when the chests allow — or deferred, or defaulted).
//   GUILD   the guild of a town where the House holds property resents its
//           wealth and wants a contribution to the guildhall.
//   RIVAL   a feuding rival House demands tribute; what it asks grows with
//           the House's wealth and with every payment.
//
// Each is a choice — pay, negotiate (a diplomacy/charisma roll for a
// smaller sum), or refuse — with real consequences: standing with the
// crown, a guild's feud (which drives its sabotage, systems/guilds.js), a
// rival's feud (and a plot hatched against a House that refuses,
// systems/schemes.js). A demand left unanswered lapses as a refusal. At most
// one demand is open at a time and each kind has a long cooldown.
//
// State lives on player.house (demands[], crownLoans[], demandLog,
// _demandCooldown, tributesPaid) and round-trips with House.serialize. The
// daily tick draws from its own seeded stream (Utils.withRng on a hash of the
// world seed and the day), so no other system's dice move. Gold flows go
// through Ledger.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { CrownBooks } from '../world/crownBooks.js';
import { House } from './house.js';
import { Ledger } from './ledger.js';
import { Fiscal } from './fiscal.js';
import { Guilds } from './guilds.js';
import { Schemes } from './schemes.js';

const DEFAULTS = {
    enabled: true, every: 15, answerDays: 10,
    crown: {
        minGold: 5000, lowReserveDays: 30, chance: 0.5, cooldown: 90,
        benevolenceShare: 0.08, loanShare: 0.12, min: 200, max: 6000,
        loanDays: 120, loanRate: 0.05, loanDeferDays: 30, loanMaxDefers: 3,
        payRep: 5, loanRep: 3, negotiateRep: 1, negotiateFailRep: -4, refuseRep: -12, refusePrestige: 5,
    },
    guild: {
        minGold: 4000, radius: 2, chance: 0.4, cooldown: 75, minFeud: 5,
        share: 0.03, min: 100, max: 1500,
        payFeud: -25, negotiateFeud: -10, negotiateFailFeud: 5, refuseFeud: 20,
    },
    rival: {
        minGold: 3000, minFeud: 40, chance: 0.45, cooldown: 60,
        baseShare: 0.04, perFeud: 0.001, growth: 1.25, min: 150, max: 8000,
        payFeud: -20, negotiateFeud: -10, negotiateFailFeud: 5, refuseFeud: 15,
    },
    negotiate: { base: 0.35, perSkill: 0.04, perCharisma: 0.03, min: 0.15, max: 0.85, share: 0.5 },
};

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : null);
const _clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

let _cfg = null;
let _cfgSrc;

export const Demands = {
    config() {
        const gd = DataLoader._gamedata;
        const src = gd && gd.house ? gd.house.demands : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const o = _obj(src) || {};
            _cfg = { ...DEFAULTS, ...o };
            for (const k of ['crown', 'guild', 'rival', 'negotiate']) _cfg[k] = { ...DEFAULTS[k], ...(_obj(o[k]) || {}) };
        }
        return _cfg;
    },

    _state(player) {
        const house = player && player.house;
        if (!house) return null;
        if (!Array.isArray(house.demands)) house.demands = [];
        if (!Array.isArray(house.crownLoans)) house.crownLoans = [];
        if (!_obj(house._demandCooldown)) house._demandCooldown = {};
        if (!_obj(house.tributesPaid)) house.tributesPaid = {};
        if (!(house._nextDemandId > 0)) house._nextDemandId = 1;
        return house;
    },

    /** Open demands, newest last. */
    open(player) {
        const h = Demands._state(player);
        return h ? h.demands.filter(d => !d.outcome) : [];
    },

    /** Loans the House has made to crowns, outstanding. */
    loans(player) {
        const h = Demands._state(player);
        return h ? h.crownLoans.filter(l => !l.settled) : [];
    },

    _rng(world) {
        const seed = (world && world.generationParams && world.generationParams.seed) || 1;
        return Utils.seededRandom(((Utils.hashStr(`${seed}|demands|${_num(world && world.day)}`) >>> 0) % 233279) + 1);
    },

    _uncrowned(player) {
        return !(player.throne && player.throne.ruling);
    },

    /** The crown that would ask: the realm the player is pledged to, else the one they stand in. */
    liege(player, world) {
        if (!world || typeof world.getKingdom !== 'function') return null;
        let k = player.allegiance ? world.getKingdom(player.allegiance) : null;
        if (!k && typeof world.getTile === 'function') {
            const t = world.getTile(player.q, player.r);
            const kid = (t && t.settlement && t.settlement.kingdom) || (t && t.kingdom);
            k = kid ? world.getKingdom(kid) : null;
        }
        return k && k.isAlive !== false ? k : null;
    },

    _crownLow(k) {
        const C = Demands.config().crown;
        const f = k && k.fisc;
        const war = Array.isArray(k.wars) && k.wars.length > 0;
        const days = Fiscal.reserveDays(k);
        return days < _num(C.lowReserveDays) || (f && _num(f.arrearsDays) > 0) || (war && days < _num(C.lowReserveDays) * 2);
    },

    // ── The daily tick ─────────────────────────────────

    /**
     * Advance demands one day: repay or defer crown loans, lapse unanswered
     * demands (as refusals), and every `every` days perhaps raise a new one.
     * @returns {{ notices: object[] }}
     */
    processDay(world, player) {
        const out = { notices: [] };
        const C = Demands.config();
        const house = Demands._state(player);
        if (!house || C.enabled === false || !world) return out;
        Utils.withRng(Demands._rng(world), () => Demands._tick(world, player, house, out));
        return out;
    },

    _tick(world, player, house, out) {
        const C = Demands.config();
        const day = _num(world.day);
        Demands._loansDay(world, player, house, day, out);
        for (const d of house.demands) {
            if (!d.outcome && day >= d.dueDay) {
                const res = Demands._refuse(world, player, d, true);
                out.notices.push({ icon: d.icon, title: 'Demand Ignored', text: res.text, type: 'warning' });
            }
        }
        if (house.demands.length > 12) house.demands = house.demands.filter(d => !d.outcome || day - _num(d.outcomeDay) < 60).slice(-12);
        if (day <= 0 || day % Math.max(1, _num(C.every, 15)) !== 0) return;
        if (Demands.open(player).length) return;
        const kinds = ['rival', 'crown', 'guild'];
        const start = Math.min(kinds.length - 1, Math.max(0, Math.floor(Utils.random() * kinds.length)));
        for (let i = 0; i < kinds.length; i++) {
            const kind = kinds[(start + i) % kinds.length];
            if (day < _num(house._demandCooldown[kind])) continue;
            const d = Demands['_make_' + kind](world, player, house, day);
            if (d) {
                house._demandCooldown[kind] = day + _num(C[kind].cooldown, 60);
                house.demands.push(d);
                out.notices.push({ icon: d.icon, title: d.title, text: `${d.text} Answer within ${C.answerDays} days from Dynasty → House.`, type: 'warning' });
                break;
            }
        }
    },

    _new(house, day, fields) {
        return {
            id: house._nextDemandId++, day, dueDay: day + _num(Demands.config().answerDays, 10),
            negotiated: false, outcome: null, ...fields,
        };
    },

    _make_crown(world, player, house, day) {
        const C = Demands.config().crown;
        const gold = _num(player.gold);
        if (gold < C.minGold || !Demands._uncrowned(player)) return null;
        const k = Demands.liege(player, world);
        if (!k || !Demands._crownLow(k)) return null;
        if (Utils.random() >= C.chance) return null;
        const loan = Utils.random() < 0.5;
        const amount = Math.round(_clamp(gold * (loan ? C.loanShare : C.benevolenceShare), C.min, C.max));
        const ruler = k.ruler || 'The crown';
        return Demands._new(house, day, {
            kind: 'crown', sub: loan ? 'loan' : 'benevolence', kingdomId: k.id, from: k.name, amount, icon: '👑',
            title: loan ? 'A Forced Loan' : 'A Benevolence',
            text: loan
                ? `${ruler} of ${k.name}, the royal chests near empty, "invites" ${house.name} to lend the crown ${amount} gold, to be repaid in ${C.loanDays} days with interest.`
                : `${ruler} of ${k.name} asks of ${house.name} a benevolence — a free gift of ${amount} gold to the crown in its need.`,
        });
    },

    /** The town guild that most resents the House's wealth nearby, or null: { s, g }. */
    _resentfulGuild(world, player) {
        const C = Demands.config().guild;
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];
        const props = player.properties || [];
        let best = null;
        for (const s of views) {
            const gs = Guilds.townGuilds(s);
            if (!gs) continue;
            const near = props.filter(p => p && Hex.distance(p.q, p.r, s.q, s.r) <= _num(C.radius, 2)).length
                + (s.market && s.market.works ? Object.values(s.market.works).filter(w => w && w.owner === 'player').length : 0);
            if (!near) continue;
            for (const g of Object.values(gs)) {
                if (!g || Guilds.rankOf(player, s, g.id) >= 0) continue; // its own members are not dunned
                const score = _num(g.feud) * 2 + near;
                if (_num(g.feud) >= _num(C.minFeud) || near >= 2) {
                    if (!best || score > best.score) best = { s, g, score };
                }
            }
        }
        return best;
    },

    _make_guild(world, player, house, day) {
        const C = Demands.config().guild;
        const gold = _num(player.gold);
        if (gold < C.minGold) return null;
        const hit = Demands._resentfulGuild(world, player);
        if (!hit || Utils.random() >= C.chance) return null;
        const amount = Math.round(_clamp(gold * C.share, C.min, C.max));
        return Demands._new(house, day, {
            kind: 'guild', q: hit.s.q, r: hit.s.r, guildId: hit.g.id, from: hit.g.name, amount, icon: '⚒️',
            title: 'The Guild Resents You',
            text: `The ${hit.g.name} grumbles that ${house.name} grows fat on ${hit.s.name}'s trade. Its masters ask ${amount} gold for the guildhall — "to keep the peace".`,
        });
    },

    /** What a rival asks in tribute: a share of the House's gold, more with feud and every payment. */
    tributeAsk(player, rival) {
        const C = Demands.config().rival;
        const paid = _num(Demands._state(player).tributesPaid[rival.kingdomId]);
        const share = C.baseShare + _num(rival.feud) * C.perFeud;
        return Math.round(_clamp(_num(player.gold) * share * Math.pow(C.growth, paid), C.min, C.max));
    },

    _make_rival(world, player, house, day) {
        const C = Demands.config().rival;
        if (_num(player.gold) < C.minGold || !house.rivals) return null;
        const rival = Object.values(house.rivals).filter(r => _num(r.feud) >= C.minFeud).sort((a, b) => _num(b.feud) - _num(a.feud))[0];
        if (!rival || Utils.random() >= C.chance) return null;
        const amount = Demands.tributeAsk(player, rival);
        return Demands._new(house, day, {
            kind: 'rival', rivalId: rival.kingdomId, from: rival.name, amount, icon: '⚔️',
            title: 'A Rival Demands Tribute',
            text: `${rival.name} sends word: ${house.name}'s wealth offends them. Pay ${amount} gold in tribute, or they will take it out of your hide.`,
        });
    },

    // ── Answering ──────────────────────────────────────

    _find(player, id) {
        return Demands.open(player).find(d => d.id === id) || null;
    },

    /** Chance a negotiation succeeds. */
    negotiateChance(player) {
        const N = Demands.config().negotiate;
        const skill = _num(player.skills && player.skills.diplomacy);
        return _clamp(N.base + skill * N.perSkill + (_num(player.charisma, 5) - 5) * N.perCharisma, N.min, N.max);
    },

    /** Answer a demand: 'pay' | 'negotiate' | 'refuse'. Returns { success, text }. */
    answer(player, world, id, choice) {
        const d = Demands._find(player, id);
        if (!d) return { success: false, reason: 'That demand is no longer open.' };
        if (choice === 'pay') return Demands._pay(world, player, d, d.amount);
        if (choice === 'refuse') return Demands._refuse(world, player, d, false);
        if (choice === 'negotiate') {
            if (d.negotiated) return { success: false, reason: 'They will not haggle again.' };
            d.negotiated = true;
            const C = Demands.config();
            const roll = ((Utils.hashStr(`${(world.generationParams && world.generationParams.seed) || 1}|haggle|${d.id}|${d.day}`) >>> 0) % 1000) / 1000;
            if (roll < Demands.negotiateChance(player)) {
                const amount = Math.max(1, Math.round(d.amount * _num(C.negotiate.share, 0.5)));
                return Demands._pay(world, player, d, amount, true);
            }
            const text = Demands._sour(world, player, d);
            return { success: true, negotiated: false, text: `${d.from} will not be haggled with. ${text} The demand stands at ${d.amount} gold.` };
        }
        return { success: false, reason: 'Unknown answer.' };
    },

    /** A failed haggle sours the asker a little. */
    _sour(world, player, d) {
        const C = Demands.config();
        if (d.kind === 'crown') { Demands._rep(player, d.kingdomId, C.crown.negotiateFailRep); return 'The crown is offended.'; }
        if (d.kind === 'guild') { Demands._guildFeud(world, d, C.guild.negotiateFailFeud); return 'The guild\'s masters take offence.'; }
        House.accrueRivalFeud(player, world, d.rivalId, C.rival.negotiateFailFeud, 'haggling over tribute');
        return 'Your rival takes it as an insult.';
    },

    _rep(player, kingdomId, delta) {
        if (!kingdomId || !delta) return;
        if (!player.reputation) player.reputation = {};
        player.reputation[kingdomId] = _num(player.reputation[kingdomId]) + delta;
    },

    _guild(world, d) {
        const tile = world && typeof world.getTile === 'function' ? world.getTile(d.q, d.r) : null;
        const s = tile && tile.settlement;
        return s ? { s, g: Guilds.guild(s, d.guildId) } : { s: null, g: null };
    },

    _guildFeud(world, d, delta) {
        const { g } = Demands._guild(world, d);
        if (g) g.feud = Math.round(_clamp(_num(g.feud) + delta, 0, 100) * 100) / 100;
    },

    _close(d, world, outcome) {
        d.outcome = outcome;
        d.outcomeDay = _num(world && world.day);
    },

    _pay(world, player, d, amount, haggled = false) {
        if (_num(player.gold) < amount) return { success: false, reason: `You need ${amount} gold.` };
        const C = Demands.config();
        const house = Demands._state(player);
        const day = _num(world.day);
        player.gold = _num(player.gold) - amount;
        let text;
        if (d.kind === 'crown') {
            const k = world.getKingdom(d.kingdomId);
            if (k) {
                k.treasury = _num(k.treasury) + amount;
                CrownBooks.note(k, d.sub === 'loan' ? 'loans' : 'levy', amount);
            }
            if (d.sub === 'loan') {
                Ledger.record(player, 'crownLoan', -amount);
                house.crownLoans.push({ id: d.id, kingdomId: d.kingdomId, from: d.from, amount, rate: C.crown.loanRate, dueDay: day + C.crown.loanDays, defers: 0, settled: false });
                Demands._rep(player, d.kingdomId, haggled ? C.crown.negotiateRep : C.crown.loanRep);
                text = `${house.name} lends ${d.from} ${amount} gold, due back in ${C.crown.loanDays} days with ${Math.round(C.crown.loanRate * 100)}% interest.`;
            } else {
                Ledger.record(player, 'benevolence', -amount);
                Demands._rep(player, d.kingdomId, haggled ? C.crown.negotiateRep : C.crown.payRep);
                text = `${house.name} gives ${d.from} a benevolence of ${amount} gold. The crown is pleased.`;
            }
        } else if (d.kind === 'guild') {
            const { s, g } = Demands._guild(world, d);
            if (g) g.treasury = _num(g.treasury) + amount;
            Demands._guildFeud(world, d, haggled ? C.guild.negotiateFeud : C.guild.payFeud);
            Ledger.record(player, 'guilds', -amount);
            text = `${amount} gold to the ${d.from}${s ? ` at ${s.name}` : ''}. The masters' grumbling quiets.`;
        } else {
            const k = world.getKingdom(d.rivalId);
            if (k) k.treasury = _num(k.treasury) + amount;
            House.accrueRivalFeud(player, world, d.rivalId, haggled ? C.rival.negotiateFeud : C.rival.payFeud);
            house.tributesPaid[d.rivalId] = _num(house.tributesPaid[d.rivalId]) + 1;
            Ledger.record(player, 'rivalTribute', -amount);
            text = `${house.name} pays ${d.from} ${amount} gold. The feud cools — and they will remember that you pay.`;
        }
        if (haggled) text = `You talk them down to ${amount} gold. ${text}`;
        Demands._close(d, world, haggled ? 'negotiated' : 'paid');
        House._chronicle(house, world, text, ['demand', d.kind]);
        return { success: true, paid: amount, text };
    },

    _refuse(world, player, d, lapsed) {
        const C = Demands.config();
        const house = Demands._state(player);
        let text;
        if (d.kind === 'crown') {
            Demands._rep(player, d.kingdomId, C.crown.refuseRep);
            const lost = Math.min(_num(house.prestige), _num(C.crown.refusePrestige));
            if (lost > 0) House.spend(house, lost, `refused ${d.from}`, world.day);
            text = `${house.name} ${lapsed ? 'ignores' : 'refuses'} ${d.from}'s ${d.sub === 'loan' ? 'loan' : 'benevolence'}. The crown will not forget it (${C.crown.refuseRep} standing${lost ? `, −${lost} Prestige` : ''}).`;
        } else if (d.kind === 'guild') {
            Demands._guildFeud(world, d, C.guild.refuseFeud);
            text = `${house.name} ${lapsed ? 'ignores' : 'refuses'} the ${d.from}. Its men mutter, and its feud with you deepens — your works there may suffer for it.`;
        } else {
            House.accrueRivalFeud(player, world, d.rivalId, C.rival.refuseFeud, 'tribute refused');
            const rival = house.rivals && house.rivals[d.rivalId];
            let plot = null;
            if (rival) {
                const options = Schemes.eligibleTypes(player, world, _num(rival.feud));
                const busy = Schemes.active(player).some(s => s.rivalId === d.rivalId);
                if (options.length && !busy && Schemes.active(player).length < Schemes.CONFIG.maxActive) {
                    plot = Schemes.hatch(player, world, rival, options[options.length - 1]);
                }
            }
            text = `${house.name} ${lapsed ? 'ignores' : 'refuses'} ${d.from}'s demand. Their feud burns hotter${plot ? ' — and they are plotting something' : ''}.`;
        }
        Demands._close(d, world, lapsed ? 'lapsed' : 'refused');
        House._chronicle(house, world, text, ['demand', d.kind]);
        return { success: true, text };
    },

    /** Crown loans fall due: repaid with interest when the chests allow, else deferred, at last defaulted. */
    _loansDay(world, player, house, day, out) {
        const C = Demands.config().crown;
        for (const l of house.crownLoans) {
            if (l.settled || day < l.dueDay) continue;
            const k = world.getKingdom(l.kingdomId);
            const owed = Math.round(l.amount * (1 + _num(l.rate)));
            if (k && k.isAlive !== false && _num(k.treasury) >= owed) {
                k.treasury = _num(k.treasury) - owed;
                CrownBooks.note(k, 'debt', owed);
                player.gold = _num(player.gold) + owed;
                Ledger.record(player, 'crownLoan', l.amount);
                Ledger.record(player, 'loanInterest', owed - l.amount);
                l.settled = 'repaid';
                out.notices.push({ icon: '👑', title: 'Loan Repaid', text: `${l.from} repays ${house.name}'s loan: ${owed} gold.`, type: 'success' });
            } else if (k && k.isAlive !== false && l.defers < _num(C.loanMaxDefers, 3)) {
                l.defers++;
                l.dueDay = day + _num(C.loanDeferDays, 30);
                out.notices.push({ icon: '👑', title: 'Loan Deferred', text: `${l.from} cannot repay your ${l.amount} gold yet. It asks for ${C.loanDeferDays} more days.`, type: 'warning' });
            } else {
                l.settled = 'defaulted';
                Demands._rep(player, l.kingdomId, 3); // a crown that defaults owes you a little grace
                out.notices.push({ icon: '👑', title: 'Crown Defaults', text: `${l.from} will never repay your ${l.amount} gold.`, type: 'error' });
                House._chronicle(house, world, `${l.from} defaults on ${house.name}'s loan of ${l.amount} gold.`, ['demand', 'crown']);
            }
        }
        if (house.crownLoans.length > 10) house.crownLoans = house.crownLoans.filter(l => !l.settled).concat(house.crownLoans.filter(l => l.settled).slice(-4));
    },
};
