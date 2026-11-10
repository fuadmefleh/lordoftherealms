// ActionMenu — Arms & Armour: what the player wields and wears (main hand,
// off hand, head, body), its stats, grade, condition and edge; take up,
// put away, sharpen and mend; and the troops' kits — arm them from your
// stores or the town's armourers, mend them at the smithy
// (systems/arms.js). Buttons route through data-am-act → ActionMenu.armsAct.
import { ActionMenu } from './_ref.js';
import { Arms } from '../../systems/arms.js';
import { itemIcon } from '../icons.js';
import { Duels } from '../../systems/duels.js';
import { Grades } from '../../core/grades.js';
import { PlayerInventory } from '../../core/inventory.js';
import { PlayerEffects } from '../../player/playerEffects.js';
import { PlayerMilitary } from '../../player/playerMilitary.js';
import { PracticeSkills } from '../../systems/practiceSkills.js';
import { BTN_GOLD, BTN_PLAIN, BTN_DIM, CARD, esc } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const pct = (v) => `${Math.round(v * 100)}%`;

function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="armsAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

/** A small bar for condition / edge. */
function bar(v, color) {
    const w = Math.max(0, Math.min(100, Math.round(v)));
    return `<span style="display:inline-block; width:60px; height:6px; background:rgba(255,255,255,0.1); border-radius:3px; vertical-align:middle;"><span style="display:block; width:${w}%; height:100%; background:${color}; border-radius:3px;"></span></span>`;
}

function gradeChip(g) {
    const gr = Grades.get(g);
    return gr.id === 'common' ? '' : ` <span style="color:${gr.color}">${gr.icon} ${gr.name}</span>`;
}

/** One line of what a piece does. */
function statLine(s) {
    if (!s) return '';
    const parts = [];
    if (s.slot === 'main') {
        if (s.melee) {
            parts.push(`⚔️ ${s.dmg.toFixed(1)} ${s.dtype || ''}`);
            if (s.attack) parts.push(`handling ${s.attack > 0 ? '+' : ''}${s.attack.toFixed(1)}`);
            parts.push(`reach ${s.reach}`);
            if (s.pen > 0) parts.push(`pierces ${pct(s.pen)} of armour`);
        } else parts.push('a missile weapon: for the hunt and the battle line, not a duel');
        if (s.hands >= 2) parts.push('two hands');
    } else if (s.slot === 'off') {
        parts.push(`🛡️ guard +${s.block.toFixed(1)}`, `riposte +${s.riposte}`, `covers ${pct(s.cover)}`);
    } else {
        parts.push(`stops ${pct(s.prot)} (cut ${pct(Math.min(0.7, s.prot * s.vs.cut))}, point ${pct(Math.min(0.7, s.prot * s.vs.pierce))}, blunt ${pct(Math.min(0.7, s.prot * s.vs.blunt))})`);
    }
    parts.push(`${s.weight} kg`);
    return parts.join(' · ');
}

Object.assign(ActionMenu, {
    /** The player's arms and armour, and the troops' kits */
    showArms(game) {
        const { player, world } = game;
        const tile = world.getTile(player.q, player.r);
        const s = tile && tile.settlement;
        const lo = Arms.loadout(player);
        const me = Duels.fromPlayer(player, { mods: PlayerEffects.duelModifiers(player), fresh: true });
        let html = `<div style="font-size:12px; max-height:640px; overflow-y:auto;">`;
        html += `<p style="margin:0 0 6px; ${NOTE}">💰 ${Math.floor(player.gold || 0)} gold · In a fight you hit for <b>${me.power.toFixed(1)}</b> (attack ${me.attack.toFixed(1)}, guard ${me.defense.toFixed(1)}); your harness stops ${pct(me.armour)} of a blow; ${me.maxStamina} breath. On the road: ${pct(1 - PlayerEffects.personalDamageMultiplier(player))} of harm turned.</p>`;

        // ── Equipment ──
        for (const slot of Arms.SLOTS) {
            const def = Arms.config().slots[slot] || { label: slot, icon: '⚔️' };
            const p = lo[slot];
            html += `<div style="${CARD}"><b>${def.icon} ${esc(def.label)}</b>: `;
            if (p) {
                html += `${itemIcon(p.id, esc(Arms.iconOf(p.id)), 22)} ${esc(p.stats.name)}${gradeChip(p.grade)}<br><span style="${NOTE}">${esc(statLine(p.stats))}</span><br>`;
                html += `<span style="${NOTE}">Condition ${bar(p.cond, p.cond < 50 ? '#e67e22' : '#2ecc71')} ${Math.round(p.cond)}%`;
                if (p.stats.edge != null) html += ` · Edge ${bar(p.edge, p.edge < 50 ? '#e67e22' : '#5dade2')} ${Math.round(p.edge)}%`;
                html += '</span><br>';
                html += act('Put away', ['unequip', slot], BTN_PLAIN);
                if (p.stats.edge != null && p.edge < 99.5) {
                    const hasStone = (player.inventory.whetstone || 0) > 0;
                    html += act(hasStone ? '⬛ Hone on the whetstone' : `Grindstone (${Arms.config().wear.grindFee}g)`, ['sharpen'], BTN_PLAIN, hasStone || Arms.hasSmith(s), 'You need a whetstone, or a town smith.');
                }
                if (p.cond < 99.5) {
                    const q = Arms.mendQuote(player, slot, s, world);
                    const goods = PlayerInventory.describe(q.goods) || 'nothing';
                    html += act(`🔨 Mend it yourself (${goods})`, ['mendSelf', slot], BTN_PLAIN, q.self, `It takes ${goods}.`);
                    if (q.smith) html += act(`Smith mends it (${q.smith.total}g)`, ['mendSmith', slot], BTN_PLAIN, !q.smith.short.length && (player.gold || 0) >= q.smith.total, q.smith.short.length ? `The smith has no ${q.smith.short.join(', ')}.` : `${q.smith.total} gold.`);
                }
            } else {
                html += `<span style="${NOTE}">${slot === 'main' ? 'bare hands' : 'nothing'}</span><br>`;
            }
            // What else is carried for the slot
            const others = Arms.candidates(player, slot).filter(c => !p || c.id !== p.id);
            for (const c of others.slice(0, 6)) {
                html += act(`${itemIcon(c.id, esc(Arms.iconOf(c.id)), 18)} ${esc(Arms.nameOf(c.id))}${c.count > 1 ? ` ×${c.count}` : ''}`, ['equip', c.id], BTN_GOLD, true, statLine(Arms.stats(c.id, c.grade)));
            }
            if (!p && !others.length) html += `<span style="${NOTE}">You carry none. Forge one at an anvil, buy one, or order one from a town's weaponsmith.</span>`;
            html += '</div>';
        }

        // ── The troops ──
        const kitted = (player.army || []).filter(u => Arms.kitSpec(u.type) && !u.mercenary);
        if (kitted.length) {
            html += `<div style="${CARD}"><b>⚔️ Your soldiers' arms</b><br>`;
            const byType = {};
            for (const u of kitted) (byType[u.type] = byType[u.type] || []).push(u);
            for (const [type, units] of Object.entries(byType)) {
                const f = units.reduce((t, u) => t + Arms.unitFactor(u), 0) / units.length;
                const gaps = units.filter(u => u.kit && Arms.kitGaps(u).length).length;
                const old = units.filter(u => !u.kit).length;
                const sample = units.find(u => u.kit) || null;
                html += `<div style="margin:3px 0;">${esc(units[0].icon || '')} ${units.length} ${esc(units[0].name || type)} — fighting at <b>${pct(f)}</b>${sample ? ` <span style="${NOTE}">(${esc(Arms.kitLabel(sample) || 'unarmed')})</span>` : ''}${gaps ? ` <span style="color:#e67e22">${gaps} short of arms</span>` : ''}${old ? ` <span style="${NOTE}">${old} armed of old</span>` : ''}</div>`;
            }
            const shortAny = kitted.some(u => u.kit && Arms.kitGaps(u).length);
            html += act('Issue arms from your stores', ['armPack'], BTN_PLAIN, shortAny, 'Nobody is short, or you carry nothing for them.');
            if (s && s.market) {
                const q = kitted.filter(u => u.kit && Arms.kitGaps(u).length).length;
                html += act(`Buy the shortfall in ${esc(s.name)}`, ['armBuy'], BTN_GOLD, q > 0, 'Nobody is short of arms.');
            }
            if (Arms.hasSmith(s)) {
                const mq = Arms.kitMendQuote(player, s, world);
                html += act(`🔨 Mend their arms (${mq.total}g${mq.iron ? `, ${mq.iron} iron` : ''})`, ['mendKits'], BTN_PLAIN, mq.units > 0 && (player.gold || 0) >= mq.total, mq.units ? `${mq.total} gold.` : 'Their arms need no mending.');
            }
            html += `<div style="${NOTE}; margin-top:4px;">A soldier fights by what he carries: unarmed he is worth half a man, with a Common iron kit his full worth, with Fine steel more. Battles wear the kits; the fallen take theirs with them.</div></div>`;
        }
        // Smithing: where to make arms
        const smith = PracticeSkills.def('smithing') ? PracticeSkills.level(player, 'smithing') : null;
        html += `<div style="${NOTE}; margin:6px 0;">⚒️ ${smith != null ? `Smithing ${smith}. ` : ''}Forge arms at any anvil (Weaponsmith &amp; Armoury): smelt ore to iron, copper and tin to bronze, carve hafts, bind grips, then forge. Or order a piece from a town's weaponsmith (Hire the Tradesmen).</div>`;
        html += '</div>';
        game.ui.showCustomPanel('⚔️ Arms & Armour', html);
    },

    armsAct(game, op, a = null) {
        const { player, world } = game;
        const tile = world.getTile(player.q, player.r);
        const s = tile && tile.settlement;
        let res = null;
        if (op === 'equip') res = Arms.equip(player, a);
        else if (op === 'unequip') res = Arms.unequip(player, a);
        else if (op === 'sharpen') res = Arms.sharpen(player, { settlement: s });
        else if (op === 'mendSelf') {
            res = Arms.mend(player, a, { self: true });
            if (res.success && PracticeSkills.def('smithing')) PracticeSkills.gain(player, 'smithing', 3);
        } else if (op === 'mendSmith') res = Arms.mend(player, a, { settlement: s, world });
        else if (op === 'armPack' || op === 'armBuy') {
            const r = Arms.armArmy(player, { settlement: s, world, buy: op === 'armBuy' });
            const got = { ...r.fromPack };
            for (const [k, n] of Object.entries(r.bought)) got[k] = (got[k] || 0) + n;
            res = r.units
                ? { success: true, text: `${r.units} soldiers armed: ${PlayerInventory.describe(got)}${r.cost ? ` (${r.cost} gold)` : ''}.` }
                : { success: false, reason: op === 'armBuy' ? 'The town has nothing fit for them, or you lack the gold.' : 'You carry nothing fit for them.' };
        } else if (op === 'mendKits') res = Arms.mendKits(player, s, world);
        if (res) {
            game.ui.showNotification('⚔️ Arms & Armour', res.success ? (res.text || 'Done.') : (res.reason || 'Not possible.'), res.success ? 'success' : 'error');
            game.ui.updateStats(player, world);
        }
        ActionMenu.showArms(game);
    },

    /** The recruit menu's line on a unit type's kit: where his arms would come from, and his worth. */
    recruitArmsNote(game, unitType, settlement) {
        const q = PlayerMilitary.recruitKitQuote(game.player, unitType, settlement, game.world);
        if (!q) return '';
        const from = Object.entries(q.slots).map(([slot, x]) => (x.id ? `${Arms.nameOf(x.id)}${x.from === 'pack' ? ' (yours)' : ` (${x.price}g)`}` : `no ${(Arms.config().slots[slot] || {}).label || slot}`.toLowerCase())).join(', ');
        return `<div style="font-size: 11px; color: ${q.factor >= 0.95 ? '#81c784' : '#e6b35a'};" title="A recruit is issued arms from your stores first, then the town's armourers' stock at its price">⚔️ Arms: ${esc(from)}${q.cost ? ` · +${q.cost} gold` : ''} · fights at ${pct(q.factor)}</div>`;
    },
});
