// ActionMenu — ⚔️ Blood Feuds (Dynasty → Blood Feuds): the families, Houses
// and crowns your House owes blood, or who owe it to yours. Each: who carries
// it now, the unavenged dead, its heat and generations, and what can end it —
// a blood price before the arbiter the realm's law names, a match between the
// Houses. Below: feuds in the town you hold that you may judge, the world's
// own feuds you have heard of, and those that ended. Logic: systems/bloodFeuds.js.
import { ActionMenu } from './_ref.js';
import { BloodFeuds } from '../../systems/bloodFeuds.js';
import { lede, chips, rowList, card, price, esc } from './uiKit.js';
import { Utils } from '../../core/utils.js';

const HOW = {
    wergild: ['💰', 'Blood price paid'], married: ['💍', 'Ended at the altar'], judged: ['⚖️', 'Judged'], faded: ['🍂', 'Forgotten'],
    letGo: ['🕊️', 'Let lie'], extinct: ['⚰️', 'Line ended'], wiped: ['💀', 'Wiped out'],
};

function _bar(value) {
    const pct = Math.max(0, Math.min(100, Math.round(value)));
    const col = pct >= 70 ? '#c0533a' : pct >= 45 ? '#d9703f' : pct >= 25 ? '#d9a13f' : '#b5a46a';
    return `<div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;margin:4px 0 6px;"><div style="width:${pct}%;height:100%;background:${col};"></div></div>`;
}

Object.assign(ActionMenu, {
    /** The blood feuds panel. message: { html, tone } shown on top. */
    showBloodFeuds(game, message = null) {
        const player = game.player;
        const world = game.world;
        if (!player || !world) return;
        const v = BloodFeuds.view(world, player);
        let html = '<div style="font-size:12px; max-height:540px; overflow-y:auto;">';
        if (message) html += card(message.html, { tone: message.tone || 'gold' });
        html += lede(v.mine.length
            ? 'Blood is owed. A family does not forget its dead: it refuses you its trade, speaks against you at court and on the road, and waits with a knife. The debt passes to sons and to heirs.'
            : 'No family owes your House blood. Every killing is remembered by the dead one\'s kin — even a lawful hanging, if they deem it unjust.');

        for (const m of v.mine) {
            const f = m.feud;
            let body = chips([
                ['⚔️', m.owed ? 'They owe you' : 'You owe them', Math.round(f.heat), m.owed ? 'gold' : 'bad'],
                ['🧬', 'Generation', m.gens + 1],
                m.bearer ? ['🗡️', 'Carried by', esc(m.bearer)] : null,
            ]);
            body += _bar(f.heat);
            const dead = m.dead.map(d => `${esc(d.name)} (${esc((BloodFeuds.kindDef(d.how) || {}).label || d.how)})`).join(', ');
            if (dead) body += `<div style="color:#cfc3a5; margin:2px 0 6px;">The unavenged: ${dead}.</div>`;
            const acts = (f.acts || []).slice(0, 3).map(a => ({ icon: '•', name: esc(a.text), desc: `day ${a.d}` }));
            if (acts.length) body += rowList(acts, 'Lately');
            if (!m.owed) {
                const rows = [];
                const q = m.wergild;
                rows.push(q && q.ok
                    ? { icon: '💰', name: 'Offer the blood price', desc: `To ${esc(q.bearer || q.payee)}, before ${esc(q.arbiter)} (${Math.round(q.chance * 100)}% they take it)`, side: price(q.price, true), act: 'bloodFeudAct', args: ['wergild', f.id] }
                    : { icon: '💰', name: 'Offer the blood price', off: true, why: esc((q && q.reason) || 'Not now.'), side: q && q.price ? price(q.price, false) : '' });
                const mo = m.marriage;
                if (mo && mo.ok) {
                    for (const o of mo.options.slice(0, 2)) {
                        rows.push({ icon: '💍', name: `Promise ${esc(o.child.firstName)} to ${esc(o.suitor.name)}`, desc: `A match into ${esc(m.other.name)} ends the feud`, act: 'bloodFeudAct', args: ['marry', f.id, o.childId, o.suitor.id] });
                    }
                } else if (mo) rows.push({ icon: '💍', name: 'A match between the families', off: true, why: esc(mo.reason) });
                body += rowList(rows, 'What can end it');
            }
            html += card(body, { icon: m.other.kind === 'folk' ? '🏘️' : m.other.kind === 'house' ? '🛡️' : '👑', title: esc(m.other.name), side: esc(m.other.town || ''), tone: m.owed ? 'gold' : f.heat >= 55 ? 'bad' : 'warn' });
        }

        if (v.judge.length) {
            html += rowList(v.judge.map(j => ({
                icon: '⚖️', name: `The ${esc(j.payer.name)} and the ${esc(j.payee.name)}`,
                desc: `Order the ${esc(j.payer.name)} to pay the ${esc(j.payee.name)} their blood price (a tenth to you)`, side: `${Utils.formatGold(j.price)}g`,
                act: 'bloodFeudAct', args: ['judge', j.feud.id],
            })), `Feuds to judge in ${esc(v.here ? v.here.name : 'this town')}`);
        }
        if (v.world.length) {
            html += rowList(v.world.map(f => ({
                icon: '⚔️', name: `${esc(f.sides[0].name)} and ${esc(f.sides[1].name)}`,
                desc: esc(`${f.deaths.length} dead${f.sides[0].town ? ` · ${f.sides[0].town}` : ''}${f.gens.some(g => g > 0) ? ` · ${Math.max(...f.gens) + 1} generations` : ''}`),
                side: String(Math.round(f.heat)), tone: f.heat >= 55 ? 'bad' : 'warn',
            })), 'Feuds of the world');
        }
        if (v.past.length) {
            html += rowList(v.past.map(p => {
                const [ic, label] = HOW[p.ended.how] || ['·', p.ended.how];
                return { icon: ic, name: `${esc(p.sides[0].name)} and ${esc(p.sides[1].name)}`, desc: esc(p.ended.text), side: `${esc(label)} · day ${p.ended.d}` };
            }), 'Feuds that ended');
        }
        html += '</div>';
        game.ui.showCustomPanel('⚔️ Blood Feuds', html);
    },

    /** The panel's rows (data-am-act="bloodFeudAct"). */
    bloodFeudAct(game, action, id, a = null, b = null) {
        const player = game.player;
        const world = game.world;
        let res;
        if (action === 'wergild') res = BloodFeuds.offerWergild(world, player, id);
        else if (action === 'marry') res = BloodFeuds.proposeMarriage(world, player, id, a, b);
        else if (action === 'judge') res = BloodFeuds.arbitrate(world, player, id);
        else return;
        if (!res || !res.success) {
            game.ui.showNotification('⚔️ Blood Feuds', (res && res.reason) || 'That cannot be done.', 'error');
            return;
        }
        game.ui.updateStats(player, world);
        ActionMenu.showBloodFeuds(game, { html: esc(res.text || 'Done.'), tone: res.accepted === false ? 'bad' : 'good' });
    },
});
