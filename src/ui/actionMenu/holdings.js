// ActionMenu — Manage Holding: develop a settlement you rule (projects,
// governor, garrison, unrest and rebellion). Logic lives in
// systems/holdings.js; this panel presents it in the action menu's voice
// (ui/actionMenu/uiKit.js): a lede and figures, then one row a project,
// candidate or company.
import { ActionMenu } from './_ref.js';
import { peopleLine } from './labour.js';
import { Holdings, PlayerMilitary } from './_imports.js';
import { HoldingSieges } from '../../systems/holdingSieges.js';
import { BTN_PLAIN, BTN_DIM, lede, chips, purse, sectionHead, kv, card, actRow, rowList, price } from './uiKit.js';

const SMALL = 'padding:2px 8px; margin:0 0 0 4px; font-size:11px;';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function bar(value, max, color, width = '') {
    const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(1, max)) * 100)));
    const box = width ? `width:${width}; display:inline-block; vertical-align:middle; margin-left:6px;` : 'margin-top:4px;';
    return `<span style="display:block; height:4px; ${box} background:rgba(255,255,255,0.08); border-radius:2px; overflow:hidden;"><span style="display:block; width:${pct}%; height:100%; background:${color};"></span></span>`;
}

/** A label/value pair whose value carries a muted aside ("→ 60", "a year"). */
function stat(label, value, sub = '') {
    return kv(label, `${value}${sub ? ` <small style="color:#9d937c; font-weight:400;">${sub}</small>` : ''}`);
}

/** A small button for a row's side column (the row itself is then not a button). */
function smallBtn(live, onclick, label) {
    return `<button ${live ? `onclick="${onclick}"` : 'disabled'} style="${live ? BTN_PLAIN : BTN_DIM} ${SMALL}">${label}</button>`;
}

Object.assign(ActionMenu, {
    /** The Manage Holding panel for the settlement on `tile`. */
    showHoldingPanel(game, tile) {
        const player = game.player;
        const world = game.world;
        if (!tile || !tile.settlement || !Holdings.isHolding(player, world, tile.q, tile.r)) {
            game.ui.showNotification('Not Yours', 'You do not rule this settlement.', 'error');
            return;
        }
        const { q, r } = tile;
        const s = Holdings.stats(player, world, q, r);
        const h = tile.settlement.holding;
        const present = Holdings._present(player, world, q, r);

        let html = '<div style="max-height:600px; overflow-y:auto;">';
        html += lede(`<b>${esc(s.name)}</b> · ${esc(s.tier.name)} · ${s.population} people · development slots <b>${s.used}/${s.slots}</b>`);
        const unrestColor = s.unrest >= 75 ? '#e0846a' : s.unrest >= 50 ? '#f0b35a' : '#8fd18a';
        html += chips([
            { icon: '💰', label: 'Tax', value: `${s.weeklyTax}g/wk`, cls: 'gold' },
            ['🔥', 'Unrest', `<span style="color:${unrestColor};">${s.unrest}</span>`],
            ['🛡️', 'Garrison', s.garrison],
            purse(player.gold),
        ]);

        // ── Rebellion ──
        if (s.rebellion) {
            const days = Math.max(0, s.rebellion.deadline - world.day);
            const cost = Holdings.parleyCost(tile.settlement);
            const army = PlayerMilitary.getArmyStrength(player);
            const canCrush = present && army > 0;
            let body = `<div style="margin:0 0 4px;">Rebels ${s.rebellion.strength} strong hold the streets. No taxes and no building until it ends. If they still hold it in <b>${days}</b> day(s), the town is lost.</div>`;
            body += rowList([
                {
                    icon: '⚔️', name: 'Crush the rebels', desc: `Your army ${army} vs ${s.rebellion.strength}`,
                    off: !canCrush, why: `Your army ${army} vs ${s.rebellion.strength} · ${present ? 'you have no soldiers to lead' : 'you must be at the holding'}`,
                    attrs: canCrush ? 'onclick="window._holding.crush()"' : '', side: `${army} vs ${s.rebellion.strength}`, tone: 'bad',
                },
                {
                    icon: '🤝', name: 'Buy them off', desc: '−5 renown',
                    off: player.gold < cost, why: '−5 renown · your purse is short',
                    attrs: player.gold >= cost ? 'onclick="window._holding.parley()"' : '', side: price(cost, player.gold >= cost),
                },
            ]);
            if (!present) body += '<div style="color:#9d937c; font-size:10.5px;">You must be at the holding to lead your army against them. A garrison strong enough will crush them on its own.</div>';
            html += card(body, { icon: '🔥', title: '<span style="color:#e0846a;">The town is in revolt</span>', side: `${days} day(s) left`, tone: 'bad' });
        }

        // ── Under siege (systems/holdingSieges.js) ──
        const siege = HoldingSieges.at(player, q, r);
        if (siege) {
            const body = rowList([{
                icon: '🏰', name: 'Holdings Under Siege',
                desc: `Day ${world.day - siege.startDay} · ${Math.round(siege.stores)} days of food · garrison ${Math.round(siege.garrison)} vs ${Math.round(siege.besiegers)} besiegers.`,
                act: 'showHoldingSiegesPanel', side: '›', tone: 'bad',
            }]);
            html += card(body, { icon: '🚩', title: `<span style="color:#e0846a;">Under siege by ${esc(siege.hostName)}</span>`, tone: 'bad' });
        }

        // ── Stats summary ──
        html += sectionHead('The town');
        html += '<div style="display:grid; grid-template-columns:1fr 1fr; column-gap:18px; margin-bottom:8px;">';
        html += stat('Weekly tax', `${s.weeklyTax}g`, s.skim ? `(${s.skim}% skimmed)` : '');
        html += stat('Happiness', s.happiness, `→ ${s.happinessTarget}`);
        html += stat('Loyalty', s.loyalty == null ? '—' : `${s.loyalty}%`);
        html += kv('Unrest', `<span style="color:${unrestColor};">${s.unrest}</span>${bar(s.unrest, 100, unrestColor, '48px')}`);
        html += stat('Defence', s.defense, `rebels ${s.rebels}`);
        html += stat('Garrison', s.garrison, `${s.garrisonUnits} units · ${s.upkeep}g/day`);
        html += stat('Food in store', s.reserveDays == null ? '—' : `${s.reserveDays} days`);
        html += stat('Growth', `${s.growth > 0 ? '+' : ''}${s.growth}%`, 'a year');
        html += stat('Governor', s.governor ? esc(s.governor.name.split(' (')[0]) : '<span style="color:#f0b35a;">none</span>');
        html += '</div>';
        // ── The people (world/townLabour.js) ──
        const people = peopleLine(tile.settlement, world.day);
        if (people) html += rowList([{ icon: '👥', name: 'The people', desc: people, act: 'showTownPeople', args: [null, q, r], side: '›' }]);
        if (s.drifting) {
            html += '<div style="color:#f0b35a; font-size:11px; margin:2px 0 6px;">⚠️ Ungoverned and far from you, the town drifts: happiness and loyalty slip and unrest grows each day. Appoint a governor or come back.</div>';
        }

        // ── Projects ──
        const defs = Holdings.projects();
        html += sectionHead('🏗️ Development');
        const built = Object.keys(h.built);
        if (built.length) {
            html += kv('Built', built.map(id => `${(defs[id] && defs[id].icon) || ''} ${esc((defs[id] && defs[id].name) || id)}`).join(' · '));
        }
        const projectRows = [];
        for (const p of h.queue) {
            const def = defs[p.id] || { name: p.id, icon: '🏗️' };
            const left = Math.max(0, Math.ceil(p.days - p.progress));
            projectRows.push(actRow({
                icon: def.icon, name: esc(def.name), desc: `under construction · ~${left} day(s)`,
                note: bar(p.progress, p.days, 'var(--gold)'),
                side: `<span style="color:#ffcf6a;">~${left} day(s)</span>${smallBtn(true, `window._holding.cancel('${p.id}')`, 'Abandon (refund half)')}`,
            }));
        }
        for (const [id, def] of Object.entries(defs)) {
            if (h.built[id] || h.queue.some(p => p.id === id)) continue;
            const can = Holdings.canStart(player, world, q, r, id);
            // Hide upgrades whose base isn't built yet, and bases already improved
            if (!can.ok && /first\.|Already improved/.test(can.reason || '')) continue;
            const quote = Holdings.quote(player, id);
            const fx = Holdings.projectEffect(player, world, q, r, id);
            const mats = quote.materials.map(m => `${m.need} ${m.id}${m.missing ? ` <span style="color:#f0b35a;">(${m.missing} bought at ${m.price}g)</span>` : ''}`).join(', ');
            const extra = [];
            if (fx.taxDelta) extra.push(`≈ ${fx.taxDelta > 0 ? '+' : ''}${fx.taxDelta}g tax a week`);
            if (fx.defenseAfter !== fx.defenseBefore) extra.push(`defence ${fx.defenseBefore} → ${fx.defenseAfter}`);
            if (fx.replaces) extra.push(`replaces the ${fx.replaces}`);
            const effect = `${fx.lines.join(', ')}${extra.length ? ` · <span style="color:#e0d090;">${extra.join(' · ')}</span>` : ''}`;
            const cost = `<span style="color:#9d937c;">${quote.gold}g${mats ? ` + ${mats}` : ''}</span>`;
            projectRows.push({
                icon: def.icon, name: esc(def.name),
                desc: esc(def.description || ''),
                note: `${effect}<br>${cost}`,
                off: !can.ok, why: `${esc(can.reason)} · ${esc(def.description || '')}`,
                attrs: can.ok ? `onclick="window._holding.start('${id}')"` : '',
                title: can.ok ? 'Begin construction' : '',
                side: `${price(quote.total, can.ok)}<br><small style="color:#9d937c;">${def.days} days</small>`,
            });
        }
        html += rowList(projectRows);

        // ── Governor ──
        html += sectionHead('👤 Governor');
        if (h.governor) {
            const g = h.governor;
            const loyColor = g.loyalty >= 60 ? '#8fd18a' : g.loyalty >= 30 ? '#f0b35a' : '#e0846a';
            const warns = [];
            if (s.skim) warns.push(`<span style="color:#f0b35a;">Pockets about ${s.skim}% of the taxes.</span>`);
            if (g.unpaid) warns.push('<span style="color:#e0846a;">Unpaid: loyalty is falling.</span>');
            html += rowList([actRow({
                icon: '👤', name: `${esc(g.name)} <small style="color:#9d937c; font-weight:400;">(${g.kind})</small>`,
                desc: `Stewardship ${g.stewardship} · Martial ${g.martial} · Intrigue ${g.intrigue} · Loyalty <b style="color:${loyColor};">${Math.round(g.loyalty)}</b>${g.wage ? ` · ${g.wage}g/day` : ''}`,
                note: warns.join(' '),
                side: smallBtn(true, 'window._holding.dismiss()', 'Relieve of office'),
            })]);
        } else {
            html += '<div style="color:#9d937c; margin:0 0 6px;">No one governs here. While you are far away the town drifts.</div>';
        }
        const cands = Holdings.governorCandidates(player, world, q, r);
        if (cands.length) {
            const rows = cands.map(c => {
                const preview = Holdings.computeFx(tile.settlement, { governor: c });
                const affordable = (c.fee || 0) <= player.gold;
                const line = `S ${c.stewardship} · M ${c.martial} · I ${c.intrigue} · loyalty ~${Math.round(c.loyalty)}${c.wage ? ` · ${c.wage}g/day` : ''}${c.fee ? ` · ${c.fee}g to hire` : ''}`;
                return {
                    icon: '👤', name: `${esc(c.name)} <small style="color:#9d937c; font-weight:400;">${c.kind}</small>`,
                    desc: line,
                    note: `tax ×${preview.taxMult.toFixed(2)}${preview.skim ? ` (skims ${Math.round(preview.skim * 100)}%)` : ''} · defence +${Math.round(c.martial * 4)}% · calms ${(c.martial * 0.05 + c.stewardship * 0.02 + c.intrigue * 0.03).toFixed(2)} unrest a day${c.kind === 'companion' ? ' · leaves your party' : ''}`,
                    off: !affordable, why: `${line} · your purse is short`,
                    attrs: affordable ? `onclick="window._holding.appoint('${esc(c.id)}')"` : '',
                    title: 'Appoint',
                    side: c.fee ? price(c.fee, affordable) : 'Appoint',
                    tone: c.fee ? '' : 'gold',
                };
            });
            html += `<details class="pk-more"><summary>Appoint a governor…</summary>${rowList(rows)}</details>`;
        }

        // ── Garrison ──
        html += sectionHead('🛡️ Garrison');
        const group = (units) => units.reduce((m, u) => { m[u.type] = m[u.type] || { n: 0, name: u.name || u.type, icon: u.icon || '⚔️' }; m[u.type].n++; return m; }, {});
        const inGarrison = group(h.garrison);
        const inArmy = group(Holdings.stationable(player));
        const gRows = [];
        for (const [type, g] of Object.entries(inGarrison)) {
            gRows.push(actRow({ icon: g.icon, name: `${g.n} ${esc(g.name)}`, desc: 'Stationed', side: smallBtn(present, `window._holding.withdraw('${type}', 1)`, '−1') }));
        }
        if (!gRows.length) gRows.push(actRow({ icon: '🏰', name: 'Stationed: none', desc: 'No troops hold the town' }));
        for (const [type, g] of Object.entries(inArmy)) {
            gRows.push(actRow({
                icon: g.icon, name: `${g.n} ${esc(g.name)}`, desc: 'Your army',
                side: smallBtn(present, `window._holding.station('${type}', 1)`, '+1') + smallBtn(present, `window._holding.station('${type}', ${g.n})`, 'all'),
            }));
        }
        if (!Object.keys(inArmy).length) gRows.push(actRow({ icon: '⚔️', name: 'Your army', desc: 'no soldiers to spare' }));
        html += rowList(gRows);
        html += '<div style="font-size:10.5px; color:#9d937c; margin-top:-4px;">Troops here defend against war hosts, raiders and rebels, calm unrest, and are paid from your purse each day. You must be at the holding to move them.</div>';

        // ── Recent ──
        const log = ((player.holdings && player.holdings.log) || []).slice(-5).reverse();
        if (log.length) {
            html += sectionHead('📜 Recent');
            html += '<div style="font-size:11px; color:#b9ae94;">';
            for (const e of log) html += `<div style="padding:2px 0;"><span style="color:#9d937c;">Day ${e.day}:</span> ${esc(e.text)}</div>`;
            html += '</div>';
        }
        html += '</div>';
        game.ui.showCustomPanel(`🏰 ${s.name}`, html);

        const after = (title, res) => {
            game.ui.showNotification(title, res.success ? (res.text || 'Done.') : (res.reason || 'Not possible.'), res.success ? 'success' : 'error');
            game.ui.updateStats(player, world);
            ActionMenu.showHoldingPanel(game, world.getTile(q, r));
        };
        window._holding = {
            start: (id) => after('🏗️ Construction', Holdings.startProject(player, world, q, r, id)),
            cancel: (id) => after('🏗️ Construction', Holdings.cancelProject(player, world, q, r, id)),
            appoint: (id) => after('👤 Governor', Holdings.appointGovernor(player, world, q, r, id)),
            dismiss: () => after('👤 Governor', Holdings.dismissGovernor(player, world, q, r)),
            station: (type, n) => after('🛡️ Garrison', Holdings.stationTroops(player, world, q, r, type, n)),
            withdraw: (type, n) => after('🛡️ Garrison', Holdings.withdrawTroops(player, world, q, r, type, n)),
            parley: () => after('🤝 Parley', Holdings.parley(player, world, q, r)),
            crush: () => {
                const hold = world.getTile(q, r).settlement.holding;
                if (!hold || !hold.rebellion) return;
                const battle = PlayerMilitary.combat(player, hold.rebellion.strength, `Rebels of ${tile.settlement.name}`, {
                    terrainId: tile.terrain && tile.terrain.id, world,
                    lootPurse: null, // rebel peasants carry nothing worth the taking
                });
                if (battle.reason && !battle.victory && battle.casualties === undefined) {
                    after('⚔️ Rebellion', { success: false, reason: battle.reason });
                    return;
                }
                const res = Holdings.resolveRebellion(player, world, q, r, !!battle.victory);
                const losses = battle.casualties ? ` You lost ${battle.casualties} unit(s).` : '';
                after('⚔️ Rebellion', { success: true, text: `${res.text || ''}${losses}` });
            },
        };
    },
});
