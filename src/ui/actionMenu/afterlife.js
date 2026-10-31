// ActionMenu — afterlife: when the player dies, a new life as someone else in
// the world, or the interregnum — the world turning on without them (a bar
// to let days, months or years pass) until they jump back in as an heir come
// of age or as someone new. Logic lives in player/afterlife.js; these panels
// present it.
import { ActionMenu } from './_ref.js';
import { Relationships, InnerMapRenderer } from './_imports.js';
import { Afterlife } from '../../player/afterlife.js';

const BAR_ID = 'interregnumBar';
const BTN = 'padding:6px 10px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;border:1px solid rgba(255,255,255,0.16);background:rgba(255,255,255,0.06);color:var(--text-primary);';
const BTN_GOLD = 'padding:8px 12px;border-radius:6px;font-size:12px;font-weight:700;cursor:pointer;border:1px solid rgba(245,197,66,0.55);background:linear-gradient(180deg,#f6cf57,#d9a92a);color:#1a1a1a;';

function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

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
        let html = '<div style="max-height:560px;overflow-y:auto;font-size:12px;">';
        html += '<p style="color:var(--text-secondary);margin-top:0;">Become someone living in the world now. Your House ends with its chronicle; what it held passes to the crowns and towns. You keep only what you see on the map.</p>';
        if (!people.length) html += '<p>No one could be found.</p>';
        people.forEach((c, i) => {
            const icon = c.gender === 'female' ? '👩' : '🧑';
            html += '<div style="background:rgba(0,0,0,0.3);padding:10px;border-radius:6px;margin-bottom:6px;">';
            html += `<div style="display:flex;justify-content:space-between;gap:8px;"><strong>${icon} ${_esc(c.first)} ${_esc(c.last)}</strong><span style="color:var(--gold);">${c.gold}g</span></div>`;
            html += `<div style="color:#bbb;margin:2px 0 6px;">${_esc(c.title)}, aged ${c.age} · ${_esc(c.town)} (${_esc(c.townType)})${c.kingdom ? ` in ${_esc(c.kingdom)}` : ', beholden to no crown'}${c.folkId != null ? ' · <span title="Someone of this town\'s own people">a townsperson</span>' : ''}</div>`;
            html += `<button onclick="window._afterlifeBecome(${i})" style="width:100%;${BTN_GOLD}">Become ${_esc(c.first)}</button>`;
            html += '</div>';
        });
        html += '<div style="display:flex;gap:6px;margin-top:8px;">';
        html += `<button onclick="window._afterlifeReroll()" style="flex:1;${BTN}">🎲 Other people</button>`;
        html += `<button onclick="window._afterlifeBack()" style="flex:1;${BTN}">← Back</button>`;
        html += '</div></div>';
        // From the death screen there is no going back to the game: only ← Back
        game.ui.showCustomPanel('🎭 A New Life', html, { locked: fromDeath });

        window._afterlifeReroll = () => ActionMenu.showNewLife(game, reroll + 1, cause);
        window._afterlifeBack = () => {
            if (fromDeath) ActionMenu.showDeathScreen(game, cause);
            else ActionMenu.showJumpIn(game);
        };
        window._afterlifeBecome = (i) => {
            const cand = people[i];
            if (!cand) return;
            // Leaving straight from the death screen: the reign is filed with its cause first
            if (fromDeath) Afterlife.begin(game.player, world, cause);
            const res = Afterlife.becomeStranger(game.player, world, cand);
            if (!res.success) {
                game.ui.showNotification('Cannot', res.reason || 'Something went wrong.', 'error');
                return;
            }
            ActionMenu._afterlifeTakeOver(game, res.player);
            ActionMenu._showNewLifeWelcome(game, cand, res);
        };
    },

    _showNewLifeWelcome(game, cand, res) {
        const p = res.player;
        let html = '<div style="text-align:center;font-size:12px;">';
        html += `<h3 style="color:var(--gold);margin-top:0;">${_esc(p.name)}</h3>`;
        html += `<p style="font-size:14px;">You are ${_esc(p.name)}, ${_esc(cand.title.toLowerCase())} of ${_esc(cand.town)}${cand.kingdom ? ` in ${_esc(cand.kingdom)}` : ''}, aged ${p.age}, with ${p.gold} gold to your name.</p>`;
        const e = res.epitaph;
        if (e) {
            html += '<div style="background:rgba(0,0,0,0.3);padding:10px;border-radius:6px;margin:10px 0;text-align:left;">';
            html += `<div style="color:#c9b27a;">${e.sigil && e.sigil.icon ? e.sigil.icon : '🛡️'} The line of ${_esc(e.houseName)} has ended: ${_esc(e.rank.label)} (legacy ${e.score}).</div>`;
            const x = res.escheat || {};
            const parts = [];
            if (x.estates) parts.push(_plural(x.estates, 'estate'));
            if (x.properties) parts.push(_plural(x.properties, 'building'));
            if (x.works) parts.push(_plural(x.works, 'work'));
            if (x.leases) parts.push(_plural(x.leases, 'lease'));
            if (x.farms) parts.push(_plural(x.farms, 'tax farm'));
            if (x.colonies) parts.push(_plural(x.colonies, 'colony'));
            if (parts.length) html += `<div style="color:#aaa;margin-top:4px;">What it held (${parts.join(', ')}) passed to the crowns and towns.</div>`;
            html += '</div>';
        }
        html += `<button data-am-act="closePanelAndRefresh" style="width:100%;${BTN_GOLD}font-size:14px;">Begin a New Life</button>`;
        // The old line's book goes with the new life as "Before" (systems/annals.js)
        if (Array.isArray(p.annalsPast) && p.annalsPast.length) {
            html += `<button onclick="window._newLifeAnnals()" style="width:100%;margin-top:6px;${BTN}">📖 Read the Annals of the life you left</button>`;
        }
        html += '</div>';
        game.ui.showCustomPanel('🎭 A New Life', html);
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
        else heirLine = '<span style="color:#aaa;">No heir of the blood remains</span>';
        const busy = game._afterlifeBusy;
        const auto = !!game._afterlifeAuto;
        const steps = [['1 day', 1], ['1 week', 7], ['1 month', 30], ['1 season', Math.round(Y / 4)], ['1 year', Y]];

        let html = '<div style="pointer-events:auto;zoom:var(--ui-zoom, 1);max-width:96vw;background:rgba(18,20,28,0.94);border:1px solid rgba(245,197,66,0.45);border-radius:10px;padding:8px 12px;box-shadow:0 6px 24px rgba(0,0,0,0.5);font-size:12px;color:var(--text-primary);">';
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
        const perFrame = n >= 30 ? 4 : 1;
        const finish = () => {
            game._afterlifeBusy = null;
            game.isProcessingTurn = false;
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
                for (let i = 0; i < perFrame && busy.left > 0 && !busy.stop; i++) {
                    const d = Afterlife.passDay(game.world, game.player);
                    busy.events.push(...d.events);
                    busy.cameOfAge.push(...d.cameOfAge);
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
        let html = '<div style="max-height:560px;overflow-y:auto;font-size:12px;">';
        html += `<p style="color:var(--text-secondary);margin-top:0;">${years ? `${_plural(years, 'year')} have` : 'Not a year has'} passed since ${_esc(it.name)} died. It is day ${game.world.day}.</p>`;
        if (ready.length) {
            html += '<h4 style="margin:6px 0;">Take Up the Mantle</h4>';
            for (const heir of ready) {
                const traitStr = heir.traits && heir.traits.length ? heir.traits.map(t => `${t.icon} ${t.name}`).join(', ') : 'None';
                html += '<div style="background:rgba(0,0,0,0.3);padding:10px;border-radius:6px;margin-bottom:6px;">';
                html += `<strong>${_esc(heir.firstName)} ${_esc(heir.dynasty || '')}</strong> ${heir.gender === 'male' ? '♂️' : '♀️'} · Age ${heir.age}${player.heir === heir.id ? ' <span style="color:var(--gold);">👑 Designated</span>' : ''}`;
                html += `<div style="color:#aaa;">Born: ${traitStr}</div>`;
                if (typeof ActionMenu._heirProfileHtml === 'function') html += `<div style="text-align:left;">${ActionMenu._heirProfileHtml(player, heir)}</div>`;
                html += `<button onclick="window._afterlifeHeir('${heir.id}')" style="width:100%;margin-top:6px;${BTN_GOLD}">Play as ${_esc(heir.firstName)}</button>`;
                html += '</div>';
            }
        }
        if (future.length) {
            html += '<div style="color:#bbb;margin:6px 0;">' + future.map(f => `👶 ${_esc(f.child.firstName)} (age ${f.child.age}) comes of age in ${_plural(f.years, 'year')}`).join('<br>') + '</div>';
        }
        if (!ready.length && !future.length) html += '<p style="color:#aaa;">No child of your blood remains to carry the line. A new life is the way back.</p>';
        html += `<button onclick="window._afterlifeNewLife()" style="width:100%;margin-top:6px;${ready.length ? BTN : BTN_GOLD}">🎭 A New Life: become someone in the world</button>`;
        html += `<button onclick="window._afterlifeKeepWaiting()" style="width:100%;margin-top:6px;${BTN}">⏳ Keep Waiting</button>`;
        html += `<button onclick="window._afterlifeAnnals()" style="width:100%;margin-top:6px;${BTN}">📖 Read the Annals of your life</button>`;
        html += '</div>';
        game.ui.showCustomPanel('🧭 Jump In', html);
        window._afterlifeAnnals = () => ActionMenu.showAnnals(game, { onBack: () => ActionMenu.showJumpIn(game), backLabel: '← Back' });

        window._afterlifeNewLife = () => ActionMenu.showNewLife(game, 0, it.cause);
        window._afterlifeKeepWaiting = () => game.ui.hideCustomPanel();
        window._afterlifeHeir = (childId) => {
            const estate = game.player;
            const oldName = it.name;
            const res = Afterlife.returnAsHeir(estate, game.world, childId);
            if (!res.success) {
                game.ui.showNotification('Cannot', res.reason || 'That heir cannot take up the mantle.', 'error');
                return;
            }
            ActionMenu._afterlifeTakeOver(game, estate);
            let out = '<div style="text-align:center;font-size:12px;">';
            out += '<h3 style="color:var(--gold);margin-top:0;">👑 A New Chapter</h3>';
            out += `<p style="font-size:14px;">You are now <strong>${_esc(res.newName)}</strong>, heir of ${_esc(oldName)}, ${years ? `${_plural(years, 'year')} after` : 'soon after'} their death.</p>`;
            out += `<div style="color:#bbb;margin-bottom:10px;">Age ${res.heir.age} · ${Math.floor(estate.gold)} gold inherited${estate.house ? ` · ${_esc(estate.house.name)}, generation ${estate.house.generation || 1}` : ''}</div>`;
            out += `<button data-am-act="closePanelAndRefresh" style="width:100%;${BTN_GOLD}font-size:14px;">Begin Your Story</button>`;
            out += '</div>';
            game.ui.showCustomPanel('New Heir', out);
        };
    },
});
