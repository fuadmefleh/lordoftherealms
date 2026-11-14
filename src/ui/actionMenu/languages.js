// ActionMenu — Languages: the tongues you speak, the one spoken here, lessons
// with a tutor and an interpreter for hire (systems/languages.js, world/
// cultures.js). Buttons route through data-am-act → ActionMenu.languagesAct.
import { ActionMenu } from './_ref.js';
import { Languages } from '../../systems/languages.js';
import { Cultures } from '../../world/cultures.js';
import { lede, chips, bullets, sectionHead, rowList, card, price, purse, esc } from './uiKit.js';

const NOTE = 'font-size: 11px; color: var(--text-secondary);';

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
        const known = Languages.known(player);
        html += chips([purse(player.gold), ['🗣️', 'Tongues', known.length], player.translator ? ['🤝', 'Interpreter', esc(player.translator.name)] : null]);

        // Where you stand
        if (here.lang) {
            const name = Cultures.languageName(here.lang);
            const fam = Cultures.data().families && Cultures.data().families[Cultures.family(here.lang)];
            let here2 = `You: ${bar(here.value, here.level.id)} <b>${esc(here.level.name)}</b>${here.via === 'translator' ? ' — through your interpreter' : here.via === 'kin' ? ' — through a kindred tongue' : ''}`;
            const fx = (Cultures.data().effects || {}).trade || {};
            const t = fx[here.level.id];
            const notes = [];
            if (t) notes.push(t < 0 ? `Haggling in a tongue you lack: prices ${Math.round(-t * 100)}% against you.` : `Speaking it well: a fair deal (+${Math.round(t * 100)}%).`);
            if (here.level.id === 'none' || here.level.id === 'broken') notes.push(`Talk is ${here.level.id === 'none' ? 'by gesture only' : 'simple questions only'}, and a lord's court will not hear you without ${Cultures.level((Cultures.data().effects || {}).audience || 50).name.toLowerCase()} speech or an interpreter.`);
            here2 += bullets(notes);
            html += card(here2, { icon: '📍', title: `Spoken here: ${esc(name)}`, side: fam ? `<span style="${NOTE}">${esc(fam.name)} tongues</span>` : '' });
        } else {
            html += lede('No one lives here to speak to.');
        }

        // Your tongues
        html += rowList(known.map(k => ({
            icon: k.native ? '🏠' : '🗣️', name: esc(k.name),
            desc: `${esc(k.level.name)}${k.native ? ' · mother tongue' : ''}`,
            side: `${bar(k.fluency, k.level.id)} ${k.fluency}`,
        })), 'Your tongues') || (sectionHead('Your tongues') + lede('None yet.'));
        html += `<div style="${NOTE} margin:2px 0 6px;">You learn a tongue by living among its speakers and talking with them; a tutor's lessons go faster. Kindred tongues are partly understood.</div>`;

        // Lessons
        if (s) {
            const T = (Cultures.data().learning || {}).tutor || {};
            const cost = T.cost || 18;
            const can = (player.gold || 0) >= cost;
            html += rowList(Languages.teachable(world, s).map(l => {
                const f = Math.round(Languages.fluency(player, l));
                return {
                    icon: '📖', name: `${esc(Cultures.languageName(l))} lesson`, desc: `You: ${f}/100 · one lesson a day`,
                    side: price(cost, can), off: f >= 100 || !can, why: f >= 100 ? 'You speak it like a native.' : `Needs ${cost}g.`,
                    act: 'languagesAct', args: ['lesson', l],
                };
            }), `Tutors in ${esc(s.name)}`);
        }

        // Interpreter
        const t = player.translator;
        if (t) {
            html += rowList([{
                icon: '🤝', name: `Dismiss ${esc(t.name)}`, desc: `In your service since day ${t.since}: ${t.tongues.map(x => esc(Cultures.languageName(x))).join(', ')}`,
                side: `${t.wage}g/day`, act: 'languagesAct', args: ['dismiss'],
            }], 'Interpreter');
        } else if (s) {
            const offer = Languages.translatorOffer(player, world);
            if (offer) {
                const ok = (player.gold || 0) >= offer.hire;
                html += rowList([{
                    icon: '🤝', name: `Hire ${esc(offer.name)}`, desc: `Speaks ${offer.tongues.map(x => esc(Cultures.languageName(x))).join(', ')}; then ${offer.wage}g a day`,
                    side: price(offer.hire, ok), off: !ok, why: `Needs ${offer.hire}g.`, act: 'languagesAct', args: ['hire'],
                }], 'Interpreter');
            }
        } else {
            html += sectionHead('Interpreter') + `<div style="${NOTE}">Interpreters are hired in towns and villages.</div>`;
        }
        html += '</div>';
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
