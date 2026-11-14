// ActionMenu — Arms & Armour: what the player wields and wears (main hand,
// off hand, head, body, legs, feet, hands), its stats, grade, condition and edge; take up,
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
import { esc, lede, chips, purse, rowList, sectionHead } from './uiKit.js';

// In the action menu's voice (ui/actionMenu/uiKit.js): a section a slot — what
// is worn as a listing row, then one row a thing to do with it (greyed with its
// reason), then the pieces carried that could take its place.
const NOTE = 'font-size: 11px; color: var(--text-secondary);';
const pct = (v) => `${Math.round(v * 100)}%`;

/** One armsAct row: data-am-act="armsAct" data-am-args=[op, arg]. */
function opRow(o, args, ok = true) {
    return { ...o, act: 'armsAct', args, off: !ok };
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
        const gold = player.gold || 0;
        let html = '<div style="font-size:12px;">';
        html += lede(`What you carry decides how you fare in a duel or a brawl, and how much of the road's harm you turn: ${pct(1 - PlayerEffects.personalDamageMultiplier(player))} of it.`);
        html += chips([
            { icon: '⚔️', label: 'Blow', value: me.power.toFixed(1), cls: 'gold' },
            ['🎯', 'Attack', me.attack.toFixed(1)],
            ['🛡️', 'Guard', me.defense.toFixed(1)],
            ['🧥', 'Armour stops', pct(me.armour)],
            ['💨', 'Breath', me.maxStamina],
            purse(gold),
        ]);

        // ── Equipment: a section a slot ──
        for (const slot of Arms.SLOTS) {
            const def = Arms.config().slots[slot] || { label: slot, icon: '⚔️' };
            const p = lo[slot];
            const rows = [];
            if (p) {
                const worn = p.cond < 50 || (p.stats.edge != null && p.edge < 50);
                rows.push({
                    icon: itemIcon(p.id, esc(Arms.iconOf(p.id)), 22),
                    name: `${esc(p.stats.name)}${gradeChip(p.grade)}`,
                    desc: esc(statLine(p.stats)),
                    side: `${Math.round(p.cond)}% sound${p.stats.edge != null ? ` · ${Math.round(p.edge)}% edge` : ''}`,
                    tone: worn ? 'warn' : null,
                });
                if (p.stats.edge != null && p.edge < 99.5) {
                    const hasStone = (player.inventory.whetstone || 0) > 0;
                    rows.push(opRow({
                        icon: '⬛', name: hasStone ? 'Hone it on your whetstone' : 'Have it ground at the smithy',
                        desc: 'Restores the edge', why: 'You need a whetstone, or a town smith.',
                        side: hasStone ? '' : `${Arms.config().wear.grindFee}g`,
                    }, ['sharpen'], hasStone || Arms.hasSmith(s)));
                }
                if (p.cond < 99.5) {
                    const q = Arms.mendQuote(player, slot, s, world);
                    const goods = PlayerInventory.describe(q.goods) || 'nothing';
                    rows.push(opRow({ icon: '🔨', name: 'Mend it yourself', desc: `Takes ${esc(goods)}; trains smithing`, why: `You need ${esc(goods)}.` }, ['mendSelf', slot], q.self));
                    if (q.smith) {
                        const short = q.smith.short.length;
                        rows.push(opRow({
                            icon: '⚒️', name: 'The smith mends it', desc: 'Good as new',
                            why: short ? `The smith has no ${esc(q.smith.short.join(', '))}.` : 'Your purse is short.',
                            side: `${q.smith.total}g`, tone: 'gold',
                        }, ['mendSmith', slot], !short && gold >= q.smith.total));
                    }
                }
                rows.push(opRow({ icon: '🎒', name: 'Put it away', desc: 'Back in your packs' }, ['unequip', slot]));
            } else {
                rows.push({ icon: def.icon, name: slot === 'main' ? 'Bare hands' : 'Nothing', desc: 'Nothing worn here' });
            }
            // What else is carried for the slot (no shield goes on while a two-hander fills both hands)
            const others = Arms.candidates(player, slot).filter(c => !p || c.id !== p.id);
            const bothHands = slot === 'off' && lo.main && lo.main.stats.hands >= 2 ? `Your ${esc(lo.main.stats.name.toLowerCase())} takes both hands: put it away first.` : '';
            for (const c of others.slice(0, 6)) {
                rows.push(opRow({
                    icon: itemIcon(c.id, esc(Arms.iconOf(c.id)), 18),
                    name: `Take up the ${esc(Arms.nameOf(c.id))}${c.count > 1 ? ` <span style="font-weight:normal;color:#9d937c;">×${c.count}</span>` : ''}`,
                    desc: esc(statLine(Arms.stats(c.id, c.grade))), why: bothHands,
                }, ['equip', c.id], !bothHands));
            }
            if (!p && !others.length) rows.push({ icon: '⚒️', name: 'You carry none', desc: 'Forge one at an anvil, buy one, or order one from a town\'s weaponsmith.' });
            html += rowList(rows, `${def.icon} ${esc(def.label)}`);
        }

        // ── The troops ──
        const kitted = (player.army || []).filter(u => Arms.kitSpec(u.type) && !u.mercenary);
        if (kitted.length) {
            const byType = {};
            for (const u of kitted) (byType[u.type] = byType[u.type] || []).push(u);
            const troopRows = Object.entries(byType).map(([type, units]) => {
                const f = units.reduce((t, u) => t + Arms.unitFactor(u), 0) / units.length;
                const gaps = units.filter(u => u.kit && Arms.kitGaps(u).length).length;
                const old = units.filter(u => !u.kit).length;
                const sample = units.find(u => u.kit) || null;
                const notes = [sample ? esc(Arms.kitLabel(sample) || 'unarmed') : '', gaps ? `<span style="color:#e67e22">${gaps} short of arms</span>` : '', old ? `${old} armed of old` : ''].filter(Boolean);
                return {
                    icon: esc(units[0].icon || '⚔️'), name: `${units.length} ${esc(units[0].name || type)}`, desc: notes.join(' · '),
                    side: `fights at ${pct(f)}`, tone: f >= 0.95 ? 'good' : 'warn',
                    title: 'Unarmed a soldier is worth half a man; with a Common iron kit his full worth; with Fine steel more. Battles wear kits; the fallen take theirs with them.',
                };
            });
            const shortAny = kitted.some(u => u.kit && Arms.kitGaps(u).length);
            troopRows.push(opRow({ icon: '🎒', name: 'Issue arms from your stores', desc: 'Fill the gaps from what you carry', why: 'Nobody is short of arms.' }, ['armPack'], shortAny));
            if (Arms._mkt(s)) troopRows.push(opRow({ icon: '💰', name: `Buy the shortfall in ${esc(s.name)}`, desc: 'From the town\'s armourers, at their prices', why: 'Nobody is short of arms.', tone: 'gold' }, ['armBuy'], shortAny));
            if (Arms.hasSmith(s)) {
                const mq = Arms.kitMendQuote(player, s, world);
                troopRows.push(opRow({
                    icon: '🔨', name: 'Mend their arms', desc: mq.iron ? `Takes ${mq.iron} iron` : 'At the town smithy',
                    why: mq.units ? 'Your purse is short.' : 'Their arms need no mending.', side: mq.units ? `${mq.total}g` : '',
                }, ['mendKits'], mq.units > 0 && gold >= mq.total));
            }
            html += rowList(troopRows, '⚔️ Your soldiers\' arms');

            // Arrows and bolts: what the shooters carry, and what filling their quivers takes
            const shooters = (player.army || []).filter(u => Arms.ammoGood(u) && !u.mercenary);
            if (shooters.length) {
                const byGood = {};
                for (const u of shooters) {
                    const g = Arms.ammoGood(u);
                    const o = byGood[g] || (byGood[g] = { have: 0, quiver: 0, dry: 0, units: 0 });
                    const q = Arms.quiverOf(u);
                    const have = u.ammo == null ? q.quiver : Math.floor(u.ammo);
                    o.have += have; o.quiver += q.quiver; o.units++;
                    if (have < q.perBattle) o.dry++;
                }
                const qRows = Object.entries(byGood).map(([g, o]) => ({
                    icon: esc(Arms.iconOf(g)), name: `${esc(Arms.nameOf(g))} in ${o.units} quiver${o.units > 1 ? 's' : ''}`,
                    desc: `${esc(PlayerInventory.describe({ [g]: Math.floor(player.inventory[g] || 0) }) || 'none')} in your packs${o.dry ? ` · <span style="color:#e67e22">${o.dry} short of a battle's worth: they fight at ${pct(Arms.dryMult())}</span>` : ''}`,
                    side: `${o.have}/${o.quiver}`, tone: o.dry ? 'warn' : null,
                }));
                const qq = Arms.quiverQuote(player, s, world);
                const want = Object.values(qq).reduce((t, o) => t + o.want, 0);
                qRows.push(opRow({ icon: '🎒', name: 'Fill the quivers from your packs', why: want > 0 ? 'You carry none.' : 'Every quiver is full.' }, ['quiversPack'], want > 0 && Object.keys(qq).some(g => (player.inventory[g] || 0) > 0)));
                if (Arms._mkt(s)) {
                    const cost = Object.values(qq).reduce((t, o) => t + (o.price || 0) * Math.min(o.want, o.stock || 0), 0);
                    const stock = Object.values(qq).reduce((t, o) => t + Math.min(o.want, o.stock || 0), 0);
                    qRows.push(opRow({
                        icon: '💰', name: `Buy for the quivers in ${esc(s.name)}`, desc: stock ? `${stock} to be had` : '',
                        why: want > 0 ? 'The town has none to sell.' : 'Every quiver is full.', side: stock ? `${cost}g` : '', tone: 'gold',
                    }, ['quiversBuy'], stock > 0 && gold >= 1));
                }
                html += rowList(qRows, '🏹 Arrows and bolts');
            }
        }
        // Smithing: where to make arms
        const smith = PracticeSkills.def('smithing') ? PracticeSkills.level(player, 'smithing') : null;
        html += sectionHead('Making arms') + `<div style="${NOTE}">⚒️ ${smith != null ? `Smithing ${smith}. ` : ''}Forge at any anvil (Weaponsmith &amp; Armoury), or order a piece from a town's weaponsmith (Hire the Tradesmen).</div>`;
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
        else if (op === 'quiversPack' || op === 'quiversBuy') {
            const r = Arms.supplyQuivers(player, { settlement: s, world, buy: op === 'quiversBuy' });
            const got = { ...r.fromPack };
            for (const [k, n] of Object.entries(r.bought)) got[k] = (got[k] || 0) + n;
            res = Object.keys(got).length
                ? { success: true, text: `The quivers take ${PlayerInventory.describe(got)}${r.cost ? ` (${r.cost} gold)` : ''}.${r.short ? ` ${r.short} still wanted.` : ''}` }
                : { success: false, reason: op === 'quiversBuy' ? 'The town has none to sell, or you lack the gold.' : 'You carry none for them.' };
        }
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
        let from = Object.entries(q.slots).filter(([, x]) => !x.twoHands).map(([slot, x]) => (x.id ? `${Arms.nameOf(x.id)}${x.from === 'pack' ? ' (yours)' : ` (${x.price}g)`}` : `no ${(Arms.config().slots[slot] || {}).label || slot}`.toLowerCase())).join(', ');
        // A bowman's quiver
        if (q.ammo) from += `, ${q.ammo.pack + q.ammo.buy}/${q.ammo.want} ${Arms.nameOf(q.ammo.good).toLowerCase()}${q.ammo.buy ? ` (${q.ammo.buy} at ${q.ammo.price}g)` : q.ammo.pack ? ' (yours)' : ''}`;
        return `<div style="font-size: 11px; color: ${q.factor >= 0.95 ? '#81c784' : '#e6b35a'};" title="A recruit is issued arms from your stores first, then the town's armourers' stock at its price">⚔️ Arms: ${esc(from)}${q.cost ? ` · +${q.cost} gold` : ''} · fights at ${pct(q.factor)}</div>`;
    },
});
