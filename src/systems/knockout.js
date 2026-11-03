// ============================================================
// KNOCKOUT — beaten to nothing is beaten senseless, not dead
// ============================================================
// A street fight that brings someone to 0 health leaves them lying senseless,
// not dead. Whoever stands over them chooses what comes next.
//
//   - An NPC knocked out by the player lies where they fell until they come
//     round (wakeSeconds), hurt and frightened. The player may finish them
//     off (a murder), go through their pockets, or leave them be.
//   - The player knocked out is at the mercy of whoever beat them
//     (attackerVerdict):
//       • the watch hauls a wanted player off to the cells, and leaves a
//         merely troublesome one with a warning;
//       • kin of someone the player killed, or anyone holding a grudge, may
//         finish them, as may the violent sort;
//       • most go through the player's purse and leave them; some just leave.
//     The player comes round hours later (hoursOut) at a little health.
//   - Who started it matters (ctx.starter):
//       • the player threw the first blow: in a town with a watch, the one who
//         downed them runs for the guards (fetchWatch) — they wake in the cells;
//       • the other set on the player (a householder who hates them,
//         householderAttacks): they may finish the player, or — where the
//         realm allows private prison camps (privatePrisonsAllowed) — drag
//         them off to their own camp to work (capturePlayer: servitude).
//
// Pure decisions on Utils' seedable stream; the street map applies them
// (ui/innerMapCombat.js). Data: data/knockout.json.

import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';
import { NpcDisposition } from './npcDisposition.js';
import { Duels } from './duels.js';
import { Ledger } from './ledger.js';

const DEFAULTS = {
    npc: { wakeSeconds: [45, 90], wakeHpShare: 0.25 },
    player: { hoursOut: [1, 3], wakeHpShare: 0.15, robShare: [0.3, 0.7] },
    // Chances (0–1) the one who downed the player finishes them, by what they hold against them
    finish: { base: 0.02, aggressive: 0.05, disliked: 0.08, grudge: 0.35, murderGrudge: 0.75, guard: 0, child: 0 },
    // Chance they go through the player's purse instead of just walking off
    rob: { base: 0.45, beggar: 0.85, traveler: 0.6, aggressive: 0.7, noble: 0.1, priest: 0.05, guard: 0, child: 0.2 },
    fetchWatch: 0.9,
    npcStarted: { finish: { base: 0.2, aggressive: 0.4, grudge: 0.5, murderGrudge: 0.8 }, capture: 0.6, days: [8, 20], freedomCost: 12 },
    privatePrisons: { allowShare: 0.4 },
    householder: { chance: 0.6, hateBelow: 15, angryBelow: 30 },
    lines: {
        fetch: ['Guards! GUARDS! In here!'],
        capture: ['You work for me now.'],
        householder: ['You. In MY house?'],
        finish: ['This is for {victim}.', 'No one will miss you.', 'You should have stayed down.'],
        arrest: ['That\'s enough. You\'re coming with me.', 'Take them to the cells.'],
        warn: ['Let that be a lesson. Stay out of trouble.', 'Next time it\'s the cells.'],
        rob: ['I\'ll have that purse.', 'Call it payment.', 'Serves you right.'],
        leave: ['Stay down.', 'Had enough?', '*spits* Not worth it.'],
        npcWake: ['Ugh... my head...', 'W-what happened?', 'Gods... stay away from me!', '*groans*'],
    },
};

let _cfg = null;
let _cfgSrc;

function _obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }
function _num(v, d = 0) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }
function _span(range, rnd) {
    const [a, b] = Array.isArray(range) ? range : [0, 0];
    return a + rnd() * (b - a);
}
function _pick(arr, rnd) { return Array.isArray(arr) && arr.length ? arr[Math.floor(rnd() * arr.length) % arr.length] : null; }
function _fill(text, vars) { return text ? String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : text; }

export const Knockout = {
    DEFAULTS,

    config() {
        const src = DataLoader._gamedata ? DataLoader._gamedata.knockout : undefined;
        if (!_cfg || src !== _cfgSrc) {
            _cfgSrc = src;
            const d = _obj(src) || {};
            _cfg = {
                npc: { ...DEFAULTS.npc, ...(_obj(d.npc) || {}) },
                player: { ...DEFAULTS.player, ...(_obj(d.player) || {}) },
                finish: { ...DEFAULTS.finish, ...(_obj(d.finish) || {}) },
                rob: { ...DEFAULTS.rob, ...(_obj(d.rob) || {}) },
                lines: { ...DEFAULTS.lines, ...(_obj(d.lines) || {}) },
                fetchWatch: _num(d.fetchWatch, DEFAULTS.fetchWatch),
                npcStarted: { ...DEFAULTS.npcStarted, ...(_obj(d.npcStarted) || {}), finish: { ...DEFAULTS.npcStarted.finish, ...((_obj(d.npcStarted) || {}).finish || {}) } },
                privatePrisons: { ...DEFAULTS.privatePrisons, ...(_obj(d.privatePrisons) || {}) },
                householder: { ...DEFAULTS.householder, ...(_obj(d.householder) || {}) },
            };
        }
        return _cfg;
    },

    /** How long (seconds) a knocked-out NPC lies senseless, and the share of health they wake with. */
    npcWake(rnd = Utils.random) {
        const N = Knockout.config().npc;
        return { seconds: _span(N.wakeSeconds, rnd), hpShare: _num(N.wakeHpShare, 0.25) };
    },

    /** What a knocked-out NPC mutters as they come round. */
    wakeLine(rnd = Utils.random) {
        return _pick(Knockout.config().lines.npcWake, rnd);
    },

    /**
     * The one who knocked the player out decides their fate.
     * @param {object} npc the attacker (an inner-map NPC)
     * @param {object} player
     * @param {object} [ctx] { wanted: an unanswered incident here (the watch arrests),
     *   starter: 'player'|'npc'|null (who threw the first blow), hasWatch: a town watch to fetch,
     *   campsAllowed: the realm lets private citizens keep prison camps, campName, rnd }
     * @returns {{ act:'finish'|'arrest'|'warn'|'rob'|'leave'|'fetch'|'capture', line:string|null, chance:number, why:string, days?:number }}
     */
    attackerVerdict(npc, player, ctx = {}) {
        const C = Knockout.config();
        const rnd = ctx.rnd || Utils.random;
        const vars = { victim: 'them', player: (player && player.name) || 'you', camp: ctx.campName || 'the camp' };
        const say = (act) => _fill(_pick(C.lines[act], rnd), vars);
        // The watch: the cells for the wanted, a warning for the rest
        if (npc && npc.type === 'guard') {
            const act = ctx.wanted ? 'arrest' : 'warn';
            return { act, line: say(act), chance: 0, why: ctx.wanted ? 'You are wanted here.' : 'The watch does not kill.' };
        }
        const mem = npc ? NpcDisposition.getMemory(npc) : {};
        const grudge = mem.grudge || null;
        if (grudge && grudge.victimName) vars.victim = grudge.victimName;
        const F = C.finish;
        let temperament = 'balanced';
        try { temperament = Duels.fromNpc(npc).temperament || 'balanced'; } catch (e) { temperament = 'balanced'; }
        let chance = _num(F.base);
        let why = 'They have no reason to kill you.';
        if (npc && npc.type === 'child') { chance = _num(F.child); why = 'A child.'; } else {
            if (temperament === 'aggressive') { chance = Math.max(chance, _num(F.aggressive)); why = 'A violent sort.'; }
            if (_num(mem.disposition, 50) < 25) { chance += _num(F.disliked); why = 'They hate you.'; }
            if (grudge) {
                const g = grudge.severity === 'murder' ? _num(F.murderGrudge) : _num(F.grudge);
                chance = Math.max(chance, g);
                why = grudge.severity === 'murder' ? `You killed ${grudge.victimName}.` : `You hurt ${grudge.victimName}.`;
            }
        }
        // They set on the player: kill them, or (where the law allows) take them for their camp
        if (ctx.starter === 'npc' && !(npc && npc.type === 'child')) {
            const N = C.npcStarted;
            let k = _num(N.finish.base);
            if (temperament === 'aggressive') k = Math.max(k, _num(N.finish.aggressive));
            if (grudge) k = Math.max(k, grudge.severity === 'murder' ? _num(N.finish.murderGrudge) : _num(N.finish.grudge));
            k = Math.max(0, Math.min(1, k));
            if (rnd() < k) return { act: 'finish', line: say('finish'), chance: k, why: 'They meant to kill you from the first.' };
            if (ctx.campsAllowed && rnd() < _num(N.capture)) {
                const days = Math.max(1, Math.round(_span(N.days, rnd)));
                return { act: 'capture', line: say('capture'), chance: k, why: 'The realm lets them keep prisoners.', days };
            }
        }
        chance = Math.max(0, Math.min(1, chance));
        if (rnd() < chance) return { act: 'finish', line: say('finish'), chance, why };
        // The player started it: off to fetch the watch
        if (ctx.starter === 'player' && ctx.hasWatch && !(npc && npc.type === 'child') && rnd() < _num(C.fetchWatch)) {
            return { act: 'fetch', line: say('fetch'), chance, why: 'You started it, and they want you jailed for it.' };
        }
        const R = C.rob;
        let rob = _num(R[npc && npc.type], _num(R.base));
        if (temperament === 'aggressive') rob = Math.max(rob, _num(R.aggressive));
        const act = _num(player && player.gold) > 0 && rnd() < rob ? 'rob' : 'leave';
        return { act, line: say(act), chance, why };
    },

    /**
     * Does the realm let private citizens keep prison camps and prisoners?
     * The realm's own law (kingdom.laws.privatePrisons) if it has one, else a
     * hash of the realm decides (allowShare of realms), the same all game.
     */
    privatePrisonsAllowed(world, kingdomId) {
        if (kingdomId == null) return false;
        const k = world && typeof world.getKingdom === 'function' ? world.getKingdom(kingdomId) : null;
        if (k && k.laws && typeof k.laws.privatePrisons === 'boolean') return k.laws.privatePrisons;
        const key = `${kingdomId}|${(k && k.name) || ''}`;
        let h = 2166136261;
        for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
        return ((h >>> 0) % 1000) / 1000 < _num(Knockout.config().privatePrisons.allowShare, 0.4);
    },

    /**
     * Someone at home who hates the player: do they set on them as they walk in?
     * @returns {{ attacks:boolean, line:string|null, why:string|null }}
     */
    householderAttacks(npc, rnd = Utils.random) {
        const C = Knockout.config();
        const H = C.householder;
        if (!npc || ['guard', 'child'].includes(npc.type) || npc._taskFoe) return { attacks: false, line: null, why: null };
        const mem = NpcDisposition.getMemory(npc) || {};
        let temperament = 'balanced';
        try { temperament = Duels.fromNpc(npc).temperament || 'balanced'; } catch (e) { temperament = 'balanced'; }
        const disp = _num(mem.disposition, 50);
        const hostile = !!mem.grudge || disp < _num(H.hateBelow, 15) || (temperament === 'aggressive' && disp < _num(H.angryBelow, 30));
        if (!hostile || rnd() >= _num(H.chance, 0.6)) return { attacks: false, line: null, why: null };
        const why = mem.grudge ? `You hurt ${mem.grudge.victimName || 'their own'}.` : 'They hate you.';
        return { attacks: true, line: _fill(_pick(C.lines.householder, rnd), { victim: (mem.grudge && mem.grudge.victimName) || 'them' }), why };
    },

    /**
     * Taken for a private prison camp: the player's servitude (player/actions
     * servitude_wait / _escape / _buy_freedom), part of their purse confiscated.
     */
    capturePlayer(player, verdict, ctx = {}) {
        const N = Knockout.config().npcStarted;
        const days = Math.max(1, Math.round(_num(verdict && verdict.days, 10)));
        const took = Math.floor(_num(player.gold) * 0.3);
        player.gold = _num(player.gold) - took;
        if (took > 0) Ledger.record(player, 'robbery', -took);
        player.indenturedServitude = {
            captor: ctx.campName || 'a private prison camp',
            daysRemaining: days, totalDays: days, dailyWage: 0, goldConfiscated: took,
            canBuyFreedom: true, freedomCost: Math.round(days * _num(N.freedomCost, 12)),
            escapeChance: 0.1 + _num(player.skills && player.skills.stealth) * 0.03,
            privateCamp: true, keeper: ctx.keeper || null, kingdom: ctx.kingdom != null ? ctx.kingdom : null,
        };
        return { days, took };
    },

    /**
     * The player comes round: hours lost, a little health back, and (robbed)
     * part of their purse gone. Mutates the player.
     * @returns {{ hours:number, health:number, stolen:number }}
     */
    playerWakes(player, verdict, rnd = Utils.random) {
        const P = Knockout.config().player;
        const hours = Math.max(1, Math.round(_span(P.hoursOut, rnd)));
        const max = _num(player.maxHealth, 100);
        player.health = Math.max(1, Math.round(max * _num(P.wakeHpShare, 0.15)));
        let stolen = 0;
        if (verdict && verdict.act === 'rob') {
            stolen = Math.floor(_num(player.gold) * _span(P.robShare, rnd));
            if (stolen > 0) {
                player.gold = _num(player.gold) - stolen;
                Ledger.record(player, 'robbery', -stolen);
            }
        }
        return { hours, health: player.health, stolen };
    },
};
