// ActionMenu — Languages: the tongues you speak, the one spoken here, lessons
// with a tutor and an interpreter for hire (systems/languages.js, world/
// cultures.js). Buttons route through data-am-act → ActionMenu.languagesAct.
import { ActionMenu } from './_ref.js';
import { Languages } from '../../systems/languages.js';
import { Cultures } from '../../world/cultures.js';
import { BTN_GOLD, BTN_PLAIN, BTN_DIM, CARD } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function act(label, args, style = BTN_GOLD, enabled = true, title = '') {
    if (!enabled) return `<button disabled style="${BTN_DIM}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
    return `<button data-am-act="languagesAct" data-am-args='${esc(JSON.stringify(args))}' style="${style}"${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
}

const LEVEL_COLOR = { none: '#e74c3c', broken: '#e8a040', conversational: '#9acd32', fluent: '#5fbf6a' };

function bar(v, levelId) {
    const w = Math.max(0, Math.min(100, Math.round(v)));
    return `<span style="display:inline-block; width:90px; height:7px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden; vertical-align:middle;"><span style="display:block; width:${w}%; height:100%; background:${LEVEL_COLOR[levelId] || '#888'};"></span></span>`;
}

Object.assign(ActionMenu, {
    /** The Languages panel */
    showLanguages(game) {
        const { player, world } = game;
        Languages.ensure(player, world);
        const tile = world.getTile(player.q, player.r);
        const s = tile && tile.settlement;
        const here = Languages.here(player, world);
        let html = '<div style="font-size:12px; max-height:620px; overflow-y:auto;">';

        // Where you stand
        if (here.lang) {
            const name = Cultures.languageName(here.lang);
            const fam = Cultures.data().families && Cultures.data().families[Cultures.family(here.lang)];
            html += `<div style="${CARD}"><b>Spoken here:</b> ${esc(name)}${fam ? ` <span style="${NOTE}">(${esc(fam.name)} tongues)</span>` : ''}<br>`;
            html += `You: ${bar(here.value, here.level.id)} <b>${esc(here.level.name)}</b>${here.via === 'translator' ? ' — through your interpreter' : here.via === 'kin' ? ' — through a kindred tongue' : ''}`;
            const fx = (Cultures.data().effects || {}).trade || {};
            const t = fx[here.level.id];
            if (t) html += `<div style="${NOTE}">${t < 0 ? `Haggling in a tongue you lack: prices ${Math.round(-t * 100)}% against you.` : `Speaking it well: a fair deal (+${Math.round(t * 100)}%).`}</div>`;
            if (here.level.id === 'none' || here.level.id === 'broken') html += `<div style="${NOTE}">Talk is ${here.level.id === 'none' ? 'by gesture only' : 'simple questions only'}, and a lord's court will not hear you without ${Cultures.level((Cultures.data().effects || {}).audience || 50).name.toLowerCase()} speech or an interpreter.</div>`;
            html += '</div>';
        } else {
            html += `<div style="${CARD}"><span style="${NOTE}">No one lives here to speak to.</span></div>`;
        }

        // Your tongues
        html += '<div style="margin-top:6px;"><b>Your tongues</b></div>';
        const known = Languages.known(player);
        if (!known.length) html += `<div style="${NOTE}">None yet.</div>`;
        for (const k of known) {
            html += `<div style="margin:3px 0;">${bar(k.fluency, k.level.id)} <b>${esc(k.name)}</b> — ${esc(k.level.name)} (${k.fluency}/100)${k.native ? ` <span style="${NOTE}">· mother tongue</span>` : ''}</div>`;
        }
        html += `<div style="${NOTE}; margin-top:4px;">You learn a tongue by living among its speakers and talking with them; a tutor's lessons go faster. Kindred tongues are partly understood.</div>`;

        // Lessons
        if (s) {
            const T = (Cultures.data().learning || {}).tutor || {};
            const teach = Languages.teachable(world, s);
            html += `<div style="${CARD}"><b>Tutors in ${esc(s.name)}</b> <span style="${NOTE}">(${T.cost || 18} gold a lesson, one a day)</span><br>`;
            for (const l of teach) {
                const f = Math.round(Languages.fluency(player, l));
                html += act(`📖 ${esc(Cultures.languageName(l))} (${f})`, ['lesson', l], BTN_PLAIN, f < 100 && (player.gold || 0) >= (T.cost || 18), f >= 100 ? 'You speak it like a native.' : `Not enough gold (${T.cost || 18}g).`);
            }
            html += '</div>';
        }

        // Interpreter
        html += `<div style="${CARD}"><b>Interpreter</b><br>`;
        const t = player.translator;
        if (t) {
            html += `${esc(t.name)}, in your service since day ${t.since}: ${t.tongues.map(x => esc(Cultures.languageName(x))).join(', ')} · ${t.wage} gold a day<br>`;
            html += act('Dismiss', ['dismiss'], BTN_PLAIN);
        } else if (s) {
            const offer = Languages.translatorOffer(player, world);
            if (offer) {
                html += `${esc(offer.name)} offers service: ${offer.tongues.map(x => esc(Cultures.languageName(x))).join(', ')} — ${offer.hire} gold to hire, then ${offer.wage} a day.<br>`;
                html += act(`Hire (${offer.hire}g)`, ['hire'], BTN_GOLD, (player.gold || 0) >= offer.hire, `Not enough gold (${offer.hire}g).`);
            }
        } else {
            html += `<span style="${NOTE}">Interpreters are hired in towns and villages.</span>`;
        }
        html += '</div></div>';
        game.ui.showCustomPanel('🗣️ Languages', html);
    },

    /** Every button on the panel */
    languagesAct(game, op, arg = null) {
        const { player, world } = game;
        let res = null;
        if (op === 'lesson') res = Languages.lesson(player, world, arg);
        else if (op === 'hire') res = Languages.hireTranslator(player, world);
        else if (op === 'dismiss') res = Languages.dismissTranslator(player);
        if (res) {
            game.ui.showNotification('🗣️ Languages', res.success ? res.text : (res.reason || 'Not possible.'), res.success ? 'success' : 'error');
            game.ui.updateStats(player, world);
        }
        ActionMenu.showLanguages(game);
    },
});
