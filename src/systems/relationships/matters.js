// Relationships — matters: the people the player knows bring them things.
//
// A friend asks for a loan (and may not pay it back), a close friend tells
// you a secret about one of the great (the truth of a court scandal,
// systems/whispers.js), someone begs for help with a kinsman in trouble, a
// rival suitor calls on the one you are courting, a friend hears a rumour
// about you (systems/gossip.js, as it is told in their town) and wants to
// hear it from you, your spouse hears about your affair (or just senses it),
// an enemy badmouths you through their town. One open matter per person,
// settled face to face before it expires (and an ignored matter has its own
// price). Affairs: a married player may court someone else; every success
// risks an 'affair' rumour starting in that person's town, and when it
// reaches your spouse's town…
//
// Content: data/relationships.json → matters. State on the player's
// relationship records (rel.matter, rel.debt), saved with them. The daily
// turn draws from its own seeded stream (world seed + day), so it never
// reshuffles anyone else's dice; answering a matter draws from Utils.random.
import { Relationships } from './_ref.js';
import { Utils, Gossip, Whispers, Duels } from './_imports.js';

const _day = world => (world && Number.isFinite(world.day) ? world.day : 0);
const _num = v => (Number.isFinite(v) ? v : 0);

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

const DEFAULTS = {
    chancePerDay: 0.035, maxOpen: 3, expireDays: 18, heardChance: 0.35, jealousyChance: 0.06,
    rumorJealousyChance: 0.5, grudgeChance: 0.04, deedPraise: 2, loanDays: [20, 40], loanInterest: 0.2,
    affairRumorChance: 0.3, honesty: {}, conscience: {},
    // A loyal friend repays a debt more surely (honesty + (loyalty - 50) x loyaltyHonesty)
    loyaltyHonesty: 0.005,
    // Told the truth once ('heard_crime: admit'), they take your word more readily after (deny / lie rolls)
    trustBonus: 0.15,
    // An ignored grudge goes cold: no courting for coldDays; an ignored rival suitor marries them
    coldDays: 180, slanderDiscredit: 0.3,
};
const _loyalty = npc => (npc && Number.isFinite(npc.loyalty) ? npc.loyalty : 50);

const GIFT_COST = 40;
const PEACE_COST = 30;
const MAX_MEMORY = 30;

Object.assign(Relationships, {
    _mattersData() {
        const data = Relationships._getData();
        return (data && data.matters) || { config: {}, kinds: {} };
    },

    _mattersCfg() {
        return { ...DEFAULTS, ...(Relationships._mattersData().config || {}) };
    },

    _matterKind(kind) {
        return (Relationships._mattersData().kinds || {})[kind] || {};
    },

    _npcKey(npc) {
        return npc && npc.settlementQ != null && npc.settlementR != null ? `${npc.settlementQ},${npc.settlementR}` : null;
    },

    _fillMatter(text, m, npc) {
        return String(text || '').replace(/\{(\w+)\}/g, (all, k) => {
            if (k === 'npc') return npc ? npc.firstName : 'someone';
            if (k === 'place') return (npc && npc.settlementName) || 'town';
            if (k === 'truth') return m.truth ? 'true' : 'a lie';
            return m[k] != null ? String(m[k]) : all;
        });
    },

    _remember(rel, field, id) {
        if (!Array.isArray(rel[field])) rel[field] = [];
        rel[field].push(id);
        if (rel[field].length > MAX_MEMORY) rel[field].splice(0, rel[field].length - MAX_MEMORY);
    },

    _bump(rel, field, delta, lo = -100, hi = 100) {
        rel[field] = Utils.clamp(_num(rel[field]) + delta, lo, hi);
    },

    /** The open matter a person has with the player, or null. */
    getMatter(player, npcId) {
        const rel = player && player.relationships && player.relationships[npcId];
        return (rel && rel.matter) || null;
    },

    /** Everyone with something to settle: [{ npc, matter, title, icon }]. */
    openMatters(player) {
        const out = [];
        for (const [npcId, rel] of Object.entries((player && player.relationships) || {})) {
            if (!rel || !rel.matter) continue;
            const npc = Relationships.getNPC(npcId);
            if (!npc || !npc.isAlive) continue;
            const def = Relationships._matterKind(rel.matter.kind);
            out.push({ npc, matter: rel.matter, title: def.title || rel.matter.kind, icon: def.icon || '💬' });
        }
        return out;
    },

    _startMatter(player, npc, rel, kind, params, world) {
        const cfg = Relationships._mattersCfg();
        const def = Relationships._matterKind(kind);
        const day = _day(world);
        const lines = (def.ask || []).length;
        rel.matter = { kind, day, expires: day + cfg.expireDays, line: lines ? Utils.randInt(0, lines - 1) : 0, ...params };
        return {
            type: 'matter',
            icon: def.icon || '💬',
            title: def.title || 'A Word',
            text: Relationships._fillMatter(def.notice || '{npc} wants a word.', rel.matter, npc),
            npc: npc.firstName,
            npcId: npc.id,
        };
    },

    // ──────────── THE DAILY TURN ────────────

    /**
     * Debts fall due, ignored matters expire, rumours reach the people you
     * know, spouses grow suspicious, enemies talk, friends ask for things.
     * Returns events [{ type: 'matter', icon, title, text, npc }].
     */
    processMatters(player, world) {
        if (!player || !player.relationships) return [];
        const seed = (world && world.generationParams && world.generationParams.seed) || 0;
        const rng = Utils.seededRandom((_hash(`${seed}:matters:${_day(world)}`) % 233279) + 1);
        return Utils.withRng(rng, () => Relationships._mattersDay(player, world));
    },

    _mattersDay(player, world) {
        const events = [];
        const cfg = Relationships._mattersCfg();
        const day = _day(world);
        const people = Object.entries(player.relationships)
            .map(([npcId, rel]) => ({ npcId, rel, npc: Relationships.getNPC(npcId) }))
            .filter(p => p.rel && p.npc && p.npc.isAlive);

        // Debts falling due
        for (const { rel, npc } of people) {
            if (!rel.debt || day < rel.debt.due || rel.matter) continue;
            const honesty = (cfg.honesty[npc.personality] != null ? cfg.honesty[npc.personality] : 0.7) + (_loyalty(npc) - 50) * cfg.loyaltyHonesty;
            if (Utils.random() < honesty) {
                const back = Math.round(rel.debt.amount * (1 + cfg.loanInterest));
                player.gold = _num(player.gold) + back;
                Relationships._bump(rel, 'score', 5);
                delete rel.debt;
                events.push({ type: 'matter', icon: '💰', title: 'A Debt Repaid', text: `${npc.firstName} repaid your loan: ${back} gold, with thanks and something on top.`, npc: npc.firstName, npcId: npc.id });
            } else {
                events.push(Relationships._startMatter(player, npc, rel, 'debt', { amount: rel.debt.amount }, world));
            }
        }

        // Ignored matters
        for (const { rel, npc } of people) {
            const m = rel.matter;
            if (!m || day <= m.expires) continue;
            const def = Relationships._matterKind(m.kind);
            switch (m.kind) {
                case 'loan': Relationships._bump(rel, 'score', -3); break;
                case 'debt': delete rel.debt; Relationships._bump(rel, 'score', 3); break;
                case 'plea': Relationships._bump(rel, 'score', -8); break;
                case 'rival_suitor':
                    // ...and they are promised to the suitor: married, and no longer courted
                    rel.romantic = false;
                    rel.affection = 0;
                    Relationships._bump(rel, 'score', -5);
                    if (player.spouse !== npc.id) {
                        npc.isMarried = true;
                        npc.marriedTo = m.suitor || 'another';
                    }
                    break;
                case 'heard_crime': Relationships._bump(rel, 'score', -8); break;
                case 'jealousy': Relationships._bump(rel, 'affection', -12, 0, 100); break;
                case 'grudge':
                    // Cold and permanent (for a long while): they will not be courted or warmed to
                    Relationships._bump(rel, 'score', -10);
                    rel.closedUntil = day + _num(cfg.coldDays);
                    rel.romantic = false;
                    break;
                default: break;
            }
            events.push({ type: 'matter', icon: def.icon || '💬', title: 'A Matter Left', text: Relationships._fillMatter(def.expire || '{npc} gave up waiting for you.', m, npc), npc: npc.firstName, npcId: npc.id, ignored: true });
            delete rel.matter;
        }

        let open = people.filter(p => p.rel.matter).length;
        const room = () => open < cfg.maxOpen;

        // A spouse who hears, or senses, that there is someone else
        if (player.spouse && room()) {
            const spouse = Relationships.getNPC(player.spouse);
            const srel = player.relationships[player.spouse];
            if (spouse && spouse.isAlive && srel && !srel.matter) {
                const others = people.filter(p => p.npcId !== player.spouse && p.rel.romantic && _num(p.rel.affection) >= 30);
                const key = Relationships._npcKey(spouse);
                const heard = (player.gossip && player.gossip.rumors || []).find(r => !r.expired && r.type === 'affair'
                    && (Relationships.isInTravelParty(player, spouse.id) || (key && (r.spreadTo || []).includes(key)))
                    && !(srel.asked || []).includes(r.id));
                if (heard && Utils.random() < cfg.rumorJealousyChance) {
                    const other = others.find(o => `${o.npc.firstName} ${o.npc.dynasty}` === heard.victim.name || o.npc.firstName === heard.victim.name);
                    Relationships._remember(srel, 'asked', heard.id);
                    events.push(Relationships._startMatter(player, spouse, srel, 'jealousy', { other: heard.victim.name, otherId: other ? other.npcId : null, cause: 'rumor' }, world));
                    open++;
                } else if (others.length && Utils.random() < cfg.jealousyChance) {
                    const o = others[0];
                    events.push(Relationships._startMatter(player, spouse, srel, 'jealousy', { other: `${o.npc.firstName} ${o.npc.dynasty}`, otherId: o.npcId, cause: 'sense' }, world));
                    open++;
                }
            }
        }

        // Rumours about the player reach the people they know
        let praised = false;
        for (const { rel, npc } of people) {
            const key = Relationships._npcKey(npc);
            if (!key || _num(rel.score) < 10) continue;
            const rumors = (player.gossip && player.gossip.rumors) || [];
            // Good word: a small warmth, and a note now and then
            const deed = rumors.find(r => !r.expired && Gossip.isDeed(r) && (r.spreadTo || []).includes(key)
                && !(rel.praised || []).includes(r.id) && !((Gossip.tellingAt(r, key) || {}).stolen));
            if (deed) {
                Relationships._remember(rel, 'praised', deed.id);
                // As big as it's told in their town: a legend warms them more,
                // a soured telling hardly at all (Gossip.deedWeight)
                const warmth = Math.round(cfg.deedPraise * Gossip.deedWeight(deed, key));
                if (warmth > 0) Relationships._bump(rel, 'score', warmth);
                if (!praised && warmth > 0) {
                    praised = true;
                    events.push({ type: 'matter', icon: '📣', title: 'Word Gets Around', text: `${npc.firstName} in ${npc.settlementName} heard: "${Gossip.describeAt(deed, key)}" They're telling everyone they know you.`, npc: npc.firstName, npcId: npc.id });
                }
            }
            if (rel.matter || !room()) continue;
            const bad = rumors.find(r => !r.expired && !Gossip.isTalk(r) && (r.spreadTo || []).includes(key)
                && !(rel.asked || []).includes(r.id) && Gossip.localSeverity(r, key) >= 15 && !((Gossip.tellingAt(r, key) || {}).clears));
            if (bad && Utils.random() < cfg.heardChance) {
                Relationships._remember(rel, 'asked', bad.id);
                const falseCharge = bad.type === 'slander' || bad.type === 'merchant_slander';
                events.push(Relationships._startMatter(player, npc, rel, 'heard_crime', {
                    rumorId: bad.id, rumor: Gossip.describeAt(bad, key), severity: Math.round(Gossip.localSeverity(bad, key)), slander: falseCharge, crime: bad.type,
                }, world));
                open++;
            }
        }

        // Enemies talk
        for (const { rel, npc } of people) {
            if (rel.matter || !room() || _num(rel.score) > (Relationships._matterKind('grudge').maxScore ?? -30)) continue;
            if (Utils.random() >= cfg.grudgeChance) continue;
            const rumor = npc.settlementQ != null
                ? Gossip.accuse(player, world, 'slander', { q: npc.settlementQ, r: npc.settlementR, victim: `${npc.firstName} ${npc.dynasty}`, credibility: 0.6 })
                : null;
            events.push(Relationships._startMatter(player, npc, rel, 'grudge', { rumorId: rumor ? rumor.id : null }, world));
            open++;
        }

        // Friends and lovers ask for things
        for (const { npcId, rel, npc } of people) {
            if (rel.matter || !room()) continue;
            if (Utils.random() >= cfg.chancePerDay) continue;
            const kind = Relationships._pickMatterKind(player, npcId, rel, npc);
            if (!kind) continue;
            const params = Relationships._matterParams(player, kind, npc);
            if (!params) continue;
            events.push(Relationships._startMatter(player, npc, rel, kind, params, world));
            open++;
        }
        return events;
    },

    _pickMatterKind(player, npcId, rel, npc) {
        const kinds = Relationships._mattersData().kinds || {};
        const isSpouse = player.spouse === npcId;
        const score = _num(rel.score);
        const options = [];
        for (const [id, def] of Object.entries(kinds)) {
            if (def.auto) continue;
            if (def.minScore != null && score < def.minScore) continue;
            if (id === 'loan' && (isSpouse || rel.debt)) continue;
            if (id === 'rival_suitor') {
                if (!rel.romantic || isSpouse || npc.isMarried) continue;
                const a = _num(rel.affection);
                if (a < (def.minAffection ?? 25) || a > (def.maxAffection ?? 79)) continue;
            }
            options.push({ id, w: def.weight || 1 });
        }
        if (!options.length) return null;
        let roll = Utils.random() * options.reduce((s, o) => s + o.w, 0);
        for (const o of options) {
            roll -= o.w;
            if (roll < 0) return o.id;
        }
        return options[options.length - 1].id;
    },

    _matterParams(player, kind, npc) {
        const def = Relationships._matterKind(kind);
        const range = def.amount || [30, 90];
        switch (kind) {
            case 'loan':
                return { amount: Utils.randInt(range[0], range[1]), reason: Utils.randPick(def.reasons || ['Times are hard']) };
            case 'plea':
                return { amount: Utils.randInt(range[0], range[1]), kin: Utils.randPick(def.kin || ['My brother']), reason: Utils.randPick(def.trouble || ['is in trouble']) };
            case 'rival_suitor':
                return { suitor: Utils.randPick(def.suitors || ['another suitor']) };
            case 'confidence': {
                const sc = Whispers.secretIn(player, npc.kingdomId);
                if (sc) return { scandalId: sc.id, subject: sc.subject.name, truth: sc.truth };
                return { sorrow: true, sorrowLine: Utils.randInt(0, Math.max(0, (def.sorrow || []).length - 1)) };
            }
            default: return {};
        }
    },

    // ──────────── FACE TO FACE ────────────

    /** What the person says, and what the player can answer: { kind, icon, title, line, options[] } or null. */
    /**
     * The rival suitor as a duellist: data/relationships.json matters.kinds
     * .rival_suitor.suitorFoes maps each suitor to a townsperson's duel
     * profile (data/duels.json npcs.*) — a captain of the guard fights like a
     * guard, a travelling poet like a traveller. opts.duelMods: the player
     * layer's duel modifiers (mood, treasures, crafted arms' quality).
     */
    _suitorDuelists(player, m, opts = {}) {
        const def = Relationships._matterKind('rival_suitor') || {};
        const foes = def.suitorFoes || {};
        const type = foes[m.suitor] || def.defaultFoe || 'villager';
        const a = Duels.fromPlayer(player, { mods: opts.duelMods || {} });
        const b = Duels.fromNpc({ type, name: m.suitor, personalityTraits: [] });
        b.name = m.suitor;
        return { a, b };
    },

    /** The player's chance (0..1) of winning the suitor's duel, from a few bouts on a private stream. */
    _suitorOdds(player, m, opts = {}) {
        const { a, b } = Relationships._suitorDuelists(player, m, opts);
        let s = _hash(`suitor:${m.suitor}:${player.name || ''}`) || 1;
        const rng = () => {
            s = (s + 0x6D2B79F5) >>> 0;
            let t = s;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const N = 24;
        let won = 0;
        for (let i = 0; i < N; i++) {
            const r = Duels.autoResolve({ ...a }, { ...b }, { mode: 'firstBlood', rng });
            if (r.playerWon) won++;
        }
        return won / N;
    },

    matterView(player, npcId, opts = {}) {
        const m = Relationships.getMatter(player, npcId);
        const npc = Relationships.getNPC(npcId);
        if (!m || !npc) return null;
        const def = Relationships._matterKind(m.kind);
        const pickLine = list => (list && list.length ? list[(m.line || 0) % list.length] : '');
        let line = pickLine(def.ask);
        if (m.kind === 'confidence' && m.sorrow) line = (def.sorrow || [])[m.sorrowLine || 0] || line;
        const others = Relationships._otherLoves(player, npcId);
        if (m.kind === 'jealousy' && !m.other) line = pickLine(def.askNoName) || line;
        const gold = _num(player.gold);
        const charm = _num(player.charisma) || 5;
        const might = _num(player.strength) || 5;
        const pct = p => Math.round(Utils.clamp(p, 0.05, 0.95) * 100);
        const trust = Relationships._trustBonus(player.relationships && player.relationships[npcId]);
        const opt = (id, icon, label, extra = {}) => ({ id, icon, label, ...extra });
        let options = [];
        switch (m.kind) {
            case 'loan':
                options = [
                    opt('lend', '💰', `Here: ${m.amount} gold. Pay me back when you can.`, { cost: m.amount, disabled: gold < m.amount, reason: `You have ${gold} gold.` }),
                    opt('refuse', '✋', "I can't spare it. I'm sorry."),
                ];
                break;
            case 'debt':
                options = [
                    opt('forgive', '🕊️', "Forget the debt. We're friends."),
                    opt('demand', '⚖️', 'I need that money back. Now.', { chance: pct(0.35 + charm * 0.04) }),
                    opt('wait', '⏳', 'Pay me when you can. Another month.'),
                ];
                break;
            case 'confidence':
                options = m.sorrow
                    ? [opt('comfort', '🤝', "I'm here. Tell me everything."), opt('deflect', '😶', "That's... a lot to take in.")]
                    : [opt('keep', '🤐', 'Your secret is safe with me.'), opt('doubt', '🤨', 'Are you sure? That could hang someone.')];
                break;
            case 'plea':
                options = [
                    opt('pay', '💰', `Take ${m.amount} gold. Go, quickly.`, { cost: m.amount, disabled: gold < m.amount, reason: `You have ${gold} gold.` }),
                    opt('refuse', '✋', "I can't help you. I'm sorry."),
                ];
                break;
            case 'rival_suitor':
                options = [
                    opt('gift', '💐', 'Let me show you who cares more.', { cost: GIFT_COST, disabled: gold < GIFT_COST, reason: `You need ${GIFT_COST} gold.` }),
                    opt('duel', '⚔️', `I'll have a word with ${m.suitor}. Outside.`, { chance: pct(Relationships._suitorOdds(player, m, opts)) }),
                    opt('yield', '🚶', 'If they make you happy, go to them.'),
                ];
                break;
            case 'heard_crime':
                options = m.slander
                    ? [opt('deny', '🙅', "It's a lie, and I know who's spreading it."), opt('shrug', '🤷', 'Believe what you like.')]
                    : [
                        opt('deny', '🙅', 'Lies. Every word of it.', { chance: pct(0.85 - _num(m.severity) / 100 * 0.6 + (charm - 5) * 0.03 + trust), lie: true }),
                        opt('admit', '😔', "It's true. I won't lie to you."),
                        opt('justify', '🗡️', 'They had it coming.'),
                    ];
                break;
            case 'jealousy':
                options = others.length
                    ? [
                        opt('lie', '😇', "There's no one else. There never was.", { chance: pct(0.6 - (m.cause === 'rumor' ? 0.3 : 0) + (charm - 5) * 0.04 + trust), lie: true }),
                        opt('end', '💔', `It's over with ${m.other || 'them'}. I swear it.`),
                        opt('defy', '🔥', 'What I do is my own business.'),
                    ]
                    : [opt('truth', '💞', "There's no one else. Only you. Ask anyone.")];
                break;
            case 'grudge':
                options = [
                    opt('peace', '🕊️', "Let's end this. Here, for your trouble.", { cost: PEACE_COST, disabled: gold < PEACE_COST, reason: `You need ${PEACE_COST} gold.` }),
                    opt('threaten', '👊', 'Say one more word about me. Go on.', { chance: pct(0.3 + might * 0.05) }),
                ];
                break;
            default: break;
        }
        return { kind: m.kind, icon: def.icon || '💬', title: def.title || 'A Word', line: Relationships._fillMatter(line, m, npc), options, expires: m.expires };
    },

    /** The bonus to a deny / lie roll with someone the player once told a hard truth. */
    _trustBonus(r) {
        return r && r.trustsWord ? _num(Relationships._mattersCfg().trustBonus) : 0;
    },

    /** The player's other romances (affection 30+) besides this person. */
    _otherLoves(player, npcId) {
        return Object.entries(player.relationships || {})
            .filter(([id, rel]) => id !== npcId && rel && rel.romantic && _num(rel.affection) >= 30)
            .map(([id, rel]) => ({ id, rel, npc: Relationships.getNPC(id) }))
            .filter(o => o.npc && o.npc.isAlive);
    },

    /**
     * Answer a matter. Returns { ok, reply (their words), note, tone: 'good'|'bad'|'info', divorced? }.
     */
    /** opts.duelMods: the player layer's duel modifiers (PlayerEffects.duelModifiers) for a fight. */
    resolveMatter(player, npcId, optionId, world, opts = {}) {
        const npc = Relationships.getNPC(npcId);
        const rel = player && player.relationships && player.relationships[npcId];
        const m = rel && rel.matter;
        if (!npc || !m) return { ok: false, reason: 'There is nothing to settle.' };
        const view = Relationships.matterView(player, npcId, opts);
        const choice = view && view.options.find(o => o.id === optionId);
        if (!choice) return { ok: false, reason: 'Not an answer to this.' };
        if (choice.disabled) return { ok: false, reason: choice.reason || 'Not possible.' };
        const charm = _num(player.charisma) || 5;
        const might = _num(player.strength) || 5;
        const trust = Relationships._trustBonus(rel);
        const roll = p => Utils.random() < Utils.clamp(p, 0.05, 0.95);
        const score = d => { Relationships._bump(rel, 'score', d); return `${d >= 0 ? '+' : ''}${d}`; };
        const love = d => { Relationships._bump(rel, 'affection', d, 0, 100); return `${d >= 0 ? '+' : ''}${d}`; };
        const done = (reply, note, tone, extra = {}) => {
            delete rel.matter;
            npc.lastInteraction = _day(world);
            return { ok: true, reply, note, tone, ...extra };
        };
        const day = _day(world);

        switch (`${m.kind}:${optionId}`) {
            case 'loan:lend': {
                player.gold -= m.amount;
                const cfg = Relationships._mattersCfg();
                rel.debt = { amount: m.amount, due: day + Utils.randInt(cfg.loanDays[0], cfg.loanDays[1]), lent: day };
                return done('*takes your hands* You don\'t know what this means. I won\'t forget it.', `💰 −${m.amount} gold · 🤝 Relationship ${score(8)} · they'll repay in a month or so`, 'good');
            }
            case 'loan:refuse':
                return done('*nods, not quite hiding it* I understand. I shouldn\'t have asked.', `🤝 Relationship ${score(-4)}`, 'bad');
            case 'debt:forgive':
                delete rel.debt;
                player.karma = Math.min(100, _num(player.karma) + 2);
                return done('*tears up* I\'ll find a way to repay you. Not in coin, maybe. But I will.', `🕊️ Debt forgiven · 🤝 Relationship ${score(12)} · Karma +2`, 'good');
            case 'debt:demand':
                if (roll(0.35 + charm * 0.04)) {
                    const half = Math.ceil(m.amount / 2);
                    player.gold = _num(player.gold) + half;
                    delete rel.debt;
                    return done('*counts it out, coin by coin, without a word*', `💰 +${half} gold (half of it) · 🤝 Relationship ${score(-10)}`, 'bad');
                }
                return done('*flares up* I told you I haven\'t got it! What do you want, my shirt?', `😬 Nothing gained · 🤝 Relationship ${score(-20)}`, 'bad');
            case 'debt:wait':
                rel.debt.due = day + 30;
                return done('*breathes out* Thank you. Thank you. A month, I promise.', `⏳ Due in 30 days · 🤝 Relationship ${score(2)}`, 'info');
            case 'confidence:keep':
            case 'confidence:doubt': {
                const sc = m.scandalId != null ? Whispers.reveal(player, m.scandalId) : null;
                const known = sc ? ` · 🗝️ You know the truth about ${m.subject}: it's ${m.truth ? 'TRUE' : 'a lie'}` : '';
                if (optionId === 'keep') return done('*squeezes your arm* I knew I could trust you.', `🤝 Relationship ${score(4)}${known}`, 'good');
                return done('*stiffens* I\'m sure. I wish I weren\'t.', `🤝 Relationship ${score(-1)}${known}`, 'info');
            }
            case 'confidence:comfort':
                return done('*talks for an hour, then laughs at themselves* Thank you. I needed that.', `🤝 Relationship ${score(6)}`, 'good');
            case 'confidence:deflect':
                return done('*closes up* Forget I said anything.', `🤝 Relationship ${score(-2)}`, 'bad');
            case 'plea:pay':
                player.gold -= m.amount;
                npc.loyalty = Utils.clamp(_loyalty(npc) + 10, 0, 100);
                player.karma = Math.min(100, _num(player.karma) + 3);
                return done('*already running for the door* Bless you. Bless you!', `💰 −${m.amount} gold · 🤝 Relationship ${score(12)} · Karma +3`, 'good');
            case 'plea:refuse':
                return done('*goes white* Then I\'ll find another way. Or I won\'t.', `🤝 Relationship ${score(-6)}`, 'bad');
            case 'rival_suitor:gift':
                player.gold -= GIFT_COST;
                return done('*laughs, delighted* Oh, put it away. All right. You win. They can keep their flowers.', `💐 −${GIFT_COST} gold · 💗 Affection ${love(10)}`, 'good');
            case 'rival_suitor:duel': {
                // Fought out on the duel engine (systems/duels.js): your arms and
                // skill against the suitor's (a guard captain is no poet)
                const { a, b } = Relationships._suitorDuelists(player, m, opts);
                const fight = Duels.autoResolve(a, b, { mode: 'firstBlood' });
                const rounds = `${fight.rounds} exchange${fight.rounds === 1 ? '' : 's'}`;
                if (fight.playerWon) {
                    Gossip.spreadDeed(player, world, 'duel_won', { q: player.q, r: player.r, victim: m.suitor });
                    return done(`*eyes shining* You sent ${m.suitor} home with a bloody nose! Half the town saw it.`, `⚔️ Won (${rounds} against ${b.weapon}) · 💗 Affection ${love(15)} · word spreads`, 'good', { duel: fight });
                }
                // Hurt by how badly it went (Duels.harm: a share of the health lost)
                const hurt = Math.max(5, Math.round(Duels.harm(fight.aLost, [8, 22])));
                player.health = Math.max(1, _num(player.health) - hurt);
                return done(`*dabs at your split lip* ${m.suitor} didn't fight fair, did they? ...Did they?`, `⚔️ Beaten (${rounds}) · ❤️ −${hurt} health · 💗 Affection ${love(-5)}`, 'bad', { duel: fight });
            }
            case 'rival_suitor:yield':
                rel.romantic = false;
                rel.affection = 0;
                return done('*quietly* That\'s... generous of you. I\'ll remember it.', `💔 The romance is over · 🤝 Relationship ${score(5)}`, 'info');
            case 'heard_crime:deny':
                if (m.slander) {
                    // They believe you, and they say so about town: the slander loses its credit
                    const cfg = Relationships._mattersCfg();
                    const refuted = m.rumorId != null && Gossip.discredit(player, m.rumorId, Relationships._npcKey(npc), _num(cfg.slanderDiscredit));
                    return done('*relieved* I knew it. People will say anything. And I\'ll tell them so.', `🤝 Relationship ${score(3)}${refuted ? ` · 🗣️ ${npc.firstName} speaks up for you in ${npc.settlementName || 'town'}: the slander loses its credit` : ''}`, 'good');
                }
                if (roll(0.85 - _num(m.severity) / 100 * 0.6 + (charm - 5) * 0.03 + trust)) return done('*searches your face, then nods* I believe you. God help me, I do.', `🤝 Relationship ${score(2)}${trust ? ' · you told them the truth once before' : ''}`, 'good');
                // Caught in a lie: the trust you had is spent
                delete rel.trustsWord;
                npc.loyalty = Utils.clamp(_loyalty(npc) - 5, 0, 100);
                return done('*steps back* Don\'t. Don\'t lie to me on top of it.', `🙊 They saw through it · 🤝 Relationship ${score(-18)}`, 'bad');
            case 'heard_crime:shrug':
                return done('*frowns* That\'s not an answer.', `🤝 Relationship ${score(-3)}`, 'bad');
            case 'heard_crime:admit': {
                const cfg = Relationships._mattersCfg();
                const d = cfg.conscience[npc.personality] != null ? cfg.conscience[npc.personality] : -10;
                npc.loyalty = Utils.clamp(_loyalty(npc) + 5, 0, 100);
                rel.trustsWord = true;
                return done(d <= -12 ? '*long silence* At least you told me. I don\'t know what to do with it.' : '*nods slowly* Thank you for not lying. That counts for something.', `🤝 Relationship ${score(d)} · they trust your word`, d <= -12 ? 'bad' : 'info');
            }
            case 'heard_crime:justify': {
                const d = npc.personality === 'ambitious' || npc.personality === 'bold' ? 2 : npc.personality === 'kind' || npc.personality === 'gentle' ? -22 : -8;
                return done(d > 0 ? '*a hard smile* Then they did. Good.' : '*recoils* Listen to yourself.', `🤝 Relationship ${score(d)}`, d > 0 ? 'good' : 'bad');
            }
            case 'jealousy:truth':
                return done('*searches your face, then softens* ...I believe you. I\'m sorry.', `💗 Affection ${love(3)}`, 'good');
            case 'jealousy:lie':
                if (roll(0.6 - (m.cause === 'rumor' ? 0.3 : 0) + (charm - 5) * 0.04 + trust)) return done('*wants to believe it, and so does* All right. All right.', `😇 They believed you · 💗 Affection ${love(2)}`, 'good');
                return Relationships._jealousBlowup(player, rel, npc, world, done, love(-30), '*throws the cup* LIAR!');
            case 'jealousy:end': {
                // The one they named (when they named one); every other romance when they only sensed it
                const others = Relationships._otherLoves(player, npcId);
                const named = m.otherId != null ? others.filter(o => o.id === m.otherId) : [];
                const ended = named.length ? named : others;
                for (const o of ended) {
                    o.rel.romantic = false;
                    o.rel.affection = 0;
                    Relationships._bump(o.rel, 'score', -25);
                }
                const what = named.length ? `Your romance with ${named[0].npc.firstName} is over` : 'Your other romances are over';
                return done('*quiet, shaking* Thank you for telling me. We\'ll... we\'ll start again.', `💔 ${what} · 💗 Affection ${love(5)}`, 'info');
            }
            case 'jealousy:defy':
                return Relationships._jealousBlowup(player, rel, npc, world, done, love(-20), '*very quiet* I see. Then I know where I stand.');
            case 'grudge:peace':
                player.gold -= PEACE_COST;
                return done('*pockets it, eyes narrow, then relax* ...Fine. Water under the bridge.', `🕊️ −${PEACE_COST} gold · 🤝 Relationship ${score(30)}`, 'good');
            case 'grudge:threaten':
                if (roll(0.3 + might * 0.05)) {
                    const rumor = m.rumorId != null && player.gossip ? player.gossip.rumors.find(r => r.id === m.rumorId) : null;
                    if (rumor) rumor.expired = true;
                    return done('*backs off, white* All right! All right. I\'ll keep my mouth shut.', `🤐 The badmouthing stops · 🤝 Relationship ${score(-5)}`, 'info');
                }
                return done('*laughs in your face* Or what? Everyone will hear about this too.', `🤝 Relationship ${score(-10)}`, 'bad');
            default:
                return { ok: false, reason: 'Not an answer to this.' };
        }
    },

    /** A jealous spouse's anger: below 15 affection, the marriage ends. */
    _jealousBlowup(player, rel, npc, world, done, loveNote, line) {
        if (_num(rel.affection) < 15) {
            Relationships.divorce(player, world);
            return done(`${line} I'm leaving. Don't follow me.`, `💔 ${npc.firstName} has left you · the marriage is over`, 'bad', { divorced: true });
        }
        return done(line, `💔 Affection ${loveNote}`, 'bad');
    },

    /** A married player's success with someone else may start talk in that person's town. */
    _affairRisk(player, npc, world) {
        if (!player.spouse || !npc || npc.id === player.spouse) return null;
        if (Utils.random() >= Relationships._mattersCfg().affairRumorChance) return null;
        return Gossip.spreadDeed(player, world, 'affair', {
            q: npc.settlementQ, r: npc.settlementR, location: npc.settlementName, kingdom: npc.kingdomId, victim: `${npc.firstName} ${npc.dynasty}`,
        });
    },
});
