// ActionMenu — afterlife: when the player dies, a new life as someone else in
// the world, or the interregnum — the world turning on without them (a bar
// to let days, months or years pass) until they jump back in as an heir come
// of age or as someone new. Logic lives in player/afterlife.js; these panels
// present it.
import { ActionMenu } from './_ref.js';
import { Relationships, InnerMapRenderer, SaveLoad, InnerMap } from './_imports.js';
import { Afterlife } from '../../player/afterlife.js';
import { EstateSettlement } from '../../player/estateSettlement.js';
import { Cultures } from '../../world/cultures.js';
import { LlmProse } from '../../systems/llmProse.js';
import { HallChronicles } from '../hallChronicles.js';
import { ChronicleBookExport } from '../chronicleBook.js';
import { BTN_GOLD, BTN_PLAIN, sectionHead, lede, chips, card, actRow, rowList } from './uiKit.js';

const BAR_ID = 'interregnumBar';
// The bars float over the map, outside the custom panel: the kit's buttons, inline
const BTN = BTN_PLAIN;
const TITLE = 'text-align:center; font-family:var(--font-display); font-size:18px; font-weight:600; letter-spacing:0.5px; color:#ffe9a8; margin:2px 0 10px;';
const FIELD = 'padding:6px 8px;border-radius:6px;border:1px solid rgba(245,197,66,0.18);background:rgba(0,0,0,0.35);color:#ece2c8;font-size:12px;font-family:var(--font-body);';

function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

/** One person to become, as a row: the whole row is "Become …" (window._afterlifeBecome(i)). */
function _candidateCard(c, i) {
    const icon = c.gender === 'female' ? '👩' : '🧑';
    let note = '';
    if (c.newcomer) {
        const tongue = c.native ? Cultures.languageName(c.native) : null;
        note = `<span style="color:#c9b27a;">🧳 Just arrived${c.newcomer.from ? ` from ${_esc(c.newcomer.from)}` : ''}${c.newcomer.culture ? ` · ${_esc(c.newcomer.culture)}` : ''}${tongue ? `, speaking ${_esc(tongue)}` : ''}. A stranger here.</span>`;
    } else if (c.kin) {
        note = `<span style="color:#9d937c;">Family here: ${_esc(c.kin)}</span>`;
    }
    return actRow({
        icon,
        name: `${_esc(c.first)} ${_esc(c.last)}`,
        desc: `${_esc(c.title)}, aged ${c.age} · ${_esc(c.town)} (${_esc(c.townType)})${c.kingdom ? ` in ${_esc(c.kingdom)}` : ', beholden to no crown'}${c.folkId != null ? ' · <span title="Someone of this town\'s own people">a townsperson</span>' : ''}`,
        note,
        attrs: `onclick="window._afterlifeBecome(${i})"`,
        title: `Become ${c.first}`,
        side: `<span class="pk-price">${c.gold}<small>g</small></span><br><span style="font-size:10.5px; color:#9d937c;">Become ${_esc(c.first)} ›</span>`,
    });
}

/** The parts of a town's line: its name, and "town of 2,400 · Imperial, speaking Old Imperial · capital of Aster". */
function _townParts(t) {
    const kind = t.type === 'clan' ? `wandering clan of ${t.population}` : `${t.type === 'capital' ? 'city' : _esc(t.type)} of ${Number(t.population).toLocaleString()}`;
    const tongue = t.languageName ? `, speaking ${_esc(t.languageName)}` : '';
    const realm = t.kingdom ? `${t.capital ? 'capital of' : 'in'} ${_esc(t.kingdom)}` : (t.type === 'clan' ? 'roaming the wilds' : 'beholden to no crown');
    const folk = t.folk ? ` · <span title="Grown townspeople you may have heard of">${t.folk} known folk</span>` : '';
    return { name: `${t.capital ? '👑 ' : ''}${_esc(t.name)}`, desc: `${kind} · ${t.culture ? _esc(t.culture) : 'of no known people'}${tongue} · ${realm}${folk}` };
}

/** "Riverford · town of 2,400 · Imperial, speaking Old Imperial · capital of Aster" */
function _townLine(t) {
    const p = _townParts(t);
    return `<strong>${p.name}</strong> <span style="color:#cbbf9f;">· ${p.desc}</span>`;
}

/** The settlement list, filtered by `state.query` and sorted by `state.sort` ('realm' groups under headings). */
function _townListHtml(towns, state) {
    const q = String(state.query || '').trim().toLowerCase();
    let list = !q ? towns.slice() : towns.filter(t => [t.name, t.kingdom, t.culture, t.languageName, t.type]
        .some(v => v && String(v).toLowerCase().includes(q)));
    if (state.sort === 'size') list.sort((a, b) => b.population - a.population);
    else if (state.sort === 'name') list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (!list.length) return '<p style="color:#9d937c;">No settlement by that name.</p>';
    const groupOf = (o) => o.kingdom || (o.type === 'clan' ? 'Wandering clans' : 'Free lands');
    const row = (t) => {
        const p = _townParts(t);
        return { icon: t.type === 'clan' ? '⛺' : t.capital ? '🏰' : '🏘️', name: p.name, desc: p.desc, attrs: `onclick="window._afterlifeTown('${_esc(t.id)}')"`, side: '›' };
    };
    if (state.sort !== 'realm') return rowList(list.map(row));
    let html = '';
    const groups = [];
    for (const t of list) {
        const g = groupOf(t);
        let entry = groups.find(x => x.g === g);
        if (!entry) groups.push(entry = { g, towns: [] });
        entry.towns.push(t);
    }
    for (const { g, towns: inG } of groups) html += rowList(inG.map(row), `${_esc(g)} <span style="color:#9d937c; letter-spacing:0;">(${inG.length})</span>`);
    return html;
}

/** Leave the new-life panels: to the deathbed, or to the interregnum's Jump In. */
function _backFromNewLife(game, fromDeath, cause) {
    if (fromDeath) ActionMenu.showDeathScreen(game, cause);
    else ActionMenu.showJumpIn(game);
}

/** Become `cand` (a random one or one of a chosen town) and hand the game over. */
function _become(game, cand, fromDeath, cause) {
    if (!cand) return;
    const world = game.world;
    // A town chosen may be gone: refuse before the old life is closed
    const tile = world.getTile(cand.q, cand.r);
    if (!(cand.dawn && cand.dawn.clanId != null) && !(tile && tile.settlement && tile.settlement.population > 0)) {
        game.ui.showNotification('Cannot', `${cand.town || 'That town'} is no more.`, 'error');
        return;
    }
    // Leaving straight from the death screen: the reign is filed with its cause first
    if (fromDeath) Afterlife.begin(game.player, world, cause);
    const old = game.player;
    const res = Afterlife.becomeStranger(old, world, cand);
    if (!res.success) {
        game.ui.showNotification('Cannot', res.reason || 'Something went wrong.', 'error');
        return;
    }
    // The old House ended here, as on the epitaph: its chronicle book is kept
    // with its Hall of Houses entry (ui/hallChronicles.js; optional), and the
    // welcome offers it to save (the old House is gone once the game moves on)
    if (old && old.house) {
        res.oldPlayer = old;
        if (world.run) HallChronicles.archive(game, { player: old });
    }
    ActionMenu._afterlifeTakeOver(game, res.player);
    ActionMenu._showNewLifeWelcome(game, cand, res);
}

const PICK_BAR_ID = 'newLifePickBar';

/**
 * Pick the new life's settlement on the world map: the panel steps aside, a
 * bar says what to do, and the next map click on a settlement (or, at the
 * dawn, a clan) opens its people. Escape or Cancel goes back to the list.
 * No day can end while picking.
 */
function _pickOnMap(game, cause, listState) {
    const wasFollowing = game.camera ? game.camera.following : null;
    const wasProcessing = !!game.isProcessingTurn;
    const done = () => {
        game._hexPick = null;
        game.isProcessingTurn = wasProcessing;
        if (game.camera && wasFollowing != null) game.camera.following = wasFollowing;
        const bar = document.getElementById(PICK_BAR_ID);
        if (bar) bar.remove();
    };
    const cancel = () => {
        done();
        ActionMenu.showNewLifeTowns(game, cause, listState || {});
    };
    game._hexPick = {
        onPick: (q, r) => {
            const at = Afterlife.townChoiceAt(game.world, q, r);
            if (!at) {
                game.ui.showNotification('🏘️ Not there', 'Click a town or village on the map (or Cancel).', 'default');
                return;
            }
            done();
            ActionMenu.showNewLifeAt(game, at, 0, cause, listState);
        },
        onCancel: cancel,
    };
    game.isProcessingTurn = true;
    if (game.camera) game.camera.following = false;
    game.ui.hideCustomPanel();
    let bar = document.getElementById(PICK_BAR_ID);
    if (!bar) {
        bar = document.createElement('div');
        bar.id = PICK_BAR_ID;
        bar.style.cssText = 'position:fixed;left:0;right:0;top:64px;display:flex;justify-content:center;pointer-events:none;z-index:900;';
        document.body.appendChild(bar);
    }
    bar.innerHTML = '<div style="pointer-events:auto;max-width:calc(96vw / var(--ui-zoom, 1));background:rgba(18,20,28,0.94);border:1px solid rgba(245,197,66,0.45);border-radius:10px;padding:8px 12px;box-shadow:0 6px 24px rgba(0,0,0,0.5);font-size:12px;color:var(--text-primary);display:flex;gap:10px;align-items:center;">'
        + '<strong style="color:var(--gold);">🗺️ Click the settlement your new life begins in</strong>'
        + `<span style="color:#9d937c;">drag to look around · Esc to cancel</span>`
        + `<button onclick="window._afterlifePickCancel()" style="${BTN}">Cancel</button></div>`;
    window._afterlifePickCancel = cancel;
}

Object.assign(ActionMenu, {
    // ── A new life ──────────────────────────────────────

    /**
     * Pick someone in the world to become. `cause` is the death being
     * left behind (from the death screen); `reroll` asks for other people.
     */
    showNewLife(game, reroll = 0, cause = null) {
        const world = game.world;
        const fromDeath = !Afterlife.active(game.player);
        const people = Afterlife.candidates(world, reroll);
        let html = '<div style="font-size:12px;">';
        html += lede('Become someone living in the world now. Your House ends with its chronicle; what it held passes to the crowns and towns. You keep only what you see on the map.');
        if (!people.length) html += '<p style="color:#9d937c;">No one could be found.</p>';
        html += rowList(people.map((c, i) => _candidateCard(c, i)), 'Someone to become');
        // Or begin in a place of your own choosing (ActionMenu.showNewLifeTowns)
        html += rowList([
            { icon: '🏘️', name: 'Choose a settlement', desc: 'Begin a life in the town of your choice', attrs: 'onclick="window._afterlifeChooseTown()"', side: '›' },
            { icon: '🎲', name: 'Other people', attrs: 'onclick="window._afterlifeReroll()"' },
            { icon: '←', name: 'Back', attrs: 'onclick="window._afterlifeBack()"' },
        ], 'Or');
        html += '</div>';
        // From the death screen there is no going back to the game: only ← Back
        game.ui.showCustomPanel('🎭 A New Life', html, { locked: fromDeath });

        window._afterlifeReroll = () => ActionMenu.showNewLife(game, reroll + 1, cause);
        window._afterlifeChooseTown = () => ActionMenu.showNewLifeTowns(game, cause);
        window._afterlifeBack = () => _backFromNewLife(game, fromDeath, cause);
        window._afterlifeBecome = (i) => _become(game, people[i], fromDeath, cause);
    },

    /**
     * Choose where the new life begins: every living settlement, searchable,
     * grouped by realm (or sorted by size or name), with its size, culture and
     * tongue — or picked by clicking it on the world map.
     * `opts`: { query, sort } to reopen as it was left.
     */
    showNewLifeTowns(game, cause = null, opts = {}) {
        const world = game.world;
        const fromDeath = !Afterlife.active(game.player);
        const towns = Afterlife.townChoices(world);
        const state = { query: opts.query || '', sort: opts.sort || 'realm' };
        const dawn = towns.some(t => t.type === 'clan');
        let html = '<div style="font-size:12px;">';
        html += lede(`Pick the ${dawn ? 'clan or village' : 'town or village'} your new life begins in. You will be offered some of its own people, and someone just arriving there.`);
        html += '<div style="display:flex;gap:6px;margin-bottom:6px;">';
        html += `<input id="newLifeTownSearch" type="text" placeholder="Search by name, realm or culture…" value="${_esc(state.query)}" style="flex:1;min-width:0;${FIELD}">`;
        html += `<select id="newLifeTownSort" style="${FIELD}padding:6px;">`;
        for (const [v, label] of [['realm', 'By realm'], ['size', 'Largest first'], ['name', 'By name']]) html += `<option value="${v}"${state.sort === v ? ' selected' : ''}>${label}</option>`;
        html += '</select></div>';
        html += `<div id="newLifeTownList" style="max-height:440px;overflow-y:auto;">${_townListHtml(towns, state)}</div>`;
        const foot = [];
        // The world map takes the click (ui/game/gameLoop.js handleClick, game._hexPick)
        if (!InnerMap.active && game.renderer) foot.push({ icon: '🗺️', name: 'Pick on the map', attrs: 'onclick="window._afterlifePickOnMap()"' });
        foot.push({ icon: '←', name: 'Back', attrs: 'onclick="window._afterlifeTownsBack()"' });
        html += rowList(foot);
        html += '</div>';
        game.ui.showCustomPanel('🏘️ Where the New Life Begins', html, { locked: fromDeath });

        const redraw = () => {
            const list = typeof document !== 'undefined' && document.getElementById('newLifeTownList');
            if (list) list.innerHTML = _townListHtml(towns, state);
        };
        const search = typeof document !== 'undefined' && document.getElementById('newLifeTownSearch');
        if (search) search.addEventListener('input', () => { state.query = search.value; redraw(); });
        const sort = typeof document !== 'undefined' && document.getElementById('newLifeTownSort');
        if (sort) sort.addEventListener('change', () => { state.sort = sort.value; redraw(); });

        window._afterlifeTown = (id) => {
            const at = towns.find(t => t.id === id);
            if (at) ActionMenu.showNewLifeAt(game, at, 0, cause, state);
        };
        window._afterlifePickOnMap = () => _pickOnMap(game, cause, state);
        window._afterlifeTownsBack = () => ActionMenu.showNewLife(game, 0, cause);
    },

    /** The people of one chosen place (`at`: an Afterlife.townChoices entry) to become. */
    showNewLifeAt(game, at, reroll = 0, cause = null, listState = null) {
        const world = game.world;
        const fromDeath = !Afterlife.active(game.player);
        const people = Afterlife.candidatesAt(world, at, reroll);
        let html = '<div style="font-size:12px;">';
        html += lede(_townLine(at));
        if (!people.length) html += `<p style="color:#9d937c;">No one could be found in ${_esc(at.name)}: it may be no more. Choose another place.</p>`;
        html += rowList(people.map((c, i) => _candidateCard(c, i)), 'Someone to become');
        const foot = [];
        if (people.length) foot.push({ icon: '🎲', name: 'Other people', attrs: 'onclick="window._afterlifeRerollAt()"' });
        foot.push({ icon: '🏘️', name: 'Another settlement', attrs: 'onclick="window._afterlifeOtherTown()"' });
        foot.push({ icon: '←', name: 'Back', attrs: 'onclick="window._afterlifeBackAt()"' });
        html += rowList(foot, 'Or');
        html += '</div>';
        game.ui.showCustomPanel(`🎭 A New Life in ${at.name}`, html, { locked: fromDeath });

        window._afterlifeRerollAt = () => ActionMenu.showNewLifeAt(game, at, reroll + 1, cause, listState);
        window._afterlifeOtherTown = () => ActionMenu.showNewLifeTowns(game, cause, listState || {});
        window._afterlifeBackAt = () => ActionMenu.showNewLife(game, 0, cause);
        window._afterlifeBecome = (i) => _become(game, people[i], fromDeath, cause);
    },

    /**
     * An heirless estate settled (player/estateSettlement.js): the chronicle
     * line and what it held, who was paid, what went unpaid, where the rest went.
     */
    _estateHtml(world, rec) {
        if (!rec) return '';
        let body = `<div style="color:#c9b27a; font-style:italic;">${_esc(EstateSettlement.line(world, rec))}</div>`;
        const rows = EstateSettlement.breakdown(rec);
        if (rows.length) {
            body += '<table style="width:100%; border-collapse:collapse; font-size:11.5px; margin-top:6px;">';
            for (const r of rows) {
                const c = r.tone === 'bad' ? '#e0846a' : r.tone === 'gold' ? '#ffcf6a' : '#cbbf9f';
                body += `<tr><td style="padding:2px 0; color:#9d937c;">${_esc(r.label)}</td><td style="padding:2px 0; text-align:right; color:${c};">${r.value < 0 ? '−' : ''}${Math.abs(r.value).toLocaleString('en-US')}g</td></tr>`;
            }
            body += '</table>';
        }
        if (rec.runs && rec.runs.length) body += `<div style="color:#e0846a; margin-top:4px;">The loss starts a run on ${rec.runs.map(_esc).join(' and ')}.</div>`;
        if (rec.bank) body += `<div style="color:#9d937c; margin-top:4px;">${_esc(rec.bank)} passes to its partners.</div>`;
        return card(body, { icon: '⚖️', title: 'The Estate Settled' });
    },

    _showNewLifeWelcome(game, cand, res) {
        const p = res.player;
        let html = '<div style="font-size:12px;">';
        html += `<div style="${TITLE}">${_esc(p.name)}</div>`;
        if (cand.newcomer) {
            html += lede(`You are ${_esc(p.name)}, ${_esc(cand.title.toLowerCase())}, aged ${p.age}, newly come to ${_esc(cand.town)}${cand.kingdom ? ` in ${_esc(cand.kingdom)}` : ''}${cand.newcomer.from ? ` from ${_esc(cand.newcomer.from)}` : ''}, with ${p.gold} gold to your name.`);
            if (p.nativeLanguage) html += `<p style="font-size:12px;color:#c9b27a;">You speak ${_esc(Cultures.languageName(p.nativeLanguage))}; the folk here may not.</p>`;
        } else {
            html += lede(`You are ${_esc(p.name)}, ${_esc(cand.title.toLowerCase())} of ${_esc(cand.town)}${cand.kingdom ? ` in ${_esc(cand.kingdom)}` : ''}, aged ${p.age}, with ${p.gold} gold to your name.`);
        }
        // Born at the dawn: a family of the clan (player/dawnBirth.js)
        if (res.kin) html += `<p style="font-size:12.5px;color:#c9b27a;">You were born to the clan, and your kin are with you: ${_esc(res.kin)}. Their pot is yours when your packs are empty — pay it back.</p>`;
        const e = res.epitaph;
        if (e) {
            let body = `<div style="color:#c9b27a;">${e.sigil && e.sigil.icon ? e.sigil.icon : '🛡️'} The line of ${_esc(e.houseName)} has ended: ${_esc(e.rank.label)} (legacy ${e.score}).</div>`;
            // Its epitaph: the court scribe's once written (systems/llmProse.js), else the plain one
            if (e.proseKey) {
                const ep = LlmProse.text(game.world, e.proseKey, e.prose || '');
                if (ep) body += `<div style="color:#e8dcc0;font-family:Georgia,serif;font-style:italic;margin-top:4px;">${_esc(ep)}</div>`;
            }
            const x = res.escheat || {};
            const parts = [];
            if (x.estates) parts.push(_plural(x.estates, 'estate'));
            if (x.properties) parts.push(_plural(x.properties, 'building'));
            if (x.works) parts.push(_plural(x.works, 'work'));
            if (x.leases) parts.push(_plural(x.leases, 'lease'));
            if (x.farms) parts.push(_plural(x.farms, 'tax farm'));
            if (x.colonies) parts.push(_plural(x.colonies, 'colony'));
            if (parts.length) body += `<div style="color:#9d937c;margin-top:4px;">What it held (${parts.join(', ')}) passed to the crowns and towns.</div>`;
            html += card(body);
        }
        if (res.estate) html += ActionMenu._estateHtml(game.world, res.estate);
        html += `<button data-am-act="closePanelAndRefresh" style="${BTN_GOLD}display:block;width:100%;margin-top:8px;padding:10px;font-size:14px;">Begin a New Life</button>`;
        // The old line's book goes with the new life as "Before" (systems/annals.js)
        const rows = [];
        if (Array.isArray(p.annalsPast) && p.annalsPast.length) {
            rows.push({ icon: '📖', name: 'Read the Annals of the life you left', attrs: 'onclick="window._newLifeAnnals()"' });
        }
        // ...and its illustrated chronicle, to keep (ui/chronicleBook.js), as any ended House's
        const oldHouse = res.oldPlayer && res.oldPlayer.house;
        if (oldHouse) {
            rows.push({ icon: '📜', name: `Save the chronicle of ${_esc(oldHouse.name || 'the House')}`, desc: 'The illustrated book of the line you left: arms, maps, the family tree', attrs: 'onclick="window._newLifeChronicle()"' });
        }
        if (rows.length) html += rowList(rows);
        html += '</div>';
        game.ui.showCustomPanel('🎭 A New Life', html);
        window._newLifeChronicle = () => {
            if (!res.oldPlayer) return;
            ChronicleBookExport.exportBook({ player: res.oldPlayer, world: game.world }).then(
                (r) => { if (r && r.ok) game.ui.showNotification('📜 The Chronicle', r.path ? `Saved to ${r.path}` : 'The chronicle of the line you left is saved.', 'success'); },
                () => game.ui.showNotification('📜 The Chronicle', 'The chronicle could not be saved.', 'warning'),
            );
        };
        window._newLifeAnnals = () => ActionMenu.showAnnals(game, { chapter: `before${p.annalsPast.length - 1}`, onBack: () => ActionMenu._showNewLifeWelcome(game, cand, res), backLabel: '← Back' });
    },

    /** Hand the game to `player` (a new life, or an heir after the wait). */
    _afterlifeTakeOver(game, player) {
        ActionMenu.stopInterregnum(game);
        if (typeof InnerMapRenderer !== 'undefined' && InnerMapRenderer.clearDeathAnimation) InnerMapRenderer.clearDeathAnimation();
        player._isDead = false;
        game.player = player;
        if (game.renderer) {
            game.renderer.setPlayer(player);
            game.renderer.selectedHex = null;
            game.renderer.reachableHexes = player.getReachableHexes(game.world);
        }
        if (game.camera) game.camera.following = true;
        if (typeof game.recenterCamera === 'function') game.recenterCamera();
        if (game.minimap && game.minimap.invalidate) game.minimap.invalidate();
        game.ui.hideCustomPanel();
        game.ui.updateStats(player, game.world);
    },

    // ── The interregnum ─────────────────────────────────

    /** From the death screen: let the world turn on without the player. */
    beginInterregnum(game, cause = null) {
        const begun = Afterlife.begin(game.player, game.world, cause);
        game.ui.hideCustomPanel();
        if (game.camera) game.camera.following = false;
        if (game.renderer) game.renderer.reachableHexes = null;
        ActionMenu.renderInterregnumBar(game);
        const left = [];
        if (begun.disbanded) left.push(`${_plural(begun.disbanded, 'soldier')} of your army drift home`);
        if (begun.companions) left.push(`your companions go their own ways`);
        if (begun.estate) game.ui.showNotification('⚖️ The Estate Settled', EstateSettlement.line(game.world, begun.estate), 'info');
        game.ui.showNotification('⏳ The World Turns', `The world goes on without you${left.length ? `: ${left.join(', and ')}` : ''}. Let time pass, and jump back in when you will.`, 'info');
    },

    /** Draw (or redraw) the interregnum bar at the foot of the screen. */
    renderInterregnumBar(game) {
        const player = game.player;
        if (!Afterlife.active(player)) { ActionMenu.stopInterregnum(game); return; }
        let wrap = document.getElementById(BAR_ID);
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = BAR_ID;
            // Under the title bar, clear of the turn panel and the side panels
            wrap.style.cssText = 'position:fixed;left:0;right:0;top:64px;display:flex;justify-content:center;pointer-events:none;z-index:900;';
            document.body.appendChild(wrap);
        }
        const it = player.interregnum;
        const world = game.world;
        const Y = Relationships._getHeirSettings().daysPerYear || 120;
        const years = Afterlife.yearsWaited(player, world);
        const days = world.day - it.since;
        const ready = Afterlife.heirsReady(player);
        const next = Afterlife.futureHeirs(player)[0];
        let heirLine;
        if (ready.length) heirLine = `<span style="color:#7fd07f;">👑 ${ready.map(c => _esc(c.firstName)).join(', ')} ${ready.length === 1 ? 'is' : 'are'} of age</span>`;
        else if (next) heirLine = `👶 ${_esc(next.child.firstName)} comes of age in ${_plural(next.years, 'year')}`;
        else if (Afterlife.cadetsReady(player).length) heirLine = `<span style="color:#a8d68a;">🌿 ${_esc(Afterlife.cadetsReady(player)[0].name)} could take up the mantle</span>`;
        else heirLine = '<span style="color:#aaa;">No heir of the blood remains</span>';
        const busy = game._afterlifeBusy;
        const auto = !!game._afterlifeAuto;
        const steps = [['1 day', 1], ['1 week', 7], ['1 month', 30], ['1 season', Math.round(Y / 4)], ['1 year', Y], ['5 years', Y * 5], ['10 years', Y * 10]];

        let html = '<div style="pointer-events:auto;max-width:calc(96vw / var(--ui-zoom, 1));background:rgba(18,20,28,0.94);border:1px solid rgba(245,197,66,0.45);border-radius:10px;padding:8px 12px;box-shadow:0 6px 24px rgba(0,0,0,0.5);font-size:12px;color:var(--text-primary);">';
        html += '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;justify-content:space-between;margin-bottom:6px;">';
        html += `<div><strong style="color:var(--gold);">⏳ The world turns without you</strong> <span style="color:#aaa;">· Day ${world.day} · ${years ? `${_plural(years, 'year')}` : _plural(days, 'day')} since ${_esc(it.name)} died</span></div>`;
        html += `<div>${heirLine}</div>`;
        html += '</div>';
        html += '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">';
        if (busy) {
            html += `<span style="color:#ddd;">Passing… ${busy.total - busy.left}/${busy.total} days</span>`;
            html += `<button onclick="window._afterlifeStop()" style="${BTN}">⏹ Stop</button>`;
        } else {
            for (const [label, n] of steps) html += `<button onclick="window._afterlifePass(${n})" style="${BTN}" ${auto ? 'disabled' : ''}>+${label}</button>`;
            html += `<button onclick="window._afterlifeAuto()" style="${BTN}">${auto ? '⏸ Pause' : '▶ Let it run'}</button>`;
        }
        html += `<button onclick="window._afterlifeJumpIn()" style="${BTN_GOLD}">🧭 Jump In</button>`;
        html += '</div>';
        if (game._afterlifeNews) html += `<div style="margin-top:6px;color:#bbb;font-size:11px;">${game._afterlifeNews}</div>`;
        html += '</div>';
        wrap.innerHTML = html;

        window._afterlifePass = (n) => ActionMenu.passInterregnumDays(game, n);
        window._afterlifeStop = () => { if (game._afterlifeBusy) game._afterlifeBusy.stop = true; };
        window._afterlifeAuto = () => {
            if (game._afterlifeAuto) {
                clearInterval(game._afterlifeAuto);
                game._afterlifeAuto = null;
            } else {
                game._afterlifeAuto = setInterval(() => {
                    if (!Afterlife.active(game.player)) { ActionMenu.stopInterregnum(game); return; }
                    if (!game._afterlifeBusy) ActionMenu.passInterregnumDays(game, 1);
                }, Afterlife.config().autoPlayMs);
            }
            ActionMenu.renderInterregnumBar(game);
        };
        window._afterlifeJumpIn = () => ActionMenu.showJumpIn(game);
    },

    /** Take down the bar and stop any running time. */
    stopInterregnum(game) {
        if (game._afterlifeAuto) clearInterval(game._afterlifeAuto);
        game._afterlifeAuto = null;
        if (game._afterlifeBusy) game._afterlifeBusy.stop = true;
        const el = document.getElementById(BAR_ID);
        if (el) el.remove();
    },

    /**
     * Let `n` days pass, a few per frame so the map keeps drawing; the bar
     * shows progress and can stop it. Heirs coming of age and the great
     * events of the world are reported at the end.
     */
    passInterregnumDays(game, n) {
        if (game._afterlifeBusy || !Afterlife.active(game.player)) return;
        const busy = game._afterlifeBusy = { left: Math.max(1, Math.floor(n)), total: Math.max(1, Math.floor(n)), stop: false, events: [], cameOfAge: [] };
        game.isProcessingTurn = true;
        // (as many days a frame as fit in FRAME_MS — the map and the bar still move, Stop is
        // heard — and a long wait runs as the distant years: player/afterlife.js passDay)
        const FRAME_MS = 40;
        const distant = Afterlife.isDistant(busy.total);
        const fromDay = game.world.day;
        const finish = () => {
            game._afterlifeBusy = null;
            game.isProcessingTurn = false;
            // The autosave the daily turn would have made (ui/game/endDay.js), once if the
            // wait crossed an autosave day — years of "let it run" are not lost to a crash
            const every = SaveLoad.AUTO_SAVE_INTERVAL;
            // (an Ironman run saves after every wait: ui/game/ironman.js)
            if (SaveLoad.isIronman(game) || (every > 0 && Math.floor(game.world.day / every) > Math.floor(fromDay / every))) {
                try {
                    const res = SaveLoad.saveGame(game);
                    if (res && res.success && !SaveLoad.isIronman(game)) game.ui.showNotification('Auto-Saved', 'Game progress saved', 'default');
                } catch (err) {
                    console.error('[Afterlife] autosave failed', err);
                }
            }
            if (game.minimap && game.minimap.invalidate) game.minimap.invalidate();
            game.ui.updateStats(game.player, game.world);
            for (const c of busy.cameOfAge) {
                const child = c.child || c;
                if (child && child.firstName) game.ui.showNotification('👑 Of Age', `${child.firstName} has come of age and may take up the mantle. Jump in when you will.`, 'success');
            }
            const named = busy.events.filter(ev => ev && ev.name);
            if (named.length) {
                const last = named[named.length - 1];
                game._afterlifeNews = `📜 ${_esc(last.icon || '')} ${_esc(last.name)}${named.length > 1 ? ` — and ${_plural(named.length - 1, 'other event')} while you waited` : ''}`;
                if (busy.total <= 7) for (const ev of named.slice(-2)) game.ui.showNotification(`${ev.icon || '📜'} ${ev.name}`, ev.description || 'News from across the realms.', 'info');
            }
            ActionMenu.renderInterregnumBar(game);
        };
        const step = () => {
            if (game._afterlifeBusy !== busy) return;
            try {
                const t0 = performance.now();
                for (let i = 0; busy.left > 0 && !busy.stop && (i === 0 || performance.now() - t0 < FRAME_MS); i++) {
                    const d = Afterlife.passDay(game.world, game.player, { distant });
                    busy.events.push(...d.events);
                    busy.cameOfAge.push(...d.cameOfAge);
                    if (d.estate) game.ui.showNotification('⚖️ The Last of the Blood', `No heir of the blood remains. ${EstateSettlement.line(game.world, d.estate)}`, 'warning');
                    busy.left--;
                }
            } catch (err) {
                console.error('[Afterlife] a day failed to pass', err);
                busy.stop = true;
            }
            if (busy.left > 0 && !busy.stop) {
                if (busy.total > 1) ActionMenu.renderInterregnumBar(game);
                setTimeout(step, 0);
            } else {
                finish();
            }
        };
        if (busy.total > 1) ActionMenu.renderInterregnumBar(game);
        setTimeout(step, 0);
    },

    /** Return to the world: an heir come of age, or a new life. */
    showJumpIn(game) {
        const player = game.player;
        if (!Afterlife.active(player)) return;
        if (game._afterlifeAuto) { clearInterval(game._afterlifeAuto); game._afterlifeAuto = null; ActionMenu.renderInterregnumBar(game); }
        const it = player.interregnum;
        const years = Afterlife.yearsWaited(player, game.world);
        const ready = Afterlife.heirsReady(player);
        const future = Afterlife.futureHeirs(player);
        let html = '<div style="font-size:12px;">';
        html += lede(`${years ? `${_plural(years, 'year')} have` : 'Not a year has'} passed since ${_esc(it.name)} died. It is day ${game.world.day}.`);
        if (ready.length) {
            html += sectionHead('Take Up the Mantle');
            for (const heir of ready) {
                // (birth traits only when there are any: the profile below lists the rest)
                let body = heir.traits && heir.traits.length ? `<div style="color:#9d937c;">Born: ${heir.traits.map(t => `${t.icon} ${_esc(t.name)}`).join(', ')}</div>` : '';
                if (typeof ActionMenu._heirProfileHtml === 'function') body += `<div style="text-align:left;">${ActionMenu._heirProfileHtml(player, heir)}</div>`;
                body += rowList([{ icon: '👑', name: `Play as ${_esc(heir.firstName)}`, desc: 'Take up the mantle', side: '›', tone: 'gold', attrs: `onclick="window._afterlifeHeir('${heir.id}')"` }]);
                html += card(body, {
                    icon: heir.gender === 'male' ? '♂️' : '♀️',
                    title: `${_esc(heir.firstName)} ${_esc(heir.dynasty || '')}`,
                    side: `Age ${heir.age}${player.heir === heir.id ? ' · 👑 Designated' : ''}`,
                    tone: player.heir === heir.id ? 'gold' : '',
                });
            }
        }
        if (future.length) {
            html += rowList(future.map(f => ({ icon: '👶', name: `${_esc(f.child.firstName)} (age ${f.child.age})`, desc: `comes of age in ${_plural(f.years, 'year')}` })), 'Still to come of age');
        }
        // No heir of the main line: a cadet branch's head (systems/cadetBranches.js)
        const cadets = ready.length ? [] : Afterlife.cadetsReady(player);
        if (cadets.length) {
            html += sectionHead('The Cadet Line');
            cadets.forEach((b, i) => {
                let body = `<div style="color:#9d937c;">${_esc(b.name)} · seat at ${_esc(b.seat ? b.seat.name : '—')} · ${Math.round(b.gold)} gold · loyalty ${Math.round(b.loyalty)}${b.estranged ? ' (estranged)' : ''}</div>`;
                body += rowList([{ icon: '🌿', name: `Play as ${_esc(b.head.firstName)}`, desc: 'The branch comes home to the main line', side: '›', tone: i === 0 ? 'gold' : '', attrs: `onclick="window._afterlifeCadet('${b.id}')"` }]);
                html += card(body, { icon: '🌿', title: `${_esc(b.head.firstName)} of ${_esc(b.name)}`, side: `Age ${b.head.age}${i === 0 ? ' · nearest' : ''}`, tone: i === 0 ? 'gold' : '' });
            });
        }
        if (!ready.length && !future.length && !cadets.length) html += '<p style="color:#9d937c;">No child of your blood remains to carry the line. A new life is the way back.</p>';
        if (EstateSettlement.settled(player)) html += ActionMenu._estateHtml(game.world, player.estateSettled);
        html += rowList([
            { icon: '🎭', name: 'A New Life', desc: 'Become someone in the world', attrs: 'onclick="window._afterlifeNewLife()"', tone: ready.length ? '' : 'gold', side: ready.length ? '' : '›' },
            { icon: '⏳', name: 'Keep Waiting', attrs: 'onclick="window._afterlifeKeepWaiting()"' },
            { icon: '📖', name: 'Read the Annals of your life', attrs: 'onclick="window._afterlifeAnnals()"' },
        ], 'Or');
        html += '</div>';
        game.ui.showCustomPanel('🧭 Jump In', html);
        window._afterlifeAnnals = () => ActionMenu.showAnnals(game, { onBack: () => ActionMenu.showJumpIn(game), backLabel: '← Back' });

        window._afterlifeNewLife = () => ActionMenu.showNewLife(game, 0, it.cause);
        window._afterlifeKeepWaiting = () => game.ui.hideCustomPanel();
        window._afterlifeCadet = (branchId) => window._afterlifeHeir(null, branchId);
        window._afterlifeHeir = (childId, branchId = null) => {
            const estate = game.player;
            const oldName = it.name;
            const res = branchId ? Afterlife.returnAsCadet(estate, game.world, branchId) : Afterlife.returnAsHeir(estate, game.world, childId);
            if (!res.success) {
                game.ui.showNotification('Cannot', res.reason || 'That heir cannot take up the mantle.', 'error');
                return;
            }
            ActionMenu._afterlifeTakeOver(game, estate);
            let out = '<div style="font-size:12px;">';
            out += `<div style="${TITLE}">👑 A New Chapter</div>`;
            out += lede(`You are now <strong>${_esc(res.newName)}</strong>, heir of ${_esc(oldName)}, ${years ? `${_plural(years, 'year')} after` : 'soon after'} their death.`);
            out += chips([['🎂', 'Age', res.heir.age], { icon: '💰', label: 'Inherited', value: `${Math.floor(estate.gold)} gold`, cls: 'gold' }, estate.house ? ['🛡️', `${_esc(estate.house.name)}, generation`, estate.house.generation || 1] : null]);
            // Where the rest of the purse went: debts, the other children's portions, the heriot (systems/inheritance.js)
            if (res.inheritance && res.inheritance.line) out += `<div style="font-size:11px;color:#c9b27a;margin:4px 0 8px;">💰 ${_esc(res.inheritance.line)}</div>`;
            if (res.cadet) out += `<div style="font-size:11px;color:#8fd18a;margin:4px 0 8px;">🌿 ${_esc(res.cadet.text)}</div>`;
            out += `<button data-am-act="closePanelAndRefresh" style="${BTN_GOLD}display:block;width:100%;padding:10px;font-size:14px;">Begin Your Story</button>`;
            out += '</div>';
            game.ui.showCustomPanel('New Heir', out);
        };
    },
});
