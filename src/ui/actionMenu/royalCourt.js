// ActionMenu — the Royal Court: the council, edicts, vassals and their
// factions, and the realm's state, for a player who rules a realm. Logic lives
// in systems/kingship.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { Kingship } from '../../systems/kingship.js';
import { Throne, House } from './_imports.js';
import { panelTabs } from './uiKit.js';

const BTN = 'padding: 5px 9px; margin: 4px 4px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_RED = BTN + 'background: #8e2b2b; color: #fff;';
const BTN_DIM = BTN + 'background: rgba(255,255,255,0.08); color: var(--text-secondary); cursor: default;';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';
const MUTED = 'color: var(--text-secondary); font-size: 11px;';
const TABS = [['council', '🏛️ Council'], ['edicts', '📜 Edicts'], ['vassals', '🛡️ Vassals'], ['realm', '👑 Realm']];

const _esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
const _sign = v => `${v > 0 ? '+' : ''}${v}`;

function _btn(label, call, enabled = true, style = BTN_GOLD, title = '') {
    return `<button title="${_esc(title)}" onclick="${enabled ? call : ''}" style="${enabled ? style : BTN_DIM}" ${enabled ? '' : 'disabled'}>${label}</button>`;
}

function _opinionColor(v) {
    if (v >= 20) return '#8fd88f';
    if (v >= 0) return '#f1c40f';
    if (v >= -40) return '#e67e22';
    return '#e74c3c';
}

function _bar(value, min, max, color) {
    const pct = Math.round(((value - min) / Math.max(1, max - min)) * 100);
    return `<div style="height:5px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;margin:2px 0 4px;">
        <div style="width:${Math.max(0, Math.min(100, pct))}%;height:100%;background:${color};"></div></div>`;
}

function _modsText(mods) {
    return Object.entries(mods || {}).map(([k, v]) => `${k} ${_sign(Math.round(v * 100))}%`).join(' · ');
}

function _councilTab(player, world) {
    const offices = Kingship.offices();
    let html = `<div style="${MUTED}">Each office's bonus is its holder's competence (1-20) times a loyalty factor. Lords on the council think better of the crown; ambitious lords resent upstarts (family and companions) in the great offices.</div>`;
    for (const o of Kingship.OFFICES) {
        const def = offices[o] || {};
        const cur = Kingship.councillor(player, world, o);
        html += `<div style="${CARD}">`;
        html += `<div style="font-weight:bold;">${def.icon || ''} ${_esc(def.label || o)}</div>`;
        html += `<div style="${MUTED}">${_esc(def.blurb || '')}</div>`;
        if (cur) {
            html += `<div style="margin-top:4px;">${_esc(cur.name)} <span style="${MUTED}">· ${_esc(cur.desc)} · competence ${cur.competence} · loyalty ${cur.loyalty}</span></div>`;
            html += _btn('Dismiss', `window._court.dismiss('${o}')`, true, BTN_RED);
        } else {
            html += `<div style="color:#e88;margin-top:4px;">Vacant</div>`;
        }
        const cands = Kingship.candidates(player, world, o).filter(c => !(cur && c.kind === cur.kind && c.id === cur.id)).slice(0, 5);
        if (cands.length) {
            html += `<div style="${MUTED}margin-top:4px;">Candidates:</div>`;
            for (const c of cands) {
                html += `<div style="font-size:11px;">${_esc(c.name)} <span style="${MUTED}">(${_esc(c.desc)}) · competence ${c.competence} · loyalty ${c.loyalty}${c.office ? ` · now ${_esc((offices[c.office] || {}).label || c.office)}` : ''}</span> `;
                html += _btn('Appoint', `window._court.appoint('${o}','${c.kind}','${_esc(c.id)}')`) + '</div>';
            }
        }
        html += '</div>';
    }
    return html;
}

function _edictsTab(player, world) {
    const court = Kingship.court(player);
    const stats = Kingship.realmStats(player, world);
    let html = `<div style="${MUTED}">Edicts are realm-wide decrees. Proclaiming one costs the royal treasury; most cost upkeep every day until revoked (they lapse if the treasury cannot pay). In force: ${stats.edicts}/${stats.edictSlots} · upkeep ${stats.upkeep}g/day · treasury ${stats.treasury}g.</div>`;
    for (const [id, def] of Object.entries(Kingship.edicts())) {
        const active = !!court.edicts[id];
        const can = active ? null : Kingship.canPass(player, world, id);
        html += `<div style="${CARD}${active ? 'border-color:rgba(245,197,66,0.5);' : ''}">`;
        html += `<div style="font-weight:bold;">${def.icon || ''} ${_esc(def.label)}${active ? ` <span style="color:var(--gold);font-size:11px;">· in force since day ${court.edicts[id].since}</span>` : ''}</div>`;
        html += `<div style="${MUTED}">${_esc(def.blurb || '')}</div>`;
        const facts = [];
        if (def.mods) facts.push(_modsText(def.mods));
        if (def.upkeep) facts.push(`upkeep ${def.upkeep}g/day`);
        if (def.factions) facts.push(Object.entries(def.factions).map(([f, v]) => `${f} ${_sign(v)}`).join(', '));
        if (def.likes && def.likes.length) facts.push(`lords who seek ${def.likes.join('/')} approve`);
        if (def.hates && def.hates.length) facts.push(`lords who seek ${def.hates.join('/')} object`);
        html += `<div style="${MUTED}">${_esc(facts.join(' · '))}</div>`;
        if (active) html += _btn('Revoke', `window._court.revoke('${id}')`, true, BTN_RED);
        else {
            html += _btn(`Proclaim (${def.passCost != null ? def.passCost : 150}g)`, `window._court.pass('${id}')`, can.ok);
            if (!can.ok) html += `<span style="${MUTED}"> ${_esc(can.reason)}</span>`;
        }
        html += '</div>';
    }
    return html;
}

function _vassalsTab(player, world) {
    const court = Kingship.court(player);
    const cfg = Kingship.config();
    const G = cfg.grants || {};
    let html = '';
    // Revolt
    const rv = court.revolt;
    if (rv) {
        const R = cfg.revolt || {};
        const d = Kingship.demandText(rv.demand);
        html += `<div style="${CARD}border-color:rgba(231,76,60,0.6);">`;
        html += `<div style="font-weight:bold;color:#e74c3c;">🔥 The revolt of ${_esc(rv.leaderName)} · day ${world.day - rv.startDay}/${R.maxDays}</div>`;
        html += `<div style="${MUTED}">They demand ${_esc(d.label)}. Rebel strength ${Math.round(rv.strength)} · ${rv.seats.length} seat(s) held · ${rv.hosts.length} host(s) marching · battles won ${rv.battlesWon}, lost ${rv.battlesLost}.</div>`;
        html += `<div>Momentum ${Math.round(rv.momentum)} <span style="${MUTED}">(crushed at ${R.crushedAt}, conceded at ${R.lostAt})</span></div>`;
        html += _bar(rv.momentum, R.lostAt, R.crushedAt, rv.momentum >= 0 ? '#8fd88f' : '#e74c3c');
        html += `<div style="${MUTED}">Break their war hosts in the field (+${R.hostDefeated}), or besiege a rebel seat with your army (+${R.seatTaken}, +${R.leaderSeatTaken} for the leader's).</div>`;
        const cost = Kingship.parleyCost(player);
        html += _btn(`🕊️ Parley: grant ${_esc(d.label)} and pay ${cost}g`, 'window._court.parley()', true, BTN_RED);
        html += '</div>';
    }
    // Factions
    const facs = Kingship.factions(player, world, { revealedOnly: true });
    html += '<h5 style="margin:8px 0 4px;color:#e67e22;">⚔️ Factions</h5>';
    if (!facs.length) html += `<div style="${MUTED}">No faction is known to you. A Spymaster uncovers plots before they strike.</div>`;
    for (const f of facs) {
        const fx = f.faction;
        html += `<div style="${CARD}border-color:rgba(230,126,34,0.5);">`;
        html += `<div style="font-weight:bold;">${f.demand.icon} ${_esc(f.leader)}'s faction demands ${_esc(f.demand.label)}</div>`;
        html += `<div style="${MUTED}">Members: ${f.members.map(_esc).join(', ')} · strength ${f.strength} · threat ${Math.round(f.threat * 100)}%${fx.ultimatum ? ` · <span style="color:#e74c3c;">ultimatum due day ${fx.ultimatum.dueDay}</span>` : ''}</div>`;
        html += _btn('🏳️ Concede', `window._court.concede('${fx.id}')`);
        html += _btn('⛓️ Arrest the leader', `window._court.arrest('${fx.id}')`, true, BTN_RED);
        html += '</div>';
    }
    // Vassals
    html += '<h5 style="margin:10px 0 4px;color:var(--gold);">🛡️ Your vassals</h5>';
    html += `<div style="${MUTED}">💰 Gold ${G.gold.treasury}g (treasury) · 🎖️ Title ${G.title.prestige} Prestige · 🌾 Land (the crown's taxes −${Math.round(G.land.taxLoss * 100)}%) · 💍 Marriage ${G.marriage.prestige} Prestige + ${G.marriage.gold}g · 🤝 Favour ${G.favour.gold}g · ⛓️ Break a lord weaker than half the crown's power.</div>`;
    const feast = Kingship.canFeast(player, world);
    html += _btn(`🍖 Royal feast (${G.feast.treasury}g, +${G.feast.favour} favour to all)`, 'window._court.feast()', feast.ok);
    if (!feast.ok) html += `<span style="${MUTED}"> ${_esc(feast.reason)}</span>`;
    for (const s of Kingship.vassalSummary(player, world).sort((a, b) => b.power - a.power)) {
        const v = s.vassal;
        html += `<div style="${CARD}${v.rebel ? 'border-color:rgba(231,76,60,0.6);' : ''}">`;
        html += `<div style="font-weight:bold;">${v.rebel ? '🔥 ' : ''}${_esc(s.name)} <span style="${MUTED}">of ${_esc(s.seatName)} · age ${v.age} · ${_esc(s.traits.join(', '))}</span></div>`;
        html += `<div style="font-size:11px;">Opinion <span style="color:${_opinionColor(s.opinion)};font-weight:bold;">${_sign(s.opinion)}</span> (heading ${_sign(s.forecast.target)}) · power ${s.power} · ambition ${v.ambition} · honor ${v.honor} · seeks ${_esc(s.goals.join(', '))}${v.kin ? ' · 💍 kin' : ''}${s.refusing ? ' · <span style="color:#e74c3c;">refusing the levy</span>' : ''}${s.cowed ? ' · cowed' : ''}${s.faction && s.faction.revealed ? ' · <span style="color:#e67e22;">in a faction</span>' : ''}</div>`;
        html += `<div style="${MUTED}">${s.forecast.parts.map(p => `${_esc(p.label)} ${_sign(p.value)}`).join(' · ')}</div>`;
        if (!v.rebel) {
            html += _btn('💰', `window._court.grant('gold','${v.id}')`, true, BTN_GOLD, 'Grant gold');
            html += _btn('🎖️', `window._court.grant('title','${v.id}')`, true, BTN_GOLD, 'Grant a title');
            html += _btn('🌾', `window._court.grant('land','${v.id}')`, true, BTN_GOLD, 'Grant crown land');
            html += _btn('💍', `window._court.grant('marriage','${v.id}')`, !v.kin, BTN_GOLD, 'Marry a grown child into their house');
            html += _btn('🤝', `window._court.grant('favour','${v.id}')`, true, BTN_GOLD, 'Settle a quarrel in their favour');
            html += _btn('⛓️', `window._court.grant('break','${v.id}')`, true, BTN_RED, 'Break this lord');
        }
        html += '</div>';
    }
    return html;
}

function _realmTab(player, world) {
    const s = Kingship.realmStats(player, world);
    const k = s.kingdom;
    let html = `<div style="${CARD}">`;
    html += `<div style="font-weight:bold;color:var(--gold);">👑 ${_esc(k.ruler)} — ${_esc(k.name)}</div>`;
    html += `<div>Treasury ${s.treasury}g · Army ${s.military} · Stability ${s.stability} · ${s.towns} towns, ${s.population} people</div>`;
    html += `<div>Faith: piety ${s.piety == null ? '—' : s.piety}, unity ${s.unity == null ? '—' : s.unity} · Levy rate ${Math.round(Throne.levyRate(player) * 100)}% · Prestige ${House.getPrestige(player)}</div>`;
    html += `<div>Wars: ${s.wars.length ? s.wars.map(_esc).join(', ') : 'none'} · Allies: ${s.allies.length ? s.allies.map(_esc).join(', ') : 'none'}</div>`;
    html += `<div>Vassals: ${s.vassals} (${s.loyal} loyal, ${s.disloyal} discontented) · Edicts ${s.edicts}/${s.edictSlots}, upkeep ${s.upkeep}g/day</div>`;
    html += '</div>';
    // The crown's trade: duties, export bans, embargoes, treaties, the granaries (ui/actionMenu/tradePolicy.js)
    html += `<div style="${CARD}"><div style="font-weight:bold;">⚖️ Trade policy</div><div style="${MUTED}">Set duties on each kind of goods, ban exports, lay embargoes, sign treaties and fill the royal granaries.</div><button data-am-act="showTradePolicy" data-am-args='["crown"]' style="${BTN_GOLD}">Open the trade policy</button></div>`;
    // The crown's books: taxes, the army's pay, the court, tax farms (ui/actionMenu/treasury.js)
    html += `<div style="${CARD}"><div style="font-weight:bold;">🧾 The treasury</div><div style="${MUTED}">The budget line by line, the taxes, the army's pay and the court, tax farms, offices and crown land for sale.</div><button data-am-act="showTreasury" data-am-args='["crown"]' style="${BTN_GOLD}">Open the treasury</button></div>`;
    html += `<div style="${CARD}"><div style="font-weight:bold;">What the court adds to the realm</div><div style="${MUTED}">${_esc(_modsText(s.mods)) || 'Nothing yet — name a council and proclaim edicts.'}${s.peaceChance ? ` · peace odds +${Math.round(s.peaceChance * 100)}%` : ''}</div></div>`;
    const st = s.stats;
    html += `<div style="${MUTED}">Edicts proclaimed ${st.edictsPassed} · grants ${st.grants} · feasts ${st.feasts} · plots revealed ${st.plotsRevealed} · lords broken ${st.lordsBroken} · revolts ${st.revolts} (crushed ${st.revoltsCrushed}, conceded ${st.revoltsConceded})</div>`;
    const court = Kingship.court(player);
    if (court.log.length) {
        html += '<h5 style="margin:10px 0 4px;">📖 The court\'s chronicle</h5>';
        for (const h of court.log.slice(-8).reverse()) html += `<div style="${MUTED}">Day ${h.day}: ${_esc(h.text)}</div>`;
    }
    return html;
}

Object.assign(ActionMenu, {
    /** The Royal Court: council, edicts, vassals and factions, and the realm. */
    showRoyalCourt(game, tile, tab = 'council') {
        const player = game.player;
        const world = game.world;
        const k = Throne.ruledKingdom(player, world);
        if (!k) {
            game.ui.showNotification('🏛️ Royal Court', 'You rule no realm.', 'error');
            return;
        }
        const court = Kingship.court(player);
        let html = '<div style="font-size:12px;">';
        html += panelTabs(game, {
            id: 'royalCourt', title: `🏛️ The Royal Court of ${k.name}`, tabs: TABS, active: tab,
            go: (id) => { ActionMenu.showRoyalCourt(game, tile, id); },
            attrsFor: (id) => `onclick="window._court.tab('${id}')"`,
        });
        if (!court.initialized) {
            html += `<div style="${MUTED}">The lords of ${_esc(k.name)} will come to swear fealty at the end of the day.</div>`;
        } else if (tab === 'edicts') html += _edictsTab(player, world);
        else if (tab === 'vassals') html += _vassalsTab(player, world);
        else if (tab === 'realm') html += _realmTab(player, world);
        else html += _councilTab(player, world);
        html += '</div>';
        game.ui.showCustomPanel(`🏛️ The Royal Court of ${k.name}`, html);

        const reopen = () => ActionMenu.showRoyalCourt(game, tile, tab);
        const result = (title, res) => ActionMenu._realmResult(game, title, res, reopen);
        window._court = {
            tab: (id) => ActionMenu.showRoyalCourt(game, tile, id),
            appoint: (office, kind, id) => result('🏛️ The Council', Kingship.appoint(player, world, office, kind, id)),
            dismiss: (office) => result('🏛️ The Council', Kingship.dismiss(player, world, office)),
            pass: (id) => result('📜 Edict', Kingship.passEdict(player, world, id)),
            revoke: (id) => result('📜 Edict', Kingship.revokeEdict(player, world, id)),
            feast: () => result('🍖 Royal Feast', Kingship.holdFeast(player, world)),
            concede: (id) => result('🏳️ Faction', Kingship.concede(player, world, id)),
            arrest: (id) => result('⛓️ Faction', Kingship.arrestLeader(player, world, id)),
            parley: () => result('🕊️ Parley', Kingship.parley(player, world)),
            grant: (kind, id) => {
                const fn = {
                    gold: Kingship.grantGold, title: Kingship.grantTitle, land: Kingship.grantLand,
                    marriage: Kingship.arrangeMarriage, favour: Kingship.grantFavour, break: Kingship.breakVassal,
                }[kind];
                if (fn) result('🛡️ Your Vassals', fn(player, world, id));
            },
        };
    },
});
