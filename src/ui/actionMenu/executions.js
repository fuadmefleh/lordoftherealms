// ActionMenu — the scaffold (systems/executions.js).
//   showExecutions     "The Scaffold": the condemned awaiting your word, those in
//                      your power you could bring to it, martyrs' shrines raised
//                      against you, what the scaffold has seen. Reached from
//                      Intrigue & the Law ('executions').
//   showCondemned      one of the condemned: the place, the manner, proclaim the
//                      day or do it here and now, or a mercy.
//   executionsAct      a row: bring, place, proclaim, now, spare, endow, tear.
//   showScaffoldCrowd  a realm's execution in this town today: join the crowd
//                      ('scaffold_crowd').
//   scaffoldCrowdAct   watch, or cry out for mercy.
//   showScaffoldHere   the scaffold or pillory clicked on the street map
//                      (ui/innerMapScaffold.js): the condemned here, today's
//                      crowd, the deaths and punishments the realm's law allows.
import { ActionMenu } from './_ref.js';
import { Executions } from '../../systems/executions.js';
import { lede, chips, card, rowList, price, esc } from './uiKit.js';

const KIND_WORD = { captive: 'In your cellar', bounty: 'Taken for a bounty', vassal: 'Lords of your court', rival: 'Blood of the rival Houses' };
const BACK = (act, args = null) => `<button data-am-act="${act}"${args ? ` data-am-args='${esc(JSON.stringify(args))}'` : ''} style="width:100%;padding:8px;margin-top:10px;background:#444;border:1px solid #666;border-radius:6px;color:#eee;cursor:pointer;">Back</button>`;

// The place chosen for each of the condemned while the panel is open
const _placeSel = {};

function _guiltWord(e) {
    if (e.source === 'trial') return 'condemned by your court';
    if (e.guilty === true) return 'the guilt is plain';
    if (e.guilty === false) return 'no court has proven anything';
    return 'guilt unknown';
}

function _fearLove(st) {
    const f = Math.round(st.stats.fear || 0);
    const l = Math.round(st.stats.love || 0);
    const word = f > l * 2 + 4 ? 'feared' : l > f ? 'loved for mercy' : f > 0 ? 'stern' : 'unknown';
    return { f, l, word };
}

Object.assign(ActionMenu, {
    /** The Scaffold: the condemned, those in your power, the shrines, the record. */
    showExecutions(game, flash = '') {
        const { player, world } = game;
        const st = Executions.state(player);
        const fl = _fearLove(st);
        const seats = Executions.seats(player, world);
        let html = lede('A death in public is the oldest sermon a ruler gives. The crowd watches you as closely as the condemned: a just death steadies a town, a cruel or a wrong one is remembered for a lifetime.');
        html += chips([
            ['⚖️', 'Your name', fl.word],
            ['💀', 'Put to death', st.stats.executed || 0],
            ['🕊️', 'Spared', st.stats.spared || 0],
            ['🕯️', 'Martyrs', Executions.cults(world).filter(c => c.by.kind === 'player').length],
        ]);
        if (flash) html += card(esc(flash), { icon: '⚖️', title: 'Done' });
        if (!seats.length) html += card('You hold no seat of your own, and so no right of the sword: you can only show mercy. A holding, an office in a realm\'s capital or a crown gives you a scaffold.', { icon: '🛡️', tone: 'warn' });
        const list = Executions.list(player);
        html += rowList(list.map(e => ({
            icon: e.ropeBroke ? '🙏' : e.proclaimed ? '📜' : '⛓️', name: esc(e.name),
            desc: esc(`${e.crimeLabel} · ${_guiltWord(e)}${e.ropeBroke ? ' · the rope broke' : ''}`),
            note: e.proclaimed ? esc(`Proclaimed: day ${e.proclaimed.day}, ${e.proclaimed.place.name}`) : esc(`Waiting since day ${e.day}`),
            side: '›', act: 'showCondemned', args: [e.id], tone: e.guilty === false ? 'warn' : '',
        })), '⚖️ Awaiting your word');
        if (!list.length) html += card('No one awaits your word. Your court condemns (the scaffold verdict), a crushed revolt gives up its leader, and anyone in your power can be brought here.', { icon: '⚖️' });
        const targets = Executions.targets(player, world);
        const groups = {};
        for (const t of targets) (groups[t.kind] || (groups[t.kind] = [])).push(t);
        for (const [kind, ts] of Object.entries(groups)) {
            html += rowList(ts.map(t => ({
                icon: t.icon, name: esc(t.name), desc: esc(t.desc), side: 'To the cells', tone: t.guilty ? '' : 'bad',
                note: t.guilty ? '' : 'Innocent of any crime a court has named', act: 'executionsAct', args: ['bring', t.kind, t.id],
            })), `${KIND_WORD[kind] || kind}`);
        }
        const mine = Executions.cults(world).filter(c => c.by.kind === 'player');
        if (mine.length) {
            const cost = (Executions.config().martyr || {}).endowCost || 120;
            const rows = [];
            for (const c of mine) {
                rows.push({ icon: '🕯️', name: esc(`The shrine of ${c.name}`), desc: esc(`${c.town} · since day ${c.day} · ${c.endowed ? 'endowed: at peace' : c.torn ? 'pulled down: prayed in secret' : `fervour ${Math.round(c.strength)}`}`), side: '' });
                if (!c.endowed) rows.push({ icon: '🙏', name: 'Endow the shrine', desc: esc(`Candles, a stone, a priest: penance before ${c.town}`), side: price(cost, (player.gold || 0) >= cost), act: 'executionsAct', args: ['endow', c.id], tone: 'good' });
                if (!c.torn && !c.endowed) rows.push({ icon: '🔨', name: 'Pull it down', desc: 'Fear, and the cult may only harden', act: 'executionsAct', args: ['tear', c.id], tone: 'bad' });
            }
            html += rowList(rows, '🕯️ Martyrs made by your scaffold');
        }
        if (st.history.length) {
            html += rowList(st.history.slice(0, 10).map(h => ({
                icon: h.outcome === 'executed' ? '💀' : h.outcome === 'spared' ? '🕊️' : h.outcome === 'rescued' ? '🏃' : h.outcome === 'rope' ? '🙏' : '💢',
                name: esc(h.name), desc: esc(`${h.outcome === 'executed' ? ((Executions.config().methods[h.method] || {}).label || h.method) : h.outcome === 'spared' ? ((Executions.config().mercies[h.mercy] || {}).label || 'spared') : h.outcome}${h.place ? ` · ${h.place}` : ''} · day ${h.day}`),
                note: h.words ? esc(`“${h.words}”`) : '', side: h.crowd ? `${h.crowd} watched` : '', tone: h.outcome === 'executed' && h.guilty === false ? 'bad' : '',
            })), '📜 What the scaffold has seen');
        }
        game.ui.showCustomPanel('⚖️ The Scaffold', html);
    },

    /** One of the condemned: where, how, when — or mercy. */
    showCondemned(game, id, flash = '') {
        const { player, world } = game;
        const e = Executions.get(player, id);
        if (!e) { ActionMenu.showExecutions(game, flash); return; }
        const places = Executions.places(player, world, e);
        const sel = places.find(p => p.ok && p.key === _placeSel[e.id]) || places.find(p => p.ok) || null;
        const He = e.gender === 'female' ? 'She' : 'He';
        let html = lede(esc(`${e.name}, ${Executions.rankDef(e.rank).label}, condemned for ${e.crimeLabel}: ${_guiltWord(e)}. ${He} waits in the cells for your word.`));
        if (flash) html += card(esc(flash), { icon: '⚖️', title: 'Done' });
        if (e.ropeBroke) html += card('The rope broke under them. The crowd called it a sign of God. Hang them again and you defy it before every soul who saw; spare them and the town will bless your name.', { icon: '🙏', tone: 'warn' });
        if (e.proclaimed) html += card(esc(`The day is proclaimed: day ${e.proclaimed.day}, in ${e.proclaimed.place.name}. Be there to see it, or your officers will see to it.`), { icon: '📜' });
        html += rowList(places.map(p => ({
            icon: p.here ? '📍' : '🏛️', name: esc(p.name), desc: esc(`${p.crimeTown ? 'Where the crime was' : 'Your seat'}${p.here ? ' · you are here' : ''}`), off: !p.ok, why: esc(p.why || ''),
            side: sel && sel.key === p.key ? 'Chosen' : '', tone: sel && sel.key === p.key ? 'gold' : '', act: 'executionsAct', args: ['place', e.id, p.key],
        })), '🏛️ Where');
        if (sel) {
            const methods = Executions.methods(player, world, e, sel);
            const rows = [];
            for (const m of methods) {
                const pv = m.ok ? Executions.preview(player, world, e.id, m.id, sel.key, true) : null;
                const desc = pv ? `${m.desc} Proclaimed: about ${pv.size} come, ${pv.mood.icon} ${pv.mood.label}${pv.risks.length ? `; risk: ${pv.risks.join(', ')}` : ''}.` : m.desc;
                rows.push({ icon: m.icon, name: esc(`${m.label}: proclaim the day`), desc: esc(desc), off: !m.ok, why: esc(m.why), tone: m.cruel ? 'bad' : '', act: 'executionsAct', args: ['proclaim', e.id, m.id], side: '📜' });
                if (m.ok && sel.here) {
                    const now = Executions.preview(player, world, e.id, m.id, sel.key, false);
                    rows.push({ icon: m.icon, name: esc(`${m.label}: here and now`), desc: esc(`Before whoever is about: some ${now.size}, ${now.mood.label}.`), tone: m.cruel ? 'bad' : '', act: 'executionsAct', args: ['now', e.id, m.id], side: '⚡' });
                }
            }
            html += rowList(rows, '💀 The manner of it');
        }
        html += rowList(Executions.mercies(player, world, e).map(m => ({
            icon: m.icon, name: esc(m.label), desc: esc(m.desc), off: !m.ok, why: esc(m.why), tone: 'good', act: 'executionsAct', args: ['spare', e.id, m.id],
        })), '🕊️ Or mercy');
        html += BACK('showExecutions');
        game.ui.showCustomPanel(`⚖️ ${esc(e.name)}`, html);
    },

    /** A row of the Scaffold. */
    executionsAct(game, what, a, b) {
        const { player, world } = game;
        let r = null;
        if (what === 'place') { _placeSel[a] = b; ActionMenu.showCondemned(game, a); return; }
        if (what === 'bring') r = Executions.bring(player, world, a, b);
        else if (what === 'proclaim') r = Executions.proclaim(player, world, a, b, _placeSel[a]);
        else if (what === 'now') r = Executions.carryOut(player, world, a, b, _placeSel[a], { proclaimed: false });
        else if (what === 'spare') r = Executions.spare(player, world, a, b, _placeSel[a]);
        else if (what === 'endow') r = Executions.endowShrine(player, world, a);
        else if (what === 'tear') r = Executions.tearDownShrine(player, world, a);
        if (!r || !r.success) { game.ui.showNotification('⚖️ The Scaffold', (r && r.reason) || 'It cannot be done.', 'error'); return; }
        game.ui.updateStats(player, world);
        if (what === 'proclaim') ActionMenu.showCondemned(game, a, r.text);
        else ActionMenu.showExecutions(game, r.text);
    },

    /** A realm's execution in this town today: the crowd you can join. */
    showScaffoldCrowd(game, flash = '') {
        const { player, world } = game;
        const list = Executions.crowdsAt(world, player.q, player.r);
        let html = lede('The square is packed from the church steps to the well. Children sit on their fathers\' shoulders; the pie-sellers are doing well.');
        if (flash) html += card(esc(flash), { icon: '💀', title: 'The scaffold' });
        for (const e of list) {
            const m = Executions.config().methods[e.method] || {};
            html += rowList([
                { icon: m.icon || '💀', name: esc(`Watch ${e.name} die`), desc: esc(`${(m.label || 'The rope')} for ${e.crimeLabel}`), act: 'scaffoldCrowdAct', args: [e.id, 'watch'] },
                { icon: '🕊️', name: 'Cry out for mercy', desc: 'The crowd may take it up. The crown will not thank you.', act: 'scaffoldCrowdAct', args: [e.id, 'mercy'], tone: 'good' },
            ], `💀 ${esc(e.name)}`);
        }
        if (!list.length && !flash) html += card('No one dies here today.', { icon: '🕊️' });
        game.ui.showCustomPanel('💀 The Crowd at the Scaffold', html);
    },

    scaffoldCrowdAct(game, pubId, how, from = null) {
        const r = Executions.attend(game.player, game.world, pubId, how);
        if (!r.success) { game.ui.showNotification('💀 The Scaffold', r.reason || 'Not today.', 'error'); return; }
        game.ui.updateStats(game.player, game.world);
        if (from === 'here') ActionMenu.showScaffoldHere(game, r.text);
        else ActionMenu.showScaffoldCrowd(game, r.text);
    },

    /**
     * The scaffold (or the pillory) in this town's square, from the street map
     * (ui/innerMapScaffold.js): who is condemned here and when, today's crowd,
     * the deaths this realm's law and faith allow, its punishments, how the
     * town's thieves are cowed, a martyr's shrine, who sits in the stocks.
     */
    showScaffoldHere(game, flash = '') {
        const { player, world } = game;
        const q = player.q, r = player.r;
        const at = Executions.atTown(player, world, q, r);
        const day = Number.isFinite(world && world.day) ? world.day : 0;
        let html = lede(esc(`The square of ${at.town || 'the town'}${at.realm ? `, under the law of ${at.realm}` : ''}. Folk give the timbers a wide berth and their children a hard look.`));
        if (flash) html += card(esc(flash), { icon: '💀', title: 'The scaffold' });
        const rows = [];
        for (const c of at.condemned) {
            const when = c.today ? 'today' : `day ${c.day} (in ${c.day - day} day${c.day - day === 1 ? '' : 's'})`;
            const by = c.kind === 'yours' ? 'by your sentence' : `by the law of ${at.realm || 'the realm'}`;
            rows.push({ icon: c.icon, name: esc(c.name), desc: esc(`${c.methodLabel} for ${c.crimeLabel}, ${by}: ${when}`), tone: c.kind === 'yours' && c.guilty === false ? 'warn' : '',
                side: c.kind === 'yours' ? '›' : '', act: c.kind === 'yours' ? 'showCondemned' : null, args: c.kind === 'yours' ? [c.id] : null });
            if (c.kind === 'realm' && c.today) {
                rows.push({ icon: '👁️', name: `Watch ${esc(c.name)} die`, desc: 'Stand in the crowd to the end', act: 'scaffoldCrowdAct', args: [c.id, 'watch', 'here'] });
                rows.push({ icon: '🕊️', name: 'Cry out for mercy', desc: 'The crowd may take it up. The crown will not thank you.', act: 'scaffoldCrowdAct', args: [c.id, 'mercy', 'here'], tone: 'good' });
            }
        }
        html += rows.length ? rowList(rows, '⛓️ The condemned') : card('No one is condemned to die here now.', { icon: '🕊️' });
        // Who sits in the stocks here (your tenants in arrears: systems/peopleCrimes.js)
        const stocks = ((player.peopleCrimes && player.peopleCrimes.stocks) || []).filter(x => x.q === q && x.r === r);
        if (stocks.length) {
            html += rowList(stocks.map(x => ({ icon: '🔒', name: esc(x.name), desc: esc(`In the stocks for the rent owed you, until day ${x.until}${x.winter ? '; in this cold it can kill' : ''}`), tone: x.winter ? 'bad' : '' })), '🔒 In the stocks');
        }
        html += rowList(at.methods.map(m => ({ icon: m.icon, name: esc(m.label), desc: esc(m.ok ? (m.why ? `Allowed, ${m.why}` : 'Allowed') : `Not here: ${m.why}`), tone: m.ok ? '' : 'bad', off: !m.ok, why: esc(m.why) })), `⚖️ The deaths the law allows${at.realm ? ` in ${esc(at.realm)}` : ''}`);
        const law = [];
        if (at.punishment) law.push({ icon: '⚖️', name: `Punishment: ${esc(at.punishment.label)}`, desc: esc(at.punishment.desc || '') });
        if (at.mutilation) law.push({ icon: '✋', name: `Mutilation: ${esc(at.mutilation.label)}`, desc: esc(at.mutilation.desc || '') });
        if (at.fear < 1) law.push({ icon: '🫣', name: 'The thieves are cowed', desc: `A death here not long ago: the town's thieves try their luck ${Math.round((1 - at.fear) * 100)}% less often` });
        if (at.cult) law.push({ icon: '🕯️', name: esc(`The shrine of ${at.cult.name}`), desc: esc(`A martyr of the scaffold, prayed to in ${at.cult.town || 'town'}: the next crowd here will be sullen`) });
        if (law.length) html += rowList(law, '📜 The law here');
        if (Executions.canJudge(player, world)) html += rowList([{ icon: '⚖️', name: 'Your Scaffold', desc: 'The condemned awaiting your word, and those in your power', act: 'showExecutions', side: '›', tone: 'gold' }]);
        game.ui.showCustomPanel(`💀 The Scaffold of ${esc(at.town || 'the Town')}`, html);
    },
});
