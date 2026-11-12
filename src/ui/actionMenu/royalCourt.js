// ActionMenu — the Royal Court: the council, edicts, vassals and their
// factions, and the realm's state, for a player who rules a realm. Logic lives
// in systems/kingship.js; this panel presents it in the action menu's voice
// (ui/actionMenu/uiKit.js): a lede and chips, then a row for each choice.
import { ActionMenu } from './_ref.js';
import { Kingship } from '../../systems/kingship.js';
import { Throne, House } from './_imports.js';
import { panelTabs, lede, chips, sectionHead, kv, card, actRow, rowList, price, BTN_GOLD, BTN_RED, BTN_OFF } from './uiKit.js';
import { Names } from '../../core/names.js';

const MUTED = 'color: #9d937c; font-size: 11px;';
const TABS = [['council', '🏛️ Council'], ['edicts', '📜 Edicts'], ['vassals', '🛡️ Vassals'], ['realm', '👑 Realm']];

const _esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
const _sign = v => `${v > 0 ? '+' : ''}${v}`;
const _why = t => `<span style="color:#c98a6a;">${t}</span>`;
const _muted = t => `<span style="color:#9d937c;">${t}</span>`;

function _btn(label, call, enabled = true, style = BTN_GOLD, title = '') {
    return `<button title="${_esc(title)}" onclick="${enabled ? call : ''}" style="${enabled ? style : BTN_OFF}" ${enabled ? '' : 'disabled'}>${label}</button>`;
}

function _opinionColor(v) {
    if (v >= 20) return '#8fd18a';
    if (v >= 0) return '#ffcf6a';
    if (v >= -40) return '#f0b35a';
    return '#e0846a';
}

function _bar(value, min, max, color) {
    const pct = Math.round(((value - min) / Math.max(1, max - min)) * 100);
    return `<div style="height:5px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;margin:2px 0 6px;">
        <div style="width:${Math.max(0, Math.min(100, pct))}%;height:100%;background:${color};"></div></div>`;
}

function _modsText(mods) {
    return Object.entries(mods || {}).map(([k, v]) => `${k} ${_sign(Math.round(v * 100))}%`).join(' · ');
}

function _councilTab(player, world) {
    const offices = Kingship.offices();
    let html = lede('Each office\'s bonus is its holder\'s competence (1-20) times a loyalty factor. Lords on the council think better of the crown; ambitious lords resent upstarts (family and companions) in the great offices.');
    for (const o of Kingship.OFFICES) {
        const def = offices[o] || {};
        const cur = Kingship.councillor(player, world, o);
        let body = def.blurb ? `<div style="${MUTED}">${_esc(def.blurb)}</div>` : '';
        if (cur) {
            body += rowList([actRow({
                icon: '💺', name: _esc(cur.name),
                desc: `${_esc(cur.desc)} · competence ${cur.competence} · loyalty ${cur.loyalty}`,
                side: _btn('Dismiss', `window._court.dismiss('${o}')`, true, BTN_RED),
            })]);
        }
        const rows = [];
        const cands = Kingship.candidates(player, world, o).filter(c => !(cur && c.kind === cur.kind && c.id === cur.id)).slice(0, 5);
        for (const c of cands) {
            rows.push(actRow({
                icon: '👤', name: _esc(c.name),
                desc: `${_esc(c.desc)} · competence ${c.competence} · loyalty ${c.loyalty}${c.office ? ` · now ${_esc((offices[c.office] || {}).label || c.office)}` : ''}`,
                attrs: `onclick="window._court.appoint('${o}','${c.kind}','${_esc(c.id)}')"`,
                side: 'Appoint', tone: 'gold',
            }));
        }
        body += rowList(rows, 'Candidates');
        html += card(body, {
            icon: def.icon || '', title: _esc(def.label || o),
            side: cur ? _esc(cur.name) : '<span style="color:#e0846a;">Vacant</span>',
        });
    }
    return html;
}

function _edictFacts(def) {
    const facts = [];
    if (def.mods) facts.push(_modsText(def.mods));
    if (def.upkeep) facts.push(`upkeep ${def.upkeep}g/day`);
    if (def.factions) facts.push(Object.entries(def.factions).map(([f, v]) => `${f} ${_sign(v)}`).join(', '));
    if (def.likes && def.likes.length) facts.push(`lords who seek ${def.likes.join('/')} approve`);
    if (def.hates && def.hates.length) facts.push(`lords who seek ${def.hates.join('/')} object`);
    return _esc(facts.join(' · '));
}

function _edictsTab(player, world) {
    const court = Kingship.court(player);
    const stats = Kingship.realmStats(player, world);
    let html = lede('Edicts are realm-wide decrees. Proclaiming one costs the royal treasury; most cost upkeep every day until revoked (they lapse if the treasury cannot pay).');
    html += chips([
        { icon: '📜', label: 'In force', value: `${stats.edicts}/${stats.edictSlots}`, cls: stats.edicts < stats.edictSlots ? 'gold' : 'dim' },
        ['⏳', 'Upkeep', `${stats.upkeep}g/day`],
        { icon: '🏦', label: 'Treasury', value: `${stats.treasury}g`, cls: 'gold' },
    ]);
    const rows = [];
    for (const [id, def] of Object.entries(Kingship.edicts())) {
        const active = !!court.edicts[id];
        const facts = _edictFacts(def);
        const passCost = def.passCost != null ? def.passCost : 150;
        if (def.royalPost) {
            // The Royal Post names its house (systems/couriers.js): proclaim it for one, or hand it on
            const cands = Kingship.royalPostCandidates(player, world);
            const holder = cands.find(c => c.holder);
            let body = `<div style="${MUTED}">${_esc(def.blurb || '')}</div>`;
            if (facts) body += `<div style="${MUTED}">${facts}</div>`;
            if (holder) body += `<div style="margin-top:4px;">Held by <b>${_esc(holder.name)}</b> · ${holder.stations} station${holder.stations === 1 ? '' : 's'} in the realm · ${holder.fee}g a week to the treasury</div>`;
            if (!cands.length) body += `<div style="${MUTED}">No courier house keeps a station in the realm.</div>`;
            body += rowList(cands.filter(x => !x.holder).slice(0, 5).map(c => {
                const chk = active ? { ok: true } : Kingship.canPass(player, world, id, { courierId: c.id });
                return {
                    icon: c.icon, name: `${_esc(c.name)}${c.own ? ' (yours)' : ''}`,
                    desc: `${c.stations} station${c.stations === 1 ? '' : 's'} · rep ${c.reputation} · fee ${c.fee}g/wk`,
                    off: !chk.ok, why: _esc(chk.reason || ''),
                    attrs: `onclick="window._court.royalPost('${_esc(c.id)}')"`,
                    side: active ? 'Transfer' : `Proclaim for them ${price(passCost, true)}`, tone: 'gold',
                };
            }));
            if (active) body += _btn('Revoke', `window._court.revoke('${id}')`, true, BTN_RED);
            html += card(body, {
                icon: def.icon || '', title: _esc(def.label),
                side: active ? `in force since day ${court.edicts[id].since}` : '',
                tone: active ? 'gold' : '',
            });
            continue;
        }
        if (active) {
            rows.push(actRow({
                icon: def.icon || '', name: `${_esc(def.label)} <span style="color:#ffcf6a; font-size:11px; font-weight:400;">· in force since day ${court.edicts[id].since}</span>`,
                desc: _esc(def.blurb || ''), note: facts ? _muted(facts) : '',
                side: _btn('Revoke', `window._court.revoke('${id}')`, true, BTN_RED),
            }));
        } else {
            const can = Kingship.canPass(player, world, id);
            rows.push(actRow({
                icon: def.icon || '', name: _esc(def.label),
                desc: _esc(def.blurb || ''),
                note: [facts ? _muted(facts) : '', can.ok ? '' : _why(_esc(can.reason))].filter(Boolean).join('<br>'),
                off: !can.ok,
                attrs: `onclick="window._court.pass('${id}')"`,
                side: `Proclaim ${price(passCost, can.ok)}`, tone: 'gold',
            }));
        }
    }
    html += rowList(rows, 'Decrees');
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
        let body = `<div style="${MUTED}">They demand ${_esc(d.label)}. Rebel strength ${Math.round(rv.strength)} · ${rv.seats.length} seat(s) held · ${rv.hosts.length} host(s) marching · battles won ${rv.battlesWon}, lost ${rv.battlesLost}.</div>`;
        body += `<div style="margin-top:4px;">Momentum <b style="color:${rv.momentum >= 0 ? '#8fd18a' : '#e0846a'};">${Math.round(rv.momentum)}</b> <span style="${MUTED}">(crushed at ${R.crushedAt}, conceded at ${R.lostAt})</span></div>`;
        body += _bar(rv.momentum, R.lostAt, R.crushedAt, rv.momentum >= 0 ? '#8fd18a' : '#e0846a');
        body += `<div style="${MUTED}">Break their war hosts in the field (+${R.hostDefeated}), or besiege a rebel seat with your army (+${R.seatTaken}, +${R.leaderSeatTaken} for the leader's).</div>`;
        const cost = Kingship.parleyCost(player);
        body += rowList([{
            icon: '🕊️', name: `Parley: grant ${_esc(d.label)} and pay ${cost}g`, desc: 'End the revolt on their terms',
            attrs: 'onclick="window._court.parley()"', side: price(cost, true), tone: 'bad',
        }]);
        html += card(body, { icon: '🔥', title: `The revolt of ${_esc(rv.leaderName)}`, side: `day ${world.day - rv.startDay}/${R.maxDays}`, tone: 'bad' });
    }
    // Factions
    const facs = Kingship.factions(player, world, { revealedOnly: true });
    html += sectionHead('⚔️ Factions');
    if (!facs.length) html += `<div style="${MUTED} margin-bottom:8px;">No faction is known to you. A Spymaster uncovers plots before they strike.</div>`;
    for (const f of facs) {
        const fx = f.faction;
        let body = `<div style="${MUTED}">Members: ${f.members.map(_esc).join(', ')} · strength ${f.strength} · threat ${Math.round(f.threat * 100)}%${fx.ultimatum ? ` · <span style="color:#e0846a;">ultimatum due day ${fx.ultimatum.dueDay}</span>` : ''}</div>`;
        body += rowList([
            { icon: '🏳️', name: 'Concede', desc: `Grant ${_esc(f.demand.label)}`, attrs: `onclick="window._court.concede('${fx.id}')"` },
            { icon: '⛓️', name: 'Arrest the leader', desc: `Seize ${_esc(f.leader)}`, attrs: `onclick="window._court.arrest('${fx.id}')"` },
        ]);
        html += card(body, { icon: f.demand.icon, title: `${_esc(f.leader)}'s faction demands ${_esc(f.demand.label)}`, side: `strength ${f.strength}`, tone: 'warn' });
    }
    // Vassals
    html += sectionHead('🛡️ Your vassals');
    html += `<div style="${MUTED} margin-bottom:6px;">💰 Gold ${G.gold.treasury}g (treasury) · 🎖️ Title ${G.title.prestige} Prestige · 🌾 Land (the crown's taxes −${Math.round(G.land.taxLoss * 100)}%) · 💍 Marriage ${G.marriage.prestige} Prestige + ${G.marriage.gold}g · 🤝 Favour ${G.favour.gold}g · ⛓️ Break a lord weaker than half the crown's power.</div>`;
    const feast = Kingship.canFeast(player, world);
    html += rowList([{
        icon: '🍖', name: 'Royal feast', desc: `+${G.feast.favour} favour to all`,
        off: !feast.ok, why: _esc(feast.reason || ''),
        attrs: 'onclick="window._court.feast()"', side: price(G.feast.treasury, feast.ok),
    }]);
    for (const s of Kingship.vassalSummary(player, world).sort((a, b) => b.power - a.power)) {
        const v = s.vassal;
        let body = `<div style="${MUTED}">of ${_esc(s.seatName)} · age ${v.age} · ${_esc(s.traits.join(', '))}</div>`;
        body += `<div style="font-size:11px; margin-top:2px;">Opinion <span style="color:${_opinionColor(s.opinion)};font-weight:bold;">${_sign(s.opinion)}</span> (heading ${_sign(s.forecast.target)}) · power ${s.power} · ambition ${v.ambition} · honor ${v.honor} · seeks ${_esc(s.goals.join(', '))}${v.kin ? ' · 💍 kin' : ''}${s.refusing ? ' · <span style="color:#e0846a;">refusing the levy</span>' : ''}${s.cowed ? ' · cowed' : ''}${s.faction && s.faction.revealed ? ' · <span style="color:#f0b35a;">in a faction</span>' : ''}</div>`;
        body += `<div style="${MUTED}">${s.forecast.parts.map(p => `${_esc(p.label)} ${_sign(p.value)}`).join(' · ')}</div>`;
        if (!v.rebel) {
            body += '<div style="margin-top:4px;">';
            body += _btn('💰', `window._court.grant('gold','${v.id}')`, true, BTN_GOLD, 'Grant gold');
            body += _btn('🎖️', `window._court.grant('title','${v.id}')`, true, BTN_GOLD, 'Grant a title');
            body += _btn('🌾', `window._court.grant('land','${v.id}')`, true, BTN_GOLD, 'Grant crown land');
            body += _btn('💍', `window._court.grant('marriage','${v.id}')`, !v.kin, BTN_GOLD, 'Marry a grown child into their house');
            body += _btn('🤝', `window._court.grant('favour','${v.id}')`, true, BTN_GOLD, 'Settle a quarrel in their favour');
            body += _btn('⛓️', `window._court.grant('break','${v.id}')`, true, BTN_RED, 'Break this lord');
            body += '</div>';
        }
        const title = `${v.pretender ? '<span title="Of the old royal line: says the throne is theirs" style="color:#f0b35a;">🗡️ Pretender</span> ' : ''}${_esc(s.name)}`;
        html += card(body, {
            icon: v.rebel ? '🔥' : '🛡️', title,
            side: `<span style="color:${_opinionColor(s.opinion)};">${_sign(s.opinion)}</span>`,
            tone: v.rebel ? 'bad' : '',
        });
    }
    return html;
}

function _realmTab(player, world) {
    const s = Kingship.realmStats(player, world);
    const k = s.kingdom;
    let html = lede(`👑 <b>${_esc(k.ruler)}</b> — ${_esc(k.name)}`);
    html += chips([
        { icon: '🏦', label: 'Treasury', value: `${s.treasury}g`, cls: 'gold' },
        ['⚔️', 'Army', s.military],
        ['⚖️', 'Stability', s.stability],
        ['🏘️', 'Towns', s.towns],
        ['👥', 'People', s.population],
    ]);
    let body = kv('Faith', `piety ${s.piety == null ? '—' : s.piety}, unity ${s.unity == null ? '—' : s.unity}`);
    body += kv('Levy rate', `${Math.round(Throne.levyRate(player) * 100)}%`);
    body += kv('Prestige', House.getPrestige(player));
    body += kv('Wars', s.wars.length ? s.wars.map(_esc).join(', ') : 'none');
    body += kv('Allies', s.allies.length ? s.allies.map(_esc).join(', ') : 'none');
    body += kv('Vassals', `${s.vassals} (${s.loyal} loyal, ${s.disloyal} discontented)`);
    body += kv('Edicts', `${s.edicts}/${s.edictSlots}, upkeep ${s.upkeep}g/day`);
    html += card(body);
    html += rowList([
        // The crown's trade: duties, export bans, embargoes, treaties, the granaries (ui/actionMenu/tradePolicy.js)
        { icon: '⚖️', name: 'Trade policy', desc: 'Set duties on each kind of goods, ban exports, lay embargoes, sign treaties and fill the royal granaries.', act: 'showTradePolicy', args: ['crown'], side: 'Open the trade policy', tone: 'gold' },
        // The realm's laws: private prisons, land for foreigners, punishment (ui/actionMenu/laws.js)
        { icon: '📜', name: 'The laws', desc: 'Proclaim the realm\'s laws: whether free folk may keep prison camps, who may hold land in its towns, and how hard the watch punishes.', act: 'showLaws', args: ['crown'], side: 'Open the laws', tone: 'gold' },
        // The crown's books: taxes, the army's pay, the court, tax farms (ui/actionMenu/treasury.js)
        { icon: '🧾', name: 'The treasury', desc: 'The budget line by line, the taxes, the army\'s pay and the court, tax farms, offices and crown land for sale.', act: 'showTreasury', args: ['crown'], side: 'Open the treasury', tone: 'gold' },
    ], 'Governing the realm');
    html += card(`<div style="${MUTED}">${_esc(_modsText(s.mods)) || 'Nothing yet — name a council and proclaim edicts.'}${s.peaceChance ? ` · peace odds +${Math.round(s.peaceChance * 100)}%` : ''}</div>`, { title: 'What the court adds to the realm' });
    const st = s.stats;
    html += chips([
        ['📜', 'Edicts proclaimed', st.edictsPassed], ['🎁', 'Grants', st.grants], ['🍖', 'Feasts', st.feasts],
        ['🕵️', 'Plots revealed', st.plotsRevealed], ['⛓️', 'Lords broken', st.lordsBroken],
        ['🔥', 'Revolts', `${st.revolts} (crushed ${st.revoltsCrushed}, conceded ${st.revoltsConceded})`],
    ]);
    const court = Kingship.court(player);
    if (court.log.length) {
        html += sectionHead('📖 The court\'s chronicle');
        for (const h of court.log.slice(-8).reverse()) html += `<div style="${MUTED} padding:2px 0;">Day ${h.day}: ${_esc(h.text)}</div>`;
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
            id: 'royalCourt', title: `🏛️ The Royal Court of ${Names.realm(k.name)}`, tabs: TABS, active: tab,
            go: (id) => { ActionMenu.showRoyalCourt(game, tile, id); },
            attrsFor: (id) => `onclick="window._court.tab('${id}')"`,
        });
        if (!court.initialized) {
            html += lede(`The lords of ${_esc(Names.realm(k.name))} will come to swear fealty at the end of the day.`);
        } else if (tab === 'edicts') html += _edictsTab(player, world);
        else if (tab === 'vassals') html += _vassalsTab(player, world);
        else if (tab === 'realm') html += _realmTab(player, world);
        else html += _councilTab(player, world);
        html += '</div>';
        game.ui.showCustomPanel(`🏛️ The Royal Court of ${Names.realm(k.name)}`, html);

        const reopen = () => ActionMenu.showRoyalCourt(game, tile, tab);
        const result = (title, res) => ActionMenu._realmResult(game, title, res, reopen);
        window._court = {
            tab: (id) => ActionMenu.showRoyalCourt(game, tile, id),
            appoint: (office, kind, id) => result('🏛️ The Council', Kingship.appoint(player, world, office, kind, id)),
            dismiss: (office) => result('🏛️ The Council', Kingship.dismiss(player, world, office)),
            pass: (id) => result('📜 Edict', Kingship.passEdict(player, world, id)),
            revoke: (id) => result('📜 Edict', Kingship.revokeEdict(player, world, id)),
            royalPost: (courierId) => result('📮 The Royal Post', Kingship.grantRoyalPost(player, world, courierId)),
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
