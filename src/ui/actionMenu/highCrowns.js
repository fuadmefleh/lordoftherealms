// ActionMenu — High Crowns: the crowns you wear in personal union, the
// viceroys who rule them, the lords' temper, crowns offered or to be dictated,
// the Empire / High Kingship, and the plan for the crowns at your death.
// Logic lives in systems/highCrowns.js; this panel presents it in the action
// menu's voice (ui/actionMenu/uiKit.js). Opened from Claims & Crowns.
import { ActionMenu } from './_ref.js';
import { Throne, PlayerMilitary, House } from './_imports.js';
import { HighCrowns } from '../../systems/highCrowns.js';
import { LlmProse } from '../../systems/llmProse.js';
import { chips, purse, sectionHead, card, rowList, price, lede, esc } from './uiKit.js';
import { Names } from '../../core/names.js';
import { Utils } from '../../core/utils.js';

const MUTED = 'color: #9d937c; font-size: 11px;';

function _bar(value, color) {
    const pct = Math.max(0, Math.min(100, Math.round(value)));
    return `<div style="height:5px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;margin:3px 0 5px;"><div style="width:${pct}%;height:100%;background:${color};"></div></div>`;
}

function _temperWord(sep) {
    if (sep >= 85) return 'on the edge of revolt';
    if (sep >= 70) return 'talking of a king of their own';
    if (sep >= 45) return 'restless under a far king';
    if (sep >= 20) return 'grudging';
    return 'content';
}

function _loyaltyWord(l) {
    if (l >= 75) return 'devoted';
    if (l >= 55) return 'loyal';
    if (l >= 40) return 'wavering';
    if (l >= 25) return 'disloyal';
    return 'false';
}

Object.assign(ActionMenu, {
    /** High Crowns: every crown you wear, the high crown, offers, the succession plan. */
    showHighCrowns(game, tile) {
        const { player, world } = game;
        const st = HighCrowns.state(player);
        const cfg = HighCrowns.config();
        const army = PlayerMilitary.getArmyStrength(player);
        const crowns = HighCrowns.crownsOf(player, world);
        const emp = HighCrowns.empire(player);
        let html = '<div style="font-size:12px;">';
        html += chips([
            ['👑', 'Crowns', `${crowns.length}/${cfg.maxCrowns}`],
            { icon: '⭐', label: 'Prestige', value: House.getPrestige(player), cls: 'gold' },
            purse(player.gold),
        ]);
        html += lede(emp
            ? `You are <b>${esc(emp.title)}</b> of the ${esc(emp.name)}, crowned on day ${emp.day} at ${esc(emp.seat || 'your capital')}.`
            : crowns.length > 1 ? `You wear ${crowns.length} crowns. Each realm keeps its own lords and laws; you rule the far ones through viceroys.`
                : 'A ruler may win a second crown: press a claim on another throne, take one offered by blood, or make a beaten realm yield its crown.');

        // ── The high crown ──
        if (emp) {
            const text = emp.proseKey ? LlmProse.text(world, emp.proseKey, '') : '';
            let body = text ? `<div style="${MUTED} font-style:italic;">${esc(text)}</div>` : '';
            body += `<div style="${MUTED} margin-top:4px;">+${cfg.proclaim.yearlyPrestige} Prestige a year · every crown steadier (+${Math.round(cfg.proclaim.stability * 100)} stability) · the far lords' discontent grows ${Math.round((cfg.separatism.empireMult - 1) * 100)}% faster · the leagues fear you ${Math.round((cfg.proclaim.coalitionFear - 1) * 100)}% more. Should your crowns fall to one, the high title is lost.</div>`;
            html += card(body, { icon: '🏛️', title: `The ${esc(emp.name)}`, tone: 'gold' });
        } else if (crowns.length) {
            const ps = HighCrowns.proclaimStatus(player, world);
            const style = HighCrowns.styleFor(player, world);
            let body = `<div style="${MUTED}">Wear ${cfg.proclaim.minCrowns}+ crowns, rule ${cfg.proclaim.minSettlements}+ settlements across them (you rule ${ps.towns}), and hold ${cfg.proclaim.minPrestige}+ Prestige. The coronation costs ${ps.cost} Prestige and a feast of ${Utils.formatGold(ps.feast)} gold (${Utils.formatGold(ps.fromPurse)} from your purse, ${Utils.formatGold(ps.fromTreasury)} from the home treasury), spent in your capital.</div>`;
            body += rowList([{
                icon: '🏛️', name: `Be crowned ${esc(style.title)} of the ${esc(style.name)}`,
                desc: 'A title above kings: Prestige yearly, steadier crowns — and more enemies',
                off: !ps.ok, why: esc(ps.reasons[0] || ''), attrs: 'onclick="window._highCrowns.proclaim()"', side: `${ps.cost} ⭐`, tone: 'gold',
            }]);
            html += card(body, { icon: '🏛️', title: 'A crown above crowns' });
        }

        // ── Your crowns ──
        if (crowns.length) {
            html += rowList(crowns.map(c => c.home
                ? { icon: '👑', name: esc(c.name), desc: `Your seat · ${c.towns} settlements · ruled in person (Royal Court)`, side: '›', tone: 'gold', attrs: 'onclick="window._highCrowns.court()"' }
                : {
                    icon: c.separatism >= cfg.separatism.warnAt ? '🏴' : '🏛️', name: esc(c.name),
                    desc: `${c.towns} settlements · viceroy ${c.viceroy ? `${esc(c.viceroy.name)} (${_loyaltyWord(c.viceroy.loyalty)})` : '<span style="color:#e0846a;">none</span>'} · lords ${_temperWord(c.separatism)}`,
                    side: '›', tone: c.separatism >= cfg.separatism.warnAt || !c.viceroy ? 'warn' : '', attrs: `onclick="window._highCrowns.crown('${c.kingdomId}')"`,
                }), '👑 Your crowns');
        }

        // ── Crowns offered ──
        for (const o of Object.values(st.offers)) {
            const k = world.getKingdom(o.kingdomId);
            if (!k) continue;
            const can = HighCrowns.canSeekAnother(player, world, k.id);
            let body = `<div style="${MUTED}">${esc(HighCrowns._text('offer', { realm: Names.realm(k.name), claim: o.claim }, ''))}</div>`;
            body += rowList([
                { icon: '👑', name: 'Accept the crown', desc: `The coronation in ${esc(k.name)}'s capital`, side: price(o.fee, (player.gold || 0) >= o.fee), off: !can.ok || (player.gold || 0) < o.fee, why: esc(can.ok ? `You need ${Utils.formatGold(o.fee)} gold` : can.reason), attrs: `onclick="window._highCrowns.accept('${k.id}')"`, tone: 'gold' },
                { icon: '✋', name: 'Decline', attrs: `onclick="window._highCrowns.decline('${k.id}')"` },
            ]);
            html += card(body, { icon: '📜', title: `The crown of ${esc(Names.realm(k.name))}`, side: `${Math.max(0, o.expires - world.day)} days to answer`, tone: 'warn' });
        }

        // ── Crowns to dictate ──
        const dictate = [];
        for (const c of Throne.claims(player, world)) {
            const conquest = (c.sources.find(s => s.id === 'conquest') || {}).value || 0;
            if (!conquest) continue;
            const can = HighCrowns.canDictate(player, world, c.kingdomId, { armyStrength: army });
            dictate.push({ icon: '⚔️', name: `Make ${esc(c.kingdom.name)} yield its crown`, desc: `You stormed its capital (claim by conquest ${conquest}). At war with your crown and its host broken, its court must bow`, off: !can.ok, why: esc(can.reason || ''), side: `${cfg.dictate.prestige} ⭐`, tone: 'bad', attrs: `onclick="window._highCrowns.dictate('${c.kingdomId}')"` });
        }
        if (dictate.length) html += rowList(dictate, '⚔️ By the sword');

        // ── At your death ──
        if (crowns.length > 1) {
            const plan = HighCrowns.plan(player);
            const preview = HighCrowns.partitionPreview(player, world);
            const parted = preview.filter(p => p.child).map(p => `${esc(p.name)} to ${esc(p.child.firstName)}`);
            html += rowList([
                { icon: '🛡️', name: 'Keep the crowns whole', desc: `Your heir wears them all. Each far realm tests the new ruler (+${cfg.succession.wholeSpike} discontent); the younger children are passed over and may contest it.`, side: plan === 'whole' ? 'chosen' : '', tone: plan === 'whole' ? 'gold' : '', attrs: plan === 'whole' ? '' : 'onclick="window._highCrowns.plan(\'whole\')"' },
                { icon: '🌿', name: 'Partition among the children', desc: parted.length ? `Today that would be: ${parted.join('; ')}. They rule as kin, allied to your heir.` : 'You have no grown younger child to give a crown to: the crowns would stay whole.', side: plan === 'partition' ? 'chosen' : '', tone: plan === 'partition' ? 'gold' : '', attrs: plan === 'partition' ? '' : 'onclick="window._highCrowns.plan(\'partition\')"' },
            ], '🕯️ The crowns at your death');
            const ag = HighCrowns.aggrieved(player);
            if (ag.length) html += `<div style="${MUTED}">Passed over at the last succession: ${ag.map(a => esc(a.name)).join(', ')}.</div>`;
        }

        if (st.past.length) html += `<div style="${MUTED} margin-top:6px;">Before: ${st.past.map(p => `the ${esc(p.name)} (day ${p.from}–${p.until}, ${esc(p.why)})`).join('; ')}.</div>`;
        if (st.history.length) {
            html += sectionHead('📖 Of the crowns');
            for (const h of st.history.slice(-6).reverse()) html += `<div style="${MUTED} padding:2px 0;">Day ${h.day}: ${esc(h.text)}</div>`;
        }
        html += '</div>';
        game.ui.showCustomPanel('🏛️ High Crowns', html);

        const reopen = () => ActionMenu.showHighCrowns(game, tile);
        const result = (title, res, again = reopen) => ActionMenu._realmResult(game, title, res, again);
        window._highCrowns = {
            court: () => ActionMenu.showRoyalCourt(game, tile, 'realm'),
            crown: (kid) => ActionMenu.showHighCrown(game, tile, kid),
            proclaim: () => result('🏛️ The High Crown', HighCrowns.proclaim(player, world, {})),
            accept: (kid) => result('👑 A Crown Accepted', HighCrowns.acceptOffer(player, world, kid)),
            decline: (kid) => result('📜 A Crown Declined', HighCrowns.declineOffer(player, world, kid)),
            dictate: (kid) => result('⚔️ A Crown Yielded', HighCrowns.dictate(player, world, kid, { armyStrength: PlayerMilitary.getArmyStrength(player) })),
            plan: (p) => result('🕯️ The Crowns at Your Death', HighCrowns.setPlan(player, p)),
            back: reopen,
        };
    },

    /** One far crown: its viceroy, the lords' temper, its policies and decrees. */
    showHighCrown(game, tile, kid) {
        const { player, world } = game;
        const entry = HighCrowns.unionCrown(player, kid);
        const k = world.getKingdom(kid);
        if (!entry || !k) { ActionMenu.showHighCrowns(game, tile); return; }
        const cfg = HighCrowns.config();
        const V = cfg.viceroy;
        const q = HighCrowns.levyQuote(player, world, kid);
        const v = entry.viceroy;
        const away = world.day - (entry.lastPresentDay || entry.since);
        const court = entry.court || null;
        let html = '<div style="font-size:12px;">';
        html += chips([
            ['🏴', 'Discontent', Math.round(entry.separatism)],
            ['🏛️', 'Stability', Math.round(k.stability || 0)],
            { icon: '💰', label: 'Levy', value: `${Utils.formatGold(q.levy - q.skim)}g/day`, cls: 'gold' },
            ['⚔️', 'Army', Math.floor(k.military || 0)],
        ]);
        html += lede(`Yours since day ${entry.since}${entry.how === 'inherited' ? ', by right of blood' : entry.how === 'conquest' ? ', yielded at the sword\'s point' : ''}. Its lords are ${_temperWord(entry.separatism)}. ${away <= 7 ? 'You are in the realm: your presence quiets them.' : `You were last in the realm ${away} days ago.`}`);
        html += _bar(entry.separatism, entry.separatism >= cfg.separatism.warnAt ? '#e0846a' : '#f0b35a');
        html += `<div style="${MUTED}">At ${cfg.separatism.breakAt} discontent, with stability under ${cfg.separatism.breakStability} (or its lords in revolt for a king of their own), the lords crown a native. Going there, a native or kin viceroy, light taxes and the charter calm them; absence, foreign rule, tribute and heavy taxes stir them — and so do its lords at court, by their opinion of you and their factions.</div>`;

        // ── The viceroy ──
        let vb = '';
        if (v) {
            const tgt = HighCrowns.loyaltyTarget(player, world, entry);
            vb += `<div><b style="color:#ece2c8;">${esc(v.name)}</b> <span style="${MUTED}">(${esc((HighCrowns.candidates(player, world, kid).find(c => c.kind === v.kind && c.id === v.id) || {}).blurb || v.kind)})</span></div>`;
            vb += `<div style="${MUTED}">Loyalty ${Math.round(v.loyalty)} (${_loyaltyWord(v.loyalty)}, heading for ${tgt.value}: ${tgt.parts.map(p => `${esc(p.label)} ${p.value > 0 ? '+' : ''}${p.value}`).join(' · ')}) · ambition ${Math.round(v.ambition)} · competence ${HighCrowns.competence(entry)}</div>`;
            if (q.skim > 0) vb += `<div style="color:#f0b35a; font-size:11px;">The levy comes in short: about ${Utils.formatGold(q.skim)}g a day stays with the viceroy's people.</div>`;
            if (v.rumoured) vb += '<div style="color:#e0846a; font-size:11px;">It is whispered that he means to wear this crown himself.</div>';
            vb += rowList([
                { icon: '🎁', name: 'Send a gift', desc: 'Gold into his purse; his loyalty warms', side: price(V.giftGold, (player.gold || 0) >= V.giftGold), off: (player.gold || 0) < V.giftGold, why: `You need ${Utils.formatGold(V.giftGold)} gold`, attrs: `onclick="window._highCrown.favour('gift')"` },
                { icon: '🎖️', name: 'Honour him before both courts', desc: 'Loyalty, and his ambition sated a little', side: `${V.honourPrestige} ⭐`, off: House.getPrestige(player) < V.honourPrestige, why: `Need ${V.honourPrestige} Prestige`, attrs: `onclick="window._highCrown.favour('honour')"` },
            ]);
        } else {
            vb += '<div style="color:#e0846a;">No one rules here in your name: the realm drifts and its lords grow bold. Name a viceroy.</div>';
        }
        const cands = HighCrowns.candidates(player, world, kid).filter(c => !(v && c.kind === v.kind && c.id === v.id)).slice(0, 6);
        const cost = v ? (v.rumoured ? V.replaceExposedPrestige : V.replacePrestige) : 0;
        vb += rowList(cands.map(c => ({
            icon: c.kind === 'native' ? '🏰' : c.kind === 'kin' ? '🩸' : c.kind === 'spouse' ? '💍' : '🎓', name: esc(c.name),
            desc: `${esc(c.blurb)} · loyalty ${c.loyalty}, ambition ${c.ambition}, competence ${c.competence}`,
            side: cost ? `${cost} ⭐` : 'name', attrs: `onclick="window._highCrown.appoint('${c.kind}','${esc(String(c.id))}')"`,
        })), v ? 'Replace the viceroy' : 'Name a viceroy');
        html += card(vb, { icon: '🏛️', title: 'The viceroy' });

        // ── Policies (this crown's own) ──
        for (const axis of Throne.POLICY_AXES) {
            const def = Throne.policies()[axis];
            if (!def) continue;
            html += rowList(Object.entries(def.options || {}).map(([id, opt]) => {
                const active = entry.policies[axis] === id;
                return { icon: opt.icon || '📜', name: esc(opt.label), desc: esc(opt.blurb || ''), side: active ? 'in force' : '', tone: active ? 'gold' : '', attrs: active ? '' : `onclick="window._highCrown.policy('${axis}','${id}')"` };
            }), `${esc(def.label)} in ${esc(k.name)}`);
        }

        // ── Decrees ──
        const D = HighCrowns.decrees();
        const slots = HighCrowns.decreeSlots();
        const used = Object.keys(entry.decrees || {}).length;
        html += rowList(Object.entries(D).map(([id, d]) => {
            const on = !!entry.decrees[id];
            return {
                icon: d.icon || '📜', name: esc(d.label), desc: esc(d.blurb || ''),
                side: on ? 'revoke' : `${d.prestige || 0} ⭐`, tone: on ? 'gold' : '',
                off: !on && (used >= slots || House.getPrestige(player) < (d.prestige || 0)), why: used >= slots ? `${slots} decrees at most: revoke one first` : `Need ${d.prestige} Prestige`,
                attrs: on ? `onclick="window._highCrown.revoke('${id}')"` : `onclick="window._highCrown.decree('${id}')"`,
            };
        }), `📜 Decrees (${used}/${slots})`);

        html += rowList([
            // Its own royal court: council (the viceroy at its head), edicts, vassals, factions, revolts (ui/actionMenu/royalCourt.js)
            { icon: '🏛️', name: `The Royal Court of ${esc(Names.realm(k.name))}`, desc: `${court && court.initialized ? `${court.vassals.length} lords${court.revolt ? ' · <span style="color:#e0846a;">in revolt</span>' : ''}` : 'Its lords come to swear fealty'} · council, edicts, vassals and their factions`, side: '›', tone: court && court.revolt ? 'bad' : 'gold', attrs: 'onclick="window._highCrown.court()"' },
            { icon: '👑', name: `Lay down the crown of ${esc(Names.realm(k.name))}`, desc: 'Its old line takes it back, in peace', tone: 'bad', attrs: 'onclick="window._highCrown.release()"' },
            { icon: '←', name: 'Back to your crowns', attrs: 'onclick="window._highCrown.back()"' },
        ]);
        html += '</div>';
        game.ui.showCustomPanel(`🏛️ ${esc(k.name)}`, html);

        const again = () => ActionMenu.showHighCrown(game, tile, kid);
        const home = () => ActionMenu.showHighCrowns(game, tile);
        const result = (title, res, reopen = again) => ActionMenu._realmResult(game, title, res, reopen);
        window._highCrown = {
            favour: (how) => result('🏛️ The Viceroy', HighCrowns.favour(player, world, kid, how)),
            appoint: (kind, id) => result('🏛️ A New Viceroy', HighCrowns.appoint(player, world, kid, kind, id)),
            policy: (axis, id) => result('👑 Royal Policy', HighCrowns.setPolicy(player, world, kid, axis, id)),
            decree: (id) => result('📜 A Decree', HighCrowns.proclaimDecree(player, world, kid, id)),
            revoke: (id) => result('📜 A Decree Revoked', HighCrowns.revokeDecree(player, world, kid, id)),
            release: () => result('👑 A Crown Laid Down', HighCrowns.release(player, world, kid), home),
            court: () => ActionMenu.showRoyalCourt(game, tile, 'council', kid),
            back: home,
        };
    },
});
