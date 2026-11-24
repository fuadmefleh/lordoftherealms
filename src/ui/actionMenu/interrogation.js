// ActionMenu — the dungeon (systems/interrogation.js).
//   showDungeon         "🔗 The Dungeon": everyone you hold (cellar, a rival
//                       House's child, an outlaw taken for a bounty), the
//                       realm's law on torture, the names you were given, what
//                       you have learned of the rival Houses. Reached from
//                       Intrigue & the Law ('dungeon') and from 🔪 The Knife's
//                       captive panels.
//   showDungeonPrisoner the ladder for one prisoner: each step's odds, the
//                       death risk, whether it is lawful here.
//   dungeonAct          a row: question them / act on a name.
import { ActionMenu } from './_ref.js';
import { Interrogation } from '../../systems/interrogation.js';
import { Atrocities } from '../../systems/atrocities.js';
import { lede, chips, card, rowList, price, esc } from './uiKit.js';

const KIND_WORD = { captive: '⛓️ In your cellar', rival: '🏰 Blood of the rival Houses', bounty: '🗡️ Taken for a bounty', rebel: '🔥 Leaders of risings', pow: '🛡️ Prisoners of war' };
const KIND_ICON = { captive: '⛓️', rival: '🏰', bounty: '🗡️', rebel: '🔥', pow: '🛡️' };
const LAW_WORD = { forbidden: 'Torture forbidden', treason: 'For treason only', free: 'At the gaoler\'s will' };
const _cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
const pct = (x) => `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`;
const BACK = (act, args) => `<button data-am-act="${act}"${args ? ` data-am-args="${esc(JSON.stringify(args))}"` : ''} style="width:100%;padding:8px;margin-top:10px;background:#444;border:1px solid #666;border-radius:6px;color:#eee;cursor:pointer;">Back</button>`;

function _namesHtml(game) {
    const { player } = game;
    const names = Interrogation.names(player).filter(n => n.status === 'open');
    const canCondemn = Interrogation.canCondemn();
    let html = '';
    for (const n of names.slice(0, 8)) {
        const who = `${esc(n.name)}${n.role ? `, ${esc(n.role)}` : ''}${n.town && n.vassalId == null ? ` of ${esc(n.town)}` : ''}`;
        html += rowList([
            { icon: '📣', name: `Accuse ${esc(n.name)}`, desc: `Name ${who} ${esc(Interrogation._claimText(n))} before all`, act: 'dungeonAct', args: ['accuse', n.id], tone: 'warn' },
            canCondemn ? { icon: '⚖️', name: 'Condemn them', desc: 'Send them to the scaffold. If it was a lie, it will come out', act: 'dungeonAct', args: ['condemn', n.id], tone: 'bad' } : null,
            { icon: '🤐', name: 'Let it lie', desc: 'Do nothing with it', act: 'dungeonAct', args: ['drop', n.id] },
        ], `🗝️ ${esc(n.from)} named ${esc(n.name)}, day ${n.day}`);
    }
    const settled = Interrogation.names(player).filter(n => n.status !== 'open').slice(0, 6);
    if (settled.length) {
        html += rowList(settled.map(n => ({
            icon: n.status === 'dropped' ? '🤐' : n.status === 'condemned' ? '⚖️' : '📣', name: esc(n.name), desc: `Named by ${esc(n.from)} · day ${n.day}`,
            // (a condemned name never shows its truth here: the scaffold's own record may, if it comes out)
            side: n.status === 'dropped' ? 'Let lie' : n.status === 'condemned' ? esc(n.fate ? _cap(String(n.fate).replace(/_/g, ' ')) : 'Awaiting the scaffold') : n.outcome === 'true' ? 'It was true' : 'Innocent',
            tone: n.status === 'dropped' ? '' : n.status === 'condemned' ? 'warn' : n.outcome === 'true' ? 'good' : 'bad',
        })), '📜 Names acted on');
    }
    return html;
}

function _intelHtml(game) {
    const { player, world } = game;
    const day = (world && world.day) || 0;
    const rows = Object.values(Interrogation.state(player).intel || {}).filter(i => i && day <= (i.until || 0)).map(i => ({
        icon: '🏰', name: esc(i.house), desc: `${Math.round(i.gold)} gold${i.ambition ? ` · means to ${esc(i.ambition)}` : ''}${i.doing ? ` · ${esc(i.doing)}` : ''}`,
        note: `Learned day ${i.day}; you hear of their plots sooner until day ${i.until}`, side: `feud ${i.feud}`,
    }));
    return rowList(rows, '🕯️ What your prisoners told of the Houses');
}

Object.assign(ActionMenu, {
    /** The Dungeon: everyone you hold, the law, the names given. */
    showDungeon(game, flash = '') {
        const { player, world } = game;
        const st = Interrogation.state(player);
        const held = Interrogation.held(player, world);
        const kid = Interrogation._playerRealm(player, world);
        const law = Interrogation.law(world, kid);
        let html = lede('Those you hold know things. Bread and a quiet word, the threat of the irons, the irons themselves: some talk, some lie to make it stop, some die. Whatever you learn here, you will never be quite sure of.');
        html += chips([
            ['🔗', 'Law here', LAW_WORD[law] || law],
            ['⚔️', 'Cruelty', Math.round(Atrocities.butcher(player))],
            ['🗣️', 'Broken', st.stats.broken || 0],
            ['💀', 'Died in your keeping', st.stats.died || 0],
        ]);
        if (flash) html += card(esc(flash), { icon: '🔗', title: 'The dungeon' });
        const groups = {};
        for (const h of held) (groups[h.kind] || (groups[h.kind] = [])).push(h);
        for (const [kind, list] of Object.entries(groups)) {
            html += rowList(list.map(h => {
                const sub = Interrogation.subject(player, h, world);
                return { icon: KIND_ICON[kind] || '⛓️', name: esc(h.name), desc: esc(h.desc), side: '›',
                    note: `${esc(Interrogation.bodyWord(sub.hp))}${sub.sessions ? ` · questioned ${sub.sessions} time${sub.sessions === 1 ? '' : 's'}` : ''}`,
                    act: 'showDungeonPrisoner', args: [h.key], tone: sub.hp < 40 ? 'bad' : '' };
            }), KIND_WORD[kind] || kind);
        }
        if (!held.length) html += card('You hold no one: lock a townsperson in your cellar, take a rival House\'s child from its retinue, take an outlaw alive for a bounty, take a captain from a beaten host or a stormed town, or the leader of a crushed rising.', { icon: '🔗' });
        // The men who yielded in battle: ransom talks, the column, oaths, stakes (ui/actionMenu/prisonerFates.js)
        html += rowList([{ icon: '🛡️', name: 'Prisoners of war', desc: 'Ransom talks for the men of rank, the column awaiting your word, oaths, turncoats, your stakes', side: '›', act: 'showCaptives' }]);
        html += _namesHtml(game);
        html += _intelHtml(game);
        if ((st.spiesDone || []).length) html += rowList(st.spiesDone.slice(0, 5).map(x => ({ icon: '🕵️', name: esc(x.name), desc: `Put to the question by ${esc(x.realm)} · day ${x.day}`, side: 'Talked', tone: 'bad' })), '🕵️ Your spies in their cells');
        if (st.log.length) html += rowList(st.log.slice(0, 8).map(l => ({ icon: '·', name: esc(l.text), desc: `day ${l.day}` })), '📜 The gaoler\'s book');
        game.ui.showCustomPanel('🔗 The Dungeon', html);
    },

    /** The ladder for one prisoner. */
    showDungeonPrisoner(game, key, flash = '') {
        const { player, world } = game;
        const h = Interrogation.find(player, world, key);
        if (!h) { ActionMenu.showDungeon(game, flash); return; }
        const sub = Interrogation.subject(player, h, world);
        const law = Interrogation.law(world, h.kingdomId);
        const she = h.gender === 'female';
        const he = she ? 'she' : 'he';
        const him = she ? 'her' : 'him';
        let html = lede(`${esc(h.name)}: ${esc(h.desc)}.`);
        html += chips([
            ['🩸', 'Body', Interrogation.bodyWord(sub.hp)],
            ['🔗', 'Law', LAW_WORD[law] || law],
            ['🗣️', 'Broke', sub.broke || 0],
        ]);
        if (flash) html += card(esc(flash), { icon: '🔗', title: 'In the dark', tone: 'warn' });
        const warn = {
            captive: `No one hears ${him} down here, unless the gaoler talks. If ${he} ever goes free, ${he} will tell.`,
            rival: `${esc(h.rival ? h.rival.name : 'Their House')} will hear of it. Hurt ${him} and the feud runs hotter; let ${him} die and they will want blood.`,
            bounty: 'Outlaws are hard men, but they know the roads and the hiding places. A dead one is worth nothing to the magistrate.',
            rebel: `${he === 'she' ? 'She' : 'He'} knows who stood with ${him} at the rising. Every law calls a rebel a traitor; ${he === 'she' ? 'her' : 'his'} town will call ${him} a martyr if ${he} dies here.`,
            pow: `${esc(h.pow ? h.pow.realm : 'Their realm')} wants ${him} back, and will pay. ${he === 'she' ? 'She' : 'He'} knows its treasury and its army; hurt ${him} and the realm hears of it.`,
        }[h.kind] || '';
        if (warn) html += card(warn, { icon: '⚠️' });
        const opts = Interrogation.options(player, world, h);
        html += rowList(opts.map(o => ({
            icon: o.icon, name: esc(o.label), desc: esc(o.desc || ''), off: !o.ok, why: esc(o.why),
            note: `${pct(o.chance)} to break${o.death > 0 ? ` · ${pct(o.death)} to die` : ''}${o.harsh ? (o.lawful ? ' · lawful here' : ' · against the law here') : ''}`,
            side: o.harsh ? (o.lawful ? '' : '⚖️') : '', tone: o.harsh ? 'bad' : '', act: 'dungeonAct', args: ['question', h.key, o.id],
        })), `🔗 Put ${him} to the question`);
        if (h.kind === 'pow' && h.pow) {
            const ransom = Interrogation.powRansom(player, world, h.pow);
            html += rowList([
                { icon: '💰', name: 'Ransom', desc: `${esc(h.pow.realm)} pays out of its treasury and ${he} rides home`, side: ransom > 0 ? price(ransom, true) : 'Nothing to pay', off: !(ransom > 0), why: `${esc(h.pow.realm)} has nothing in its treasury.`, act: 'dungeonAct', args: ['powRansom', h.pow.id] },
                { icon: '🕊️', name: 'Send them home', desc: 'For nothing: their realm thinks the better of you', act: 'dungeonAct', args: ['powRelease', h.pow.id], tone: 'good' },
                Interrogation.canCondemn() ? { icon: '⚖️', name: 'To the scaffold', desc: 'Onto the list of the condemned, for your word', act: 'dungeonAct', args: ['powCondemn', h.pow.id], tone: 'bad' } : null,
            ], '⛓️ Or');
        }
        html += BACK('showDungeon');
        game.ui.showCustomPanel(`🔗 ${esc(h.name)}`, html);
    },

    /** A row of the dungeon: question a prisoner, or act on a name. */
    dungeonAct(game, what, a, b) {
        const { player, world } = game;
        let r;
        if (what === 'question') r = Interrogation.question(player, world, a, b);
        else if (what === 'accuse') r = Interrogation.accuse(player, world, a);
        else if (what === 'condemn') r = Interrogation.condemn(player, world, a);
        else if (what === 'drop') r = Interrogation.drop(player, world, a);
        else if (what === 'powRansom') r = Interrogation.ransomPow(player, world, a);
        else if (what === 'powRelease') r = Interrogation.releasePow(player, world, a);
        else if (what === 'powCondemn') r = Interrogation.condemnPow(player, world, a);
        else r = { success: false, reason: 'No such thing.' };
        if (!r || !r.success) { game.ui.showNotification('🔗 The Dungeon', (r && r.reason) || 'It cannot be done.', 'error'); return; }
        game.ui.updateStats(player, world);
        if (what === 'question' && !r.died) ActionMenu.showDungeonPrisoner(game, a, r.text);
        else ActionMenu.showDungeon(game, r.text);
    },
});
