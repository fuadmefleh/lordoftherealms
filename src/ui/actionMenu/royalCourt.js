// ActionMenu — the Royal Court: the council, edicts, vassals and their
// factions, and the realm's state, for a player who rules a realm. Logic lives
// in systems/kingship.js; this panel presents it in the action menu's voice
// (ui/actionMenu/uiKit.js): a lede and chips, then a row for each choice.
import { ActionMenu } from './_ref.js';
import { Kingship } from '../../systems/kingship.js';
import { Throne, House } from './_imports.js';
import { panelTabs, lede, chips, sectionHead, kv, card, more, actRow, rowList, price, BTN_GOLD, BTN_RED, BTN_OFF } from './uiKit.js';
import { Names } from '../../core/names.js';
import { crownRuleHtml, bindCrownRule } from './throne.js';

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
    html += `<div style="${MUTED} margin-bottom:6px;">Open a lord to grant them gold, a title, land, a match or a favour, or to break them.</div>`;
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
        if (!v.rebel) body += rowList([{ icon: '🎁', name: 'Grant or punish', desc: 'Gold, a title, land, a match, a favour, or break them', side: '›', attrs: `onclick="window._court.vassal('${v.id}')"` }]);
        const title = `${v.pretender ? '<span title="Of the old royal line: says the throne is theirs" style="color:#f0b35a;">🗡️ Pretender</span> ' : ''}${_esc(s.name)}`;
        html += card(body, {
            icon: v.rebel ? '🔥' : '🛡️', title,
            side: `<span style="color:${_opinionColor(s.opinion)};">${_sign(s.opinion)}</span>`,
            tone: v.rebel ? 'bad' : '',
        });
    }
    return html;
}

/** One vassal's page: who they are, and a row for each grant (its price on the row) or for breaking them. */
function _vassalPage(player, world, id) {
    const s = Kingship.vassalSummary(player, world).find(x => String(x.vassal.id) === String(id));
    if (!s) return '';
    const v = s.vassal;
    const G = Kingship.config().grants || {};
    const k = Throne.ruledKingdom(player, world);
    const treasury = (k && k.treasury) || 0;
    const prestige = House.getPrestige(player);
    const gold = player.gold || 0;
    let html = lede(`<b>${_esc(s.name)}</b> of ${_esc(s.seatName)}, age ${v.age} · ${_esc(s.traits.join(', '))}. Seeks ${_esc(s.goals.join(', '))}.`);
    html += chips([
        { icon: '💭', label: 'Opinion', value: `<span style="color:${_opinionColor(s.opinion)};">${_sign(s.opinion)}</span> → ${_sign(s.forecast.target)}` },
        ['⚔️', 'Power', s.power], ['🔥', 'Ambition', v.ambition], ['🛡️', 'Honour', v.honor],
        v.kin ? ['💍', 'Kin', ''] : null,
        s.refusing ? { icon: '⚠️', label: 'Refusing the levy', value: '' } : null,
    ]);
    html += `<div style="${MUTED} margin-bottom:4px;">${s.forecast.parts.map(pt => `${_esc(pt.label)} ${_sign(pt.value)}`).join(' · ')}</div>`;
    const row = (icon, name, desc, kind, sideHtml, ok = true, why = '', tone = '') => ({
        icon, name, desc, side: sideHtml, off: !ok, why, tone, attrs: `onclick="window._court.grant('${kind}','${v.id}')"`,
    });
    html += rowList([
        row('💰', 'Grant gold', 'From the treasury', 'gold', price(G.gold && G.gold.treasury, treasury >= ((G.gold && G.gold.treasury) || 0))),
        row('🎖️', 'Grant a title', `Costs ${(G.title && G.title.prestige) || 0} Prestige`, 'title', `⭐${(G.title && G.title.prestige) || 0}`, prestige >= ((G.title && G.title.prestige) || 0), 'Not enough Prestige'),
        row('🌾', 'Grant crown land', `The crown's taxes fall ${Math.round(((G.land && G.land.taxLoss) || 0) * 100)}%`, 'land', ''),
        row('💍', 'Marry a grown child into their house', `${(G.marriage && G.marriage.prestige) || 0} Prestige and a dowry`, 'marriage', price(G.marriage && G.marriage.gold, gold >= ((G.marriage && G.marriage.gold) || 0)), !v.kin, 'Already your kin'),
        row('🤝', 'Settle a quarrel in their favour', 'Paid from your purse', 'favour', price(G.favour && G.favour.gold, gold >= ((G.favour && G.favour.gold) || 0))),
        row('⛓️', 'Break this lord', 'Only a lord weaker than half the crown\'s power; the others will remember', 'break', '', true, '', 'bad'),
        { icon: '←', name: 'Back to the vassals', attrs: `onclick="window._court.tab('vassals')"` },
    ], 'Grants');
    return html;
}

function _realmTab(game) {
    const { player, world } = game;
    const s = Kingship.realmStats(player, world);
    const k = s.kingdom;
    let html = lede(`👑 <b>${_esc(k.ruler)}</b> — ${_esc(k.name)}${s.wars.length ? ` · at war with ${s.wars.map(_esc).join(', ')}` : ''}${s.allies.length ? ` · allied with ${s.allies.map(_esc).join(', ')}` : ''}`);
    html += chips([
        { icon: '🏦', label: 'Treasury', value: `${s.treasury}g`, cls: 'gold' },
        ['⚔️', 'Army', s.military],
        ['⚖️', 'Stability', s.stability],
        ['🏘️', 'Towns', s.towns],
        ['👥', 'People', s.population],
        ['⭐', 'Prestige', House.getPrestige(player)],
        ['🛡️', 'Vassals', `${s.vassals} (${s.disloyal} discontented)`],
        ['📜', 'Edicts', `${s.edicts}/${s.edictSlots} · ${s.upkeep}g/day`],
        ['🙏', 'Faith', `piety ${s.piety == null ? '—' : s.piety}, unity ${s.unity == null ? '—' : s.unity}`],
    ]);
    // The levy, the crown's policies, diplomacy and abdication (ui/actionMenu/throne.js)
    html += crownRuleHtml(game);
    html += rowList([
        // The crown's trade: duties, export bans, embargoes, treaties, the granaries (ui/actionMenu/tradePolicy.js)
        { icon: '⚖️', name: 'Trade policy', desc: 'Duties, export bans, embargoes, treaties, the royal granaries', act: 'showTradePolicy', args: ['crown'], side: '›' },
        // The realm's laws: private prisons, land for foreigners, punishment (ui/actionMenu/laws.js)
        { icon: '📜', name: 'The laws', desc: 'Prison camps, land for foreigners, how hard the watch punishes', act: 'showLaws', args: ['crown'], side: '›' },
        // The crown's books: taxes, the army's pay, the court, tax farms (ui/actionMenu/treasury.js)
        { icon: '🧾', name: 'The treasury', desc: 'The budget line by line, tax farms, offices and crown land for sale', act: 'showTreasury', args: ['crown'], side: '›' },
    ], 'Governing the realm');
    html += `<div style="${MUTED} margin:6px 0;"><b>The court adds:</b> ${_esc(_modsText(s.mods)) || 'nothing yet — name a council and proclaim edicts'}${s.peaceChance ? ` · peace odds +${Math.round(s.peaceChance * 100)}%` : ''}</div>`;
    const st = s.stats;
    const court = Kingship.court(player);
    html += more('The reign in numbers, and the court\'s chronicle', chips([
        ['📜', 'Edicts proclaimed', st.edictsPassed], ['🎁', 'Grants', st.grants], ['🍖', 'Feasts', st.feasts],
        ['🕵️', 'Plots revealed', st.plotsRevealed], ['⛓️', 'Lords broken', st.lordsBroken],
        ['🔥', 'Revolts', `${st.revolts} (crushed ${st.revoltsCrushed}, conceded ${st.revoltsConceded})`],
    ]) + court.log.slice(-8).reverse().map(h => `<div style="${MUTED} padding:2px 0;">Day ${h.day}: ${_esc(h.text)}</div>`).join(''));
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
        else if (tab === 'realm') html += _realmTab(game);
        else html += _councilTab(player, world);
        html += '</div>';
        game.ui.showCustomPanel(`🏛️ The Royal Court of ${Names.realm(k.name)}`, html);

        const reopen = () => ActionMenu.showRoyalCourt(game, tile, tab);
        // The Realm tab's policies and diplomacy (ui/actionMenu/throne.js crownRuleHtml)
        if (tab === 'realm') bindCrownRule(game, reopen);
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
            vassal: (id) => {
                const html = _vassalPage(player, world, id);
                if (html) game.ui.showCustomPanel('🛡️ Your Vassal', `<div style="font-size:12px;">${html}</div>`);
            },
            grant: (kind, id) => {
                const fn = {
                    gold: Kingship.grantGold, title: Kingship.grantTitle, land: Kingship.grantLand,
                    marriage: Kingship.arrangeMarriage, favour: Kingship.grantFavour, break: Kingship.breakVassal,
                }[kind];
                if (fn) ActionMenu._realmResult(game, '🛡️ Your Vassals', fn(player, world, id), () => (_vassalPage(player, world, id) ? window._court.vassal(id) : reopen()));
            },
        };
    },
});
