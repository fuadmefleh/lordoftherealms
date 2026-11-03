// ============================================
// NPC KNOWLEDGE — what townsfolk can truthfully tell the player
// ============================================
// The dialog's "What do you know of the realm?", "Tell me about this place"
// and the rumour fallback used to fill templates with random words (a made-up
// tariff, a made-up army). Here every answer is read from the world:
//
//   realm  — the ruler (and their temper), wars and allies, the army against
//            the other realms', how firmly the crown holds the land, its
//            tariffs, bans and embargoes (systems/tradePolicy.js), taxes, the
//            treasury and its debts, the faith and its unity, the harvest
//            outlook where the NPC lives (world/harvests.js);
//   town   — its size and realm, the buildings and who keeps them (the inner
//            map's, passed in), what its market is short of or glutted with
//            (world/settlementMarket.js), its guilds, the old places and the
//            outlaws round about (systems/delves.js, systems/outlawLairs.js);
//   rumour — a shortage in a town nearby, a lair raiding, a ruin nobody came
//            back from, a war, a failing harvest elsewhere, word of folk the
//            player knows.
//
// Who is asked matters (data/npcKnowledge.json): a noble knows the court, a
// guard the army, a merchant the tariffs; outside their own field an NPC
// speaks from hearsay — a band can be off by one, and they say so ("— or so
// folk say"). How they feel about the player decides how much they share; at
// warm terms they add what is not said in the street (the crown's debts,
// soldiers unpaid). A guard who tells of a lair puts it on the player's map.
//
// Also: how hard an NPC is to flatter or persuade (personality, mood, being
// flattered before), and the cheap uses of goodwill — a bargain from a
// trader, a favour from anyone else.
//
// Deterministic: choices are hashes of a seed the caller passes (no draws on
// the shared RNG). World/player/npc passed in.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { Hex } from '../core/hex.js';
import { PlayerInventory } from '../core/inventory.js';
import { Harvests } from '../world/harvests.js';
import { SettlementMarket } from '../world/settlementMarket.js';
import { TradePolicy } from './tradePolicy.js';
import { OutlawLairs } from './outlawLairs.js';
import { NpcTasks } from './npcTasks.js';
import { Townsfolk } from './townsfolk.js';
import { Ledger } from './ledger.js';

const DEFAULTS = {
    expertise: {
        villager: { topics: ['ruler', 'harvest', 'wars'], sure: 0, places: 1 },
    },
    hedges: ['— or so folk say'],
    guarded: ['*shrugs* '],
    openers: { sure: [''], hearsay: [''], guarded: [''] },
    bands: {
        army: ['barely an army worth the name', 'a small army', 'a middling army', 'a large army', 'the greatest host of any realm'],
        stability: ['close to open revolt', 'restless', 'settled enough', 'firmly held'],
        harvest: ['failing', 'thin', 'fair', 'bumper'],
        unity: ['split by heresy', 'of many minds', 'devout', 'devout to a man'],
        treasury: ['near empty', 'lean', 'comfortable', 'overflowing'],
    },
    social: {
        flatter: { base: 3, traits: {}, types: {}, warm: -1, cold: 1, again: 2 },
        persuade: { base: 5, traits: {}, types: {}, warm: -1, cold: 2 },
    },
    favour: { minDisposition: 65, cost: 8, everyDays: 30, bargainMin: 50, bargainCost: 5, bargainMax: 0.15, repayDays: 30, repaidWarmth: 4, lateWarmth: 1, overdueCold: -6 },
    // Who knows the land best (expertise places 3+) knows it further out, and a second old place
    wideKnowledge: { lairRadius: 10, siteRadius: 8, wideLairRadius: 16, wideSiteRadius: 14, wideAt: 3 },
    // Who won't tell you anything: below refuseBelow they always send you off, below
    // grudgingBelow they do so grudgingChance% of the time; a grudge always does.
    rebuff: {
        refuseBelow: 25, grudgingBelow: 40, grudgingChance: 50, pester: -1,
        lines: {
            grudge: ['After what you did to {victim}? Ask me nothing.'],
            hostile: ['Shove off.'],
            cold: ['I\'ve nothing to say to you.'],
            wary: ['*shrugs* Couldn\'t say.'],
        },
        topics: {},
    },
};

/** What learning a topic adds to the player's knowledge of the realm (player.learnAboutKingdom). */
const TOPIC_CATEGORY = { ruler: 'ruler', wars: 'diplomacy', army: 'military', tariffs: 'economy', fiscal: 'economy', religion: 'religion', stability: 'basics', harvest: 'economy' };

const TRADERS = ['merchant', 'blacksmith_npc', 'traveler'];

let _cfg = null;
let _cfgSrc;

function _obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
function _num(v, d = 0) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }
function _h(s) { return Utils.hashStr(String(s)) >>> 0; }
function _pick(arr, h) { return arr && arr.length ? arr[h % arr.length] : ''; }
function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function _pct(x) { return `${Math.round(x * 100)}%`; }
function _list(xs) { return xs.length <= 1 ? (xs[0] || '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`; }
function _good(id) { return String(id || 'goods').replace(/_/g, ' '); }
function _cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function _kingdom(world, id) {
    if (!world || id == null) return null;
    const k = (world.kingdoms || []).find(x => x && x.id === id);
    return k && k.isAlive !== false ? k : null;
}
function _dist(world, a, b, c, d) { return world && world.width ? Hex.wrappingDistance(a, b, c, d, world.width) : Hex.distance(a, b, c, d); }

export const NpcKnowledge = {
    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.npcKnowledge : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            _cfg = { ...DEFAULTS, ...d };
            _cfg.expertise = { ...DEFAULTS.expertise, ...(_obj(d.expertise) || {}) };
            _cfg.bands = { ...DEFAULTS.bands, ...(_obj(d.bands) || {}) };
            _cfg.openers = { ...DEFAULTS.openers, ...(_obj(d.openers) || {}) };
            _cfg.social = { ...DEFAULTS.social, ...(_obj(d.social) || {}) };
            _cfg.favour = { ...DEFAULTS.favour, ...(_obj(d.favour) || {}) };
            _cfg.wideKnowledge = { ...DEFAULTS.wideKnowledge, ...(_obj(d.wideKnowledge) || {}) };
            const rb = _obj(d.rebuff) || {};
            _cfg.rebuff = { ...DEFAULTS.rebuff, ...rb, lines: { ...DEFAULTS.rebuff.lines, ...(_obj(rb.lines) || {}) }, topics: { ...(_obj(rb.topics) || {}) } };
        }
        return _cfg;
    },

    expertise(type) {
        const E = NpcKnowledge.config().expertise;
        return E[type] || E.villager || DEFAULTS.expertise.villager;
    },

    /** How many things an NPC will tell, by how they feel about the player. */
    shareCount(disposition) {
        const d = _num(disposition, 50);
        if (d < 30) return 1;
        if (d < 60) return 2;
        if (d < 75) return 3;
        return 4;
    },

    // ──────────── THE REALM ────────────

    /** A band index (0..n-1) for a value against ascending thresholds. */
    _band(value, thresholds) {
        let i = 0;
        while (i < thresholds.length && value >= thresholds[i]) i++;
        return i;
    },

    /**
     * The true state of a realm, topic by topic: { topic: { band?, bands?, say(band), secret? } }.
     * `at` = the settlement the NPC stands in (for the harvest).
     */
    facts(world, player, kingdom, at = null) {
        const B = NpcKnowledge.config().bands;
        const out = {};
        if (!kingdom) return out;
        const alive = (world && world.kingdoms || []).filter(k => k && k.isAlive !== false);

        // The ruler and their temper
        const lordTrait = kingdom.lord && Array.isArray(kingdom.lord.traits) && kingdom.lord.traits[0] && kingdom.lord.traits[0].name;
        const ls = kingdom.lastSuccession;
        const newRuler = ls && world && Number.isFinite(world.day) && world.day - _num(ls.day) <= 120 ? (ls.oldRulerName || null) : null;
        out.ruler = {
            say: () => `${kingdom.ruler || 'The crown'} rules ${kingdom.name}${lordTrait ? ` — ${String(lordTrait).toLowerCase()}, by all accounts` : ''}${newRuler ? `, since ${newRuler} passed` : ''}.`,
            vague: () => `${kingdom.ruler || 'Some lord or other'} sits on the throne.`,
        };

        // Wars and friends
        const wars = (kingdom.wars || []).map(id => _kingdom(world, id)).filter(Boolean).map(k => k.name);
        const allies = (kingdom.allies || []).map(id => _kingdom(world, id)).filter(Boolean).map(k => k.name);
        let worst = null;
        for (const [id, v] of Object.entries(kingdom.relations || {})) {
            const k = _kingdom(world, id);
            if (k && !wars.includes(k.name) && (!worst || v < worst.v)) worst = { name: k.name, v };
        }
        out.wars = {
            say: () => (wars.length ? `${kingdom.name} is at war with ${_list(wars)}.` : `${kingdom.name} is at peace.`)
                + (allies.length ? ` ${_list(allies)} ${allies.length > 1 ? 'stand' : 'stands'} with us.` : '')
                + (!wars.length && worst && worst.v <= -30 ? ` There's bad blood with ${worst.name}, though.` : ''),
            vague: () => (wars.length ? `There's fighting somewhere — ${wars[0]}, I think.` : 'No war that I know of.'),
        };

        // The army against the other realms'
        const mil = _num(kingdom.military);
        const avg = alive.length ? alive.reduce((s, k) => s + _num(k.military), 0) / alive.length : mil || 1;
        const rank = alive.filter(k => _num(k.military) > mil).length + 1;
        const armyBand = rank === 1 && alive.length > 2 ? 4 : NpcKnowledge._band(mil / Math.max(1, avg), [0.4, 0.8, 1.25]);
        const unpaid = kingdom.fisc && _num(kingdom.fisc.arrearsDays) >= 7;
        out.army = {
            band: armyBand, bands: B.army,
            say: (b) => `The crown keeps ${B.army[b]}${b === armyBand ? ` — some ${Math.round(mil / 50) * 50 || mil} men under arms` : ''}.`,
            secret: unpaid ? 'And between us — the soldiers haven\'t been paid in weeks.' : null,
        };

        // How firmly the land is held
        const stab = _num(kingdom.stability, 50);
        const stabBand = NpcKnowledge._band(stab, [30, 50, 72]);
        const revolt = (world && world.activeEvents || []).some(e => e && e.id === 'rebellion' && e.kingdomId === kingdom.id);
        out.stability = {
            band: stabBand, bands: B.stability,
            say: (b) => `The realm is ${B.stability[b]}${revolt ? ' — there\'s open rebellion in places' : ''}.`,
        };

        // Tariffs, bans, embargoes
        const p = kingdom.tradePolicy && typeof kingdom.tradePolicy === 'object' ? kingdom.tradePolicy : null;
        if (p) {
            const stance = TradePolicy.stance(p.stance);
            const avgImp = TradePolicy.avgImport(kingdom);
            const bans = Object.keys(p.bans || {}).filter(c => p.bans[c]).map(c => (TradePolicy.category(c) || { label: c }).label.toLowerCase());
            const embargoes = Object.keys(p.embargo || {}).filter(id => p.embargo[id]).map(id => _kingdom(world, id)).filter(Boolean).map(k => k.name);
            const treaties = Object.keys(p.treaty || {}).filter(id => p.treaty[id]).map(id => _kingdom(world, id)).filter(Boolean).map(k => k.name);
            const tariffBand = NpcKnowledge._band(avgImp, [0.05, 0.1, 0.16]);
            const tariffWords = ['light', 'moderate', 'stiff', 'ruinous'];
            out.tariffs = {
                band: tariffBand, bands: tariffWords,
                say: (b) => `The crown's trade policy is ${stance.label.toLowerCase()} — duties on imports are ${tariffWords[b]}${b === tariffBand ? `, about ${_pct(avgImp)}` : ''}.`
                    + (bans.length ? ` No exporting ${_list(bans)}.` : '')
                    + (embargoes.length ? ` Nothing may be traded with ${_list(embargoes)}.` : '')
                    + (treaties.length ? ` Goods from ${_list(treaties)} come in duty-free by treaty.` : ''),
            };
        }

        // Taxes, the treasury, the coin
        const fisc = kingdom.fisc || null;
        const fin = kingdom.finance || null;
        const debt = fin && Array.isArray(fin.debt) ? fin.debt.reduce((s, d) => s + _num(d.owed), 0) : 0;
        const treasBand = NpcKnowledge._band(_num(kingdom.treasury), [500, 2500, 8000]);
        out.fiscal = {
            band: treasBand, bands: B.treasury,
            say: (b) => `${fisc && fisc.level ? `Taxes are ${String(fisc.level).replace(/_/g, ' ')}, ` : ''}the royal coffers ${B.treasury[b]}.`
                + (fin && _num(fin.purity, 1) < 0.97 ? ' And the coin\'s been clipped — there\'s less silver in it than there was.' : ''),
            secret: debt > 500 ? `The crown owes the bankers some ${Math.round(debt / 100) * 100} gold.` : null,
        };

        // The faith
        const rel = kingdom.religion;
        if (rel && rel.name) {
            const unityBand = NpcKnowledge._band(_num(rel.unity, 70), [40, 65, 90]);
            const heresies = Array.isArray(rel.heresies) ? rel.heresies.length : 0;
            out.religion = {
                band: unityBand, bands: B.unity,
                say: (b) => `The realm keeps ${rel.name}; the people are ${B.unity[b]}.${heresies ? ` A heresy has taken root, too.` : ''}`,
            };
        }

        // The harvest where the NPC lives
        if (at && world && world.harvests) {
            const region = Harvests.regionOfTown(world, at);
            const f = region != null ? Harvests.forecast(world, region) : null;
            if (f) {
                const hb = NpcKnowledge._band(_num(f.est, 1), [0.82, 0.95, 1.1]);
                const blight = (f.blights || [])[0];
                out.harvest = {
                    band: hb, bands: B.harvest,
                    say: (b) => (f.settled ? `The last harvest hereabouts was ${B.harvest[b]}.` : `The harvest's looking ${B.harvest[b]} this year.`)
                        + (blight ? ` There's ${String(Harvests.blightName(blight)).toLowerCase()} in the fields.` : ''),
                };
            }
        }
        return out;
    },

    /**
     * An NPC's answer about a realm: true where they know it, hearsay (and
     * said so) where they don't, little to someone they dislike.
     * @returns {{ text, tone: 'sure'|'hearsay'|'guarded', topics: string[], learned: string[] }}
     */
    aboutKingdom(world, player, npc, kingdom, opts = {}) {
        const C = NpcKnowledge.config();
        const type = (npc && npc.type) || 'villager';
        const ex = NpcKnowledge.expertise(type);
        const disp = _num(opts.disposition, 50);
        const seed = opts.seed || `${npc && (npc.uid || npc.id)}|${kingdom && kingdom.id}`;
        const facts = NpcKnowledge.facts(world, player, kingdom, opts.settlement || null);
        const want = (ex.topics || []).filter(t => facts[t]);
        const n = Math.min(want.length, NpcKnowledge.shareCount(disp));
        if (!kingdom || !n) return { text: 'I\'m afraid I don\'t know much about the wider politics.', tone: 'hearsay', topics: [], learned: [] };
        const parts = [];
        const learned = ['basics'];
        let sureCount = 0;
        for (let i = 0; i < n; i++) {
            const topic = want[i];
            const f = facts[topic];
            const sure = (ex.topics || []).indexOf(topic) < _num(ex.sure);
            if (sure) {
                sureCount++;
                parts.push(f.say(f.band));
                if (TOPIC_CATEGORY[topic] && !learned.includes(TOPIC_CATEGORY[topic])) learned.push(TOPIC_CATEGORY[topic]);
                if (disp >= 75 && f.secret) parts.push(f.secret);
            } else {
                // Hearsay: a band may be off by one, and it is said as hearsay
                const h = _h(`${seed}|${topic}`);
                let text;
                if (f.bands && f.band != null) {
                    const off = h % 5 === 0 ? 1 : h % 5 === 1 ? -1 : 0;
                    const b = _clamp(f.band + off, 0, f.bands.length - 1);
                    text = f.say(b);
                } else {
                    text = (f.vague || f.say)(f.band);
                }
                const hedge = _pick(C.hedges, h >>> 3);
                parts.push(text.replace(/\.$/, '') + (hedge.startsWith(',') ? '' : ' ') + hedge + (/[.?!]$/.test(hedge) ? '' : '.'));
            }
        }
        const tone = disp < 30 ? 'guarded' : sureCount >= Math.ceil(n / 2) ? 'sure' : 'hearsay';
        const h0 = _h(`${seed}|open`);
        const open = tone === 'guarded' ? _pick(C.guarded, h0) + _pick(C.openers.guarded, h0 >>> 2) : _pick(C.openers[tone], h0);
        return { text: (open + parts.join(' ')).replace(/\s+/g, ' ').trim(), tone, topics: want.slice(0, n), learned };
    },

    // ──────────── THE TOWN ────────────

    /**
     * An NPC's account of the town and the land about it. `opts.buildings`:
     * the inner map's buildings ({ type, ownerName }). Guards (and the
     * well-disposed) name the outlaws close by — the lair goes on the map —
     * and anyone may point out an old place nobody has explored.
     * @returns {{ text, revealed: { lairs: number[], sites: [{q,r}] } }}
     */
    aboutTown(world, player, npc, settlement, opts = {}) {
        const type = (npc && npc.type) || 'villager';
        const ex = NpcKnowledge.expertise(type);
        const disp = _num(opts.disposition, 50);
        const seed = opts.seed || `${npc && (npc.uid || npc.id)}|town`;
        const revealed = { lairs: [], sites: [] };
        if (!settlement) return { text: 'Just a spot on the road, this. Nothing to tell.', revealed };
        const parts = [];
        const k = _kingdom(world, settlement.kingdom);
        parts.push(`This is ${settlement.name}, ${/^[aeiou]/i.test(settlement.type || 'town') ? 'an' : 'a'} ${settlement.type || 'settlement'} of some ${Math.round(_num(settlement.population, 100) / 10) * 10} souls${k ? `, held by ${k.name}` : ', beholden to no crown'}.`);

        // Buildings and who keeps them
        const B = Array.isArray(opts.buildings) ? opts.buildings : [];
        const NAMES = { tavern: 'the tavern', blacksmith: 'the smithy', church: 'the church', temple: 'the temple', marketplace: 'the market', barracks: 'the barracks', town_hall: 'the town hall', manor: 'the manor', castle: 'the castle', granary: 'the granary', stable: 'the stables', guard_tower: 'the watchtower' };
        const PREF = { guard: ['barracks', 'guard_tower', 'town_hall'], priest: ['temple', 'church'], merchant: ['marketplace', 'warehouse', 'tavern'], blacksmith_npc: ['blacksmith', 'marketplace'], noble: ['manor', 'town_hall'], farmer: ['granary', 'farm', 'stable'] };
        const order = [...(PREF[type] || []), 'tavern', 'marketplace', 'church', 'temple', 'blacksmith', 'barracks', 'town_hall', 'manor'];
        const said = [];
        for (const t of order) {
            if (said.length >= 3) break;
            const b = B.find(x => x && x.type === t && !said.some(s => s.type === t));
            if (b && NAMES[t]) said.push(b);
        }
        if (said.length) {
            parts.push(_cap(_list(said.map(b => b.ownerName && b.ownerName !== (npc && npc.name)
                ? `${b.ownerName} keeps ${NAMES[b.type]}` : `there's ${NAMES[b.type]}`))) + '.');
        }

        // The market: what's short and what's cheap
        if (settlement.market && (TRADERS.includes(type) || ['farmer', 'villager', 'beggar'].includes(type) || disp >= 60)) {
            const short = SettlementMarket.worstShortage(settlement, 1.6);
            const glut = SettlementMarket.biggestGlut(settlement, 0.65);
            if (short) parts.push(`${_cap(_good(short.id))} is dear — the market's nearly out of it.`);
            if (glut && parts.length < 5) parts.push(`${_cap(_good(glut.id))}'s going cheap, mind.`);
        }

        // Guilds
        const guilds = Object.values(settlement.guilds || {}).filter(g => g && g.name).map(g => g.name);
        if (guilds.length && (TRADERS.includes(type) || type === 'noble')) parts.push(`The ${_list(guilds.slice(0, 2))} ${guilds.length > 1 ? 'have' : 'has'} a hall here.`);

        // The land about: outlaws and old places
        const places = _num(ex.places, 1) + (disp >= 60 ? 1 : 0) - (disp < 30 ? 1 : 0);
        if (world && places > 0) {
            const q = settlement.q, r = settlement.r;
            // A guard or a traveller who likes you (places 3+) knows the land further out, and two old places
            const WK = NpcKnowledge.config().wideKnowledge;
            const wide = places >= _num(WK.wideAt, 3);
            const lairRadius = wide ? _num(WK.wideLairRadius, 16) : _num(WK.lairRadius, 10);
            const siteRadius = wide ? _num(WK.wideSiteRadius, 14) : _num(WK.siteRadius, 8);
            let lairBest = null;
            for (const l of OutlawLairs.active(player)) {
                const d = _dist(world, q, r, l.q, l.r);
                if (d <= lairRadius && (!lairBest || d < lairBest.d)) lairBest = { l, d };
            }
            if (lairBest && (type === 'guard' || places >= 2)) {
                const l = lairBest.l;
                const dir = NpcTasks.direction(world, q, r, l.q, l.r);
                parts.push(`Outlaws hole up at ${l.name}, ${NpcTasks.distanceWords(lairBest.d)}${dir ? ` to the ${dir}` : ''}${l.leader && l.leader.name && !l.leader.slain ? ` — ${l.leader.name} leads them` : ''}.`);
                if (type === 'guard') OutlawLairs.reveal(player, l.id);
                else l.rumoured = true;
                revealed.lairs.push(l.id);
            }
            if (places >= 2) {
                const sites = NpcTasks.delveSites(world, q, r, siteRadius).slice(0, wide ? 2 : 1);
                sites.forEach((site, i) => {
                    const dir = NpcTasks.direction(world, q, r, site.q, site.r);
                    const name = site.name.replace(/^The /, 'the ');
                    parts.push(i === 0
                        ? `There's ${name} ${NpcTasks.distanceWords(site.d)}${dir ? ` to the ${dir}` : ''} — nobody's been to the bottom of it.`
                        : `And further out, ${name}, ${NpcTasks.distanceWords(site.d)}${dir ? ` to the ${dir}` : ''}. Few come back from that one the same.`);
                    const t = world.getTile ? world.getTile(site.q, site.r) : null;
                    if (t && !t.explored) t.explored = true;
                    revealed.sites.push({ q: site.q, r: site.r });
                });
            }
        }

        const keep = NpcKnowledge.shareCount(disp) + 1;
        let text = parts.slice(0, Math.max(1, keep + (parts.length > keep && disp >= 60 ? 1 : 0))).join(' ');
        if (disp < 30) text = _pick(NpcKnowledge.config().guarded, _h(seed)) + text;
        return { text, revealed };
    },

    // ──────────── RUMOURS ────────────

    /**
     * A rumour drawn from the world as it is (or null): a shortage nearby, a
     * lair raiding, an old place, a war, a failing harvest, word of folk the
     * player knows.
     */
    rumour(world, player, npc, opts = {}) {
        if (!world) return null;
        const at = opts.settlement || null;
        const q = at ? at.q : player && player.q;
        const r = at ? at.r : player && player.r;
        if (q == null) return null;
        const type = (npc && npc.type) || 'villager';
        const seed = opts.seed || `${npc && (npc.uid || npc.id)}|rumour`;
        const C = NpcKnowledge.config();
        const hedge = (h) => (NpcKnowledge.expertise(type).places >= 2 ? '' : ' ' + _pick(C.hedges, h).replace(/^[—,]\s*/, '(') + ')');
        const lines = [];
        const views = typeof world.getSettlementViews === 'function' ? world.getSettlementViews() : [];

        // A shortage in a town close by
        for (const s of views) {
            if (!s || s === at || !s.market || (at && s.name === at.name)) continue;
            const d = _dist(world, q, r, s.q, s.r);
            if (d > 10) continue;
            const short = SettlementMarket.worstShortage(s, 1.8);
            if (short) { lines.push({ w: TRADERS.includes(type) ? 3 : 1, text: `They say ${s.name} is short of ${_good(short.id)}. A body with a cart could do well there.` }); break; }
        }
        // Outlaws
        for (const l of OutlawLairs.active(player)) {
            const d = _dist(world, q, r, l.q, l.r);
            if (d > 12) continue;
            const dir = NpcTasks.direction(world, q, r, l.q, l.r);
            lines.push({ w: type === 'guard' ? 3 : 2, text: l.raids > 0 ? `Riders out of ${l.name} have been raiding the farms${dir ? ` ${dir} of here` : ''}. ${l.leader && !l.leader.slain ? `${l.leader.name} leads them.` : ''}`.trim() : `Folk whisper of an outlaw band holed up ${NpcTasks.distanceWords(d)}${dir ? ` to the ${dir}` : ''}.` });
            l.rumoured = true;
            break;
        }
        // An old place
        const site = NpcTasks.delveSites(world, q, r, 10)[0];
        if (site) {
            const dir = NpcTasks.direction(world, q, r, site.q, site.r);
            lines.push({ w: ['traveler', 'child', 'farmer'].includes(type) ? 3 : 1, text: `There's an old ${site.kind === 'mine' ? 'mine' : site.kind === 'cave' ? 'cave' : 'ruin'} ${NpcTasks.distanceWords(site.d)}${dir ? ` to the ${dir}` : ''} — ${site.name}. Nobody who went to the bottom came back the same.${hedge(_h(seed + 's'))}` });
        }
        // War
        const kid = at ? at.kingdom : null;
        const k = _kingdom(world, kid);
        if (k && (k.wars || []).length) {
            const foe = _kingdom(world, k.wars[0]);
            if (foe) lines.push({ w: ['guard', 'noble', 'blacksmith_npc'].includes(type) ? 3 : 2, text: `They're raising levies for the war with ${foe.name}.${hedge(_h(seed + 'w'))}` });
        }
        // A harvest failing elsewhere
        if (world.harvests) {
            const regions = Harvests.regions(world).filter(x => x && x.est < 0.82 && x.conf > 0.3);
            if (regions.length) lines.push({ w: ['farmer', 'merchant'].includes(type) ? 3 : 1, text: `The harvest's failing round ${regions[0].name}. Bread will be dear there by winter.` });
        }
        // Word of folk the player knows
        const word = Townsfolk.recentWord(world, 3).find(x => x && x.text && (!at || x.town !== at.name));
        if (word) lines.push({ w: 1, text: `Word from ${word.town}: ${word.text}` });

        if (!lines.length) return null;
        const total = lines.reduce((s, l) => s + l.w, 0);
        let roll = _h(seed) % total;
        for (const l of lines) { if (roll < l.w) return l.text; roll -= l.w; }
        return lines[0].text;
    },

    // ──────────── SWAYING THEM ────────────

    /**
     * How hard an NPC is to flatter ('flatter') or persuade ('persuade'):
     * { difficulty, reasons: [label] } from their personality, their mood, and
     * whether they have been flattered before.
     */
    socialDifficulty(npc, mem, kind) {
        const S = NpcKnowledge.config().social[kind] || DEFAULTS.social[kind] || { base: 3 };
        let d = _num(S.base, 3);
        const reasons = [];
        for (const t of (npc && npc.personalityTraits) || []) {
            const m = _num(S.traits && S.traits[t]);
            if (m) { d += m; reasons.push(`${_cap(t)} ${m > 0 ? '+' : ''}${m}`); }
        }
        const tm = _num(S.types && S.types[npc && npc.type]);
        if (tm) { d += tm; reasons.push(`${_cap(String(npc.type).replace('_npc', ''))} ${tm > 0 ? '+' : ''}${tm}`); }
        const disp = _num(mem && mem.disposition, 50);
        if (disp >= 70 && S.warm) { d += S.warm; reasons.push(`Likes you ${S.warm}`); }
        if (disp < 35 && S.cold) { d += S.cold; reasons.push(`Dislikes you +${S.cold}`); }
        if (kind === 'flatter' && mem && mem.flattered && S.again) { d += S.again; reasons.push(`Flattered before +${S.again}`); }
        return { difficulty: Math.max(1, d), reasons };
    },

    // ──────────── GOODWILL SPENT ────────────

    /** Can this trader be asked for a better price now? */
    canBargain(npc, mem) {
        const F = NpcKnowledge.config().favour;
        return !!npc && TRADERS.includes(npc.type) && _num(mem && mem.disposition) >= F.bargainMin && !(mem.bargain && mem.bargain.spoken === mem.timesSpoken);
    },

    /**
     * Ask a well-disposed trader for a better price: a discount for this
     * visit (NpcDisposition.getPriceModifiers reads mem.bargain), paid for in
     * goodwill. → { pct, cost }
     */
    bargain(npc, mem, player) {
        const F = NpcKnowledge.config().favour;
        const skill = _num(player && player.skills && player.skills.commerce);
        const pct = _clamp(0.05 + (_num(mem.disposition) - F.bargainMin) / 500 + skill * 0.01, 0.03, F.bargainMax);
        mem.bargain = { pct: Math.round(pct * 100) / 100, spoken: mem.timesSpoken };
        mem.disposition = _clamp(_num(mem.disposition) - F.bargainCost, 0, 100);
        return { pct: mem.bargain.pct, cost: F.bargainCost };
    },

    /** Can this NPC be asked a favour now (not a trader; liked enough; not asked lately)? */
    canAskFavour(npc, mem, day) {
        const F = NpcKnowledge.config().favour;
        if (!npc || TRADERS.includes(npc.type) || npc.type === 'child') return false;
        if (_num(mem && mem.disposition) < F.minDisposition) return false;
        return !(mem.favourDay != null && _num(day) - mem.favourDay < F.everyDays);
    },

    /**
     * A favour from someone who likes the player, paid for in goodwill: a
     * guard names the outlaws' lair, a farmer fills the packs, a priest
     * tends a wound, a noble speaks for the player at court, anyone else
     * points out an old place. → { text, summary, kind }
     */
    askFavour(world, player, npc, mem, opts = {}) {
        const F = NpcKnowledge.config().favour;
        const day = world && Number.isFinite(world.day) ? world.day : 0;
        mem.favourDay = day;
        mem.disposition = _clamp(_num(mem.disposition) - F.cost, 0, 100);
        const at = opts.settlement || null;
        const q = at ? at.q : player.q, r = at ? at.r : player.r;
        const type = npc.type || 'villager';
        if (type === 'guard') {
            let best = null;
            for (const l of OutlawLairs.active(player)) {
                const d = _dist(world, q, r, l.q, l.r);
                if (d <= 14 && !l.known && (!best || d < best.d)) best = { l, d };
            }
            if (best) {
                OutlawLairs.reveal(player, best.l.id);
                const dir = NpcTasks.direction(world, q, r, best.l.q, best.l.r);
                return { kind: 'lair', text: `*lowers voice* The watch knows where ${best.l.name} is — ${NpcTasks.distanceWords(best.d)}${dir ? `, ${dir}` : ''}. You didn't hear it from me.`, summary: `${best.l.name} marked on your map` };
            }
        }
        if (type === 'farmer' || type === 'villager') {
            const res = PlayerInventory.addItem(player, 'grain', 3);
            if (res && res.success) return { kind: 'goods', text: '*presses a sack into your arms* Take this — there\'s more where it came from.', summary: '+3 grain' };
        }
        if (type === 'priest') {
            const max = _num(player.maxHealth, 100);
            const heal = Math.min(20, Math.max(0, max - _num(player.health, max)));
            player.health = _num(player.health, max) + heal;
            player.karma = _num(player.karma) + 1;
            return { kind: 'heal', text: '*lays a hand on your brow and murmurs a blessing*', summary: `${heal ? `+${heal} health, ` : ''}+1 karma` };
        }
        if (type === 'noble' && at && at.kingdom) {
            if (!player.reputation || typeof player.reputation !== 'object') player.reputation = {};
            player.reputation[at.kingdom] = _clamp(_num(player.reputation[at.kingdom]) + 3, -100, 100);
            const k = _kingdom(world, at.kingdom);
            return { kind: 'reputation', text: '*nods* I shall speak well of you at court. My word carries.', summary: `+3 reputation with ${k ? k.name : 'the realm'}` };
        }
        const site = NpcTasks.delveSites(world, q, r, 12)[0];
        if (site) {
            const t = world.getTile ? world.getTile(site.q, site.r) : null;
            if (t) t.explored = true;
            const dir = NpcTasks.direction(world, q, r, site.q, site.r);
            return { kind: 'site', text: `I'll tell you a thing few know: ${site.name} lies ${NpcTasks.distanceWords(site.d)}${dir ? ` to the ${dir}` : ''}. Old, and never emptied.`, summary: `${site.name} marked on your map` };
        }
        const gold = 10 + (_h(`${npc.uid || npc.id}|favour|${day}`) % 15);
        player.gold = _num(player.gold) + gold;
        Ledger.record(player, 'borrowed', gold);
        // "Pay me back when you can": a small debt they remember (mem.owed)
        const prior = mem.owed && _num(mem.owed.amount) > 0 ? _num(mem.owed.amount) : 0;
        mem.owed = { amount: prior + gold, day, due: day + _num(F.repayDays, 30), dunned: false };
        return { kind: 'gold', text: '*presses a few coins into your hand* For the road. Pay me back when you can.', summary: `+${gold} gold (you owe them ${prior + gold})`, owed: prior + gold };
    },

    // ──────────── WHAT THE PLAYER OWES ────────────

    /** The coin the player owes this person ({ amount, due, overdue }) or null. */
    owedTo(mem, day) {
        const o = mem && mem.owed;
        if (!o || !(_num(o.amount) > 0)) return null;
        return { amount: _num(o.amount), due: _num(o.due), overdue: _num(day) > _num(o.due) };
    },

    /**
     * Speaking with someone the player owes, past the day it was due: they
     * say so, and like the player a little less (once per debt). Returns the
     * reminder line, or null.
     */
    dunning(mem, day) {
        const o = NpcKnowledge.owedTo(mem, day);
        if (!o || !o.overdue || mem.owed.dunned) return null;
        mem.owed.dunned = true;
        mem.disposition = _clamp(_num(mem.disposition, 50) + _num(NpcKnowledge.config().favour.overdueCold, -6), 0, 100);
        return `*pointedly* Those ${o.amount} coins I lent you — I'd have them back now, if it's all the same to you.`;
    },

    /** Pay back what the player owes: { success, amount, warmth, text } or { success: false, reason }. */
    repay(player, mem, day) {
        const o = NpcKnowledge.owedTo(mem, day);
        if (!o) return { success: false, reason: 'You owe them nothing.' };
        if (_num(player.gold) < o.amount) return { success: false, reason: `You need ${o.amount} gold.` };
        const F = NpcKnowledge.config().favour;
        player.gold = _num(player.gold) - o.amount;
        Ledger.record(player, 'borrowed', -o.amount);
        const warmth = o.overdue ? _num(F.lateWarmth, 1) : _num(F.repaidWarmth, 4);
        mem.disposition = _clamp(_num(mem.disposition, 50) + warmth, 0, 100);
        delete mem.owed;
        return { success: true, amount: o.amount, warmth, text: o.overdue ? '*takes the coins* Late, but paid. We\'re square.' : '*smiles* Paid back, and early! Good as your word.' };
    },

    // ──────────── TURNED AWAY ────────────

    /**
     * How willing they are to tell the player anything: 'refuses' (a grudge, or
     * they dislike the player too much), 'grudging' (they may send them off), or 'open'.
     */
    willingness(mem) {
        const R = NpcKnowledge.config().rebuff;
        if (mem && mem.grudge) return 'refuses';
        const d = _num(mem && mem.disposition, 50);
        if (d < _num(R.refuseBelow, 25)) return 'refuses';
        if (d < _num(R.grudgingBelow, 40)) return 'grudging';
        return 'open';
    },

    /**
     * The line someone who dislikes the player says instead of answering a
     * question about `topic` (news, town, realm, folk, family, people, work),
     * or null when they'll answer. Seeded: the same question the same day gets the same answer.
     */
    rebuff(npc, mem, topic, seed) {
        const R = NpcKnowledge.config().rebuff;
        const will = NpcKnowledge.willingness(mem);
        if (will === 'open') return null;
        if (will === 'grudging' && _h(`${seed}|rebuff|${topic}`) % 100 >= _num(R.grudgingChance, 50)) return null;
        const d = _num(mem && mem.disposition, 50);
        const L = R.lines || {};
        const mood = mem && mem.grudge ? 'grudge' : d < 10 ? 'hostile' : will === 'refuses' ? 'cold' : 'wary';
        let pool = (L[mood] || []).slice();
        if (mood === 'hostile' || mood === 'cold') pool = pool.concat((R.topics && R.topics[topic]) || []);
        if (!pool.length) pool = DEFAULTS.rebuff.lines[mood] || DEFAULTS.rebuff.lines.cold;
        const victim = (mem && mem.grudge && mem.grudge.victimName) || 'them';
        return _pick(pool, _h(`${seed}|line|${topic}|${_num(mem && mem.timesSpoken)}`)).replace(/\{victim\}/g, victim);
    },
};
