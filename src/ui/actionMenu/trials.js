// ActionMenu — ⚖️ Courts & Lawsuits (Family → Against you; the cell's "Your Trial"):
// the trial you await (the charges and their witnesses, the judge and the
// court's custom, an advocate, a bribe, a plea), giving yourself up, the
// brands you bear and the ways to a pardon, the
// cases brought before your own court, the wrongs that surfaced, and the
// lawsuits between your House and its rivals. Logic in player/trials.js.
import { ActionMenu } from './_ref.js';
import { Trials } from '../../player/trials.js';
import { lede, chips, rowList, card, price, purse, bullets, more, esc, panelTabs } from './uiKit.js';
import { Utils } from '../../core/utils.js';

let _tab = 'trial';
const TABS = [['trial', '⚖️ Your Case'], ['court', '🏛️ Your Court'], ['suits', '📜 Lawsuits']];

const STATE = { stands: ['will testify', 'bad'], swayed: ['swayed', 'good'], cowed: ['cowed', 'warn'] };

/** A verdict's effects as HTML: gains green (the note's colour), losses red. */
function fxText(fx) {
    const parts = [];
    for (const [k, v] of Object.entries(fx || {})) {
        if (k === 'court' || !v) continue;
        const t = `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10} ${esc(k)}`;
        parts.push(v < 0 ? `<span style="color:#e08a7a;">${t}</span>` : t);
    }
    return parts.join(', ');
}

/** "the court pleader of X" → "The court pleader of X", for a name or line that opens a row. */
function cap(s) {
    const t = String(s || '');
    return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The brands you bear: what they cost you, and the ways to a pardon. */
function brandsBlock(player, v) {
    const rows = [];
    for (const { brand: b, idx, weight, options } of v.brands) {
        const what = b.pardoned
            ? `pardoned (${esc(b.pardoned.how)}, day ${b.pardoned.day}): a scar, and nothing more`
            : `for ${esc(b.crime)} (day ${b.day}). Folk think worse of you at a glance, lords colder, the watch of ${esc(b.realm)} closer${weight < 1 ? '. An old scar now, and it tells less' : ''}`;
        rows.push({ icon: '🔥', name: `Branded in ${esc(b.realm)}`, desc: what, tone: b.pardoned ? 'good' : 'bad' });
        if (b.petition) rows.push({ icon: '📜', name: 'Your petition is before the crown', desc: `Its answer comes by day ${b.petition.until}`, tone: 'warn' });
        if (b.penance) rows.push({ icon: '🕯️', name: `Penance at ${esc(b.penance.town)}`, desc: `Keep clean of the courts until day ${b.penance.until}`, tone: 'warn' });
        for (const o of options) {
            const side = o.prestige ? `⭐${o.prestige}` : o.cost ? price(o.cost, player.gold >= o.cost) : '';
            rows.push({ icon: o.icon, name: esc(o.name), desc: esc(`${o.desc}${o.days ? ` (${o.days} days)` : ''}`), side, act: 'trialsAct', args: ['pardon', idx, o.id], off: !o.ok, why: esc(o.reason || ''), tone: 'gold' });
        }
    }
    return rowList(rows, 'Marked');
}

function trialTab(player, world, v, shown = null) {
    let html = '';
    const t = v.trial;
    if (!t) {
        if (v.last && v.last.text !== shown) html += card(esc(v.last.text), { icon: '⚖️', title: `Your last trial: ${esc(v.last.town)}`, side: esc(v.last.outcome), tone: v.last.outcome === 'acquitted' ? 'good' : 'warn' });
        html += lede('No court awaits you. An arrest, by whatever road, brings a trial: the town\'s case, its witnesses, and a judge who weighs them.');
        const s = v.surrender;
        html += rowList([s.ok
            ? { icon: '🙇', name: `Give yourself up in ${esc(s.town.name)}`, desc: `${s.charges} charge${s.charges === 1 ? '' : 's'} stand against you here. A court looks kindly on one who comes of their own will.`, act: 'trialsAct', args: ['surrender'], tone: 'warn' }
            : { icon: '🙇', name: 'Give yourself up', off: true, why: esc(s.reason || '') }], 'Answer for it');
        if (v.exiles.length) html += rowList(v.exiles.map(e => ({ icon: '🚪', name: `Exiled from ${esc(e.realm)}`, desc: `Until day ${e.until}: the watch there may know you`, tone: 'bad' })), 'Banished');
        if (v.brands.length) html += brandsBlock(player, v);
        return html;
    }
    const tr = t.trial;
    html += lede(`${esc(tr.judge.name)}, ${esc(tr.judge.title)}, hears your case at ${esc(tr.town)} ${t.daysLeft ? `in ${t.daysLeft} day${t.daysLeft === 1 ? '' : 's'}` : 'today'}.${t.present ? '' : ' <b>You are not there:</b> a court that tries you in absence is harder, and its sentence follows you.'}`);
    html += chips([
        purse(player.gold),
        [t.persona.icon || '⚖️', 'Judge', esc(t.persona.name || tr.judge.persona)],
        [t.custom.icon || '⚖️', 'Custom', esc(t.custom.name)],
        ['📕', 'Law', esc(tr.law)],
        [tr.advocate ? '💼' : '🤷', 'Odds', esc(tr.advocate ? `${Math.round(t.odds.p * 100)}% to convict` : t.word), t.odds.p >= 0.5 ? 'bad' : 'good'],
    ]);
    html += `<div class="pk-row-why" style="font-size:11px; margin:2px 0 6px;">${esc(t.custom.desc || '')} <i>"${esc(t.persona.line || '')}"</i></div>`;
    // The charges
    html += rowList(tr.charges.map(c => ({ icon: c.grave ? '☠️' : '📌', name: esc(c.label), desc: esc(c.warrant ? 'the crown\'s warrant' : ['talk only', 'hearsay', 'testimony', 'caught in the act'][c.proof] || ''), side: c.grave ? 'grave' : '', tone: c.grave ? 'bad' : '' })), 'The charges');
    // The witnesses
    if (tr.witnesses.length) {
        const rows = [];
        tr.witnesses.forEach((w, i) => {
            const [label, tone] = STATE[w.state] || ['', ''];
            const traits = [w.honest ? 'an honest sort' : '', w.poor ? 'poor' : '', w.tried && w.state === 'stands' ? 'you tried them once' : ''].filter(Boolean).join(' · ');
            rows.push({ icon: '👁️', name: esc(cap(w.name)), desc: traits, side: label, tone });
            if (!w.tried && w.state === 'stands') {
                rows.push({ icon: '🗣️', name: `Talk ${esc(w.name)} round`, desc: 'Charm and reason: perhaps they did not see so clearly', act: 'trialsAct', args: ['sway', i, 'persuade'] });
                rows.push({ icon: '💰', name: `Pay ${esc(w.name)} to forget`, desc: 'A crime if they report it', side: price(t.witnessCost, player.gold >= t.witnessCost), act: 'trialsAct', args: ['sway', i, 'pay'], off: player.gold < t.witnessCost, why: 'You cannot pay it.', tone: 'warn' });
                rows.push({ icon: '🔪', name: `Threaten ${esc(w.name)}`, desc: 'Always a crime: heat, a grudge, and maybe a new charge', act: 'trialsAct', args: ['sway', i, 'threaten'], tone: 'bad' });
            }
        });
        html += rowList(rows, 'The witnesses');
    }
    // Your defence
    const def = [];
    if (tr.advocate) def.push({ icon: '💼', name: esc(cap(tr.advocate.name)), desc: `pleads for you (skill ${tr.advocate.skill})`, tone: 'good' });
    else for (const a of t.advocates) def.push({ icon: '💼', name: `Hire ${esc(a.name)}`, desc: `${esc(a.title)} · skill ${a.skill}`, side: price(a.fee, player.gold >= a.fee), act: 'trialsAct', args: ['advocate', a.id], off: player.gold < a.fee, why: `${esc(a.name)} asks ${Utils.formatGold(a.fee)} gold.` });
    if (!tr.bribeRefused) {
        for (const b of t.bribes) def.push({ icon: '🤫', name: `Slip the judge ${Utils.formatGold(b.cost)} gold`, desc: `About ${Math.round(t.bribeChance * 100)}% the judge takes it; refused, it is a new charge`, side: price(b.cost, player.gold >= b.cost), act: 'trialsAct', args: ['bribe', b.step], off: player.gold < b.cost, why: 'You cannot pay it.', tone: 'warn' });
    } else def.push({ icon: '🚫', name: 'The judge refused your coin', desc: 'The judge will remember it at the verdict', tone: 'bad' });
    if (tr.bribe > 0) def.push({ icon: '💰', name: 'The judge has your coin', side: `${Utils.formatGold(tr.bribe)}g`, tone: 'gold' });
    def.push(tr.plea === 'guilty'
        ? { icon: '🙏', name: 'You will plead guilty', desc: 'A lighter sentence, but a sure one. Change your plea?', act: 'trialsAct', args: ['plea', 'innocent'] }
        : { icon: '🙏', name: 'Plead guilty', desc: 'The court is kinder to an honest sinner, but you will be convicted', act: 'trialsAct', args: ['plea', 'guilty'] });
    if (t.present) def.push({ icon: '⚖️', name: 'Stand trial now', desc: 'Ask for your case to be heard at once', act: 'trialsAct', args: ['stand'], tone: 'gold' });
    html += rowList(def, 'Your defence');
    return html;
}

function courtTab(player, world, v) {
    let html = '';
    html += lede(v.seats
        ? 'The folk of the places you rule bring their crimes to you. Whatever you decide, someone will remember it: the condemned, their kin, the town.'
        : 'You rule nowhere yet. A lord who holds a town, an office or a realm sits in judgement over its folk.');
    if (v.seats && !v.cases.length) html += card('No case waits on your judgement. When the folk of your seats bring one, it comes here and to your notices; a case left unheard lapses, and the town remembers that too.', { icon: '⚖️', title: 'The court is quiet' });
    for (const { c, effects } of v.cases) {
        const days = Math.max(0, c.expires - (world.day || 0));
        let body = `<div style="margin-bottom:4px;">${esc(c.accused.name)} stands accused of <b>${esc(c.crimeLabel)}</b>, against ${esc(c.victim.name)}. The evidence: ${esc(Trials.proofText(c))}${c.witnesses && c.witnesses.length ? ` (${esc(c.witnesses.join(', '))})` : ''}.</div>`;
        body += rowList(Trials.verdicts().map(vd => ({ icon: vd.icon, name: esc(vd.label), desc: esc(vd.desc || ''), note: fxText(effects[vd.id]), act: 'trialsAct', args: ['rule', c.id, vd.id], tone: vd.harsh >= 3 ? 'bad' : vd.harsh === 0 ? 'good' : '' })));
        html += card(body, { icon: '⚖️', title: esc(c.town), side: `${days} day${days === 1 ? '' : 's'}`, tone: 'warn' });
    }
    if (v.wrongs.length) {
        const cost = Utils.cents((Trials.config().judge || {}).amendsCost || 60);
        html += rowList(v.wrongs.map(j => ({ icon: '🕯️', name: `Make amends for ${esc(j.name)}`, desc: `${esc(j.town)}: condemned for ${esc(j.crime)}, innocent`, side: price(cost, player.gold >= cost), act: 'trialsAct', args: ['amends', j.id], off: player.gold < cost, why: 'You cannot pay it.' })), 'Wrongs that came to light');
    }
    return html;
}

function suitsTab(player, world, v) {
    let html = lede('A House wronged by another may go to law: the realm\'s lord hears it, and damages pass purse to purse. Rival Houses with some honour will sue you, too, rather than send knives.');
    for (const { suit, odds, advocates } of v.suits) {
        const D = Trials.suitDef(suit.kind);
        const mine = suit.plaintiff === 'player';
        let body = `<div style="margin-bottom:4px;">${mine ? `You sue ${esc(suit.rivalName)}` : `${esc(suit.rivalName)} sues you`}: ${esc(D.name.toLowerCase())}${suit.note ? ` (${esc(suit.note)})` : ''}. Before ${esc(suit.judge.name)} at ${esc(suit.town)}.</div>`;
        if (suit.status === 'open') {
            const pMine = mine ? odds.p : 1 - odds.p;
            body += chips([['📅', 'Hearing', `day ${suit.hearing}`], ['⚖️', 'Your chances', suit.advocate ? `${Math.round(pMine * 100)}%` : (pMine >= 0.55 ? 'good' : pMine >= 0.45 ? 'even' : 'poor'), pMine >= 0.55 ? 'good' : pMine >= 0.45 ? 'warn' : 'bad'], suit.amount ? ['💰', 'Claim', `${Utils.formatGold(suit.amount)}g`] : null]);
            const rows = [];
            if (suit.advocate) rows.push({ icon: '💼', name: esc(suit.advocate.name), desc: `argues your side (skill ${suit.advocate.skill})`, tone: 'good' });
            else for (const a of advocates) rows.push({ icon: '💼', name: `Hire ${esc(a.name)}`, desc: `${esc(a.title)} · skill ${a.skill}`, side: price(a.fee, player.gold >= a.fee), act: 'trialsAct', args: ['suitAdvocate', suit.id, a.id], off: player.gold < a.fee, why: 'You cannot pay it.' });
            if (!suit.bribeRefused) {
                const cost = Trials.bribeCost(suit, 1);
                rows.push({ icon: '🤫', name: 'Grease the judge', desc: 'Refused, it counts against you', side: price(cost, player.gold >= cost), act: 'trialsAct', args: ['suitBribe', suit.id, 1], off: player.gold < cost, why: 'You cannot pay it.', tone: 'warn' });
            }
            rows.push(mine
                ? { icon: '✋', name: 'Withdraw the suit', desc: 'The fee is not returned', act: 'trialsAct', args: ['settle', suit.id] }
                : (() => { const cost = Trials.settleCost(suit); return { icon: '🤝', name: 'Settle out of court', desc: 'Pay part of the claim and end it', side: price(cost, player.gold >= cost), act: 'trialsAct', args: ['settle', suit.id], off: player.gold < cost, why: 'You cannot pay it.' }; })());
            body += rowList(rows);
        } else body += `<div style="color:#cfc3a5;">${esc(suit.text || suit.status)}</div>`;
        html += card(body, { icon: D.icon, title: esc(D.name), side: esc(suit.status === 'decided' ? (suit.won ? 'won' : 'lost') : suit.status), tone: suit.status === 'open' ? 'warn' : suit.won ? 'good' : '' });
    }
    const rows = [];
    const sued = new Set(v.suits.filter(x => x.suit.status === 'open').map(x => `${x.suit.rivalId}|${x.suit.kind}`));
    for (const { rival, grounds } of v.rivals) {
        for (const g of grounds) {
            if (sued.has(`${rival.kingdomId}|${g.kind}`)) continue;
            const D = Trials.suitDef(g.kind);
            rows.push({ icon: D.icon, name: `Sue ${esc(rival.name)}: ${esc(D.name.toLowerCase())}`, desc: esc(g.note || D.desc || ''), side: price(v.fee, player.gold >= v.fee), act: 'trialsAct', args: ['file', rival.kingdomId, g.kind], off: player.gold < v.fee, why: 'You cannot pay the filing fee.' });
        }
    }
    html += rows.length ? rowList(rows, 'Bring a suit') : rowList([{ icon: '📜', name: 'Bring a suit', off: true, why: v.rivals.length ? 'You have no grounds against any rival House: a refused debt, a disputed estate, a slander.' : 'Your House has no rivals to take to law.' }]);
    return html;
}

Object.assign(ActionMenu, {
    /** The courts: your case, your court, your lawsuits. message: { html, tone }. */
    showTrialsPanel(game, message = null, tab = null) {
        const { player, world } = game;
        if (!player || !world) return;
        if (tab) _tab = tab;
        const v = Trials.view(player, world);
        let html = '<div style="font-size:12px; max-height:540px; overflow-y:auto;">';
        if (message) html += card(message.html, { tone: message.tone || 'gold' });
        html += panelTabs(game, {
            id: 'trials', title: '⚖️ Courts & Lawsuits', tabs: TABS, active: _tab,
            go: (k) => { _tab = k; ActionMenu.showTrialsPanel(game); },
            attrsFor: (k) => `data-am-act="trialsAct" data-am-args='${esc(JSON.stringify(['tab', k]))}'`,
        });
        if (_tab === 'court') html += courtTab(player, world, v);
        else if (_tab === 'suits') html += suitsTab(player, world, v);
        else html += trialTab(player, world, v, message && message.raw);
        if (v.history.length) html += more('What has passed', bullets(v.history.slice(0, 12).map(h => `${esc(h.text)} <span style="color:#8f8a7e;">(day ${h.day})</span>`)));
        html += '</div>';
        game.ui.showCustomPanel('⚖️ Courts & Lawsuits', html);
    },

    /** The panel's rows (data-am-act="trialsAct"). */
    trialsAct(game, action, a = null, b = null) {
        const { player, world } = game;
        if (!player || !world) return;
        if (action === 'tab') { ActionMenu.showTrialsPanel(game, null, a); return; }
        const st = Trials.state(player);
        const suit = (id) => st.suits.find(s => s.id === id);
        let res;
        switch (action) {
            case 'surrender': res = Trials.surrender(player, world); break;
            case 'advocate': res = Trials.hireAdvocate(player, world, st.trial, a); break;
            case 'bribe': res = Trials.bribe(player, world, st.trial, a); break;
            case 'sway': res = Trials.sway(player, world, a, b); break;
            case 'plea': res = Trials.plead(player, world, a); break;
            case 'stand': {
                const r = Trials.resolveTrial(player, world);
                res = r ? { success: true, text: r.text, tone: r.convicted ? 'bad' : 'good' } : { success: false, reason: 'There is no trial.' };
                break;
            }
            case 'rule': res = Trials.rule(player, world, a, b); break;
            case 'amends': res = Trials.amends(player, world, a); break;
            case 'file': res = Trials.fileSuit(player, world, a, b); break;
            case 'settle': res = Trials.settleSuit(player, world, a); break;
            case 'suitAdvocate': res = Trials.hireAdvocate(player, world, suit(a), b); break;
            case 'suitBribe': res = Trials.bribe(player, world, suit(a), b); break;
            case 'pardon': res = Trials.seekPardon(player, world, a, b); break;
            default: return;
        }
        if (!res || !res.success) {
            game.ui.showNotification('⚖️ Courts', (res && res.reason) || 'That cannot be done.', 'error');
            return;
        }
        game.ui.updateStats(player, world);
        ActionMenu.showTrialsPanel(game, { html: esc(cap(res.text || 'Done.')), raw: res.text, tone: res.tone || (res.refused ? 'bad' : 'good') });
    },
});
