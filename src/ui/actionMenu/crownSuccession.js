// ActionMenu — the Royal Court's Succession tab: who would take the crown if
// you died today, how strongly they stand, who would claim it against them and
// which lords would follow — every factor with its weight — and what you can do
// about it in life. A war for the crown underway shows here too. Logic lives in
// systems/crownSuccession.js; the war itself is a Kingship revolt (the Vassals tab).
import { ActionMenu } from './_ref.js';
import { CrownSuccession } from '../../systems/crownSuccession.js';
import { Kingship } from '../../systems/kingship.js';
import { lede, chips, sectionHead, card, more, rowList, price } from './uiKit.js';
import { Names } from '../../core/names.js';
import { Utils } from '../../core/utils.js';

const MUTED = 'color: #9d937c; font-size: 11px;';
const _esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
const _sign = v => `${v > 0 ? '+' : ''}${v}`;
const _pct = p => `${Math.round(p * 100)}%`;

function _parts(parts) {
    if (!parts || !parts.length) return `<div style="${MUTED}">Nothing weighs either way.</div>`;
    return parts.map(p => `<div class="pk-kv"><span>${_esc(p.label)}</span><span style="color:${p.value >= 0 ? '#8fd18a' : '#e0846a'};">${_sign(p.value)}</span></div>`).join('');
}

function _riskTone(p) {
    return p >= 0.5 ? 'bad' : p >= 0.2 ? 'warn' : 'good';
}

function _warCard(player, world) {
    const rv = Kingship.revolt(player);
    if (!rv || !rv.succession) return '';
    const s = rv.succession;
    const cl = s.claimant;
    let body = `<div style="${MUTED}">${_esc(cl.name)}, ${_esc(cl.label)}, claims the crown against ${_esc(s.heir)}. ${s.foreign ? `${_esc(Names.realm(s.foreign.name))} sent ${s.foreign.men} men.` : ''}</div>`;
    body += chips([
        ['⚔️', 'Momentum', `${_sign(Math.round(rv.momentum))} (crushed at +100, the realm splits at −100)`],
        ['🔥', 'Rebel host', Math.round(rv.strength)], ['🏰', 'Rebel seats', rv.seats.length],
        ['🛡️', 'Battles', `${rv.battlesWon} won · ${rv.battlesLost} lost`],
    ]);
    body += sectionHead('His lords');
    body += s.backers.map(b => `<div class="pk-kv"><span>${_esc(b.name)}</span><span>power ${b.power}</span></div>`).join('');
    body += `<div style="${MUTED} margin-top:6px;">Break his hosts in the field and take his seats (Vassals tab). If his hosts take the capital, the crown is his. Lose, and his seats leave the realm as a kingdom of his own.</div>`;
    body += rowList([
        { icon: '🛡️', name: 'The rebels and their seats', desc: 'The Vassals tab', attrs: 'onclick="window._court.tab(\'vassals\')"', side: '›' },
        { icon: '🕊️', name: 'Buy him off', desc: 'He renounces the claim for gold from the royal treasury', attrs: 'onclick="window._court.parley()"', side: price(Kingship.parleyCost(player)) },
    ]);
    return card(body, { icon: '⚔️', title: 'The War for the Crown', side: `day ${Math.max(0, (world.day || 0) - s.startDay)}`, tone: 'bad' });
}

function _claimantCard(player, world, f, c) {
    let body = `<div style="${MUTED}">${_esc(c.label)}${c.age ? ` · age ${c.age}` : ''} · rises with a chance of <b>${_pct(c.chance)}</b></div>`;
    body += more(`Strength ${c.strength}: what it is made of`, _parts(c.parts));
    const sd = c.sides;
    if (sd) {
        const share = sd.lordPower > 0 ? sd.claimantPower / sd.lordPower : 0;
        const enough = share >= CrownSuccession.config().minLordShare;
        body += `<div style="${MUTED} margin-top:4px;">Lords who would follow: ${sd.backers.length ? sd.backers.map(b => `${_esc(b.name)} (${b.power})`).join(', ') : 'none'} — support ${sd.claimantPower} against the crown's ${sd.crownPower}.${enough ? '' : ' Too few to make war: he would stand down.'}</div>`;
        if (sd.backers.length) {
            body += more('Why they would follow', sd.backers.map(b => `<div style="margin:4px 0;"><b>${_esc(b.name)}</b> (lean ${_sign(b.lean)})</div>${_parts(b.parts)}`).join(''));
        }
    }
    const rows = [];
    const C = CrownSuccession.config().prep;
    if (c.kind === 'brother') {
        rows.push({ icon: '💰', name: 'Give a portion', desc: `${Utils.formatGold(C.portion.step)}g from your purse into theirs: a provided-for child presses no claim`, attrs: `onclick="window._crownSucc.portion('${c.ref}')"`, side: price(C.portion.step) });
        rows.push({ icon: '⛪', name: 'Send to the church', desc: 'Holy orders: the claim is given up for good (alms to the capital)', attrs: `onclick="window._crownSucc.church('${c.ref}')"`, side: price(C.orders.gold) });
        rows.push({ icon: '💍', name: 'Marry abroad', desc: "Wed into another realm: their claim goes with them (on the child's page)", act: 'showChildPanel', args: [c.ref], side: '›' });
        rows.push({ icon: '🌿', name: 'Land them', desc: 'Found a cadet branch: a loyal branch claims nothing (Dynasty → House)', act: 'showCadetBranches', side: '›' });
    } else if (c.kind === 'pretender') {
        rows.push({ icon: '🏚️', name: 'Pension the old line', desc: `Gold to its household in the capital: quiet for ${C.pension.years} years`, attrs: 'onclick="window._crownSucc.pension()"', side: price(C.pension.gold) });
        rows.push({ icon: '⛪', name: 'Shut him in a cloister', desc: `${C.cloister.prestige} Prestige and ${C.cloister.stability} stability: the line is broken for ${C.cloister.years} years`, attrs: 'onclick="window._crownSucc.cloister()"', side: `${C.cloister.prestige} ⭐` });
    } else if (c.kind === 'cadet') {
        rows.push({ icon: '🌿', name: 'Win the branch back', desc: 'Gifts and summons raise its loyalty (Dynasty → House → Cadet branches)', act: 'showCadetBranches', side: '›' });
    }
    if (rows.length) body += rowList(rows);
    return card(body, { icon: c.icon, title: _esc(c.name), side: `strength ${c.strength}`, tone: _riskTone(c.chance) });
}

/** The Succession tab of the Royal Court. */
export function successionTabHtml(game) {
    const player = game.player;
    const world = game.world;
    const f = CrownSuccession.forecast(player, world);
    if (!f) return lede('You rule no realm.');
    let html = '';
    html += _warCard(player, world);
    if (!f.heir) {
        html += lede(`You have no child to take the crown of ${_esc(Names.realm(f.kingdom.name))}. Die now and it goes back to the old line, or to a branch of your House.`);
        return html + _historyHtml(player, world);
    }
    html += lede(`If you died today, <b>${_esc(f.heir.firstName)}</b> would take the crown. Each claimant weighs his strength against the heir's standing; one who rises needs lords behind him, and makes war for the crown. Lose that war and his lords' towns leave the realm with him.`);
    html += chips([
        ['👑', 'Heir', `${_esc(f.heir.firstName)}, ${f.heir.age}${f.heir.id === player.heir ? ' · named' : ' · not named'}`],
        { icon: '⚖️', label: 'Standing', value: f.standing.value, cls: 'gold' },
        { icon: '⚔️', label: 'Chance of a contest', value: _pct(f.risk), cls: f.risk >= 0.3 ? 'bad' : '' },
        ['🤝', 'Sworn to the heir', `${f.sworn} of ${f.lords} lords`],
    ]);
    html += card(_parts(f.standing.parts), { icon: '⚖️', title: `${_esc(f.heir.firstName)}'s standing`, side: f.standing.value });
    html += sectionHead(f.claimants.length ? 'Who would claim the crown' : 'No one would claim the crown today');
    for (const c of f.claimants) html += _claimantCard(player, world, f, c);

    // Preparing the succession in life
    const C = CrownSuccession.config().prep;
    const prep = f.prep || {};
    const named = f.heir.id === player.heir;
    const crowned = !!(prep.crowned && prep.crowned.heirId === f.heir.id);
    const oathWait = prep.oathsDay != null ? Math.max(0, C.oaths.cooldownDays - ((world.day || 0) - prep.oathsDay)) : 0;
    const rows = [];
    rows.push(named
        ? { icon: '📜', name: `${_esc(f.heir.firstName)} is your named heir`, desc: `+${CrownSuccession.config().standing.designated} standing`, tone: 'good', side: '✓' }
        : { icon: '📜', name: 'Name your heir', desc: `+${CrownSuccession.config().standing.designated} standing; needed to crown them or take oaths (Dynasty → House)`, act: 'showDynastyMenu', args: [null], side: '›' });
    rows.push(crowned
        ? { icon: '👑', name: `${_esc(f.heir.firstName)} is crowned beside you`, desc: `+${CrownSuccession.config().standing.crowned} standing`, tone: 'good', side: '✓' }
        : { icon: '👑', name: 'Crown your heir in your lifetime', desc: `+${CrownSuccession.config().standing.crowned} standing. ${C.coronation.prestige} Prestige and a coronation feast paid to the capital (heir ${C.coronation.minAge}+)`, attrs: 'onclick="window._crownSucc.crown()"', side: price(C.coronation.gold), off: !named, why: 'Name your heir first' });
    rows.push({ icon: '🤝', name: 'Take the lords\' oaths to your heir', desc: `Lords of opinion ${C.oaths.minOpinion}+ swear (up to +${CrownSuccession.config().standing.oathMax} standing, and an honourable lord keeps his oath). ${C.oaths.prestige} Prestige`, attrs: 'onclick="window._crownSucc.oaths()"', side: price(C.oaths.gold), off: !named || oathWait > 0, why: !named ? 'Name your heir first' : `The lords swore lately: again in ${oathWait} days` });
    html += rowList(rows, 'Prepare the succession');
    html += `<div style="${MUTED} margin:4px 2px;">The oaths and the crowning are spent at the succession: the next heir needs their own. A long reign, a steady realm, contented lords and the House's Prestige all weigh for the heir; a child heir, a disputed succession and an empty throne weigh against.</div>`;
    return html + _historyHtml(player, world);
}

function _historyHtml(player, world) {
    const st = CrownSuccession.state(player);
    const rows = st.history.slice(-8).reverse().map(h => `<div style="${MUTED} padding:2px 0;">Day ${h.day}: ${_esc(CrownSuccession.recordText(world, h))}</div>`).join('');
    const splits = st.splits.map(s => `<div style="${MUTED} padding:2px 0;">🥀 ${_esc(s.name)} — carved from ${_esc(s.fromName)} by ${_esc(s.claimant)} on day ${s.day}${s.reunited != null ? `, whole again on day ${s.reunited}` : ''}.</div>`).join('');
    return more('Successions past, and the realms carved away', rows + splits);
}

/** Bind the tab's buttons (window._crownSucc). */
export function bindSuccession(game, reopen) {
    const player = game.player;
    const world = game.world;
    const result = (title, res) => ActionMenu._realmResult(game, title, res, reopen);
    window._crownSucc = {
        crown: () => result('👑 Coronation', CrownSuccession.crownHeir(player, world)),
        oaths: () => result('🤝 Oaths', CrownSuccession.takeOaths(player, world)),
        portion: (id) => result('💰 A Portion', CrownSuccession.givePortion(player, world, id)),
        church: (id) => result('⛪ Holy Orders', CrownSuccession.sendToChurch(player, world, id)),
        pension: () => result('🏚️ The Old Line', CrownSuccession.pensionOldLine(player, world)),
        cloister: () => result('⛪ The Old Line', CrownSuccession.cloisterOldLine(player, world)),
    };
}
