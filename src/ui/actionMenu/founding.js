// ActionMenu — Found a Village: settlers out of a town you hold (or one that
// agrees) walk to a site you pick on the map and found a village of yours.
//
//   showFoundVillage(game, q?, r?)    — the planner: whose people, how many, where, what it costs
//   foundVillageSource(game, q, r)    — settlers from this town
//   foundVillageSettlers(game, n)     — this many of them
//   foundVillagePick(game)            — step the panel aside; the next map click is the site
//   foundVillageSite(game, q, r)      — the survey of that site and the whole bill
//   foundVillageGo(game)              — send them (systems/founding.js dispatch)
//   foundVillageBudToggle(game)       — let your villages send out daughter parties, or not
//
// The logic: systems/founding.js (people, goods, coin) and
// world/villageFounding.js (survey, the walk, the village and its years).
import { ActionMenu } from './_ref.js';
import { Founding } from '../../systems/founding.js';
import { VillageFounding } from '../../world/villageFounding.js';
import { BTN_GOLD, BTN_DARK, BTN_PLAIN, lede, chips, purse, sectionHead, kv, card, rowList, price, esc } from './uiKit.js';

const PICK_BAR_ID = 'foundVillagePickBar';
const PART_LABELS = [['food', '🌾', 'Food'], ['water', '💧', 'Water'], ['timber', '🌲', 'Timber'], ['stone', '⛰️', 'Stone'], ['trade', '⚖️', 'Trade']];
const GOOD_ICON = { grain: '🌾', tools: '🔧', wood: '🌲' };

let _draft = null;

function _clearPreview(game) {
    if (game && game.renderer) game.renderer.roadPlan = null;
}

function _endPick(game) {
    if (!game) return;
    if (game._hexPick && game._hexPick._founding) game._hexPick = null;
    if (game._foundPickWas) {
        game.isProcessingTurn = game._foundPickWas.processing;
        if (game.camera && game._foundPickWas.following != null) game.camera.following = game._foundPickWas.following;
        game._foundPickWas = null;
    }
    const bar = typeof document !== 'undefined' && document.getElementById && document.getElementById(PICK_BAR_ID);
    if (bar) bar.remove();
}

function _stars(score) {
    return `<span style="color:#ffcf6a; letter-spacing:1px;">${Founding.stars(score)}</span>`;
}

function _partsHtml(parts) {
    return chips(PART_LABELS.map(([k, icon, label]) => [icon, label, `${_stars(parts[k])}`]));
}

function _readName() {
    const el = typeof document !== 'undefined' && document.getElementById && document.getElementById('foundVillageName');
    return el && typeof el.value === 'string' ? el.value : null;
}

/** The planner's draft for this game, kept while the panel is open */
function _ensureDraft(game, q, r) {
    const { player, world } = game;
    if (!_draft || _draft.world !== world) _draft = { world, src: null, n: 0, site: null, name: '', policy: 'coexistence' };
    if (Number.isFinite(q) && Number.isFinite(r)) {
        if (!_draft.src || _draft.src.q !== q || _draft.src.r !== r) { _draft.src = { q, r }; _draft.site = null; }
    }
    const sources = Founding.sources(player, world);
    if (!_draft.src || !sources.some(s => s.q === _draft.src.q && s.r === _draft.src.r)) {
        const first = sources.find(s => s.ok) || sources[0] || null;
        _draft.src = first ? { q: first.q, r: first.r } : null;
        _draft.site = null;
    }
    return sources;
}

Object.assign(ActionMenu, {
    /** The planner: whose people, how many, where, and what it costs. */
    showFoundVillage(game, q, r) {
        const { player, world } = game;
        const sources = _ensureDraft(game, q, r);
        const C = Founding.cfg();
        const minN = Number(C.minSettlers) || 10;
        let html = lede('Send settlers out to found a village of yours. They are real people leaving a real town: its numbers drop, their grain, tools and timber come from your packs or its market, and they walk to the site as one party. The village is your holding (in your realm, if you rule one), grows by the same rules as any village, and in time may become a town, and the seat of a realm.');
        html += chips([purse(player.gold), ['🏘️', 'You hold', `${(player.colonies || []).length} settlement(s)`]]);

        // Whose people
        if (!sources.length) {
            html += card('<div style="font-size:12px;">Settlers come from a town you hold, a town of a realm you rule, or the town you are standing in if its people will go with you. Go to a town first.</div>', { icon: '🏘️', title: 'No town to draw settlers from' });
            game.ui.showCustomPanel('🏘️ Found a Village', html);
            return;
        }
        html += rowList(sources.map(s => {
            const sel = _draft.src && _draft.src.q === s.q && _draft.src.r === s.r;
            return {
                icon: s.held ? '🏰' : '🏘️', name: `${esc(s.name)}${sel ? ' <small style="color:#ffcf6a;">· chosen</small>' : ''}`,
                desc: s.ok ? `${s.population} people · ${esc(s.terms || '')}` : '',
                off: !s.ok, why: `${s.population} people · ${esc(s.reason || '')}`,
                act: 'foundVillageSource', args: [s.q, s.r], side: s.ok ? `up to ${s.max}` : '', tone: sel ? 'gold' : '',
            };
        }), 'Settlers from');

        const src = _draft.src ? sources.find(s => s.q === _draft.src.q && s.r === _draft.src.r) : null;
        if (src && src.ok) {
            if (!_draft.n || _draft.n > src.max || _draft.n < minN) _draft.n = Math.max(minN, Math.min(src.max, 25));
            const opts = [...new Set([minN, 15, 20, 25, 30, 40, 50, src.max].filter(v => v >= minN && v <= src.max))].sort((a, b) => a - b);
            html += sectionHead(`How many go (${_draft.n})`);
            html += `<div style="display:flex; flex-wrap:wrap; gap:2px; margin-bottom:8px;">${opts.map(v => `<button data-am-act="foundVillageSettlers" data-am-args="[${v}]" style="${v === _draft.n ? BTN_GOLD : BTN_DARK}">${v}</button>`).join('')}</div>`;

            // Where
            const siteRows = [{ icon: '🗺️', name: 'Pick the site on the map', desc: 'Click any hex: it is surveyed (food, water, timber, stone, trade) before anything is spent.', act: 'foundVillagePick' }];
            const best = VillageFounding.bestSites(world, src, { player, maxRange: 10, limit: 5 });
            for (const b of best) {
                siteRows.push({
                    icon: '📍', name: `${esc(b.terrain)} · ${b.distance} hexes off`,
                    desc: PART_LABELS.map(([k, icon]) => `${icon}${Math.round(b.parts[k])}`).join(' '),
                    note: b.warnings.length ? esc(b.warnings[0]) : '',
                    act: 'foundVillageSite', args: [b.q, b.r], side: _stars(b.score),
                    tone: _draft.site && _draft.site.q === b.q && _draft.site.r === b.r ? 'gold' : '',
                });
            }
            html += rowList(siteRows, best.length ? `Where: good open ground near ${esc(src.name)}` : 'Where');

            if (_draft.site) html += ActionMenu._foundVillagePlanHtml(game, src);
        } else if (src) {
            html += card(`<div style="font-size:12px;">${esc(src.reason || 'No one can leave from here.')}</div>`, { icon: '⛔', title: esc(src.name), tone: 'bad' });
        }

        // Parties on the road
        const afield = VillageFounding.partiesAfield(world);
        if (afield.length) {
            html += rowList(afield.map(p => ({
                icon: '⛺', name: `${p.people} settlers out of ${esc(p.from || 'a town')}${p.name ? ` for ${esc(p.name)}` : ''}`,
                desc: `${p.bud ? 'A daughter party of your village' : 'Your party'} · about ${p.daysLeft} day(s) to go`,
            })), 'On the road');
        }

        // Daughters, and what it leads to
        const st = VillageFounding.state(player);
        html += rowList([{
            icon: '🌱', name: 'Let your villages found daughter villages',
            desc: `When a village you founded passes ${(C.bud && C.bud.minPopulation) || 400} people it may send a party of its own people out to found another (outside a realm you rule, where the realm does it).`,
            act: 'foundVillageBudToggle', side: st.bud === false ? 'off' : '✓ on', tone: st.bud === false ? '' : 'good',
        }], 'In the years after');
        const held = (player.colonies || []).length;
        html += `<div style="font-size:11px; color:#9d937c; margin:4px 0 0;">Hold three settlements and enough Prestige and you may proclaim a realm of your own with one of them as its seat (Claims & Crowns). You hold ${held}.</div>`;
        game.ui.showCustomPanel('🏘️ Found a Village', html);
    },

    /** The survey and the bill for the chosen site */
    _foundVillagePlanHtml(game, src) {
        const { player, world } = game;
        const plan = Founding.plan(player, world, src, _draft.site, _draft.n);
        const sv = plan.survey;
        if (game.renderer) {
            const route = plan.route || [src, sv];
            game.renderer.roadPlan = { segments: route.map((p, i) => ({ q: p.q, r: p.r, status: i === route.length - 1 ? (sv.ok ? 'build' : 'blocked') : 'has' })) };
        }
        let body = `<div style="font-size:12px; margin-bottom:4px;">${esc(sv.terrain || 'Open ground')} · ${sv.distance != null ? `${sv.distance} hexes from ${esc(src.name)}` : ''}${sv.nearest ? ` · nearest town ${esc(sv.nearest.name)} (${sv.nearest.d})` : ''}</div>`;
        body += _partsHtml(sv.parts);
        for (const w of plan.warnings) body += `<div style="font-size:11px; color:#f0b35a;">⚠️ ${esc(w)}</div>`;
        let html = card(body, { icon: '📍', title: 'The site', side: `${_stars(sv.score)} <small>${sv.score.toFixed(1)}</small>` });

        if (sv.ok) {
            let bill = kv('The walk', plan.route ? `${plan.route.length - 1} hexes · about ${plan.days} day(s)` : '—');
            bill += kv('Settlers', `${plan.people} of ${esc(src.name)}'s ${src.population} people`);
            for (const x of plan.supplies) {
                const parts = [];
                if (x.packs) parts.push(`${x.packs} from your packs`);
                if (x.market) parts.push(`${x.market} bought here at ${x.unit}g`);
                if (x.granary) parts.push(`${x.granary} out of the town granary at ${x.unit}g`);
                if (x.short) parts.push(`<span style="color:#e0846a;">${x.short} short</span>`);
                bill += kv(`${GOOD_ICON[x.id] || ''} ${esc(x.id)} (${x.need})`, `${parts.join(' · ') || '—'}${x.cost ? ` · ${price(x.cost)}` : ''}`);
            }
            bill += kv('Guides and carters', price(plan.fee));
            if (plan.purses) bill += kv('Settlers\' purses', `${price(plan.purses)} <small style="color:#9d937c;">(they carry it: the village's first coin)</small>`);
            bill += kv('In all', price(plan.total, plan.canPay));
            if (plan.inKind) bill += '<div style="font-size:11px; color:#9d937c;">This town barters: you pay in goods from your packs at their worth, and the settlers\' purses go with them as goods.</div>';
            html += card(bill, { icon: '🧾', title: 'The bill', side: price(plan.total, plan.canPay) });
            html += sectionHead('The village\'s name (blank: the settlers choose)');
            html += `<input type="text" id="foundVillageName" maxlength="40" value="${esc(_draft.name || '')}" placeholder="Leave blank to let them name it" style="width:100%; box-sizing:border-box; padding:7px 10px; background:rgba(0,0,0,0.3); color:#ece2c8; border:1px solid rgba(245,197,66,0.22); border-radius:6px; font-size:13px; margin-bottom:6px;">`;
            html += rowList([plan.ok
                ? { icon: '⛺', name: `Send ${plan.people} settlers`, desc: 'They set out from the town tomorrow and found the village when they arrive.', act: 'foundVillageGo', side: price(plan.total, true), tone: 'gold' }
                : { icon: '⛺', name: `Send ${plan.people} settlers`, off: true, why: esc(plan.reasons[0] || 'Not yet'), side: price(plan.total, plan.canPay) }]);
        } else {
            html += card(plan.survey.reasons.map(r => `<div style="font-size:12px;">⛔ ${esc(r)}</div>`).join(''), { icon: '⛔', title: 'Not here', tone: 'bad' });
        }
        html += rowList([{ icon: '🗺️', name: 'Pick another site', act: 'foundVillagePick' }]);
        return html;
    },

    foundVillageSource(game, q, r) {
        _ensureDraft(game);
        _draft.src = { q, r };
        _draft.site = null;
        _clearPreview(game);
        ActionMenu.showFoundVillage(game);
    },

    foundVillageSettlers(game, n) {
        _ensureDraft(game);
        const name = _readName();
        if (name !== null) _draft.name = name;
        _draft.n = Math.max(1, Math.floor(Number(n) || 0));
        ActionMenu.showFoundVillage(game);
    },

    foundVillageSite(game, q, r) {
        _ensureDraft(game);
        const t = game.world.getTile(q, r);
        _draft.site = t ? { q: t.q, r: t.r } : null;
        ActionMenu.showFoundVillage(game);
    },

    /** Step the panel aside and take the next map click as the site. */
    foundVillagePick(game) {
        _ensureDraft(game);
        const name = _readName();
        if (name !== null) _draft.name = name;
        game._foundPickWas = { processing: !!game.isProcessingTurn, following: game.camera ? game.camera.following : null };
        const cancel = () => { _endPick(game); ActionMenu.showFoundVillage(game); };
        game._hexPick = {
            _founding: true,
            onPick: (q, r) => { _endPick(game); ActionMenu.foundVillageSite(game, q, r); },
            onCancel: cancel,
        };
        game.isProcessingTurn = true;
        if (game.camera) game.camera.following = false;
        _clearPreview(game);
        game.ui.hideCustomPanel();
        if (typeof document === 'undefined' || !document.body || !document.createElement) return;
        let bar = document.getElementById(PICK_BAR_ID);
        if (!bar) {
            bar = document.createElement('div');
            bar.id = PICK_BAR_ID;
            bar.style.cssText = 'position:fixed;left:0;right:0;top:64px;display:flex;justify-content:center;pointer-events:none;z-index:900;';
            document.body.appendChild(bar);
        }
        bar.innerHTML = '<div style="pointer-events:auto;max-width:calc(96vw / var(--ui-zoom, 1));background:rgba(18,20,28,0.94);border:1px solid rgba(245,197,66,0.45);border-radius:10px;padding:8px 12px;box-shadow:0 6px 24px rgba(0,0,0,0.5);font-size:12px;color:var(--text-primary);display:flex;gap:10px;align-items:center;">'
            + '<strong style="color:var(--gold);">🏘️ Click where the village should stand</strong>'
            + '<span style="color:#9d937c;">open land, on the same shore, not too near a town · drag to look around · Esc to cancel</span>'
            + `<button onclick="window._foundPickCancel()" style="${BTN_PLAIN}">Cancel</button></div>`;
        window._foundPickCancel = cancel;
    },

    /** Send them. */
    foundVillageGo(game) {
        const { player, world } = game;
        _ensureDraft(game);
        if (!_draft.src || !_draft.site) return;
        const name = _readName();
        if (name !== null) _draft.name = name;
        // Check before the AP is spent: a refusal costs nothing
        const plan = Founding.plan(player, world, _draft.src, _draft.site, _draft.n);
        if (!plan.ok) {
            game.ui.showNotification('Cannot Send Settlers', esc(plan.reasons[0] || 'Not yet'), 'error');
            return;
        }
        if (ActionMenu.commitPendingAP && !ActionMenu.commitPendingAP(game)) return;
        const res = Founding.dispatch(player, world, _draft.src, _draft.site, _draft.n, { name: _draft.name, policy: _draft.policy });
        if (!res.success) {
            game.ui.showNotification('Cannot Send Settlers', esc(res.reason || 'Not yet'), 'error');
            return;
        }
        _clearPreview(game);
        game.ui.showNotification('⛺ Settlers Set Out',
            `${res.plan.people} settlers leave ${esc(res.plan.source.name)} with ${Object.entries(res.unit.inventory).map(([k, v]) => `${v} ${k}`).join(', ')}. About ${res.plan.days} day(s) on the road; ${res.paid}g spent.`, 'success');
        _draft.site = null;
        _draft.name = '';
        game.ui.hideCustomPanel();
        game.ui.updateStats(player, world);
    },

    foundVillageBudToggle(game) {
        const st = VillageFounding.state(game.player);
        st.bud = st.bud === false;
        ActionMenu.showFoundVillage(game);
    },
});
