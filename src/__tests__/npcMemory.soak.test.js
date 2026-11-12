// Long-run probe for NPC memory (systems/npcMemory.js): a real generated world,
// every town given a roster, the bot playing, and a heavy-handed player's deeds
// laid on dozens of townsfolk every season for decades — the memory store and the
// save must stay bounded and the daily sweep cheap. Skipped unless NPCMEM_SOAK=1
// (years: NPCMEM_YEARS, default 30; seed: NPCMEM_SEED, default 101).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { loadData, newGame, endDay, carryOn } from './playtest/harness.js';
import { botDay } from './playtest/bot.js';
import { SaveLoad } from '../systems/saveLoad.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { NpcMemory } from '../systems/npcMemory.js';
import { Relationships } from '../systems/relationships.js';

const ENV = (typeof process !== 'undefined' && process.env) || {};
const RUN = !!ENV.NPCMEM_SOAK;
const YEARS = Number(ENV.NPCMEM_YEARS) || 30;
const SEED = Number(ENV.NPCMEM_SEED) || 101;
const KINDS = ['gift', 'alms', 'hired', 'wages_unpaid', 'assaulted', 'robbed', 'healed'];
const KIN_KINDS = ['burial', 'murdered', 'hanged', 'wed'];

let logSpy;
let warnSpy;
beforeAll(async () => {
    await loadData();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => { logSpy && logSpy.mockRestore(); warnSpy && warnSpy.mockRestore(); });

function saveBytes(game) {
    Relationships.prepareForSave(game.player);
    return JSON.stringify({ world: SaveLoad.serializeWorld(game.world), player: SaveLoad.serializePlayer(game.player) }).length;
}

describe.skipIf(!RUN)('NpcMemory — decades of a heavy hand', () => {
    it(`stays bounded over ${YEARS} years`, () => {
        const game = newGame(SEED);
        const { world } = game;
        const towns = world.getSettlementViews().filter(s => s && s.name);
        for (const s of towns) if (!s.folk) Townsfolk.seed(s, world, { q: s.q, r: s.r });
        const rows = [];
        let n = 0;
        let ms = 0;
        let sweeps = 0;
        const t0 = Date.now();
        const stats = {};
        for (let i = 0; i < YEARS * 120; i++) {
            try { botDay(game, stats); } catch (e) { /* the bot's own trouble */ }
            const res = endDay(game);
            if (res.died && !carryOn(game, res.died).how) break;
            const day = world.day;
            if (day % 30 === 0) {
                // A sweep's own cost (endDay already ran it: time a second, idle pass the same day)
                const a = performance.now();
                NpcMemory.processDay(world, game.player);
                ms += performance.now() - a;
                sweeps++;
                // Deeds: ~40 townsfolk across the realm each season, a few towns' memories
                for (let j = 0; j < 40; j++) {
                    const s = towns[(n * 7 + j * 13) % towns.length];
                    const live = s.folk ? s.folk.people.filter(p => p.died == null && !p.away) : [];
                    if (!live.length) continue;
                    const p = live[(n + j * 5) % live.length];
                    const ref = { folk: s.folk, person: p };
                    if (j % 4 === 0) NpcMemory.rememberKin(world, ref, { kind: KIN_KINDS[(n + j) % KIN_KINDS.length], player: game.player });
                    else NpcMemory.remember(world, ref, { kind: KINDS[(n + j) % KINDS.length], player: game.player, kin: j % 3 === 0 });
                    n++;
                }
                for (let j = 0; j < 3; j++) NpcMemory.rememberTown(world, towns[(n + j * 11) % towns.length], { kind: ['raided', 'dole', 'ruled_harsh', 'hanged'][(n + j) % 4], player: game.player, victim: 'Tam' });
            }
            if ((i + 1) % (120 * 5) === 0) {
                const st = NpcMemory.stats(world);
                rows.push(`year ${(i + 1) / 120}: towns ${st.towns}, holders ${st.holders}, episodes ${st.episodes} (+${st.townEpisodes} town), memory ${(st.bytes / 1024).toFixed(1)} KB, save ${(saveBytes(game) / 1024).toFixed(0)} KB, sweep ${(ms / Math.max(1, sweeps)).toFixed(2)} ms, ${((Date.now() - t0) / (i + 1)).toFixed(1)} ms/day`);
            }
        }
        process.stdout.write(`\nNpcMemory soak seed ${SEED}, ${towns.length} towns, ${n} deeds:\n${rows.join('\n')}\n`);
        const st = NpcMemory.stats(world);
        // Bounded: never more than perPerson per head, and the store a small share of the save
        expect(st.episodes).toBeLessThanOrEqual(st.holders * NpcMemory.config().perPerson);
        expect(st.bytes).toBeLessThan(saveBytes(game) * 0.1);
    }, 4 * 3600 * 1000);
});
