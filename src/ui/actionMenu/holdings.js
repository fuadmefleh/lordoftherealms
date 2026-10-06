// ActionMenu — Manage Holding: develop a settlement you rule (projects,
// governor, garrison, unrest and rebellion). Logic lives in
// systems/holdings.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { peopleLine } from './labour.js';
import { Holdings, PlayerMilitary } from './_imports.js';
import { HoldingSieges } from '../../systems/holdingSieges.js';

const BTN = 'padding: 5px 9px; margin: 3px 4px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_DIM = BTN + 'background: rgba(255,255,255,0.08); color: var(--text-secondary); cursor: default;';
const BTN_RED = BTN + 'background: #7a3030; color: #eee;';
const BTN_PLAIN = BTN + 'background: rgba(255,255,255,0.12); color: var(--text-primary);';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';
const STAT = 'padding: 6px 8px; background: rgba(0,0,0,0.25); border-radius: 4px;';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function bar(value, max, color) {
    const pct = Math.max(0, Math.min(100, Math.round((value / Math.max(1, max)) * 100)));
    return `<div style="height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden; margin-top:3px;"><div style="width:${pct}%; height:100%; background:${color};"></div></div>`;
}

function stat(label, value, sub = '') {
    return `<div style="${STAT}"><small style="color:#aaa;">${label}</small><br><b>${value}</b>${sub ? ` <small style="color:#999;">${sub}</small>` : ''}</div>`;
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

        let html = '<div style="font-size:12px; max-height:600px; overflow-y:auto;">';
        html += `<p style="margin:0 0 6px; color:var(--text-secondary);">${esc(s.name)} · ${esc(s.tier.name)} · ${s.population} people · development slots <b>${s.used}/${s.slots}</b></p>`;

        // ── Rebellion ──
        if (s.rebellion) {
            const days = Math.max(0, s.rebellion.deadline - world.day);
            const cost = Holdings.parleyCost(tile.settlement);
            const army = PlayerMilitary.getArmyStrength(player);
            html += `<div style="${CARD} border-color:#c0392b; background:rgba(192,57,43,0.12);">`;
            html += `<strong style="color:#ff7b6b;">🔥 The town is in revolt</strong><div style="margin:4px 0;">Rebels ${s.rebellion.strength} strong hold the streets. No taxes and no building until it ends. If they still hold it in <b>${days}</b> day(s), the town is lost.</div>`;
            html += `<button ${present && army > 0 ? 'onclick="window._holding.crush()"' : 'disabled'} style="${present && army > 0 ? BTN_RED : BTN_DIM}">⚔️ Crush the rebels (your army ${army} vs ${s.rebellion.strength})</button>`;
            html += `<button ${player.gold >= cost ? 'onclick="window._holding.parley()"' : 'disabled'} style="${player.gold >= cost ? BTN_GOLD : BTN_DIM}">🤝 Buy them off (${cost}g, −5 renown)</button>`;
            if (!present) html += '<div style="color:#999; font-size:10px; margin-top:3px;">You must be at the holding to lead your army against them. A garrison strong enough will crush them on its own.</div>';
            html += '</div>';
        }

        // ── Under siege (systems/holdingSieges.js) ──
        const siege = HoldingSieges.at(player, q, r);
        if (siege) {
            html += `<div style="${CARD} border-color:#c0392b; background:rgba(192,57,43,0.12);">`;
            html += `<strong style="color:#ff7b6b;">🚩 Under siege by ${esc(siege.hostName)}</strong><div style="margin:4px 0;">Day ${world.day - siege.startDay} · ${Math.round(siege.stores)} days of food · garrison ${Math.round(siege.garrison)} vs ${Math.round(siege.besiegers)} besiegers.</div>`;
            html += `<button data-am-act="showHoldingSiegesPanel" style="${BTN_RED}">🏰 Holdings Under Siege</button></div>`;
        }

        // ── Stats summary ──
        const unrestColor = s.unrest >= 75 ? '#e74c3c' : s.unrest >= 50 ? '#e8a040' : '#7fd07f';
        html += '<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; margin:6px 0;">';
        html += stat('Weekly tax', `${s.weeklyTax}g`, s.skim ? `(${s.skim}% skimmed)` : '');
        html += stat('Happiness', s.happiness, `→ ${s.happinessTarget}`);
        html += stat('Loyalty', s.loyalty == null ? '—' : `${s.loyalty}%`);
        html += `<div style="${STAT}"><small style="color:#aaa;">Unrest</small><br><b style="color:${unrestColor};">${s.unrest}</b>${bar(s.unrest, 100, unrestColor)}</div>`;
        html += stat('Defence', s.defense, `rebels ${s.rebels}`);
        html += stat('Garrison', s.garrison, `${s.garrisonUnits} units · ${s.upkeep}g/day`);
        html += stat('Food in store', s.reserveDays == null ? '—' : `${s.reserveDays} days`);
        html += stat('Growth', `${s.growth > 0 ? '+' : ''}${s.growth}%`, 'a year');
        html += stat('Governor', s.governor ? esc(s.governor.name.split(' (')[0]) : '<span style="color:#e8a040;">none</span>');
        html += '</div>';
        // ── The people (world/townLabour.js) ──
        const people = peopleLine(tile.settlement, world.day);
        if (people) html += `<div style="margin:4px 0;">👥 ${people} <button data-am-act="showTownPeople" data-am-args='[null, ${q}, ${r}]' style="${BTN_PLAIN}">The people</button></div>`;
        if (s.drifting) {
            html += '<div style="color:#e8a040; font-size:11px;">⚠️ Ungoverned and far from you, the town drifts: happiness and loyalty slip and unrest grows each day. Appoint a governor or come back.</div>';
        }

        // ── Projects ──
        const defs = Holdings.projects();
        html += '<h5 style="margin:10px 0 4px;">🏗️ Development</h5>';
        const built = Object.keys(h.built);
        if (built.length) {
            html += `<div style="margin-bottom:4px;">Built: ${built.map(id => `${(defs[id] && defs[id].icon) || ''} ${esc((defs[id] && defs[id].name) || id)}`).join(' · ')}</div>`;
        }
        for (const p of h.queue) {
            const def = defs[p.id] || { name: p.id, icon: '🏗️' };
            const left = Math.max(0, Math.ceil(p.days - p.progress));
            html += `<div style="${CARD} padding:6px 8px;"><div style="display:flex; justify-content:space-between;"><span>${def.icon} <b>${esc(def.name)}</b> under construction</span><span style="color:#e0b040;">~${left} day(s)</span></div>${bar(p.progress, p.days, 'var(--gold)')}`;
            html += `<button onclick="window._holding.cancel('${p.id}')" style="${BTN_PLAIN}">Abandon (refund half)</button></div>`;
        }
        for (const [id, def] of Object.entries(defs)) {
            if (h.built[id] || h.queue.some(p => p.id === id)) continue;
            const can = Holdings.canStart(player, world, q, r, id);
            // Hide upgrades whose base isn't built yet, and bases already improved
            if (!can.ok && /first\.|Already improved/.test(can.reason || '')) continue;
            const quote = Holdings.quote(player, id);
            const fx = Holdings.projectEffect(player, world, q, r, id);
            const mats = quote.materials.map(m => `${m.need} ${m.id}${m.missing ? ` <span style="color:#e8a040;">(${m.missing} bought at ${m.price}g)</span>` : ''}`).join(', ');
            const extra = [];
            if (fx.taxDelta) extra.push(`≈ ${fx.taxDelta > 0 ? '+' : ''}${fx.taxDelta}g tax a week`);
            if (fx.defenseAfter !== fx.defenseBefore) extra.push(`defence ${fx.defenseBefore} → ${fx.defenseAfter}`);
            if (fx.replaces) extra.push(`replaces the ${fx.replaces}`);
            html += `<div style="${CARD} padding:6px 8px;">`;
            html += `<div style="display:flex; justify-content:space-between; gap:6px;"><b>${def.icon} ${esc(def.name)}</b><span style="color:#aaa; white-space:nowrap;">${quote.total}g · ${def.days} days</span></div>`;
            html += `<div style="color:#bbb; font-size:11px;">${esc(def.description || '')}</div>`;
            html += `<div style="font-size:11px; color:#9fd59f;">${fx.lines.join(', ')}${extra.length ? ` · <span style="color:#e0d090;">${extra.join(' · ')}</span>` : ''}</div>`;
            html += `<div style="font-size:10px; color:#999;">${quote.gold}g${mats ? ` + ${mats}` : ''}</div>`;
            html += `<button ${can.ok ? `onclick="window._holding.start('${id}')"` : 'disabled'} style="${can.ok ? BTN_GOLD : BTN_DIM}">${can.ok ? 'Begin construction' : esc(can.reason)}</button>`;
            html += '</div>';
        }

        // ── Governor ──
        html += '<h5 style="margin:10px 0 4px;">👤 Governor</h5>';
        if (h.governor) {
            const g = h.governor;
            const loyColor = g.loyalty >= 60 ? '#7fd07f' : g.loyalty >= 30 ? '#e8a040' : '#e74c3c';
            html += `<div style="${CARD}"><b>${esc(g.name)}</b> <small style="color:#999;">(${g.kind})</small><br>`;
            html += `Stewardship ${g.stewardship} · Martial ${g.martial} · Intrigue ${g.intrigue} · Loyalty <b style="color:${loyColor};">${Math.round(g.loyalty)}</b>${g.wage ? ` · ${g.wage}g/day` : ''}`;
            if (s.skim) html += `<div style="color:#e8a040; font-size:11px;">Pockets about ${s.skim}% of the taxes.</div>`;
            if (g.unpaid) html += '<div style="color:#e74c3c; font-size:11px;">Unpaid: loyalty is falling.</div>';
            html += `<br><button onclick="window._holding.dismiss()" style="${BTN_PLAIN}">Relieve of office</button></div>`;
        } else {
            html += '<div style="color:#aaa;">No one governs here. While you are far away the town drifts.</div>';
        }
        const cands = Holdings.governorCandidates(player, world, q, r);
        if (cands.length) {
            html += '<details style="margin-top:4px;"><summary style="cursor:pointer;">Appoint a governor…</summary>';
            for (const c of cands) {
                const preview = Holdings.computeFx(tile.settlement, { governor: c });
                const affordable = (c.fee || 0) <= player.gold;
                html += `<div style="${CARD} padding:6px 8px;"><b>${esc(c.name)}</b> <small style="color:#999;">${c.kind}</small><br>`;
                html += `S ${c.stewardship} · M ${c.martial} · I ${c.intrigue} · loyalty ~${Math.round(c.loyalty)}${c.wage ? ` · ${c.wage}g/day` : ''}${c.fee ? ` · ${c.fee}g to hire` : ''}`;
                html += `<div style="font-size:10px; color:#9fd59f;">tax ×${preview.taxMult.toFixed(2)}${preview.skim ? ` (skims ${Math.round(preview.skim * 100)}%)` : ''} · defence +${Math.round(c.martial * 4)}% · calms ${(c.martial * 0.05 + c.stewardship * 0.02 + c.intrigue * 0.03).toFixed(2)} unrest a day${c.kind === 'companion' ? ' · leaves your party' : ''}</div>`;
                html += `<button ${affordable ? `onclick="window._holding.appoint('${esc(c.id)}')"` : 'disabled'} style="${affordable ? BTN_GOLD : BTN_DIM}">Appoint</button></div>`;
            }
            html += '</details>';
        }

        // ── Garrison ──
        html += '<h5 style="margin:10px 0 4px;">🛡️ Garrison</h5>';
        const group = (units) => units.reduce((m, u) => { m[u.type] = m[u.type] || { n: 0, name: u.name || u.type, icon: u.icon || '⚔️' }; m[u.type].n++; return m; }, {});
        const inGarrison = group(h.garrison);
        const inArmy = group(Holdings.stationable(player));
        html += `<div>Stationed: ${Object.keys(inGarrison).length ? Object.entries(inGarrison).map(([type, g]) => `${g.icon} ${g.n} ${esc(g.name)} <button ${present ? `onclick="window._holding.withdraw('${type}', 1)"` : 'disabled'} style="${present ? BTN_PLAIN : BTN_DIM} padding:1px 6px;">−1</button>`).join(' ') : 'none'}</div>`;
        html += `<div style="margin-top:4px;">Your army: ${Object.keys(inArmy).length ? Object.entries(inArmy).map(([type, g]) => `${g.icon} ${g.n} ${esc(g.name)} <button ${present ? `onclick="window._holding.station('${type}', 1)"` : 'disabled'} style="${present ? BTN_PLAIN : BTN_DIM} padding:1px 6px;">+1</button><button ${present ? `onclick="window._holding.station('${type}', ${g.n})"` : 'disabled'} style="${present ? BTN_PLAIN : BTN_DIM} padding:1px 6px;">all</button>`).join(' ') : 'no soldiers to spare'}</div>`;
        html += '<div style="font-size:10px; color:#999; margin-top:3px;">Troops here defend against war hosts, raiders and rebels, calm unrest, and are paid from your purse each day. You must be at the holding to move them.</div>';

        // ── Recent ──
        const log = ((player.holdings && player.holdings.log) || []).slice(-5).reverse();
        if (log.length) {
            html += '<h5 style="margin:10px 0 4px;">📜 Recent</h5><div style="font-size:11px; color:#bbb;">';
            for (const e of log) html += `<div>Day ${e.day}: ${esc(e.text)}</div>`;
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
