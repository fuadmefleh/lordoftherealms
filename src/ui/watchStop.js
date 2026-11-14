// ============================================
// WATCH STOP — a guard walks up and questions the player on the street map
// ============================================
// The UI half of systems/watchQuestioning.js. While the player walks a town:
// once a visit, after a little while on the street (data stop.delaySeconds),
// WatchQuestioning.shouldStop asks whether the town's case against them is
// enough for a stop today. If so the nearest guard on the street (no further
// than stop.reach) barks and walks up; beside the player, the questioning
// opens as a ConversationScene (ui/conversationScene.js) with the guard's bust,
// the charges and their evidence at the side, and the suspicion on the ring.
//
//   The AI brain on: the player answers in their own words (WatchQuestioning.say),
//   the guard judges each answer and comes to a verdict, held to the evidence.
//   "Done talking" (or Esc) leaves it to the guard on what was said.
//   The AI brain off (or not answering): choices — answer plainly / own up,
//   deny, bribe, run, say nothing (WatchQuestioning.answer).
//
// Closing the scene before it is decided is walking off: refusing to answer.
// Arrested: into the jail map (game.enterJailMap), as the watch's own scene does.
// Ticked from InnerMapCombat.update, beside the street's reactions.

import { InnerMap } from '../world/innerMap.js';
import { WatchQuestioning } from '../systems/watchQuestioning.js';
import { StreetCrime } from '../systems/streetCrime.js';
import { InnerMapReactions } from './innerMapReactions.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { ConversationScene } from './conversationScene.js';
import { NpcDialog } from './npcDialog.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _dist = (aq, ar, bq, br) => Math.max(Math.abs(aq - bq), Math.abs(ar - br));
const _esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function _frac(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967296;
}

/** The ring: suspicion 0..100 (high is bad, so the colour runs the other way). */
function _mood(kase) {
    const v = _num(kase && kase.suspicion);
    const tier = v >= 70 ? ['😠', 'Ready to arrest', '#f44336'] : v >= 45 ? ['😒', 'Deeply suspicious', '#ff9800']
        : v >= 25 ? ['🤨', 'Suspicious', '#FFD54F'] : ['🙂', 'Satisfied', '#8bc34a'];
    return { value: v, icon: tier[0], label: tier[1], color: tier[2], shown: `${Math.round(v)}` };
}

function _facts(kase) {
    const rows = kase.charges.slice(0, 5).map(c => `<div class="npc-dialog-fact"><b>${_esc(c.label)}</b><br><small>${_esc(WatchQuestioning.proofLabel(c))}</small></div>`);
    return `<div class="npc-dialog-fact"><small>What the watch holds against you</small></div>${rows.join('')}`;
}

export const InnerMapWatchStop = {
    _key: null,
    _clock: 0,
    _armAt: 0,
    _checked: false,
    _walk: null,     // { npc, kase, left, repath, speed }
    _scene: null,

    reset() {
        if (this._walk) this._releaseGuard(this._walk.npc, this._walk.speed);
        this._walk = null;
        this._checked = false;
        this._clock = 0;
    },

    update(deltaTime, game) {
        if (!InnerMap.active || !game || !game.player || !game.world) { if (this._key) { this.reset(); this._key = null; } return; }
        const wt = InnerMap.currentWorldTile || {};
        const key = `${wt.q},${wt.r}`;
        const day = _num(game.world.day);
        if (key !== `${this._key}` || this._day !== day) {
            this.reset();
            this._key = key;
            this._day = day;
            const S = WatchQuestioning.config().stop || {};
            const [lo, hi] = Array.isArray(S.delaySeconds) ? S.delaySeconds : [8, 20];
            this._armAt = lo + (hi - lo) * _frac(`${key}|${day}|arm`);
        }
        this._clock += deltaTime;
        if (this._walk) { this._driveGuard(deltaTime, game); return; }
        if (this._checked || this._clock < this._armAt || this._scene) return;
        if (InnerMap._insideBuilding || NpcDialog.active || game._scene || ConversationScene.active || game.player.jailState) return;
        this._checked = true;
        const tile = game.world.getTile(wt.q, wt.r);
        const s = tile && tile.settlement;
        if (!s) return;
        const res = WatchQuestioning.shouldStop(game.player, game.world, s, { key });
        if (!res.stop) return;
        this.send(game, res.case);
    },

    /** Send the nearest free guard to stop the player. → true when one goes. */
    send(game, kase) {
        const S = WatchQuestioning.config().stop || {};
        const hidden = new Set(StreetCrime.config().sight.hiddenStates || []);
        const pq = InnerMap.playerInnerQ;
        const pr = InnerMap.playerInnerR;
        let best = null;
        for (const n of InnerMap.npcs || []) {
            if (!n || n.type !== 'guard' || hidden.has(n.state) || n.state === 'gone' || n._fight || n._dialogFrozen || n._carried) continue;
            if (InnerMapReactions._responders && InnerMapReactions._responders.has(n.id)) continue;
            const d = _dist(n.q, n.r, pq, pr);
            if (d > _num(S.reach, 34)) continue;
            if (!best || d < best.d) best = { n, d };
        }
        if (!best) return false;
        const npc = best.n;
        WatchQuestioning.noteStop(game.player, game.world, kase);
        this._walk = { npc, kase, left: _num(S.giveUpSeconds, 40), repath: 0, speed: npc.speed };
        npc.speed = (npc.speed || 1) * _num(S.speedMult, 1.5);
        npc.departing = false;
        InnerMapReactions.bark(npc, WatchQuestioning.line('bark', `${kase.key}|${npc.id}`) || 'You there!');
        return true;
    },

    _releaseGuard(npc, speed) {
        if (!npc) return;
        if (speed) npc.speed = speed;
        npc._dialogFrozen = false;
        npc.path = null;
        if (npc.state === 'walking' || npc.state === 'dialog') npc.state = 'idle';
        npc.idleTimer = 3;
    },

    _driveGuard(deltaTime, game) {
        const w = this._walk;
        const npc = w.npc;
        const pq = InnerMap.playerInnerQ;
        const pr = InnerMap.playerInnerR;
        w.left -= deltaTime;
        // (gone, or lost the player: the stop is off for today — the cooldown stands)
        if (!npc || npc.state === 'gone' || npc._fight || w.left <= 0 || game.player.jailState) { this._releaseGuard(npc, w.speed); this._walk = null; return; }
        if (InnerMap._insideBuilding || npc.state === 'inside_building') return;
        if (_dist(npc.q, npc.r, pq, pr) <= 1) {
            if (NpcDialog.active || game._scene || ConversationScene.active) return; // (wait for whatever's open)
            npc.path = null;
            npc.moveProgress = 0;
            npc.state = 'idle';
            npc.facing = InnerMapCharacters.getDirection(pq - npc.q, pr - npc.r);
            this._walk = null;
            this.open(game, npc, w.kase, w.speed);
            return;
        }
        w.repath -= deltaTime;
        const walking = npc.path && npc.pathIndex < npc.path.length;
        const end = walking ? npc.path[npc.path.length - 1] : null;
        if (walking && (w.repath > 0 || _dist(end.q, end.r, pq, pr) <= 1)) return;
        w.repath = 0.6;
        const path = InnerMap._findPath(npc.q, npc.r, pq, pr);
        if (!path || path.length < 3) return;
        const step = walking ? npc.path[npc.pathIndex] : null;
        const keep = step && path[1] && path[1].q === step.q && path[1].r === step.r ? npc.moveProgress : 0;
        npc.path = path.slice(1, -1);
        npc.pathIndex = 0;
        npc.moveProgress = keep;
        if (!keep) { npc.prevQ = npc.q; npc.prevR = npc.r; }
        npc.state = 'walking';
        npc._targetBuilding = null;
    },

    // ── The questioning ──

    /** Open the questioning with a guard (also for the dev console: InnerMapWatchStop.open(game, npc, kase)). */
    open(game, npc, kase, speed = null) {
        const player = game.player;
        const world = game.world;
        const tile = world.getTile(player.q, player.r);
        const settlement = tile && tile.settlement;
        npc._dialogFrozen = true;
        const opts = { settlement, guard: npc };
        const st = { decided: false, talk: null };
        const scene = ConversationScene.open({
            name: npc.name || 'A guard of the watch',
            subtitle: 'The town watch',
            where: kase.town,
            icon: '🛡️',
            sprite: npc,
            mood: _mood(kase),
            moodTitle: 'How suspicious the watch is of you',
            facts: _facts(kase),
            greeting: WatchQuestioning.greeting(player, world, kase, npc.name),
            onClose: () => {
                this._scene = null;
                // (walking off before it is decided is refusing to answer)
                if (!st.decided) {
                    st.decided = true;
                    const out = st.talk ? WatchQuestioning.conclude(player, world, st.talk, opts) : WatchQuestioning.answer(player, world, kase, 'silent', opts);
                    this._after(game, npc, out, speed, true);
                } else if (!st.jailed) this._releaseGuard(npc, speed);
            },
        });
        this._scene = scene;

        const finish = (out) => {
            if (!out || out.invalid) return false;
            st.decided = true;
            st.jailed = !!out.jailed;
            if (out.text) scene.npc(out.text, false);
            if (out.note) scene.note(out.note.text, out.note.tone);
            scene.setMood(_mood(WatchQuestioning.refresh(player, world, kase)));
            if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, world);
            scene.leave(1400);
            this._after(game, npc, out, speed, false);
            return true;
        };

        const showChoices = () => {
            const list = WatchQuestioning.options(player, world, kase, npc).map(o => ({
                icon: o.icon, label: o.label, group: o.id === 'run' || o.id === 'silent' ? 'leave_opts' : 'talk',
                tooltip: o.hint, chance: o.chance != null ? Math.round(o.chance * 100) : null,
                disabled: o.can === false, disabledReason: o.reason,
                onPick: () => {
                    const said = { plain: kase.proof >= 2 ? 'Aye. It was me.' : 'I\'ll tell you how it was, plain.', deny: 'I had nothing to do with it.', bribe: '*presses some coin into the guard\'s palm* Perhaps this clears things up.', run: '*bolts*', silent: '*says nothing*' }[o.id];
                    scene.exchange(said, () => {
                        const out = WatchQuestioning.answer(player, world, kase, o.id, opts);
                        if (!finish(out)) { if (out && out.text) scene.note(out.text, 'bad'); showChoices(); }
                    });
                },
            }));
            scene.choices(list, { titles: { talk: 'Answer', leave_opts: 'Or' }, hint: 'Answer the watch — press 1–5.' });
        };

        const showTalk = () => {
            st.talk = st.talk || WatchQuestioning.startTalk(player, world, kase, npc);
            scene.input({
                placeholder: `Answer ${npc.name || 'the guard'}…`,
                doneLabel: 'Say no more',
                hint: 'Enter to answer · Esc to say no more and let them decide',
                onSend: async (text) => {
                    scene.player(text);
                    scene.thinking();
                    const res = await WatchQuestioning.say(player, world, st.talk, text, opts);
                    if (!scene.isOpen) return;
                    if (!res.ok) {
                        // (the AI brain failed us: the plain answers instead)
                        scene.note(res.reason, 'info');
                        if (!st.talk.done) showChoices();
                        return;
                    }
                    scene.npc(res.say, false);
                    for (const n of res.notes || []) scene.note(n.text, n.tone);
                    scene.setMood(_mood(kase));
                    if (res.result) finish({ ...res.result, text: null });
                },
                onDone: () => {
                    if (st.decided) return;
                    finish(WatchQuestioning.conclude(player, world, st.talk, opts));
                },
            });
        };

        if (WatchQuestioning.available()) showTalk();
        else showChoices();
        return scene;
    },

    /** After the verdict: the guard goes back to their round, or the player to the cells. */
    _after(game, npc, out, speed, closed) {
        if (!out) return;
        if (out.note && closed && game.ui && typeof game.ui.showNotification === 'function') {
            game.ui.showNotification('🛡️ The Watch', out.note.text.replace(/^\S+\s/, ''), out.note.tone === 'good' ? 'success' : out.note.tone === 'bad' ? 'warning' : 'info');
        }
        if (out.jailed) {
            this._releaseGuard(npc, speed);
            const go = () => {
                if (typeof game.enterJailMap === 'function') {
                    game.enterJailMap().then(ok => {
                        if (!ok && InnerMap.active && typeof game.exitInnerMap === 'function') game.exitInnerMap({ force: true });
                    });
                } else if (InnerMap.active && typeof game.exitInnerMap === 'function') game.exitInnerMap();
                if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, game.world);
            };
            setTimeout(go, closed ? 0 : 1800);
            return;
        }
        if (out.outcome === 'fled' || out.outcome === 'bribe_refused') {
            // (the guard shouts after the player, then goes back to the round)
            InnerMapReactions.bark(npc, WatchQuestioning.line('ran', `${npc.id}|after`) || 'Stop!');
        }
        if (closed) this._releaseGuard(npc, speed);
    },
};
