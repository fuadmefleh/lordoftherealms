// ActionMenu — ✍️ Your Name on the World (Dynasty → Your Name on the World):
// a law code bearing the ruler's name, towns, regions and seas named after
// the House, the House's founding tale and its three uses a reign, and an old
// ruler's last chapter (what they are remembered for, the House's motto).
// Logic lives in systems/namedLegacy.js; this panel presents it.
import { ActionMenu } from './_ref.js';
import { NamedLegacy } from '../../systems/namedLegacy.js';
import { Laws } from '../../systems/laws.js';
import { lede, chips, rowList, card, price, more, bullets, esc, BTN_GOLD } from './uiKit.js';
import { Utils } from '../../core/utils.js';

const MUTED = 'font-size:11px; color:#9d937c;';
const FIELD = 'display:block; width:100%; box-sizing:border-box; padding:7px 9px; margin:6px 0; background:rgba(0,0,0,0.35); border:1px solid rgba(245,197,66,0.18); border-radius:6px; color:#ece2c8; font-family:var(--font-body); font-size:12.5px;';
const PR = (n) => `${n} ⭐`;

function _codeCard(game, v) {
    const { world } = game;
    const C = v.cfg.code;
    const k = v.kingdom;
    if (!k) {
        return card(`<div style="${MUTED}">A code is the work of a crown: only the ruler of a realm may set its jurists to write its laws down in their own name. Codes already written bind whoever wears the crown after.</div>`, { icon: '📕', title: 'A Code of Laws' });
    }
    let body = '';
    const c = v.code;
    if (c && c.stage === 'compiling') {
        const pct = Math.round(100 * (world.day - c.startDay) / Math.max(1, c.readyDay - c.startDay));
        body += chips([['✒️', 'The jurists', `${Math.max(0, Math.min(100, pct))}%`, 'gold'], ['📅', 'Proclaimed', `day ${c.readyDay}`]]);
        body += `<div style="${MUTED}">${esc(c.name)} is being written by ${esc(c.ruler)}'s jurists. When it is done it fixes every law of ${esc(k.name)} as it stands that day.</div>`;
    } else if (c && c.stage === 'proclaimed') {
        const rows = Object.entries(c.laws || {}).map(([id, opt]) => {
            const L = Laws.law(id);
            const o = L && L.options.find(x => x.id === opt);
            const struck = c.struck && c.struck[id] != null;
            return { icon: L ? L.icon : '📜', name: esc(L ? L.name : id), desc: struck ? `Struck from the code on day ${c.struck[id]}` : 'Fixed: to change it costs Prestige, gold and stability', side: esc(o ? o.label : opt), tone: struck ? 'bad' : 'gold' };
        });
        body += `<div style="${MUTED}">Proclaimed on day ${c.day} by ${esc(c.ruler)}${c.house ? ` of ${esc(c.house)}` : ''}. While it stands: stability +${C.stabilityPerMonth} a month up to ${C.stabilityCap}; fewer cases before your courts and some rival suits shut unheard; the other realms slower to band against a crown that rules by written law.</div>`;
        const pre = NamedLegacy.codeText(world, k);
        if (pre) body += `<div style="font-size:11.5px; font-style:italic; color:#cbbf9f; margin:6px 0;">${esc(pre)}</div>`;
        body += rowList(rows);
    }
    const can = v.compile;
    if (!c || c.stage === 'proclaimed') {
        body += rowList([{
            icon: '✒️', name: c ? `Write a new code: ${esc(can.name || '')}` : `Set the jurists to ${esc(can.name || 'a code')}`,
            desc: `${can.days || C.days} days of their work; fixes the laws of ${esc(k.name)} in your name`,
            side: can.gold != null ? `${PR(can.prestige)}<br>${price(can.gold, (k.treasury || 0) >= can.gold)}` : '',
            act: 'namedLegacyAct', args: ['compile'], off: !can.ok, why: esc(can.reason || ''), tone: 'gold',
        }]);
    }
    return card(body, { icon: '📕', title: c ? esc(c.name) : 'A Code of Laws', side: c ? (c.stage === 'compiling' ? 'being written' : 'in force') : '', tone: 'gold' });
}

function _namesCard(game, v, step) {
    const { player, world } = game;
    const N = v.cfg.names;
    let body = '';
    const mine = [
        ...v.renamed.map(x => ({ icon: x.rec.mood === 'resent' ? '😠' : '🏘️', name: esc(x.s.name), desc: `Once ${esc(x.rec.from || x.s.foundingName || '')}; named on day ${x.rec.day}${x.rec.mood === 'resent' ? ' — the folk resent it, and will take their old name back once it is out of your hands' : ' — the folk are proud of it'}`, tone: x.rec.mood === 'resent' ? 'warn' : 'good' })),
        ...v.places.map(p => ({ icon: p.kind === 'sea' ? '🌊' : '⛰️', name: esc(p.name), desc: `${p.kind === 'sea' ? 'The waters' : 'The land'} by ${esc(p.town || '')}, named on day ${p.day}` })),
    ];
    if (mine.length) body += rowList(mine, 'What bears your name');
    if (step && step.town) {
        const tile = world.getTile(step.town[0], step.town[1]);
        const s = tile && tile.settlement;
        if (s) {
            body += `<div style="${MUTED} margin:4px 0;">${esc(s.name)} — ${esc(s.culture || 'its own folk')}. A town of your own culture${player.culture ? ` (${esc(player.culture)})` : ''} takes pride in your name; another resents it.</div>`;
            for (const kind of ['town', 'region', 'sea']) {
                const P = N[kind];
                const opts = NamedLegacy.nameOptions(player, world, kind, s);
                const rows = opts.map(nm => {
                    const can = NamedLegacy.canName(player, world, kind, s.q, s.r, nm);
                    return { icon: kind === 'sea' ? '🌊' : kind === 'region' ? '⛰️' : '🏘️', name: esc(nm), desc: kind === 'town' ? `${esc(s.name)} renamed` : kind === 'region' ? `The country within ${P.radius} hexes of ${esc(s.name)}` : `The water off ${esc(s.name)}, ${P.radius} hexes about`, side: `${PR(P.prestige)}<br>${price(P.gold, (player.gold || 0) >= P.gold)}`, act: 'namedLegacyAct', args: ['name', kind, s.q, s.r, nm], off: !can.ok, why: esc(can.reason || '') };
                });
                body += rowList(rows, kind === 'town' ? 'Rename the town' : kind === 'region' ? 'Name the country about it' : 'Name the sea');
            }
            body += rowList([{ icon: '↩', name: 'Choose another town', act: 'namedLegacyAct', args: ['back'] }]);
        }
    } else if (v.towns.length) {
        body += rowList(v.towns.slice(0, 24).map(s => ({ icon: s.type === 'capital' ? '🏰' : '🏘️', name: esc(s.name), desc: esc(s.culture || ''), side: '›', act: 'namedLegacyAct', args: ['town', s.q, s.r] })), 'Your towns');
    } else {
        body += `<div style="${MUTED}">You may name only what you hold: a holding of yours, or a town of the realm you rule.</div>`;
    }
    return card(body, { icon: '🗺️', title: 'Names on the Map', side: mine.length ? String(mine.length) : '' });
}

function _mythCard(game, v) {
    const { player, world } = game;
    const M = v.cfg.myth;
    let body = '';
    const m = v.myth;
    if (m) {
        body += `<div style="font-size:12px; font-style:italic; color:#e6d6ad; margin:2px 0 6px;">“${esc(NamedLegacy.mythText(world, player.house))}”</div>`;
        body += `<div style="${MUTED}">Townsfolk in your lands tell it. Each reign may call on it once.</div>`;
        if (v.invoked) {
            body += `<div style="${MUTED} margin-top:4px;">This reign called on it on day ${v.invoked.day} (${esc(v.invoked.use)}).</div>`;
        } else {
            const rows = [
                { icon: '📣', name: 'Rally to the tale', desc: `Stability +${M.rally.stability}${v.kingdom ? '' : ` (or renown +${M.rally.renown})`}, officers' and court's loyalty +${M.rally.loyalty}`, act: 'namedLegacyAct', args: ['invoke', 'rally'] },
                { icon: '👑', name: 'Proclaim the line legitimate', desc: `The next succession steadier for ${Math.round(M.legitimacyHoldDays / 120)} years; in a new reign's first ${M.legitimacyDays} days also stability +${M.legitimacy.stability}, loyalty +${M.legitimacy.loyalty}`, act: 'namedLegacyAct', args: ['invoke', 'legitimacy'] },
                ...v.claimTargets.map(k => ({ icon: '📜', name: `Find the tale in the rolls of ${esc(k.name)}`, desc: `Your claim there +${M.claim.amount} (to ${M.claim.cap} at most)`, act: 'namedLegacyAct', args: ['invoke', 'claim', k.id] })),
            ];
            body += rowList(rows.map(r => {
                const can = NamedLegacy.canInvoke(player, world, r.args[1], r.args[2] != null ? r.args[2] : null);
                return can.ok ? r : { ...r, off: true, why: esc(can.reason) };
            }), 'Call on it');
        }
    } else {
        body += `<div style="${MUTED}">A House that tells a tale of itself is a House folk remember. The tales your record bears out:</div>`;
    }
    const cands = v.candidates.filter(c => !m || c.id !== m.id);
    body += rowList(cands.map(c => {
        const can = NamedLegacy.canAdopt(player, world, c.id);
        return { icon: c.icon, name: esc(c.name), desc: esc(c.tale), side: `${PR(can.prestige || (m ? M.replacePrestige : M.prestige))}<br>${price(M.gold, (player.gold || 0) >= M.gold)}`, act: 'namedLegacyAct', args: ['adopt', c.id], off: !can.ok, why: esc(can.reason || '') };
    }), m ? 'Tell another tale instead' : 'Take up a tale');
    return card(body, { icon: (m && m.icon) || '🐺', title: m ? esc(m.name) : 'The Founding Tale', tone: m ? 'gold' : '' });
}

function _finalCard(game, v, step) {
    const { player } = game;
    let body = '';
    const done = v.chapters.slice().reverse();
    if (!v.final.ok) {
        body += `<div style="${MUTED}">${esc(v.final.reason)}</div>`;
    } else if (step && step.choice) {
        const ch = v.choices.find(c => c.id === step.choice);
        if (ch) {
            body += `<div style="font-size:12px; color:#cbbf9f; margin:2px 0 6px;">To be remembered for <b>${esc(ch.line)}</b>. ${ch.fits ? `Your reign earned it: your heir will be raised to it.` : 'Your reign did not quite earn it: the heir inherits only the words.'} What words will the House carry?</div>`;
            body += rowList([
                ...ch.mottos.map(mo => ({ icon: '✒️', name: `“${esc(mo)}”`, act: 'namedLegacyAct', args: ['final', ch.id, mo], tone: 'gold' })),
                player.house && player.house.motto ? { icon: '🛡️', name: `Keep “${esc(player.house.motto)}”`, act: 'namedLegacyAct', args: ['final', ch.id, ''] } : null,
            ]);
            body += `<input id="nl-motto" type="text" maxlength="60" placeholder="Or words of your own…" style="${FIELD}">`;
            body += `<button type="button" onclick="window._nlMotto && window._nlMotto('${esc(ch.id)}')" style="${BTN_GOLD} width:100%;">Set these words</button>`;
            body += rowList([{ icon: '↩', name: 'Choose again', act: 'namedLegacyAct', args: ['back'] }]);
        }
    } else {
        body += `<div style="${MUTED}">An old ruler sets down what the House should remember of them. The epitaph, the Annals, the chronicle book and the Hall of Houses will say it; an heir raised to it takes its trait.</div>`;
        body += rowList(v.choices.map(c => ({ icon: c.icon, name: `Remembered for ${esc(c.label)}`, desc: esc(c.line), side: c.fits ? 'earned' : '', tone: c.fits ? 'good' : '', act: 'namedLegacyAct', args: ['choose', c.id] })));
    }
    if (done.length) body += more(`Last chapters (${done.length})`, bullets(done.map(c => `<b>${esc(c.ruler)}</b>, year ${c.year}: ${esc(c.line)}${c.motto ? ` — “${esc(c.motto)}”` : ''}${c.trait ? ' (the heir raised to it)' : ''}`)));
    return card(body, { icon: '✍️', title: 'The Final Chapter' });
}

Object.assign(ActionMenu, {
    /** The panel. step: { town: [q, r] } naming a place, { choice } writing the last chapter. */
    showNamedLegacy(game, message = null, step = null) {
        const { player, world } = game;
        if (!player || !world) return;
        if (!player.house) { game.ui.showNotification('✍️ Your Name', 'Your House has not yet been founded.', 'info'); return; }
        const v = NamedLegacy.view(player, world);
        let html = '<div style="font-size:12px;">';
        if (message) html += card(message.html, { tone: message.tone || 'gold' });
        html += lede('What outlives you: laws written in your name, your name on the map, the tale your House tells of itself, and the last chapter of your life.');
        html += chips([
            ['⭐', 'Prestige', Math.floor(player.house.prestige || 0), 'gold'],
            ['💰', 'Purse', `${Utils.formatGold(player.gold || 0)}g`],
            v.kingdom ? ['🏛️', 'Treasury', `${Utils.formatGold(v.kingdom.treasury || 0)}g`] : null,
            v.legitimacy.active ? ['👑', 'Succession', `steadied to day ${v.legitimacy.until}`, 'good'] : null,
        ].filter(Boolean));
        html += _codeCard(game, v);
        html += _namesCard(game, v, step);
        html += _mythCard(game, v);
        html += _finalCard(game, v, step);
        html += rowList([{ icon: '←', name: 'Back to Dynasty', act: 'openTileMenu', args: ['showDynastyMenu'] }]);
        html += '</div>';
        game.ui.showCustomPanel('✍️ Your Name on the World', html);
        window._nlMotto = (choiceId) => {
            const el = document.getElementById('nl-motto');
            ActionMenu.namedLegacyAct(game, 'final', choiceId, el ? el.value : '');
        };
    },

    /** The panel's rows (data-am-act="namedLegacyAct"). */
    namedLegacyAct(game, op, a = null, b = null, c = null, d = null) {
        const { player, world } = game;
        if (op === 'town') return ActionMenu.showNamedLegacy(game, null, { town: [a, b] });
        if (op === 'choose') return ActionMenu.showNamedLegacy(game, null, { choice: a });
        if (op === 'back') return ActionMenu.showNamedLegacy(game);
        let res;
        if (op === 'compile') res = NamedLegacy.compile(player, world);
        else if (op === 'name') res = NamedLegacy.name(player, world, a, b, c, d);
        else if (op === 'adopt') res = NamedLegacy.adoptMyth(player, world, a);
        else if (op === 'invoke') res = NamedLegacy.invoke(player, world, a, b);
        else if (op === 'final') {
            if (!String(b || '').trim() && !(player.house && player.house.motto)) {
                game.ui.showNotification('✍️ The Final Chapter', 'Give the House some words to carry.', 'error');
                return;
            }
            res = NamedLegacy.writeFinalChapter(player, world, a, b);
        } else return;
        if (!res || !res.success) {
            game.ui.showNotification('✍️ Your Name on the World', (res && res.reason) || 'That cannot be done.', 'error');
            return;
        }
        game.ui.updateStats(player, world);
        ActionMenu.showNamedLegacy(game, { html: esc(res.text || 'Done.'), tone: 'good' });
    },
});
