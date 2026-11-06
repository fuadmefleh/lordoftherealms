// ============================================
// RIVAL AUDIENCE — talking with a rival House's head
// ============================================
// The meeting with a rival lord (systems/rivalHouses.js) as a conversation:
// what they say and what they want. The head has a face and a manner
// (persona), a mood from what has just happened to them, and a memory of
// what you have done to them; all three colour every line, and the regard
// they add up to is the mood ring (ui/actionMenu/rivalAudience.js).
//
//   Talk      what they are about and what they want (their errand and
//             ambition), their news (their own doings, in their own words),
//             their family, another House (their regard for it), what they
//             think of you (and why), their passion.
//   Acts      parley, a gift, flattery, a threat (your army against their
//             retinue), an insult, pressing a refused debt.
//   Offers    they make their own, from what they want and how they stand:
//             a blood price for a truce, a loan, speaking for them at court,
//             buying an estate of yours, a match without dowry, a blow
//             against a House they hate, a duel to first blood. Accepted
//             deals are kept or broken by their honour (RivalHouses._dealsDay).
//
// Lines come from data/rivalVoice.json, picked by hash of the day and the
// head (the same meeting reads the same; no dice drawn for words). The
// chances use Utils.random. Pure domain logic: no DOM.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Estates } from '../world/estates.js';
import { RivalHouses } from './rivalHouses.js';
import { House } from './house.js';
import { Ledger } from './ledger.js';
import { LandMarket } from './landMarket.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = world => _num(world && world.day);

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

const OFFER_ORDER = ['duel', 'against', 'match', 'bloodPrice', 'speak', 'buyEstate', 'loan'];
const OFFER_ICONS = { duel: '⚔️', against: '🗡️', match: '💍', bloodPrice: '🔴', speak: '👑', buyEstate: '🌾', loan: '💰' };

export const RivalAudience = {
    voice() {
        const g = DataLoader._gamedata;
        return (g && g.rivalVoice) || {};
    },

    /** warm / civil / cold / hostile, from the head's regard. */
    stance(regard) {
        return regard >= 30 ? 'warm' : regard >= -10 ? 'civil' : regard >= -50 ? 'cold' : 'hostile';
    },

    /** A line from a list, the same for this head on this day and for this purpose. */
    pick(list, rival, world, key) {
        if (!Array.isArray(list) || !list.length) return typeof list === 'string' ? list : '';
        return list[_hash(`${rival.houseKey}:${rival.head && rival.head.firstName}:${_day(world)}:${key}`) % list.length];
    },

    fill(text, vars) {
        return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
    },

    /** The words a line can use. */
    vars(player, world, rival, extra = {}) {
        const h = rival.head;
        const plan = rival.plan || {};
        const kids = (h.children || []).slice().sort((a, b) => b.age - a.age);
        const persona = h.persona || {};
        const good = plan.good ? RivalHouses.goodName(plan.good) : 'wool';
        const hostile = RivalHouses.rivals(player).filter(r => r !== rival && r.head).sort((a, b) => RivalHouses.tie(rival, a) - RivalHouses.tie(rival, b))[0];
        return {
            you: (player && (player.firstName || player.name)) || 'stranger',
            yourHouse: (player && player.house && player.house.name) || 'your House',
            first: h.firstName,
            name: RivalHouses.headName(rival),
            myHouse: rival.name,
            seat: (rival.seat && rival.seat.name) || 'my seat',
            passion: persona.passion ? persona.passion.name : 'the hunt',
            good,
            place: (plan.to && plan.to.name) || (plan.from && plan.from.name) || (rival.seat && rival.seat.name) || 'town',
            child: kids[0] ? kids[0].firstName : 'my eldest',
            parent: h.gender === 'female' ? 'mother' : 'father',
            other: hostile ? hostile.name : 'the other Houses',
            ...extra,
        };
    },

    /** Today's talk with this head: which topics and acts are spent. */
    _talk(rival, world) {
        if (!rival.talk || rival.talk.day !== _day(world)) rival.talk = { day: _day(world), used: [] };
        return rival.talk;
    },

    used(rival, world, key) {
        return this._talk(rival, world).used.includes(key);
    },

    _use(rival, world, key) {
        const t = this._talk(rival, world);
        if (!t.used.includes(key)) t.used.push(key);
    },

    // ──────────── THE OPENING ────────────

    /** The head's first words: the mood on them, a memory of you, then the greeting of their manner and stance. */
    greeting(player, world, rival) {
        const V = this.voice();
        const v = this.vars(player, world, rival);
        const regard = RivalHouses.regard(rival, world);
        const manner = RivalHouses.manner(rival);
        const mood = RivalHouses.mood(rival, world);
        const parts = [];
        const opener = (V.moodOpeners || {})[mood.id];
        if (opener) {
            const ev = (rival.events || []).filter(e => e.kind === mood.id).slice(-1)[0];
            const kids = (rival.head.children || []).slice();
            // The newborn for a birth; the child who wed for a wedding
            const who = mood.id === 'birth' ? kids.sort((a, b) => a.age - b.age)[0]
                : mood.id === 'wedding' ? kids.filter(c => c.wed).sort((a, b) => b.age - a.age)[0] : null;
            parts.push(this.fill(this.pick(opener, rival, world, 'mood'), { ...v, child: who ? who.firstName : v.child, other: this._ouster(player, rival) || v.other, good: v.good, day: ev && ev.day }));
        } else {
            const m = RivalHouses.memoryOf(rival, world)[0];
            const line = m && Math.abs(m.now) >= 4 && (V.recall || {})[m.kind];
            if (line) parts.push(this.fill(line, v));
        }
        const g = ((V.greeting || {})[manner] || {})[this.stance(regard)];
        parts.push(this.fill(this.pick(g, rival, world, 'greet'), v));
        return parts.filter(Boolean).join(' ');
    },

    /** The House that ousted this one as a court's favourite (from their log), or null. */
    _ouster(player, rival) {
        const e = (rival.log || []).slice().reverse().find(x => /^Ousted as favourite/.test(x.text));
        const m = e && e.text.match(/ by (.+)\.$/);
        return m ? m[1] : null;
    },

    farewell(player, world, rival) {
        const V = this.voice();
        return this.fill(this.pick((V.farewell || {})[this.stance(RivalHouses.regard(rival, world))], rival, world, 'bye'), this.vars(player, world, rival));
    },

    /** Everything the stage shows beside the portrait. */
    facts(player, world, rival) {
        const V = this.voice();
        const v = RivalHouses.view(player, world, rival);
        const recall = V.recall || {};
        const memories = RivalHouses.memoryOf(rival, world).slice(0, 4).map(m => ({
            kind: m.kind, good: m.now >= 0, weight: Math.round(m.now), inherited: !!m.inherited,
            text: RivalHouses.memoryLabel(m),
            line: recall[m.kind] || '',
        }));
        return {
            ...v,
            look: RivalHouses.describe(rival),
            honour: RivalHouses.honourWord(rival),
            mood: RivalHouses.mood(rival, world),
            regard: RivalHouses.regard(rival, world),
            stance: this.stance(RivalHouses.regard(rival, world)),
            manner: RivalHouses.manner(rival),
            memories,
            truce: RivalHouses.inTruce(rival, world) ? _num(rival.truceUntil) - _day(world) : 0,
            ask: rival.ask && rival.ask.kind === 'against' && _day(world) <= _num(rival.ask.until)
                ? { target: (RivalHouses.rival(player, rival.ask.target) || {}).name, days: _num(rival.ask.until) - _day(world) } : null,
            owed: this.owed(rival),
        };
    },

    /** A short sketch of the head for a language model (systems/npcBrain.js). */
    llmContext(player, world, rival) {
        const f = this.facts(player, world, rival);
        const mem = f.memories.map(m => m.text).join('; ');
        return [
            `${f.name}, head of ${f.house}, ${f.look}. Manner: ${f.manner}. Mood: ${f.mood.label}.`,
            `They are a rival of the player's House (feud ${f.feud}, regard ${f.regard}: ${f.stance}).`,
            f.ambition ? `Their ambition: ${f.ambition.name}.` : '',
            mem ? `They remember: ${mem}.` : '',
            `Just now they are ${f.doing}.`,
        ].filter(Boolean).join(' ');
    },

    // ──────────── TALK ────────────

    /** The topics open today: [{ id, label, icon }]. */
    topics(player, world, rival) {
        const out = [
            { id: 'business', icon: '🧭', label: 'What brings you to these roads?' },
            { id: 'news', icon: '📜', label: 'What news?' },
            { id: 'family', icon: '👪', label: 'How is your family?' },
            { id: 'you', icon: '❓', label: 'What do you think of me, truly?' },
            { id: 'passion', icon: '🎲', label: 'How do you pass the time?' },
        ];
        for (const r of RivalHouses.rivals(player)) {
            if (r !== rival && r.head) out.push({ id: `house:${r.kingdomId}`, icon: '🏰', label: `What do you make of ${r.name}?` });
        }
        return out.filter(t => !this.used(rival, world, `topic:${t.id}`));
    },

    /** Ask about a topic. → { lines: [string] } (said by the head). */
    topic(player, world, rival, id) {
        const V = this.voice();
        const T = V.topics || {};
        const v = this.vars(player, world, rival);
        this._use(rival, world, `topic:${id}`);
        const stance = this.stance(RivalHouses.regard(rival, world));
        const cagey = stance === 'hostile';
        const lines = [];
        if (id === 'business') {
            const p = rival.plan;
            const key = !p ? 'none' : p.kind === 'trade' ? (p.stage === 'buying' ? 'buying' : 'trade') : p.kind;
            lines.push(this.fill((T.business || {})[key] || T.business.none, v));
            const a = rival.ambition;
            if (a && !cagey) lines.push(this.fill((T.ambition || {})[a.id], v));
        } else if (id === 'news') {
            const own = (rival.log || []).filter(e => _day(world) - e.day <= 60 && !/you|your/i.test(e.text)).slice(-2);
            if (!own.length) lines.push(this.fill(T.noNews, v));
            for (const e of own) lines.push(this.firstPerson(e.text, rival));
            const friend = RivalHouses.rivals(player).filter(r => r !== rival && r.head).sort((a, b) => Math.abs(RivalHouses.tie(rival, b)) - Math.abs(RivalHouses.tie(rival, a)))[0];
            if (friend && Math.abs(RivalHouses.tie(rival, friend)) >= 30) lines.push(this.houseLine(player, world, rival, friend));
        } else if (id === 'family') {
            const h = rival.head;
            const kids = (h.children || []).slice().sort((a, b) => b.age - a.age);
            if (!h.spouse && !kids.length) lines.push(this.fill(T.familyNone, v));
            else {
                const wife = h.spouse ? `${h.spouse.firstName}, my ${h.spouse.gender === 'female' ? 'wife' : 'husband'}, keeps well` : 'I am alone now';
                const names = kids.map(c => `${c.firstName} (${c.age}${c.wed ? ', wed' : ''})`).join(', ');
                lines.push(`${wife}.${kids.length ? ` My children: ${names}.` : ''}`);
                if (kids[0]) lines.push(this.fill(T.heirLine, { ...v, child: kids[0].firstName }));
            }
            const yours = ((player && player.children) || []).filter(c => c && c.isAlive !== false && !c.isSibling)[0];
            if (yours && !cagey) lines.push(this.fill(T.askYours, { ...v, child: yours.firstName }));
        } else if (id === 'you') {
            lines.push(this.fill((T.you || {})[stance], v));
            // Grudges first if they think ill of you, kindnesses first if well; the other side as a concession
            const mem = RivalHouses.memoryOf(rival, world).slice(0, 4);
            const bad = mem.filter(m => m.now < 0).map(m => RivalHouses.memoryLabel(m));
            const good = mem.filter(m => m.now > 0).map(m => RivalHouses.memoryLabel(m));
            const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0]);
            const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
            const [main, other] = stance === 'warm' || (stance === 'civil' && good.length >= bad.length) ? [good, bad] : [bad, good];
            const mainKey = main === good ? 'reasonsGood' : 'reasons';
            const otherKey = main === good ? 'butBad' : 'butGood';
            if (main.length && !cagey) lines.push(this.fill(T[mainKey], { ...v, reasons: mainKey === 'reasons' ? cap(list(main)) : list(main) }));
            if (other.length && !cagey) lines.push(this.fill(T[otherKey], { ...v, reasons: list(other) }));
        } else if (id === 'passion') {
            const p = rival.head.persona && rival.head.persona.passion;
            lines.push(this.fill(p ? p.line : 'I keep busy.', v));
            if (p) RivalHouses.remember(rival, world, 'flattered', 'asked after their ' + p.name);
        } else if (id.startsWith('house:')) {
            const other = RivalHouses.rival(player, id.slice(6));
            if (other) lines.push(this.houseLine(player, world, rival, other));
        }
        return { lines: lines.filter(Boolean) };
    },

    /** "Sold 40 iron in Ashford (+120g)." → "I sold 40 iron in Ashford, at a profit." */
    firstPerson(text, rival) {
        let s = String(text);
        s = s.replace(/\s*\(([+-])\d+g\)\.$/, (m, sign) => (sign === '+' ? ', at a profit.' : ', at a loss.'));
        s = s.replace(/^Sold /, 'I sold ').replace(/^Bought /, 'I bought ').replace(/^At court in /, 'I was at court in ')
            .replace(/^Became a favourite /, 'I became a favourite ').replace(/^Ousted as favourite /, 'I was ousted as favourite ')
            .replace(/^Achieved /, 'I achieved ').replace(/^Put /, 'I had to put ').replace(/^Rode /, 'I rode ').replace(/^Hunted /, 'I hunted ')
            .replace(/^Gave up on /, 'I gave up on ').replace(/^Hires swords/, 'I have hired swords');
        const h = rival.head;
        if (h && h.firstName) s = s.replace(new RegExp(`is born to ${h.firstName}\\.$`), 'is born to me.');
        return s;
    },

    /** Their word on another House, from their regard for it. */
    houseLine(player, world, rival, other) {
        const T = (this.voice().topics || {}).otherHouse || {};
        const C = RivalHouses.config().ties;
        const t = RivalHouses.tie(rival, other);
        const key = t >= _num(C.allyAt, 50) ? 'ally' : t >= 20 ? 'friend' : t > -20 ? 'neutral' : t > _num(C.enemyAt, -50) ? 'cold' : 'enemy';
        return this.fill(T[key], { ...this.vars(player, world, rival), other: other.name });
    },

    // ──────────── ACTS ────────────

    /** Parley / gift / insult through RivalHouses, with the head's answer in their manner. → { res, line } */
    act(player, world, rival, op) {
        const V = this.voice();
        const manner = RivalHouses.manner(rival);
        const v = this.vars(player, world, rival);
        if (op === 'parley') {
            const res = RivalHouses.parley(player, world, rival.kingdomId);
            const line = res.success ? this.fill(this.pick(((V.parley || {})[res.ok ? 'ok' : 'fail'] || {})[manner], rival, world, 'parley'), v) : null;
            return { res, line };
        }
        if (op === 'gift') {
            const res = RivalHouses.gift(player, world, rival.kingdomId);
            const line = res.success ? this.fill(this.pick(((V.gift || {})[res.again ? 'again' : 'first'] || {})[manner], rival, world, 'gift'), v) : null;
            return { res, line };
        }
        if (op === 'insult') {
            const again = RivalHouses.recalls(rival, world, 'insult', 120);
            const res = RivalHouses.insult(player, world, rival.kingdomId);
            const line = res.success ? this.fill(this.pick(again ? V.insultAgain : (V.insult || {})[manner], rival, world, 'insult'), v) : null;
            return { res, line };
        }
        return { res: { success: false, reason: 'Unknown act.' }, line: null };
    },

    flatterChance(player, rival, world) {
        let c = 0.3 + 0.03 * _num(player.charisma, 5) + 0.02 * _num(player.skills && player.skills.diplomacy) + RivalHouses.regard(rival, world) / 300;
        if (RivalHouses.has(rival.head, 'proud')) c += 0.1;
        if (RivalHouses.has(rival.head, 'courtly') || RivalHouses.has(rival.head, 'scheming')) c -= 0.1;
        return Math.max(0.05, Math.min(0.85, c));
    },

    /** Kind words: a little regard won, or a little lost. Once a day. */
    flatter(player, world, rival) {
        if (this.used(rival, world, 'flatter')) return { success: false, reason: 'You have tried that today.' };
        this._use(rival, world, 'flatter');
        const ok = Utils.random() < this.flatterChance(player, rival, world);
        RivalHouses.remember(rival, world, ok ? 'flattered' : 'flatterFail');
        if (ok) House.accrueRivalFeud(player, world, rival.kingdomId, -3);
        const F = this.voice().flatter || {};
        return { success: true, ok, line: this.fill(this.pick(F[ok ? 'ok' : 'fail'], rival, world, 'flatter'), this.vars(player, world, rival)), text: ok ? 'They warm a little: feud −3.' : 'It rings false.' };
    },

    threatChance(player, rival) {
        const mine = RivalHouses._playerStrength(player);
        const theirs = RivalHouses.strength(rival) * 1.5;
        return Math.max(0.05, Math.min(0.9, mine / Math.max(1, mine + theirs)));
    },

    /**
     * A threat at the head of your men. Cowed: they keep away (a 60-day truce:
     * no waylaying, no plots) but resent it; defiant: the feud flares. Once a day.
     */
    threaten(player, world, rival) {
        if (this.used(rival, world, 'threaten')) return { success: false, reason: 'You have made your threats today.' };
        this._use(rival, world, 'threaten');
        const ok = Utils.random() < this.threatChance(player, rival);
        RivalHouses.remember(rival, world, 'threatened');
        const T = this.voice().threaten || {};
        const line = this.fill(this.pick(T[ok ? 'cowed' : 'defiant'], rival, world, 'threat'), this.vars(player, world, rival));
        if (ok) {
            rival.truceUntil = Math.max(_num(rival.truceUntil), _day(world) + 60);
            if (rival.plan && rival.plan.kind === 'waylay') RivalHouses._endWaylay(player, world, rival, RivalHouses.retinueOf(world, rival), 'spared', { notices: [] });
            House.accrueRivalFeud(player, world, rival.kingdomId, 5, 'a threat');
            return { success: true, ok, line, text: 'They back down: no blades or plots from them for 60 days. Feud +5.' };
        }
        House.accrueRivalFeud(player, world, rival.kingdomId, 10, 'a threat laughed off');
        return { success: true, ok, line, text: 'They laugh at you: feud +10.' };
    },

    /** What a refused loan still owes you (0 if nothing). */
    owed(rival) {
        return (rival.loans || []).filter(l => l.defaulted && !l.repaid).reduce((s, l) => s + _num(l.owed), 0);
    },

    /** Press them for a refused debt, before their own men: they pay if you are stronger or they are honest enough. */
    demandRepayment(player, world, rival) {
        const owed = this.owed(rival);
        if (!owed) return { success: false, reason: 'They owe you nothing.' };
        if (this.used(rival, world, 'demand')) return { success: false, reason: 'You have pressed them today.' };
        this._use(rival, world, 'demand');
        const honour = _num(rival.head.persona && rival.head.persona.honour, 5);
        const chance = Math.min(0.9, this.threatChance(player, rival) + honour * 0.04);
        RivalHouses.remember(rival, world, 'loanDemanded');
        if (Utils.random() < chance && rival.gold >= owed) {
            rival.gold -= owed;
            player.gold = _num(player.gold) + owed;
            Ledger.record(player, 'rivalDeals', owed);
            for (const l of rival.loans) if (l.defaulted && !l.repaid) l.repaid = _day(world);
            return { success: true, ok: true, line: '*colours, then counts out the coin* There. Now we are quits.', text: `They pay what they owe: +${owed} gold.` };
        }
        House.accrueRivalFeud(player, world, rival.kingdomId, 5, 'a debt pressed');
        return { success: true, ok: false, line: '*laughs* Take it up with the crown, if you like.', text: 'They will not pay. Feud +5.' };
    },

    // ──────────── THEIR OFFERS ────────────

    _cool(rival, world, kind) {
        return _num(rival.offerCooldown && rival.offerCooldown[kind]) > _day(world);
    },

    /** The player's grown, unwed children. */
    _myChildren(player) {
        return ((player && player.children) || []).filter(c => c && c.isAlive !== false && !c.isSibling && c.upbringing && c.upbringing.comeOfAge && !c.upbringing.spouse);
    },

    /** Every offer the head would make now: [{ kind, icon, pitch, terms, ...args }], most pressing first. */
    allOffers(player, world, rival) {
        const C = RivalHouses.config();
        const D = C.deals;
        const V = this.voice().offers || {};
        const v = this.vars(player, world, rival);
        const feud = _num(rival.feud);
        const day = _day(world);
        const out = [];
        const push = (kind, extra, terms) => {
            if (this._cool(rival, world, kind) || rival.lastOffer === `${kind}:${day}:taken`) return;
            out.push({ kind, icon: OFFER_ICONS[kind], pitch: this.fill((V[kind] || {}).pitch, { ...v, ...extra }), terms, ...extra });
        };
        const h = rival.head;
        // A duel, to settle it: proud or martial heads, a hot feud and a fresh insult (or a very hot feud)
        if ((RivalHouses.has(h, 'proud') || _num(h.martial) >= 7) && feud >= 55 && (RivalHouses.recalls(rival, world, 'insult', 60) || feud >= 80)
            && day - _num(rival.lastDuelDay, -1e9) > 120) {
            push('duel', {}, 'A duel to first blood. Win: feud −20, +5 renown. Lose: feud −12. Either way you take some hurt.');
        }
        // A blow against a House they hate
        const enemy = RivalHouses.rivals(player).filter(r => r !== rival && r.head && RivalHouses.tie(rival, r) <= -30)
            .sort((a, b) => RivalHouses.tie(rival, a) - RivalHouses.tie(rival, b))[0];
        if (enemy && feud <= 70 && !(rival.ask && day <= _num(rival.ask.until))) {
            push('against', { other: enemy.name, target: enemy.kingdomId }, `Insult ${RivalHouses.headName(enemy)} or fall on their retinue within ${_num(D.againstDays, 90)} days: feud ${_num(D.againstFeud, -30)} with ${rival.name}.`);
        }
        // A match without dowry
        const M = C.meet.match;
        if (feud <= M.maxFeud) {
            for (const c of this._myChildren(player)) {
                const t = RivalHouses.matchableChildren(rival).find(x => x.gender !== c.gender);
                if (t) {
                    push('match', { yourChild: c.firstName, theirChild: t.firstName, childId: c.id, idx: t.idx }, `${c.firstName} weds ${t.firstName} ${RivalHouses.surname(rival)}, no dowry: feud ${M.feud}, +${M.prestige} Prestige.`);
                    break;
                }
            }
        }
        // A blood price for a truce
        if (feud >= 45 && !RivalHouses.inTruce(rival, world)) {
            const gold = this.bloodPrice(rival);
            push('bloodPrice', { gold, days: _num(D.truceDays, 120) }, `Pay ${gold} gold: feud −30, and no waylaying or plots from them for ${_num(D.truceDays, 120)} days, if they keep their word.`);
        }
        // Speak for them at court
        if (rival.ambition && rival.ambition.id === 'favour' && feud < 70) {
            const best = RivalHouses.bestStanding(rival);
            const kid = best ? best.kingdomId : rival.kingdomId;
            const k = Estates.kingdom(world, kid);
            const rep = _num(player.reputation && player.reputation[k ? k.id : kid]);
            if (k && rep >= 10) push('speak', { realm: k.name, realmId: k.id }, `−5 reputation with ${k.name}; they gain favour there; feud −15.`);
        }
        // Buy an estate of yours
        if ((rival.ambition && rival.ambition.id === 'land') || RivalHouses.has(h, 'homebody')) {
            const mine = Estates.heldBy(world, 'player');
            const e = mine.slice().sort((a, b) => _num(a.value) - _num(b.value))[0];
            if (e) {
                const price = Math.round((_num(e.value) || LandMarket.value(world, e)) * 1.15);
                const live = Estates._liveOfKey(world, e.town);
                if (price > 0 && rival.gold >= price + _num(C.invest.reserve, 400)) push('buyEstate', { estate: e.name, estateId: e.id, gold: price, place: live ? live.name : 'town' }, `Sell ${e.name} for ${price} gold (about 15% over its value).`);
            }
        }
        // A loan
        const open = (rival.loans || []).some(l => !l.repaid && !l.defaulted);
        if (feud < 60 && !open && (rival.gold < 800 || (rival.ambition && rival.ambition.id === 'wealth' && rival.gold < 3000))) {
            const amount = Math.round((300 + _num(h.stewardship, 5) * 40) / 10) * 10;
            const owed = Math.round(amount * (1 + _num(D.loanRate, 0.2)));
            push('loan', { gold: amount, owed, days: _num(D.loanDays, 60) }, `Lend ${amount} gold; they owe ${owed} in ${_num(D.loanDays, 60)} days. ${RivalHouses.honourWord(rival)}.`);
        }
        return out.sort((a, b) => OFFER_ORDER.indexOf(a.kind) - OFFER_ORDER.indexOf(b.kind));
    },

    /** The offers they actually raise: the two most pressing (plus the blood price, if you asked what it would take). */
    offers(player, world, rival, { asked = false } = {}) {
        const all = this.allOffers(player, world, rival);
        const top = all.slice(0, 2);
        if (asked) {
            const bp = all.find(o => o.kind === 'bloodPrice');
            if (bp && !top.includes(bp)) top.push(bp);
        }
        return top;
    },

    bloodPrice(rival) {
        const proud = RivalHouses.has(rival.head, 'proud') ? 1.3 : 1;
        return Math.round(((60 + _num(rival.feud) * 5) * proud) / 10) * 10;
    },

    /** "What would it take to end this?" — the blood price, or why there is none. */
    askTerms(player, world, rival) {
        this._use(rival, world, 'terms');
        const feud = _num(rival.feud);
        if (feud < 45) return { line: feud < 20 ? 'End what? We are rivals, not enemies.' : 'Nothing so grand as a price. Time, and good manners.', offer: null };
        if (RivalHouses.inTruce(rival, world)) return { line: 'We have a truce. Let it hold, and we will see.', offer: null };
        const o = this.allOffers(player, world, rival).find(x => x.kind === 'bloodPrice');
        return { line: o ? o.pitch : 'Nothing you could pay.', offer: o || null };
    },

    /** Accept one of their offers. → { success, reason?, line, text, duel? } */
    accept(player, world, rival, offer) {
        const C = RivalHouses.config();
        const D = C.deals;
        const V = this.voice().offers || {};
        const v = this.vars(player, world, rival, offer);
        const day = _day(world);
        const said = (kind) => this.fill((V[kind] || {}).accept, v);
        if (!offer || !this.allOffers(player, world, rival).some(o => o.kind === offer.kind)) return { success: false, reason: 'They no longer offer that.' };
        const done = (text, extra = {}) => { rival.lastOffer = `${offer.kind}:${day}:taken`; return { success: true, line: said(offer.kind), text, ...extra }; };
        switch (offer.kind) {
            case 'bloodPrice': {
                if (_num(player.gold) < offer.gold) return { success: false, reason: `The blood price is ${offer.gold} gold.` };
                player.gold -= offer.gold;
                rival.gold += offer.gold;
                Ledger.record(player, 'rivalDeals', -offer.gold);
                House.accrueRivalFeud(player, world, rival.kingdomId, -30);
                rival.truceUntil = day + _num(D.truceDays, 120);
                if (rival.plan && rival.plan.kind === 'waylay') RivalHouses._endWaylay(player, world, rival, RivalHouses.retinueOf(world, rival), 'spared', { notices: [] });
                RivalHouses.remember(rival, world, 'bloodPrice', `${offer.gold}g`);
                RivalHouses._note(rival, world, `Took a blood price of ${offer.gold}g from you, and swore a truce.`);
                return done(`−${offer.gold} gold. Feud −30; a truce for ${_num(D.truceDays, 120)} days.`);
            }
            case 'loan': {
                if (_num(player.gold) < offer.gold) return { success: false, reason: `You do not have ${offer.gold} gold to lend.` };
                player.gold -= offer.gold;
                rival.gold += offer.gold;
                Ledger.record(player, 'rivalDeals', -offer.gold);
                rival.loans = (rival.loans || []).concat([{ amount: offer.gold, owed: offer.owed, due: day + _num(D.loanDays, 60), lent: day }]);
                House.accrueRivalFeud(player, world, rival.kingdomId, -10);
                RivalHouses.remember(rival, world, 'loanGiven', `${offer.gold}g`);
                RivalHouses._note(rival, world, `Borrowed ${offer.gold}g from you.`);
                return done(`−${offer.gold} gold; they owe ${offer.owed} by day ${day + _num(D.loanDays, 60)}. Feud −10.`);
            }
            case 'speak': {
                const kid = offer.realmId;
                if (!player.reputation) player.reputation = {};
                if (_num(player.reputation[kid]) < 10) return { success: false, reason: 'Your word carries too little weight there.' };
                player.reputation[kid] = _num(player.reputation[kid]) - 5;
                rival.standing[kid] = Math.min(_num(C.standing.max, 60), _num(rival.standing[kid]) + 10);
                House.accrueRivalFeud(player, world, rival.kingdomId, -15);
                RivalHouses.remember(rival, world, 'spokeForThem', offer.realm);
                RivalHouses._note(rival, world, `You spoke for them at the court of ${offer.realm}.`);
                return done(`−5 reputation with ${offer.realm}; their favour there +10. Feud −15.`);
            }
            case 'buyEstate': {
                const st = Estates.state(world);
                const e = st.estates[offer.estateId];
                if (!e || e.holder !== 'player') return { success: false, reason: 'That estate is no longer yours.' };
                if (rival.gold < offer.gold) return { success: false, reason: 'Their purse no longer runs to it.' };
                rival.gold -= offer.gold;
                player.gold = _num(player.gold) + offer.gold;
                Ledger.record(player, 'estatesSold', offer.gold);
                RivalHouses._holder(world, rival);
                LandMarket._setHolder(world, e, RivalHouses.holderId(rival), day);
                RivalHouses.remember(rival, world, 'estateSold', e.name);
                RivalHouses._note(rival, world, `Bought ${e.name} from you for ${offer.gold}g.`, 'land');
                House.accrueRivalFeud(player, world, rival.kingdomId, -10);
                return done(`+${offer.gold} gold; ${e.name} is theirs. Feud −10.`);
            }
            case 'match': {
                const res = RivalHouses.proposeMatch(player, world, rival.kingdomId, offer.childId, offer.idx, { dowry: _num(D.matchDowry, 0) });
                if (!res.success) return { success: false, reason: res.reason };
                return done(res.text);
            }
            case 'against': {
                rival.ask = { kind: 'against', target: offer.target, until: day + _num(D.againstDays, 90) };
                RivalHouses._note(rival, world, `Asked you to act against ${offer.other}.`);
                return done(`Shame or strike the lord of ${offer.other} within ${_num(D.againstDays, 90)} days.`);
            }
            case 'duel':
                // The duel itself is fought in the duel panel; RivalHouses.settleDuel takes the result
                rival.lastOffer = `${offer.kind}:${day}:taken`;
                return { success: true, duel: true, line: '*the circle of retainers widens*', text: '' };
            default:
                return { success: false, reason: 'Unknown offer.' };
        }
    },

    /** Turn an offer down: they don't raise it again for a month, and they remember. */
    decline(player, world, rival, offer) {
        const V = this.voice().offers || {};
        if (!rival.offerCooldown) rival.offerCooldown = {};
        rival.offerCooldown[offer.kind] = _day(world) + 30;
        RivalHouses.remember(rival, world, 'declined', offer.kind);
        if (offer.kind === 'duel') House.accrueRivalFeud(player, world, rival.kingdomId, 3, 'a duel refused');
        return { line: this.fill((V[offer.kind] || {}).decline, this.vars(player, world, rival, offer)) };
    },
};
