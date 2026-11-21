// ActionMenu — the Royal Court's "State of the Realm" tab: the four strains
// a great old realm suffers (graft, drifting provinces, soft heirs, entrenched
// guilds and clergy), each with its trend, what feeds it, what it does now and
// what can be done. Logic lives in systems/realmDecline.js.
import { ActionMenu } from './_ref.js';
import { RealmDecline } from '../../systems/realmDecline.js';
import { lede, chips, card, more, rowList, price, bullets } from './uiKit.js';
import { Names } from '../../core/names.js';
import { Utils } from '../../core/utils.js';

const MUTED = 'color: #9d937c; font-size: 11px;';
const _esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
const LEVEL = { quiet: ['quiet', '#8fd18a', 'good'], stirring: ['stirring', '#ffcf6a', 'gold'], biting: ['biting', '#f0b35a', 'warn'], grave: ['grave', '#e0846a', 'bad'] };

function _bar(value, pressure, color) {
    const v = Math.max(0, Math.min(100, Math.round(value)));
    const p = Math.max(0, Math.min(100, Math.round(pressure)));
    return `<div style="position:relative;height:6px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;margin:3px 0 6px;">
        <div style="width:${v}%;height:100%;background:${color};"></div>
        <div title="where it is heading" style="position:absolute;top:0;left:${p}%;width:2px;height:100%;background:#ece2c8;opacity:0.7;"></div></div>`;
}

function _trend(t) {
    if (t >= 1) return `<span style="color:#e0846a;">▲ ${t} this year</span>`;
    if (t <= -1) return `<span style="color:#8fd18a;">▼ ${Math.abs(t)} this year</span>`;
    return '<span style="color:#9d937c;">steady</span>';
}

const FOR = { graft: ['audit', 'purge', 'moveCapital'], drift: ['reorganise', 'moveCapital'], soft: [], entrench: ['purge', 'moveCapital'] };

function _measureRow(m, extra = {}) {
    const ok = m.can && m.can.ok;
    return {
        icon: m.icon, name: _esc(m.label), desc: _esc(m.blurb || ''),
        off: !ok, why: _esc((m.can && m.can.reason) || ''),
        attrs: ok ? `onclick="window._decline.${m.id === 'moveCapital' ? 'capitals' : 'act'}('${m.id}')"` : '',
        side: m.cost ? price(m.cost, ok) : (m.id === 'purge' ? '<small>grudges</small>' : ''), tone: m.id === 'purge' ? 'bad' : 'gold',
        ...extra,
    };
}

/** The State of the Realm tab's HTML. */
export function stateOfRealmHtml(game) {
    const { player, world } = game;
    const r = RealmDecline.report(player, world);
    if (!r) return lede('You rule no realm.');
    const realm = Names.realm(r.kingdom.name);
    let html = lede(`Greatness weighs. The bigger and older ${_esc(realm)} grows, the more it rots from within — unless you fight it. Each strain creeps toward where its causes push it (the pale mark), over years.`);
    html += chips([
        ['⚖️', 'Stability', `${r.stab ? r.stab : 0} from the weight of greatness`],
        ['💰', 'Skimmed', `${Utils.formatGold(r.stats.graftTotal)}g`],
        ['↩️', 'Recovered', `${Utils.formatGold(r.stats.recovered)}g`],
    ]);
    const measures = Object.fromEntries(r.measures.map(m => [m.id, m]));
    for (const s of r.strains) {
        const [lvl, color, tone] = LEVEL[s.level] || LEVEL.quiet;
        let body = `<div style="${MUTED}">${_esc(s.blurb)}</div>`;
        body += _bar(s.value, s.pressure, color);
        body += `<div style="${MUTED}">${Math.round(s.value)} now · heading for ${Math.round(s.pressure)} · ${_trend(s.trend)}</div>`;
        body += bullets(s.effects.map(_esc));
        const feeds = s.parts.map(p => `${_esc(p.label)} <b style="color:${p.value > 0 ? '#e0a06a' : '#8fd18a'};">${p.value > 0 ? '+' : ''}${p.value}</b>`);
        body += more('What feeds it', `<div style="${MUTED} line-height:1.6;">${feeds.join(' · ') || 'nothing yet'}</div>`);
        const rows = (FOR[s.id] || []).map(id => measures[id]).filter(Boolean).map(m => _measureRow(m));
        if (s.id === 'soft') {
            for (const c of r.candidates) {
                const can = RealmDecline.canCommand(player, world, c.id);
                const def = RealmDecline.measureDef('marchCommand');
                rows.push({
                    icon: def.icon || '🛡️', name: `Give ${_esc(c.firstName)} a march command`,
                    desc: `${_esc(def.blurb || '')}${r.marchTown ? ` At ${_esc(r.marchTown.name)}.` : ''}`,
                    off: !can.ok, why: _esc(can.reason || ''), attrs: can.ok ? `onclick="window._decline.march('${_esc(c.id)}')"` : '',
                    side: price(def.cost || 200, can.ok), tone: 'gold',
                });
            }
            for (const m of r.commands) rows.push({ icon: '🏔️', name: `${_esc(m.name)} holds the march at ${_esc(m.town)}`, desc: `home by day ${m.until}`, side: 'away' });
            rows.push({ icon: '🏔️', name: 'Children 10–14: Ward of the March', desc: 'Send a child to a march-warden\'s household in your farthest towns (Dynasty → the child → The Years Away). Any child fostered or sent away on a path comes home untouched by the court.', side: '›', act: 'showDynastyMenu', args: [null] });
        }
        body += rowList(rows, rows.length ? 'What you can do' : '');
        html += card(body, { icon: s.icon, title: _esc(s.label), side: `<span style="color:${color};">${lvl}</span>`, tone });
    }
    if (r.takers.length) {
        html += more('Who has been skimming', rowList(r.takers.map(t => ({
            icon: t.kind === 'clerks' ? '📜' : '💰', name: _esc(t.name), desc: t.office ? _esc(t.office) : (t.kind === 'clerks' ? 'the capital\'s purse' : _esc(t.kind)),
            side: `${Utils.formatGold(t.take)}g`, tone: 'warn',
        }))));
    }
    if (r.neighbours.length) {
        html += more('Other realms under their own weight', rowList(r.neighbours.map(o => ({
            icon: '🏚️', name: _esc(Names.realm(o.name)), desc: `${_esc(o.label)} · stability ${o.stab}${o.reformedDay != null ? ` · reformed on day ${o.reformedDay}` : ''}`,
            side: `${Math.round(o.strain)}`, tone: o.bite >= 0.6 ? 'bad' : 'warn',
        }))));
    }
    if (r.log.length) {
        html += more('The court\'s chroniclers on the realm\'s health', r.log.map(e => `<div style="${MUTED} padding:2px 0;">Day ${e.day}: ${_esc(RealmDecline.logText(world, e))}</div>`).join(''));
    }
    return html;
}

function _capitalsHtml(game) {
    const { player, world } = game;
    const m = RealmDecline.measureDef('moveCapital');
    const can = RealmDecline.can(player, world, 'moveCapital');
    const cost = RealmDecline.cost(player, world, 'moveCapital');
    const list = RealmDecline.capitalCandidates(player, world);
    let html = lede(`${_esc(m.blurb || '')} The nearer the realm's heart (its people's mean distance in leagues), the less the far provinces drift.`);
    html += rowList(list.map(c => ({
        icon: '🏰', name: _esc(c.name), desc: `${c.population} people · ${c.reach} leagues from the realm's people (now ${c.now})`,
        off: !can.ok, why: _esc(can.reason || ''), attrs: can.ok ? `onclick="window._decline.move(${c.q},${c.r})"` : '',
        side: price(cost, can.ok), tone: 'gold',
    })), 'A new seat');
    html += rowList([{ icon: '←', name: 'Back to the State of the Realm', attrs: 'onclick="window._decline.back()"' }]);
    return html;
}

/** Wire the tab's buttons (window._decline). `reopen` redraws the Royal Court on this tab. */
export function bindStateOfRealm(game, reopen) {
    const { player, world } = game;
    const result = (title, res) => ActionMenu._realmResult(game, title, res, reopen);
    window._decline = {
        back: reopen,
        act: (id) => {
            const fn = { audit: RealmDecline.audit, reorganise: RealmDecline.reorganise, purge: RealmDecline.purge }[id];
            if (fn) result(`${RealmDecline.measureDef(id).icon || '⚖️'} ${RealmDecline.measureDef(id).label || 'The Realm'}`, fn(player, world));
        },
        capitals: () => game.ui.showCustomPanel('🏰 Move the Capital', `<div style="font-size:12px;">${_capitalsHtml(game)}</div>`),
        move: (q, r) => result('🏰 A New Capital', RealmDecline.moveCapital(player, world, q, r)),
        march: (id) => result('🛡️ A March Command', RealmDecline.marchCommand(player, world, id)),
    };
}
