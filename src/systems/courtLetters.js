// ============================================
// COURT LETTERS — the great write to you, and expect an answer
// ============================================
// Lords, your liege, the rival Houses (systems/house.js house.rivals), your
// spouse and your grown children married or fostered abroad send letters
// with real choices, a deadline and a cost for silence:
//   office_offer       your liege offers the next office up (Titles.appoint,
//                      reputation/renown waived as by a Prestige claim)
//   marriage_proposal  a realm proposes a match for an unwed grown child
//                      (Heirs.marryForAlliance, no dowry — they pay one)
//   feast_invite       a feast at court: a gift, renown, standing, news
//   tournament_invite  ride in the lists (three bouts on the duel engine,
//                      systems/duels.js, fought on instinct) or watch
//   call_to_arms       your liege at war: promise to ride (kept if you win a
//                      campaign battle against that enemy — RealmPolitics
//                      merit on player.politics — within the term, broken if
//                      not), send gold to the war chest, or refuse
//   loan_request       lend gold to a crown: repaid with interest on the due
//                      day (or defaulted — then a letter begging forbearance)
//   rival_truce / rival_tribute / rival_marriage   a rival House's feud
//   spouse_plea        your realm is at war with your spouse's homeland
//   child_news         a child married abroad writes: news and intelligence
//   child_hostage      that child's new home is at war with you
// Every answer moves real state: the lord's memory of you (world/npcLords.js
// rememberDeed — read by getLordOpinion and RealmWars.hostility), rival feud,
// gold (through the Ledger), reputation, spouse affection, war chests, House
// Prestige, a child's marriage.
//
// At most one new letter every few days, a small open inbox. The daily tick
// draws from its own seeded stream (world seed + day); the player's answers
// draw from Utils.random. State on player.letters (saved). Content:
// data/courtLetters.json. World / player are passed in; no import-time side
// effects.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { NPCLords } from '../world/npcLords.js';
import { KingdomAI } from '../world/kingdomAI.js';
import { House } from './house.js';
import { Heirs } from './heirs.js';
import { Titles } from './titles.js';
import { Throne } from './throne.js';
import { RealmWars } from './realmWars.js';
import { Relationships } from './relationships.js';
import { Upbringing } from './upbringing.js';
import { Duels } from './duels.js';
import { Ledger } from './ledger.js';
import { Mail } from './mail.js';
import { Coalitions } from './coalitions.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _day = world => (world && Number.isFinite(world.day) ? world.day : 0);

function _hash(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function _seed(world) {
    const p = world && world.generationParams;
    return (p && p.seed) || 0;
}

function _fill(text, vars) {
    return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}

function _between(range, fallback = 0) {
    if (!Array.isArray(range)) return _num(range, fallback);
    return Utils.randInt(Math.round(range[0]), Math.round(range[1]));
}

const DEFAULTS = { firstDay: 8, gap: [3, 7], maxOpen: 4, maxArchive: 30, sameSenderDays: 20 };

export const CourtLetters = {

    // ──────────── DATA ────────────

    data() {
        const g = DataLoader._gamedata;
        return (g && g.courtLetters) || { config: {}, kinds: {} };
    },

    config() {
        return { ...DEFAULTS, ...(this.data().config || {}) };
    },

    kinds() {
        return this.data().kinds || {};
    },

    kind(id) {
        return this.kinds()[id] || null;
    },

    // ──────────── STATE ────────────

    _blank() {
        return {
            inbox: [], archive: [], loans: [], promises: [], pending: [], nextId: 1, nextDay: null, lastFrom: {}, unread: 0,
            stats: { received: 0, answered: 0, ignored: 0, kept: 0, broken: 0, lent: 0, repaid: 0, defaulted: 0 },
        };
    },

    state(player) {
        if (!player) return this._blank();
        let st = player.letters;
        if (!st || typeof st !== 'object') {
            player.letters = this._blank();
            return player.letters;
        }
        const blank = this._blank();
        for (const k of ['inbox', 'archive', 'loans', 'promises', 'pending']) if (!Array.isArray(st[k])) st[k] = [];
        if (!(st.nextId > 0)) st.nextId = st.inbox.length + st.archive.length + 1;
        if (st.nextDay === undefined) st.nextDay = null;
        if (!st.lastFrom || typeof st.lastFrom !== 'object') st.lastFrom = {};
        if (!Number.isFinite(st.unread)) st.unread = 0;
        st.stats = { ...blank.stats, ...(st.stats || {}) };
        return st;
    },

    serialize(player) {
        return player && player.letters ? JSON.parse(JSON.stringify(player.letters)) : null;
    },

    /** Backfill for older saves (no letters yet). */
    loadState(player) {
        if (!player) return;
        if (player.letters) this.state(player);
        else player.letters = this._blank();
    },

    open(player) {
        return this.state(player).inbox;
    },

    // ──────────── WHO IS WHO ────────────

    _kingdoms(world) {
        return ((world && world.kingdoms) || []).filter(k => k && k.isAlive !== false && k.lord);
    },

    _ruled(player, world) {
        const k = Throne.ruledKingdom(player, world);
        return k ? k.id : null;
    },

    /** Is the player's side (their own war, their liege's, the realm they rule) at war with this kingdom? */
    atWar(player, world, kid) {
        if (!kid) return false;
        if (RealmWars.atWarWith(player, kid)) return true;
        const k = world && world.getKingdom ? world.getKingdom(kid) : null;
        const wars = (k && k.wars) || [];
        if (player.allegiance && wars.includes(player.allegiance)) return true;
        const ruled = this._ruled(player, world);
        return !!(ruled && wars.includes(ruled));
    },

    regard(player, world, kingdom) {
        if (!kingdom || !kingdom.lord) return 0;
        const rep = (player.reputation && player.reputation[kingdom.id]) || 0;
        return NPCLords.getLordOpinion(kingdom.lord, player, world) + rep;
    },

    _lordName(kingdom) {
        return `${kingdom.lord.name || kingdom.ruler || 'The ruler'} of ${kingdom.name}`;
    },

    /** Grown, unwed children at home. */
    _unwedChildren(player) {
        return ((player && player.children) || []).filter(c => {
            if (!c || c.isAlive === false) return false;
            const up = Upbringing.ensure(c);
            return up.comeOfAge && !up.spouse && !Upbringing.isAway(c);
        });
    },

    /** Children living abroad: married into, or fostered at, a kingdom's court. */
    _childrenAbroad(player, world) {
        const out = [];
        for (const c of (player && player.children) || []) {
            if (!c || c.isAlive === false) continue;
            const up = Upbringing.ensure(c);
            const sp = up.spouse;
            let kid = null;
            if (sp && (sp.kind === 'alliance' || sp.kind === 'royal') && sp.kingdomId) kid = sp.kingdomId;
            else if (up.placement && up.placement.kind === 'ward' && !up.placement.returned) kid = up.placement.kingdomId;
            if (!kid || up.recalledHome) continue;
            const k = world.getKingdom(kid);
            if (k && k.isAlive !== false && k.lord) out.push({ child: c, up, kingdom: k });
        }
        return out;
    },

    _spouse(player) {
        if (!player || !player.spouse) return null;
        const npc = Relationships.getNPC(player.spouse);
        return npc && npc.isAlive !== false ? npc : null;
    },

    /** The next office up the liege could give: rank above yours, reputation/renown waived. */
    offerTitle(player, world) {
        const defs = Titles.getTitleDefinitions() || {};
        const cur = player.currentTitle && defs[player.currentTitle] ? defs[player.currentTitle].rank || 0 : 0;
        const ranked = Object.entries(defs).filter(([, t]) => (t.rank || 0) > cur).sort((a, b) => (a[1].rank || 0) - (b[1].rank || 0));
        if (!ranked.length) return null;
        const rank = ranked[0][1].rank || 0;
        for (const [id, t] of ranked.filter(([, t]) => (t.rank || 0) === rank)) {
            if (Titles.meetsRequirements(player, id, world, { waive: Titles.CLAIM_WAIVES }).meets) return { id, def: t };
        }
        return null;
    },

    // ──────────── CANDIDATES (who could write what) ────────────

    _candidates(world, player, kindId) {
        const K = this.kind(kindId) || {};
        const ruled = this._ruled(player, world);
        const lords = this._kingdoms(world).filter(k => k.id !== ruled);
        const peaceful = lords.filter(k => !this.atWar(player, world, k.id));
        const out = [];
        const lordCtx = (k, extra = {}) => ({ key: `lord:${k.id}`, from: { type: 'lord', kingdomId: k.id, name: this._lordName(k) }, kingdom: k, ...extra });

        switch (kindId) {
            case 'office_offer': {
                const liege = player.allegiance ? lords.find(k => k.id === player.allegiance) : null;
                if (!liege || this.regard(player, world, liege) < _num(K.minOpinion)) break;
                const t = this.offerTitle(player, world);
                if (t) out.push({ ...lordCtx(liege), title: t });
                break;
            }
            case 'marriage_proposal': {
                const kids = this._unwedChildren(player);
                if (!kids.length) break;
                const rivals = (player.house && player.house.rivals) || {};
                for (const k of peaceful) {
                    if (rivals[k.id]) continue;
                    if (((player.reputation && player.reputation[k.id]) || 0) < _num(K.minReputation)) continue;
                    out.push({ ...lordCtx(k), child: kids[0] });
                }
                break;
            }
            case 'feast_invite':
            case 'tournament_invite':
                for (const k of peaceful) if (this.regard(player, world, k) >= _num(K.minOpinion)) out.push(lordCtx(k));
                break;
            case 'call_to_arms': {
                const liege = player.allegiance ? lords.find(k => k.id === player.allegiance) : null;
                if (!liege || !(liege.wars || []).length) break;
                const st = this.state(player);
                for (const eid of liege.wars) {
                    const e = world.getKingdom(eid);
                    if (!e || e.isAlive === false) continue;
                    if (st.promises.some(p => p.liegeId === liege.id && p.enemyId === eid)) continue;
                    out.push({ ...lordCtx(liege), key: `liege:${liege.id}:${eid}`, enemy: e });
                }
                break;
            }
            case 'loan_request': {
                const st = this.state(player);
                const amount = Math.round(Utils.clamp(_num(player.gold) * _num(K.share, 0.15), _num(K.min, 100), _num(K.max, 2000)));
                if (_num(player.gold) < amount * 2) break;
                for (const k of peaceful) {
                    if (st.loans.some(l => l.kingdomId === k.id && (l.status === 'open' || l.status === 'defaulted'))) continue;
                    if (this.regard(player, world, k) < _num(K.minOpinion)) continue;
                    out.push({ ...lordCtx(k), amount });
                }
                break;
            }
            case 'rival_truce':
            case 'rival_tribute':
            case 'rival_marriage': {
                const rivals = (player.house && player.house.rivals) || {};
                const kids = kindId === 'rival_marriage' ? this._unwedChildren(player) : [];
                if (kindId === 'rival_marriage' && !kids.length) break;
                for (const r of Object.values(rivals)) {
                    if (!r || _num(r.feud) < _num(K.minFeud)) continue;
                    const k = world.getKingdom(r.kingdomId);
                    if (!k || k.isAlive === false) continue;
                    out.push({ key: `rival:${r.kingdomId}`, from: { type: 'rival', kingdomId: r.kingdomId, name: r.name }, kingdom: k, rival: r, child: kids[0] || null });
                }
                break;
            }
            case 'spouse_plea': {
                const sp = this._spouse(player);
                const kid = sp && (player.marriageAllianceKingdom || sp.kingdomId);
                const k = kid ? world.getKingdom(kid) : null;
                if (!k || k.isAlive === false || !this.atWar(player, world, kid)) break;
                out.push({ key: `spouse:${sp.id}`, from: { type: 'spouse', npcId: sp.id, kingdomId: kid, name: sp.firstName || 'Your spouse' }, kingdom: k, spouse: sp });
                break;
            }
            case 'child_news':
            case 'child_hostage': {
                const st = this.state(player);
                for (const a of this._childrenAbroad(player, world)) {
                    const war = this.atWar(player, world, a.kingdom.id);
                    if ((kindId === 'child_hostage') !== war) continue;
                    if (kindId === 'child_hostage' && st.pending.some(p => p.childId === a.child.id)) continue;
                    out.push({ key: `child:${a.child.id}:${kindId}`, from: { type: 'child', childId: a.child.id, kingdomId: a.kingdom.id, name: a.child.firstName }, kingdom: a.kingdom, child: a.child });
                }
                break;
            }
        }
        return out;
    },

    // ──────────── COMPOSING ────────────

    /** The court news a child abroad writes of (deterministic, from the realm's state). */
    _news(world, kingdom) {
        const bits = [];
        const wars = (kingdom.wars || []).map(id => world.getKingdom(id)).filter(Boolean).map(k => k.name);
        bits.push(wars.length ? `the realm is at war with ${wars.join(' and ')}` : 'the realm is at peace');
        const mil = _num(kingdom.military);
        bits.push(mil > 400 ? 'the barracks are full' : mil > 150 ? 'the levies drill in the yards' : 'the army is thin');
        const gold = _num(kingdom.treasury);
        bits.push(gold > 5000 ? 'the treasury is rich' : gold > 1000 ? 'the treasury is sound' : 'the treasury is nearly empty');
        if (kingdom.lord && kingdom.lord.age >= 65) bits.push(`${kingdom.lord.name} grows old`);
        return `"Here ${bits.join('; ')}. I am well, and I think of home."`;
    },

    /** Build a letter of `kindId` from a candidate context (no state change). */
    compose(world, player, kindId, ctx) {
        const K = this.kind(kindId) || {};
        const day = _day(world);
        const k = ctx.kingdom;
        const vars = { from: ctx.from.name, realm: k ? k.name : '' };
        const data = {};
        if (ctx.child) { vars.child = ctx.child.firstName; data.childId = ctx.child.id; }
        switch (kindId) {
            case 'office_offer':
                vars.title = ctx.title.def.name; data.titleId = ctx.title.id;
                break;
            case 'marriage_proposal':
                data.amount = _between(K.dowry, 150); vars.amount = data.amount;
                break;
            case 'feast_invite':
                data.amount = _between(K.cost, 50); vars.amount = data.amount;
                break;
            case 'tournament_invite':
                data.amount = _between(K.fee, 30); vars.amount = data.amount;
                data.prize = _between(K.prize, 250); vars.prize = data.prize;
                break;
            case 'call_to_arms': {
                vars.enemy = ctx.enemy.name; data.enemyId = ctx.enemy.id;
                const g = Array.isArray(K.gold) ? K.gold : [100, 1500];
                data.amount = Math.round(Utils.clamp(_num(player.gold) * _num(K.goldShare, 0.1), g[0], g[1]));
                vars.amount = data.amount;
                data.days = _num(K.promiseDays, 30); vars.days = data.days;
                break;
            }
            case 'loan_request': {
                data.amount = ctx.amount; vars.amount = ctx.amount;
                const ir = Array.isArray(K.interest) ? K.interest : [0.1, 0.1];
                data.rate = Math.round(Utils.randFloat(ir[0], ir[1]) * 100) / 100;
                vars.interest = `${Math.round(data.rate * 100)}%`;
                data.days = _between(K.term, 90); vars.days = data.days;
                break;
            }
            case 'loan_default':
                data.amount = ctx.amount; vars.amount = ctx.amount; data.loanId = ctx.loanId;
                break;
            case 'rival_truce':
            case 'rival_marriage':
                vars.feudCut = _num(K.feudCut);
                break;
            case 'rival_tribute': {
                data.amount = Math.round(Utils.clamp(_num(player.gold) * _num(K.share, 0.05), _num(K.min, 100), _num(K.max, 1000)));
                vars.amount = data.amount; vars.feudCut = _num(K.feudCut);
                break;
            }
            case 'spouse_plea':
                if (RealmWars.atWarWith(player, k.id)) {
                    const kk = world.getKingdom(k.id);
                    data.amount = kk ? RealmWars.peacePrice(player, kk) : 0;
                    vars.amount = data.amount;
                }
                break;
            case 'child_news':
                vars.news = this._news(world, k);
                data.amount = _num(K.gift, 40); vars.amount = data.amount;
                break;
            case 'coalition_ultimatum':
                data.coalitionId = ctx.coalitionId;
                data.amount = _num(ctx.amount); vars.amount = data.amount;
                data.prestige = _num(ctx.prestige); vars.prestige = data.prestige;
                vars.league = ctx.league; vars.members = ctx.members; vars.cause = ctx.cause; vars.days = ctx.days;
                break;
            case 'child_hostage': {
                const r = Array.isArray(K.ransom) ? K.ransom : [100, 600];
                data.amount = Math.round(Utils.clamp(_num(player.gold) * _num(K.ransomShare, 0.05) + r[0], r[0], r[1]));
                vars.amount = data.amount;
                break;
            }
        }
        return {
            id: 0, kind: kindId, day, expires: day + _num(K.expiry, 10),
            from: ctx.from, key: ctx.key, vars, data,
            subject: _fill(K.subject, vars), body: _fill(K.body, vars), read: false,
        };
    },

    /** Put a letter in the inbox. Returns it. */
    deliver(player, letter) {
        const st = this.state(player);
        letter.id = st.nextId++;
        st.inbox.push(letter);
        st.lastFrom[letter.key] = letter.day;
        st.unread++;
        st.stats.received++;
        return letter;
    },

    // ──────────── DAILY TICK ────────────

    _dayRng(world) {
        return Utils.seededRandom((_hash(`${_seed(world)}:courtLetters:${_day(world)}`) % 233279) + 1);
    },

    /**
     * One day: overdue letters lapse (the cost of silence), loans fall due,
     * promises are judged, a held child's fate is settled, and perhaps a new
     * letter arrives. Returns { notices, arrived }.
     */
    processDay(world, player) {
        const out = { notices: [], arrived: [] };
        if (!world || !player || !Array.isArray(world.kingdoms)) return out;
        Utils.withRng(this._dayRng(world), () => this._tick(world, player, out));
        return out;
    },

    _tick(world, player, out) {
        const st = this.state(player);
        const cfg = this.config();
        const day = _day(world);

        // Letters left unanswered
        for (const letter of st.inbox.slice()) {
            if (day > letter.expires) this._lapse(world, player, letter, out);
        }
        this._loans(world, player, out);
        this._promises(world, player, out);
        this._pending(world, player, out);

        // Perhaps a new letter
        if (st.nextDay == null) st.nextDay = Math.max(day, cfg.firstDay) + Utils.randInt(0, cfg.gap[1]);
        // Answers to the player's own mail (kinds marked mail) don't crowd the court out
        const courtOpen = st.inbox.filter(l => !(this.kind(l.kind) || {}).mail).length;
        if (day < st.nextDay || courtOpen >= cfg.maxOpen) return;
        const pool = [];
        for (const [id, K] of Object.entries(this.kinds())) {
            if (!(K.weight > 0)) continue;
            const cands = this._candidates(world, player, id).filter(c =>
                !st.inbox.some(l => l.key === c.key && l.kind === id)
                && !(st.lastFrom[c.key] != null && day - st.lastFrom[c.key] < cfg.sameSenderDays));
            if (cands.length) pool.push({ value: { id, cands }, weight: K.weight });
        }
        st.nextDay = day + Utils.randInt(cfg.gap[0], cfg.gap[1]);
        if (!pool.length) return;
        const pick = Utils.weightedPick(pool);
        const letter = this.deliver(player, this.compose(world, player, pick.id, Utils.randPick(pick.cands)));
        out.arrived.push(letter);
        out.notices.push({ icon: '✉️', title: 'A Letter Arrives', text: `${letter.from.name}: ${letter.subject}. Read it in Journal → Letters (answer within ${letter.expires - day} days).`, type: 'info' });
    },

    _archive(player, letter, outcome, text) {
        const st = this.state(player);
        st.inbox = st.inbox.filter(l => l !== letter);
        st.archive.unshift({ id: letter.id, kind: letter.kind, day: letter.day, from: letter.from, subject: letter.subject, outcome, text });
        if (st.archive.length > this.config().maxArchive) st.archive.length = this.config().maxArchive;
    },

    /** A letter's deadline passed unanswered: silence has its price. */
    _lapse(world, player, letter, out) {
        const st = this.state(player);
        const K = this.kind(letter.kind) || {};
        const k = letter.from.kingdomId ? world.getKingdom(letter.from.kingdomId) : null;
        const lord = k && k.lord;
        const remember = (deed, opts = {}) => lord && NPCLords.rememberDeed(world, lord, deed, { note: opts.note || letter.subject, ...opts });
        switch (letter.kind) {
            case 'call_to_arms':
                remember('call_ignored');
                this._rep(player, letter.from.kingdomId, _num(K.ignoreReputation, -15));
                break;
            case 'marriage_proposal': {
                const d = NPCLords.deedDef('match_refused');
                remember('match_refused', { weight: d ? d.weight / 2 : undefined });
                break;
            }
            case 'rival_truce': House.accrueRivalFeud(player, world, letter.from.kingdomId, _num(K.ignoreFeud, 3), 'truce ignored'); break;
            case 'rival_tribute':
                House.accrueRivalFeud(player, world, letter.from.kingdomId, _num(K.ignoreFeud, 12), 'tribute ignored');
                remember('rival_defied');
                break;
            case 'rival_marriage': House.accrueRivalFeud(player, world, letter.from.kingdomId, Math.round(_num(K.refuseFeud, 8) / 2), 'match ignored'); break;
            case 'spouse_plea': this._affection(player, letter.from.npcId, _num(K.ignoreAffection, -20)); break;
            case 'child_news': this._rep(player, letter.from.kingdomId, -1); break;
            case 'child_hostage': this._risk(world, player, letter, false); break;
            case 'loan_default': this._loanStatus(player, letter.data.loanId, 'written off'); break;
            case 'coalition_ultimatum': break; // the league marches on its own deadline (systems/coalitions.js)
            default:
                // Replies to the player's mail (systems/mail.js): silence costs only what lapseReply says
                if (K.mail) Mail.lapseReply(world, player, letter);
                else remember('letter_ignored');
        }
        st.stats.ignored++;
        const text = _fill(K.ignored, letter.vars);
        this._archive(player, letter, 'ignored', text);
        out.notices.push({ icon: '✉️', title: 'A Letter Unanswered', text, type: 'warning' });
    },

    _rep(player, kid, n) {
        if (!kid || !n) return;
        if (!player.reputation) player.reputation = {};
        player.reputation[kid] = Utils.clamp((player.reputation[kid] || 0) + n, -100, 100);
    },

    _affection(player, npcId, n) {
        if (!npcId || !player.relationships) return;
        const rel = Relationships.getRelationship(player, npcId);
        rel.affection = Utils.clamp(_num(rel.affection) + n, 0, 100);
    },

    _gold(player, cat, amount) {
        player.gold = _num(player.gold) + amount;
        Ledger.record(player, cat, amount);
    },

    _loanStatus(player, loanId, status) {
        const loan = this.state(player).loans.find(l => l.id === loanId);
        if (loan) loan.status = status;
        return loan;
    },

    /** Loans that fall due today: repaid with interest, or defaulted. */
    _loans(world, player, out) {
        const st = this.state(player);
        const day = _day(world);
        for (const loan of st.loans) {
            if (loan.status !== 'open' || day < loan.due) continue;
            const k = world.getKingdom(loan.kingdomId);
            const owed = loan.principal + loan.interest;
            if (!k || k.isAlive === false || !k.lord) {
                loan.status = 'lost';
                st.stats.defaulted++;
                out.notices.push({ icon: '📉', title: 'A Loan Lost', text: `${loan.kingdomName} has fallen; the ${loan.principal} gold you lent is lost.`, type: 'warning' });
                continue;
            }
            let chance = 0.45 + _num(k.lord.honor, 5) * 0.04 + (_num(k.treasury) >= owed ? 0.3 : -0.25);
            if (k.lord.name !== loan.lordName) chance -= 0.1; // the heir pays his father's debts less gladly
            if (Utils.random() < Utils.clamp(chance, 0.05, 0.97)) {
                loan.status = 'repaid';
                k.treasury = Math.max(0, _num(k.treasury) - owed);
                this._gold(player, 'lordLoans', loan.principal);
                this._gold(player, 'lordLoanInterest', loan.interest);
                st.stats.repaid++;
                out.notices.push({ icon: '🏦', title: 'A Loan Repaid', text: `${loan.kingdomName} repays the ${loan.principal} gold you lent, with ${loan.interest} gold interest.`, type: 'success' });
            } else {
                loan.status = 'defaulted';
                st.stats.defaulted++;
                const letter = this.deliver(player, this.compose(world, player, 'loan_default', {
                    key: `loan:${loan.id}`, from: { type: 'lord', kingdomId: k.id, name: this._lordName(k) }, kingdom: k,
                    amount: owed, loanId: loan.id,
                }));
                out.arrived.push(letter);
                out.notices.push({ icon: '📉', title: 'A Loan Defaulted', text: `${loan.kingdomName} cannot repay the ${owed} gold it owes you. A letter has come begging your patience.`, type: 'warning' });
            }
        }
    },

    /** Promises to ride for the liege: kept by a campaign win against that enemy, broken when the term runs out. */
    _promises(world, player, out) {
        const st = this.state(player);
        const day = _day(world);
        const merit = (player.politics && player.politics.merit) || {};
        for (const p of st.promises.slice()) {
            const liege = world.getKingdom(p.liegeId);
            const now = _num(merit[`${p.liegeId}:${p.enemyId}`]);
            const won = now > p.meritAtStart;
            const over = !liege || !(liege.wars || []).includes(p.enemyId);
            if (won) {
                if (liege) NPCLords.rememberDeed(world, liege.lord, 'kept_promise', { note: `rode against ${p.enemyName}` });
                st.stats.kept++;
                out.notices.push({ icon: '🤝', title: 'Your Word Kept', text: `You rode against ${p.enemyName} as you promised ${p.lordName}. It will be remembered.`, type: 'success' });
            } else if (day >= p.due && !over) {
                if (liege) NPCLords.rememberDeed(world, liege.lord, 'broken_promise', { note: `never rode against ${p.enemyName}` });
                this._rep(player, p.liegeId, -10);
                st.stats.broken++;
                out.notices.push({ icon: '🕯️', title: 'A Promise Broken', text: `You promised ${p.lordName} you would ride against ${p.enemyName}, and you did not.`, type: 'error' });
            } else if (!over) {
                continue;
            }
            st.promises = st.promises.filter(x => x !== p);
        }
    },

    /** A child trusted to a court at war: on the day, held if that crown thinks ill of you. */
    _pending(world, player, out) {
        const st = this.state(player);
        const day = _day(world);
        for (const p of st.pending.slice()) {
            if (day < p.due) continue;
            st.pending = st.pending.filter(x => x !== p);
            const k = world.getKingdom(p.kingdomId);
            const child = ((player.children) || []).find(c => c && c.id === p.childId);
            if (!k || !k.lord || !child || child.isAlive === false) continue;
            const K = this.kind('child_hostage') || {};
            const atWar = this.atWar(player, world, k.id);
            const regard = this.regard(player, world, k);
            if (atWar && Utils.random() < Utils.clamp(0.5 - regard / 100, 0.05, 0.9)) {
                if (player.house) House.spend(player.house, Math.min(_num(K.heldPrestige, 8), Math.max(0, _num(player.house.prestige))), `${child.firstName} held at ${k.name}`, day);
                this._rep(player, k.id, _num(K.heldReputation, -10));
                Upbringing.ensure(child).heldBy = { kingdomId: k.id, day };
                if (player.house) House._chronicle(player.house, world, `${child.firstName} is held as a hostage at the court of ${k.name}.`, ['heirs', 'war']);
                out.notices.push({ icon: '⛓️', title: `${child.firstName} Held`, text: `The court of ${k.name} holds ${child.firstName} as a hostage. Your House is shamed.`, type: 'error' });
            } else {
                out.notices.push({ icon: '🕊️', title: `${child.firstName} Safe`, text: `${k.name} kept faith: ${child.firstName} is safe among their spouse's kin.`, type: 'success' });
            }
        }
    },

    _risk(world, player, letter, trusted) {
        const K = this.kind('child_hostage') || {};
        const st = this.state(player);
        st.pending.push({ childId: letter.data.childId, kingdomId: letter.from.kingdomId, due: _day(world) + _num(K.riskDays, 20), trusted });
    },

    // ──────────── READING & ANSWERING ────────────

    markRead(player) {
        const st = this.state(player);
        for (const l of st.inbox) l.read = true;
        st.unread = 0;
    },

    /** The choices a letter offers now: [{ id, label, tooltip, ok, why }]. */
    choicesFor(player, world, letter) {
        const K = this.kind(letter.kind) || {};
        const vars = { ...letter.vars, feudCut: _num(K.feudCut) };
        const gold = _num(player.gold);
        const amount = _num(letter.data.amount);
        const out = [];
        for (const [id, c] of Object.entries(K.choices || {})) {
            let ok = true;
            let why = '';
            if (K.mail) {
                const chk = Mail.choiceCheck(player, world, letter, id);
                if (chk.hide) continue;
                ok = chk.ok;
                why = chk.why || '';
            }
            const needGold = (n) => { if (gold < n) { ok = false; why = `You need ${n} gold.`; } };
            switch (`${letter.kind}:${id}`) {
                case 'marriage_proposal:accept':
                case 'rival_marriage:accept': {
                    const child = (player.children || []).find(x => x && x.id === letter.data.childId);
                    const up = child && Upbringing.ensure(child);
                    if (!child || child.isAlive === false || !up || up.spouse || Upbringing.isAway(child)) { ok = false; why = `${letter.vars.child || 'The child'} can no longer be matched.`; }
                    break;
                }
                case 'feast_invite:attend':
                case 'tournament_invite:compete':
                case 'call_to_arms:gold':
                case 'loan_request:lend':
                case 'rival_tribute:pay':
                case 'child_news:gift':
                case 'child_hostage:recall':
                case 'coalition_ultimatum:concede':
                    needGold(amount);
                    break;
                case 'coalition_ultimatum:bow': {
                    const need = _num(letter.data.prestige);
                    if (_num(player.house && player.house.prestige) < need) { ok = false; why = `You need ${need} Prestige.`; }
                    break;
                }
                case 'call_to_arms:ride':
                    if (!player.army || !player.army.length) { ok = false; why = 'You have no army to ride with.'; }
                    break;
                case 'spouse_plea:terms':
                    if (!RealmWars.atWarWith(player, letter.from.kingdomId)) continue; // only for your own war
                    needGold(amount);
                    break;
                case 'office_offer:accept': {
                    const check = Titles.meetsRequirements(player, letter.data.titleId, world, { waive: Titles.CLAIM_WAIVES });
                    if (!check.meets) { ok = false; why = check.reason || 'You no longer qualify.'; }
                    break;
                }
            }
            out.push({ id, label: _fill(c.label, vars), tooltip: _fill(c.tooltip, vars), ok, why });
        }
        return out;
    },

    /** Answer an open letter. Returns { success, text, lines } or { success: false, reason }. */
    answer(player, world, letterId, choiceId) {
        const st = this.state(player);
        const letter = st.inbox.find(l => l.id === letterId);
        if (!letter) return { success: false, reason: 'That letter is no longer before you.' };
        const K = this.kind(letter.kind) || {};
        const choice = this.choicesFor(player, world, letter).find(c => c.id === choiceId);
        if (!choice) return { success: false, reason: 'That is not an answer this letter allows.' };
        if (!choice.ok) return { success: false, reason: choice.why };
        const res = K.mail ? Mail.answerReply(player, world, letter, choiceId) : this._apply(player, world, letter, choiceId, K);
        if (res && res.success === false) return res;
        const def = (K.choices || {})[choiceId] || {};
        const text = _fill(def.result, { ...letter.vars, feudCut: _num(K.feudCut) });
        const lines = (res && res.lines) || [];
        st.stats.answered++;
        this._archive(player, letter, choiceId, [text, ...lines].join(' '));
        return { success: true, text, lines };
    },

    _apply(player, world, letter, choiceId, K) {
        const day = _day(world);
        const kid = letter.from.kingdomId;
        const k = kid ? world.getKingdom(kid) : null;
        const lord = k && k.lord;
        const amount = _num(letter.data.amount);
        const lines = [];
        const remember = (deed, opts = {}) => { if (lord) NPCLords.rememberDeed(world, lord, deed, { note: letter.subject, ...opts }); };
        const feud = (n, why) => House.accrueRivalFeud(player, world, kid, n, why);

        switch (`${letter.kind}:${choiceId}`) {
            case 'office_offer:accept': {
                const r = Titles.appoint(player, letter.data.titleId, world, { waive: Titles.CLAIM_WAIVES });
                if (!r.success) return { success: false, reason: r.reason };
                remember('office_accepted', { note: r.title.name });
                lines.push(`${r.title.icon || '🏅'} ${r.title.name} · ${r.title.salary} gold a day.`);
                break;
            }
            case 'office_offer:decline': remember('office_refused'); break;
            case 'marriage_proposal:accept': {
                const r = Heirs.marryForAlliance(player, world, letter.data.childId, kid, { dowry: 0, minReputation: -100, deed: 'match_accepted' });
                if (!r.success) return { success: false, reason: r.reason };
                const paid = Math.min(amount, Math.max(0, _num(k && k.treasury, amount)));
                if (k) k.treasury = Math.max(0, _num(k.treasury) - paid);
                this._gold(player, 'diplomacy', paid);
                lines.push(`💍 ${r.child.firstName} weds ${r.spouse.name} · 💰 +${paid} gold.`);
                break;
            }
            case 'marriage_proposal:refuse': remember('match_refused'); break;
            case 'feast_invite:attend': {
                this._gold(player, 'feast', -amount);
                player.renown = _num(player.renown) + _num(K.renown, 2);
                this._rep(player, kid, _num(K.reputation, 4));
                remember('feast_attended');
                if (typeof player.learnAboutKingdom === 'function') player.learnAboutKingdom(kid, ['ruler', 'diplomacy']);
                lines.push(`⭐ +${_num(K.renown, 2)} renown · 📈 +${_num(K.reputation, 4)} reputation in ${k ? k.name : 'the realm'}.`);
                break;
            }
            case 'feast_invite:decline': remember('feast_declined'); break;
            case 'tournament_invite:compete': {
                this._gold(player, 'tournament', -amount);
                const t = this._tournament(player, world, letter);
                remember(t.champion ? 'tourney_champion' : 'tourney_attended');
                lines.push(t.text);
                break;
            }
            case 'tournament_invite:watch': {
                const d = NPCLords.deedDef('tourney_attended');
                remember('tourney_attended', { weight: d ? d.weight / 2 : undefined });
                this._rep(player, kid, 1);
                break;
            }
            case 'tournament_invite:decline': break;
            case 'call_to_arms:ride': {
                const merit = (player.politics && player.politics.merit) || {};
                const enemy = world.getKingdom(letter.data.enemyId);
                this.state(player).promises.push({
                    liegeId: kid, enemyId: letter.data.enemyId, enemyName: enemy ? enemy.name : letter.vars.enemy,
                    lordName: letter.from.name, day, due: day + _num(letter.data.days, 30),
                    meritAtStart: _num(merit[`${kid}:${letter.data.enemyId}`]),
                });
                remember('call_answered', { note: `against ${letter.vars.enemy}` });
                lines.push(`🤝 Fight ${letter.vars.enemy} for your liege within ${_num(letter.data.days, 30)} days (Realm Politics → Campaign).`);
                break;
            }
            case 'call_to_arms:gold': {
                this._gold(player, 'diplomacy', -amount);
                if (k) {
                    k.treasury = _num(k.treasury) + amount;
                    k.military = _num(k.military) + Math.floor(amount / 20);
                    if ((k.wars || []).includes(letter.data.enemyId) && amount >= 300) KingdomAI._warState(k, letter.data.enemyId, world).gains += 1;
                }
                remember('call_gold', { note: `${amount} gold` });
                lines.push(`💰 −${amount} gold to ${k ? k.name : 'the'} war chest.`);
                break;
            }
            case 'call_to_arms:refuse':
                remember('call_refused');
                this._rep(player, kid, _num(K.refuseReputation, -10));
                break;
            case 'loan_request:lend': {
                this._gold(player, 'lordLoans', -amount);
                if (k) k.treasury = _num(k.treasury) + amount;
                const st = this.state(player);
                st.loans.push({
                    id: `L${letter.id}`, kingdomId: kid, kingdomName: k ? k.name : '', lordName: lord ? lord.name : '',
                    principal: amount, interest: Math.round(amount * _num(letter.data.rate, 0.1)), day, due: day + _num(letter.data.days, 90), status: 'open',
                });
                st.stats.lent++;
                remember('loan_granted', { note: `${amount} gold` });
                break;
            }
            case 'loan_request:refuse': remember('loan_refused'); break;
            case 'loan_default:forgive':
                this._loanStatus(player, letter.data.loanId, 'forgiven');
                remember('loan_forgiven', { note: `${amount} gold` });
                break;
            case 'loan_default:demand': {
                const K2 = this.kind('loan_default') || {};
                const back = Math.min(Math.round(amount * _num(K2.recover, 0.5)), Math.max(0, Math.floor(_num(k && k.treasury))));
                if (back > 0 && Utils.random() < 0.6) {
                    if (k) k.treasury -= back;
                    this._gold(player, 'lordLoans', back);
                    lines.push(`💰 +${back} gold recovered.`);
                } else {
                    lines.push('Nothing comes back.');
                }
                this._loanStatus(player, letter.data.loanId, 'pressed');
                remember('insult', { weight: -6, note: 'pressed for a debt' });
                break;
            }
            case 'rival_truce:accept':
                feud(-_num(K.feudCut, 25), 'truce');
                remember('rival_truce');
                break;
            case 'rival_truce:refuse': feud(_num(K.refuseFeud, 5), 'truce refused'); break;
            case 'rival_tribute:pay':
                this._gold(player, 'diplomacy', -amount);
                if (k) k.treasury = _num(k.treasury) + amount;
                feud(-_num(K.feudCut, 20), 'tribute paid');
                break;
            case 'rival_tribute:refuse':
                feud(_num(K.refuseFeud, 10), 'tribute refused');
                remember('rival_defied');
                break;
            case 'rival_tribute:insult':
                feud(_num(K.insultFeud, 20), 'an insult');
                player.renown = _num(player.renown) + _num(K.insultRenown, 3);
                remember('insult');
                break;
            case 'rival_marriage:accept': {
                const r = Heirs.marryForAlliance(player, world, letter.data.childId, kid, { dowry: 0, minReputation: -100, deed: 'match_accepted' });
                if (!r.success) return { success: false, reason: r.reason };
                feud(-_num(K.feudCut, 60), 'a marriage');
                lines.push(`💍 ${r.child.firstName} weds ${r.spouse.name}.`);
                break;
            }
            case 'rival_marriage:refuse':
                feud(_num(K.refuseFeud, 8), 'a match refused');
                remember('match_refused');
                break;
            case 'spouse_plea:plead': {
                this._affection(player, letter.from.npcId, _num(K.affection, 12));
                remember('spouse_kin_spoken');
                const liege = player.allegiance ? world.getKingdom(player.allegiance) : null;
                if (liege && k && liege.id !== k.id) {
                    this._rep(player, liege.id, _num(K.liegeReputation, -5));
                    for (const [a, b] of [[liege, k], [k, liege]]) {
                        if (!a.relations) a.relations = {};
                        a.relations[b.id] = Utils.clamp(_num(a.relations[b.id]) + _num(K.relations, 8), -100, 100);
                    }
                }
                break;
            }
            case 'spouse_plea:terms': {
                const r = RealmWars.sueForPeace(player, world, kid);
                if (!r.success) return { success: false, reason: r.reason };
                Ledger.record(player, 'diplomacy', -r.cost);
                this._affection(player, letter.from.npcId, _num(K.affection, 12) * 2);
                lines.push(`🕊️ Peace with ${k ? k.name : 'the realm'} for ${r.cost} gold.`);
                break;
            }
            case 'spouse_plea:duty': this._affection(player, letter.from.npcId, _num(K.refuseAffection, -15)); break;
            case 'child_news:gift':
                this._gold(player, 'diplomacy', -amount);
                this._rep(player, kid, _num(K.giftReputation, 3));
                remember('gift', { weight: 3, note: `for ${letter.vars.child}'s household` });
                break;
            case 'child_news:intel': {
                const learned = typeof player.learnAboutKingdom === 'function' ? player.learnAboutKingdom(kid, ['ruler', 'military', 'diplomacy', 'economy']) : [];
                if (k) lines.push(`📜 ${k.name}: army ${Math.round(_num(k.military))}, treasury about ${Math.round(_num(k.treasury) / 100) * 100} gold, ${(k.wars || []).length ? `at war with ${(k.wars || []).map(id => (world.getKingdom(id) || {}).name).filter(Boolean).join(', ')}` : 'at peace'}${learned.length ? ` · learned of its ${learned.join(', ')}` : ''}.`);
                break;
            }
            case 'child_hostage:recall': {
                this._gold(player, 'diplomacy', -amount);
                const child = (player.children || []).find(c => c && c.id === letter.data.childId);
                if (child) {
                    const up = Upbringing.ensure(child);
                    up.recalledHome = { kingdomId: kid, day };
                    if (up.placement && up.placement.kind === 'ward') up.placement.returned = true;
                }
                remember('child_recalled');
                break;
            }
            case 'child_hostage:trust':
                remember('trusted_kin');
                this._risk(world, player, letter, true);
                break;
            // A league's terms (systems/coalitions.js): concede, or throw them back
            case 'coalition_ultimatum:concede':
            case 'coalition_ultimatum:bow': {
                const c = Coalitions.active(player);
                if (!c || c.id !== letter.data.coalitionId) return { success: false, reason: 'That league is no longer waiting on your answer.' };
                const r = Coalitions.concede(player, world, choiceId === 'bow' ? 'prestige' : 'gold', { fromLetter: true });
                if (!r.success) return r;
                lines.push(r.text);
                break;
            }
            case 'coalition_ultimatum:defy': {
                const c = Coalitions.active(player);
                if (!c || c.id !== letter.data.coalitionId) return { success: false, reason: 'That league is no longer waiting on your answer.' };
                const r = Coalitions.defy(player, world, { fromLetter: true });
                if (!r.success) return r;
                lines.push(r.text);
                break;
            }
        }
        return { success: true, lines };
    },

    /** Three bouts in the lists, fought on instinct (systems/duels.js). */
    _tournament(player, world, letter) {
        const field = Duels.tournamentField(null, []);
        const bouts = [];
        let me = Duels.fromPlayer(player);
        const armour = me.armour;
        for (const opp of field) {
            const result = Duels.autoResolve(me, opp, { playerYieldAt: 0.25 });
            bouts.push({ opponent: opp, result });
            if (!result.playerWon) break;
            me = Duels.fromPlayer(player);
        }
        const out = Duels.settleTournament(player, { prizePool: _num(letter.data.prize), bouts, armour, world });
        const text = out.champion ? `🏆 Champion of ${letter.vars.realm}'s lists! +${out.gold} gold, +${out.renown} renown.`
            : out.finalist ? `🥈 Runner-up: +${out.gold} gold, +${out.renown} renown.`
                : `Unhorsed after ${out.wins} win${out.wins === 1 ? '' : 's'}. +${out.renown} renown.`;
        return { champion: out.champion, text: out.harm > 0 ? `${text} −${out.harm} HP.` : text };
    },

    /** The inbox as the panel shows it. */
    view(player, world) {
        const st = this.state(player);
        const day = _day(world);
        return {
            open: st.inbox.map(l => ({
                id: l.id, kind: l.kind, icon: (this.kind(l.kind) || {}).icon || '✉️', from: l.from.name, fromType: l.from.type,
                subject: l.subject, body: l.body, daysLeft: Math.max(0, l.expires - day), read: !!l.read,
                choices: this.choicesFor(player, world, l),
            })),
            archive: st.archive.slice(0, 12),
            loans: st.loans.filter(l => l.status === 'open'),
            promises: st.promises.map(p => ({ ...p, daysLeft: Math.max(0, p.due - day) })),
            stats: st.stats,
        };
    },
};
