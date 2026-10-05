// ActionMenu — heirs: a child's upbringing (focus, tutor, childhood dilemmas),
// a grown child's placement (office, match, wardship), the House Chronicle
// and the epitaph when the line ends. Logic lives in systems/upbringing.js,
// systems/heirs.js and systems/legacy.js; these panels present it.
import { ActionMenu } from './_ref.js';
import { House } from './_imports.js';
import { Upbringing } from '../../systems/upbringing.js';
import { Heirs } from '../../systems/heirs.js';
import { Legacy } from '../../systems/legacy.js';
import { Companions } from '../../systems/companions.js';
import { Traits } from '../../systems/traits.js';
import { Throne } from '../../systems/throne.js';

const BTN = 'padding: 5px 8px; margin: 3px 3px 0 0; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px;';
const BTN_GOLD = BTN + 'background: var(--gold); color: #1a1a1a;';
const BTN_DARK = BTN + 'background: #444; color: #eee;';
const BTN_OFF = BTN + 'background: #333; color: #777; cursor: default;';
const CARD = 'background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 8px 10px; margin: 8px 0;';
const HEAD = 'font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--gold); margin: 10px 0 4px;';

const STAT_ICONS = { strength: '💪', charisma: '✨', intelligence: '🧠', faith: '🙏', luck: '🍀' };
const SKILL_ICONS = { combat: '⚔️', commerce: '💰', leadership: '👑', diplomacy: '🤝', stealth: '🕵️', cartography: '🗺️' };

function _esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _traitChips(list) {
    if (!list || !list.length) return '<span style="color:#888;">none yet</span>';
    return list.map(t => `<span title="${_esc((Traits.TRAITS[t.id] || {}).description || '')}">${t.icon} ${_esc(t.name)}</span>`).join(', ');
}

/** Compact one-card profile, reused by the death screen. */
function _profileBlock(p) {
    let h = `<div style="display:flex; gap:8px; flex-wrap:wrap; font-size:11px; color:#bbb;">`;
    for (const [k, v] of Object.entries(p.stats)) h += `<span title="${k}">${STAT_ICONS[k] || k} ${v}</span>`;
    h += `<span title="max health">❤️ ${p.maxHealth}</span></div>`;
    h += `<div style="display:flex; gap:8px; flex-wrap:wrap; font-size:11px; color:#999; margin-top:2px;">`;
    for (const [k, v] of Object.entries(p.skills)) h += `<span title="${k}">${SKILL_ICONS[k] || k} ${v}</span>`;
    h += '</div>';
    h += `<div style="font-size:11px; margin-top:3px;">${p.comeOfAge ? 'Traits' : 'Childhood traits'}: ${_traitChips(p.traits)}</div>`;
    return h;
}

Object.assign(ActionMenu, {
    /** Heir profile HTML (used by the death screen's heir cards). */
    _heirProfileHtml(player, child) {
        const p = Upbringing.profile(player, child);
        if (!p) return '';
        let h = `<div style="font-size:11px; color:#c9b27a; margin-top:2px;">${_esc(Upbringing.summary(player, child))}${p.tutor ? ` · taught by ${_esc(p.tutor.name)}` : ''}</div>`;
        return h + _profileBlock(p);
    },

    /** One child's upbringing: focus, tutor, dilemmas — or, grown, their placement. */
    showChildPanel(game, childId, message = null) {
        const player = game.player;
        const world = game.world;
        const child = (player.children || []).find(c => c.id === childId);
        if (!child) return;
        const p = Upbringing.profile(player, child);
        const cfg = Upbringing.config();
        let html = '<div style="max-height: 540px; overflow-y: auto; font-size: 12px;">';
        if (message) html += `<div style="${CARD} border-color:${message.color || 'rgba(245,197,66,0.4)'}; color:#eee;">${message.html}</div>`;

        html += `<div style="${CARD}">`;
        html += `<div style="display:flex; justify-content:space-between;"><b style="font-size:14px;">${_esc(p.name)}</b><span>${p.gender === 'female' ? '♀️' : '♂️'} Age ${p.age}${p.alive ? '' : ' · ⚰️ dead'}</span></div>`;
        const stageText = p.stage === 'infant' ? `An infant — education begins at ${cfg.startAge}.` : p.stage === 'child' ? `Coming of age at ${cfg.comeOfAgeAge}.` : 'Of age.';
        html += `<div style="color:#999; font-size:11px;">${stageText}${p.role ? ` · 🏰 ${_esc((House.roleDefs()[p.role] || {}).label || p.role)}` : ''}${player.heir === p.id ? ' · 👑 Designated heir' : ''}</div>`;
        if (p.birthTraits.length) html += `<div style="font-size:11px; margin-top:2px;">Born: ${p.birthTraits.map(t => `${t.icon} ${_esc(t.name)}`).join(', ')}</div>`;
        html += _profileBlock(p);
        if (p.leanings.length) html += `<div style="font-size:11px; color:#999;">Leaning toward: ${p.leanings.map(l => `${l.icon} ${_esc(l.name)} (${l.pct}%)`).join(', ')}</div>`;
        if (p.spouse) html += `<div style="font-size:11px; color:#ff9ad5; margin-top:2px;">💍 Wed to ${_esc(p.spouse.name)}${p.spouse.kind === 'royal' ? ' (royal)' : ''}</div>`;
        if (p.placement && p.placement.kind === 'ward') {
            html += `<div style="font-size:11px; color:#9cc8ff; margin-top:2px;">🏰 ${p.away ? `Fostering at the court of ${_esc(p.placement.lordName)} until day ${p.placement.until}` : `Fostered at the court of ${_esc(p.placement.lordName)}`}</div>`;
        }
        html += '</div>';

        // A dilemma waiting for the parent
        if (p.pending) {
            const ev = p.pending;
            html += `<div style="${CARD} border-color: rgba(245,197,66,0.5);">`;
            html += `<div style="font-weight:bold;">${ev.icon} ${_esc(ev.title)} <span style="color:#999; font-weight:normal; font-size:11px;">(decide by day ${ev.expires})</span></div>`;
            html += `<div style="color:#ddd; margin:4px 0;">${_esc(ev.text)}</div>`;
            for (const c of ev.choices) {
                const label = `${_esc(c.label)}${c.cost ? ` (${c.cost}g)` : ''}${c.risky ? ' ⚠️' : ''}`;
                html += c.affordable
                    ? `<button onclick="window._heirsUI.choose('${child.id}','${c.id}')" style="${c.isDefault ? BTN_DARK : BTN_GOLD} display:block; width:100%; text-align:left;">${label}</button>`
                    : `<button disabled style="${BTN_OFF} display:block; width:100%; text-align:left;">${label}</button>`;
            }
            html += '</div>';
        }

        if (p.alive && !p.comeOfAge) {
            // Education focus
            html += `<div style="${HEAD}">Education</div>`;
            html += `<div style="color:#bbb;">${p.focus ? `${p.focus.icon} <b>${_esc(p.focus.name)}</b> — ${_esc((Upbringing.focus(p.focus.id) || {}).blurb || '')}` : 'No focus: a little of everything, slowly, and no particular character.'}</div>`;
            html += '<div>';
            for (const [id, f] of Object.entries(Upbringing.focuses())) {
                const on = p.focus && p.focus.id === id;
                html += `<button onclick="window._heirsUI.focus('${child.id}','${id}')" title="${_esc(f.blurb)}" style="${on ? BTN_GOLD : BTN_DARK}">${f.icon} ${_esc(f.name)}</button>`;
            }
            html += '</div>';

            // Tutor
            html += `<div style="${HEAD}">Tutor</div>`;
            if (p.tutor) {
                const t = p.tutor;
                html += `<div>${t.icon} <b>${_esc(t.name)}</b> — ${t.focus ? `teaches ${_esc((Upbringing.focus(t.focus) || {}).name || t.focus)}` : 'teaches a little of everything'}, learning ×${t.multiplier.toFixed(2)}${t.wage ? `, ${t.wage}g a month` : ''}${t.kind === 'companion' ? ' (while they travel with you)' : ''}.`;
                html += ` <button onclick="window._heirsUI.dismiss('${child.id}')" style="${BTN_DARK}">Dismiss</button></div>`;
            } else {
                html += '<div style="color:#999;">No tutor. A tutor whose subject matches the focus speeds learning greatly.</div>';
            }
            for (const t of Upbringing.tutors()) {
                const ok = (player.gold || 0) >= (t.hireCost || 0);
                const subj = t.focus ? (Upbringing.focus(t.focus) || {}).name || t.focus : 'All subjects';
                html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:2px 0;"><span>${t.icon} ${_esc(t.name)} <span style="color:#888;">${_esc(subj)} · ×${t.quality} · ${t.wage}g/month</span></span>`;
                html += `<button ${ok ? `onclick="window._heirsUI.hire('${child.id}','${t.id}')"` : 'disabled'} style="${ok ? BTN_GOLD : BTN_OFF}">Hire ${t.hireCost}g</button></div>`;
            }
            const occ = Upbringing.data().companionOccupations || {};
            for (const npc of Companions.members(player, world)) {
                const subj = occ[npc.occupation] ? (Upbringing.focus(occ[npc.occupation]) || {}).name : 'All subjects';
                html += `<div style="display:flex; justify-content:space-between; align-items:center; padding:2px 0;"><span>🧭 ${_esc(npc.firstName)} <span style="color:#888;">companion, ${_esc(npc.occupation || 'traveller')} · ${_esc(subj)}</span></span>`;
                html += `<button onclick="window._heirsUI.companion('${child.id}','${npc.id}')" style="${BTN_DARK}">Ask to tutor</button></div>`;
            }
        }

        if (p.alive && p.comeOfAge) {
            const kingdoms = Heirs.kingdoms(player, world);
            const opts = kingdoms.map(k => {
                const royal = Heirs.royalCandidates(world, k.id)[0];
                return `<option value="${k.id}">${_esc(k.name)} (rep ${Math.round((player.reputation || {})[k.id] || 0)}${royal ? `, royal: ${_esc(royal.firstName)}` : ''})</option>`;
            }).join('');
            const pl = Heirs.config();
            const tcfg = Throne.config();
            html += `<div style="${HEAD}">A Place in the World</div>`;
            html += '<div style="color:#bbb;">Offices are granted from the House panel; skills decide how well they serve.</div>';
            html += '<div>';
            for (const r of House.ROLE_IDS) {
                const def = House.roleDefs()[r];
                html += `<button onclick="window._heirsUI.role('${child.id}','${r}')" title="${_esc(def.blurb)}" style="${p.role === r ? BTN_GOLD : BTN_DARK}">${_esc(def.label)} (${_esc(def.skill)} ${p.skills[def.skill] || 0})</button>`;
            }
            html += '</div>';
            if (!p.away && kingdoms.length) {
                html += `<div style="margin-top:6px;"><select id="heirKingdomSel" style="width:100%; padding:4px; background:#222; color:#eee; border:1px solid #555; border-radius:4px;">${opts}</select></div>`;
                html += '<div>';
                if (!p.spouse) {
                    html += `<button onclick="window._heirsUI.place('${child.id}','alliance')" style="${BTN_DARK}">💍 Alliance match (${pl.allianceDowry}g, +${pl.allianceReputation} rep)</button>`;
                    html += `<button onclick="window._heirsUI.place('${child.id}','royal')" style="${BTN_GOLD}">👑 Royal match (${tcfg.royalMatchGold}g, ⭐${tcfg.royalMatchPrestige}, claim)</button>`;
                }
                if (!(Upbringing.ensure(child).fostered)) {
                    html += `<button onclick="window._heirsUI.place('${child.id}','ward')" style="${BTN_DARK}">🏰 Send as ward (${pl.wardDays} days)</button>`;
                }
                html += '</div>';
            }
        }

        if (p.events.length) {
            html += `<div style="${HEAD}">Childhood</div>`;
            for (const e of p.events) {
                html += `<div style="padding:3px 0; border-bottom:1px solid rgba(255,255,255,0.05);"><span style="color:#888; font-size:10px;">Age ${e.age}</span> ${e.icon} <b>${_esc(e.title)}</b> — <i>${_esc(e.choice)}</i><div style="color:#bbb;">${_esc(e.text)}</div></div>`;
            }
        }
        html += `<button data-am-act="openTileMenu" data-am-args='["showDynastyMenu"]' style="${BTN_DARK} width:100%; margin-top:8px;">← Back to Dynasty</button>`;
        html += '</div>';

        const refresh = (msg) => {
            game.ui.updateStats(player, world);
            ActionMenu.showChildPanel(game, childId, msg);
        };
        const fail = (reason) => game.ui.showNotification('👶 Upbringing', reason, 'error');
        window._heirsUI = {
            focus: (id, focusId) => {
                const res = Upbringing.setFocus(player, id, focusId, world);
                if (!res.success) return fail(res.reason);
                refresh({ html: `${res.focus.icon} ${_esc(child.firstName)} will be raised in ${_esc(res.focus.name.toLowerCase())} arts.` });
            },
            hire: (id, tutorId) => {
                const res = Upbringing.hireCourtTutor(player, world, id, tutorId);
                if (!res.success) return fail(res.reason);
                refresh({ html: `${res.tutor.icon} The ${_esc(res.tutor.name)} takes up ${_esc(child.firstName)}'s education (−${res.cost}g).` });
            },
            companion: (id, npcId) => {
                const npc = Companions.members(player, world).find(n => n.id === npcId);
                const eff = npc ? Companions.effectiveness(player, npc) : 1;
                const res = Upbringing.hireCompanionTutor(player, world, id, npc, eff);
                if (!res.success) return fail(res.reason);
                refresh({ html: `🧭 ${_esc(res.tutor.name)} agrees to teach ${_esc(child.firstName)} on the road.` });
            },
            dismiss: (id) => {
                const res = Upbringing.dismissTutor(player, id);
                if (!res.success) return fail(res.reason);
                refresh({ html: `${_esc(res.tutor.name)} is dismissed.` });
            },
            choose: (id, choiceId) => {
                const res = Upbringing.resolveEvent(player, world, id, choiceId);
                if (!res.success) return fail(res.reason);
                refresh({ html: `${res.event.icon || '📜'} ${_esc(res.text)}`, color: res.died ? 'rgba(224,96,96,0.5)' : null });
            },
            role: (id, roleId) => {
                const res = House.assignRole(player, roleId, id);
                if (!res.success) return fail(res.reason);
                refresh({ html: `🏰 ${_esc(child.firstName)} is now ${_esc(House.roleDefs()[roleId].label)}.` });
            },
            place: (id, kind) => {
                const sel = document.getElementById('heirKingdomSel');
                const kid = sel ? sel.value : null;
                if (!kid) return fail('Choose a kingdom.');
                let res;
                if (kind === 'alliance') res = Heirs.marryForAlliance(player, world, id, kid);
                else if (kind === 'royal') res = Heirs.arrangeRoyalMatch(player, world, id, kid);
                else res = Heirs.sendAsWard(player, world, id, kid);
                if (!res.success) return fail(res.reason);
                if (kind === 'ward') refresh({ html: `🏰 ${_esc(child.firstName)} leaves to foster at the court of ${_esc(res.placement.lordName)} until day ${res.placement.until}.` });
                else refresh({ html: `💍 ${_esc(child.firstName)} weds ${_esc(res.spouse.name)}${kind === 'royal' ? ` — the House now holds a claim of ${res.claim} on the throne of ${_esc(res.spouse.kingdomName)}` : ''}.` });
            },
        };
        game.ui.showCustomPanel(`👶 ${child.firstName}`, html);
    },

    /** The House Chronicle: every ruler's reign, and the House's legacy. */
    showHouseChronicle(game) {
        const player = game.player;
        const d = Legacy.describe(player, game.world);
        if (!d) {
            game.ui.showNotification('House', 'Your House has not yet been founded.', 'info');
            return;
        }
        let html = '<div style="max-height: 560px; overflow-y: auto; font-size: 12px;">';
        html += `<div style="text-align:center;"><div style="font-size:26px;">${d.sigil.icon || '🛡️'}</div><div style="font-weight:bold; color:var(--gold); font-size:15px;">${_esc(d.houseName)}</div>`;
        if (d.motto) html += `<div style="font-style:italic; color:#bbb;">&ldquo;${_esc(d.motto)}&rdquo;</div>`;
        html += `<div style="color:#aaa; font-size:11px;">Generation ${d.generation} · ⭐ ${d.prestige} Prestige · Legacy ${d.score} — ${d.rank.icon} ${_esc(d.rank.label)}</div></div>`;
        html += ActionMenu._reignsHtml(d.reigns);
        html += `<button data-am-act="openTileMenu" data-am-args='["showDynastyMenu"]' style="${BTN_DARK} width:100%; margin-top:8px;">← Back to Dynasty</button>`;
        html += '</div>';
        game.ui.showCustomPanel('📜 House Chronicle', html);
    },

    /** Reign cards, founder first. */
    _reignsHtml(reigns) {
        let html = '';
        for (const r of reigns) {
            html += `<div style="${CARD}${r.live ? ' border-color: rgba(245,197,66,0.45);' : ''}">`;
            html += `<div style="display:flex; justify-content:space-between;"><b>${_esc(r.name)}${r.epithet ? ` <i style="color:#c9b27a;">${_esc(r.epithet)}</i>` : ''}</b><span style="color:#999;">Gen ${r.generation}${r.live ? ' · reigning' : ''}</span></div>`;
            html += `<div style="color:#999; font-size:11px;">Day ${r.startDay}–${r.live ? 'now' : r.endDay} · ${r.years} years · age ${r.startAge}–${r.endAge}${r.cause ? ` · died of ${_esc(r.cause)}` : ''} · ${r.score} legacy</div>`;
            const traits = (r.traits || []).map(id => Traits.TRAITS[id]).filter(Boolean);
            if (traits.length) html += `<div style="font-size:11px;">${traits.map(t => `${t.icon} ${_esc(t.name)}`).join(', ')}</div>`;
            if (r.title || r.crown) html += `<div style="font-size:11px; color:var(--gold);">${r.crown ? `👑 Ruler of ${_esc(r.crown)}` : ''}${r.crown && r.title ? ' · ' : ''}${r.title ? `📜 ${_esc(r.title)}` : ''}</div>`;
            const deeds = [
                ['👑', r.crownsWon, 'crowns won'], ['🏰', r.settlements, 'settlements taken'], ['⚔️', r.battles, 'battles won'],
                ['🔥', r.wars, 'wars'], ['📜', r.quests, 'quests'], ['🎖️', r.titles, 'titles gained'],
                ['🕳️', r.delvesCleared, 'delves cleared'], ['🗡️', r.rivalsBested, 'rivals bested'], ['⚖️', r.petitionsRuled, 'petitions ruled'],
                ['👶', r.children, 'children born'], ['🏛️', r.ambitionMilestones, 'ambition milestones'],
            ].filter(x => x[1] > 0);
            if (deeds.length) html += `<div style="font-size:11px; color:#bbb; margin-top:2px;">${deeds.map(([i, v, l]) => `<span title="${l}">${i} ${v} ${l}</span>`).join(' · ')}</div>`;
            if (r.prestigeGained) html += `<div style="font-size:11px; color:#bbb;">⭐ ${r.prestigeGained > 0 ? '+' : ''}${r.prestigeGained} Prestige</div>`;
            for (const n of r.notableRulings || []) html += `<div style="font-size:11px; color:#aab;">⚖️ ${_esc(n.text)}</div>`;
            for (const h of r.highlights || []) html += `<div style="font-size:11px; color:#999;">· ${_esc(h.text)}</div>`;
            html += '</div>';
        }
        return html;
    },

    /** The line has ended: the House's epitaph and legacy score. */
    showEpitaph(game, cause = null) {
        const player = game.player;
        const e = Legacy.endDynasty(player, game.world, cause);
        let html = '<div style="max-height: 560px; overflow-y: auto; font-size: 12px; text-align:center;">';
        if (!e) {
            html += '<p>Without an heir, your story ends here.</p>';
        } else {
            html += `<div style="font-size:30px;">${e.sigil.icon || '🛡️'}</div>`;
            html += `<div style="font-weight:bold; color:var(--gold); font-size:16px;">${_esc(e.houseName)}</div>`;
            if (e.motto) html += `<div style="font-style:italic; color:#bbb;">&ldquo;${_esc(e.motto)}&rdquo;</div>`;
            html += `<div style="color:#ccc; margin:6px 0;">${e.generations} generation${e.generations === 1 ? '' : 's'} · ${e.years} years · ⭐ ${e.prestige} Prestige${e.crowns ? ` · 👑 ${e.crowns} crown${e.crowns === 1 ? '' : 's'}` : ''}</div>`;
            html += `<div style="font-size:22px; margin-top:6px;">${e.rank.icon}</div><div style="color:var(--gold); font-size:15px; font-weight:bold;">${_esc(e.rank.label)}</div>`;
            html += `<div style="color:#aaa;">Legacy score ${e.score}</div>`;
            if (e.line) html += `<div style="color:#c9b27a; font-style:italic; margin-top:4px;">${_esc(e.line)}</div>`;
            html += `<div style="text-align:left;">${ActionMenu._reignsHtml(e.reigns)}</div>`;
        }
        html += '<button onclick="location.reload();" style="width: 100%; padding: 12px; background: #a33; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; color: #fff; margin-top: 10px;">Start New Game</button>';
        html += '</div>';
        game.ui.showCustomPanel('🕯️ The Line Ends', html);
    },
});
