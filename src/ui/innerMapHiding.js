// ============================================
// INNER MAP HIDING — lying low in cover on the street map, and the ambush
// ============================================
// The play of systems/stealthCover.js (the odds) over world/streetCover.js
// (where cover is):
//
//   HIDE      H (or Hide in the Bush on a bush, Hide Here on yourself) in
//             cover: the row behind a bush, a haystack, a stall's counter, a
//             tree's trunk; a field of tall crops; reeds on a bank; tall grass
//             in the wilds; a dark corner between walls at night. You are
//             drawn faint with an eye over your head that opens as someone's
//             notice grows. A shuttered lantern is shuttered for you; a torch
//             gives you away. Moving out of cover, attacking or talking ends
//             it; creeping from cover to cover keeps it (moving is noticed).
//   NOTICED   each quarter second everyone in sight weighs you: distance,
//             the dark and your light, fog and rain, your Stealth, moving or
//             still, armour, the cover; the watch sharper, an alert one
//             sharper still. Spotted: they call out, you are out of cover,
//             the curfew watch may walk up. Stealth trains with every
//             minute hidden and every ambush.
//   AMBUSH    someone passes within reach: F springs on them (the strike: a
//             heavy first blow that may fell them — InnerMapCombat's own
//             fight carries on), or from their card: Seize and Bind (rope),
//             Rob at Knifepoint (their real purse). Felled unaware, or struck
//             in the dark unseen: blindside — they never saw who, and only
//             those in sight saw it (StreetCrime reads it).
//   LISTEN    hidden and still, folk say more of you (ui/innerMapOverheard.js
//             reads listenBoost); a rival House's agent watched from cover
//             grows suspect (RivalAgents.overheard).
//   LURKERS   now and then someone lies in wait in cover for the player — a
//             footpad, a cutthroat at night, an outlaw in the wilds, a bounty
//             hunter, a rival's hired blade or assassin — more at night, in a
//             poor town, with a bounty on you or a House at feud with yours.
//             Unseen they are not drawn; a sharp eye (Stealth, the cunning,
//             the wanderer, a light carried) may spot them first; within
//             reach they spring, the first blow theirs (who started it: they).
//
// Ticked from game/gameLoop.js (update), drawn from innerMapLayers/entities.js
// (wrapPlayerDraw, unseenLurker), menus from innerMapUI.js. Its rolls come
// from a stream of its own (the world seed, the map, a count), never the
// shared RNG. Nothing here is saved: hiding and lurkers last a map visit.

import { InnerMap } from '../world/innerMap.js';
import { StreetCover } from '../world/streetCover.js';
import { SettlementWealth } from '../world/settlementWealth.js';
import { StealthCover } from '../systems/stealthCover.js';
import { SocialSkills } from '../systems/socialSkills.js';
import { CombatSkills } from '../systems/combatSkills.js';
import { CarriedLight } from '../systems/carriedLight.js';
import { NightStreets } from '../systems/nightStreets.js';
import { StreetCrime } from '../systems/streetCrime.js';
import { Duels } from '../systems/duels.js';
import { Downed } from '../systems/downed.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { NpcTheft } from '../systems/npcTheft.js';
import { Traits } from '../systems/traits.js';
import { Gossip } from '../systems/gossip.js';
import { Schemes } from '../systems/schemes.js';
import { Nemesis } from '../systems/nemesis.js';
import { RivalAgents } from '../systems/rivalAgents.js';
import { Underworld } from '../systems/underworld.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { LightSystem } from './lightSystem.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { InnerMapReactions } from './innerMapReactions.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { InnerMapCarry } from './innerMapCarry.js';
import { InnerMapDowned } from './innerMapDowned.js';
import { drawMapText } from './mapInk.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _dist = (aq, ar, bq, br) => Math.max(Math.abs(aq - bq), Math.abs(ar - br));
const _seed = world => (world && world.generationParams && world.generationParams.seed) || 0;
const _now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const _an = w => (/^[aeiou]/i.test(String(w || '')) ? 'an' : 'a');

function _frac(str) {
    const s = String(str);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
}

/** States in which a person sees nothing of the street. */
const BLIND = new Set(['inside_building', 'leaving_building', 'gone', 'unconscious', 'bound', 'dialog']);

function _notify(game, title, body, kind = 'info') {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, body, kind);
}

export const InnerMapHiding = {
    /** Hidden now: { q, r, kind, quality, word, since, moved } */
    hidden: null,
    _goHide: null,
    _tick: 0,
    _lurkTick: 0,
    _danger: 0,
    _prompt: null,
    _lurkers: [],
    _tiles: null,
    _visitLurks: 0,
    _hourKey: null,
    _n: 0,
    _still: 0,
    _hiddenSecs: 0,
    _trainedThisVisit: 0,
    _game: null,
    _hintCover: null,

    // ──────────── THE DICE ────────────

    _roll(game, salt) {
        const w = game && game.world;
        const wt = InnerMap.currentWorldTile || {};
        return _frac(`${_seed(w)}|${wt.q},${wt.r}|${_num(w && w.day)}|hide|${salt}|${this._n++}`);
    },

    // ──────────── WHAT THE PLAYER IS ────────────

    _darkness() {
        return InnerMap._insideBuilding ? 0 : Math.max(0, Math.min(1, _num(LightSystem.ambientDarkness)));
    },

    /** Your light: { lit (anything carried shows you), torch } */
    _light(player) {
        const carried = CarriedLight.lit(player);
        return { lit: !!carried || NightStreets.lit(player), torch: carried === 'torch' };
    },

    _weather() {
        const sw = InnerMap._sw || {};
        return { fog: _num(sw.fog), rain: _num(sw.rain), snow: _num(sw.snow) };
    },

    _stealth(player) {
        try { return SocialSkills.level(player, 'stealth') || 1; } catch (e) { return 1; }
    },

    _settlement() {
        const ref = InnerMap._currentWorldTileRef;
        return (ref && ref.settlement) || (InnerMap.currentWorldTile && InnerMap.currentWorldTile.settlement) || null;
    },

    /** Cover in the player's cell now (null indoors, on deck, in the water). */
    coverHere() {
        if (!InnerMap.active || InnerMap._insideBuilding || InnerMap._aboardBoat) return null;
        if (typeof InnerMap.isPlayerSwimming === 'function' && InnerMap.isPlayerSwimming()) return null;
        return StreetCover.coverAt(InnerMap.tiles, InnerMap.playerInnerQ, InnerMap.playerInnerR, { darkness: this._darkness() });
    },

    // ──────────── HIDE / COME OUT ────────────

    /** H on the street map: hide in cover here, walk to cover close by, or come out. */
    toggle(game) {
        if (!game || !game.player || !InnerMap.active) return;
        if (this.hidden) { this.unhide(game, 'You come out of hiding.'); return; }
        if (this.hide(game)) return;
        const near = InnerMap._insideBuilding ? null : StreetCover.nearest(InnerMap.tiles, InnerMap.playerInnerQ, InnerMap.playerInnerR, 4, { darkness: this._darkness() });
        if (near) { this.goHide(game, near.q, near.r); return; }
        _notify(game, '🌿 No cover here', InnerMap._insideBuilding
            ? 'Indoors there is nowhere to hide from those in the room.'
            : 'Nothing close by to hide in: get behind a bush, a haystack or a stall, into tall crops or reeds — or, at night, a dark corner between walls.', 'info');
    },

    /** Walk to a cover cell and hide on arriving. */
    goHide(game, q, r) {
        if (q === InnerMap.playerInnerQ && r === InnerMap.playerInnerR) { this.hide(game); return; }
        const res = InnerMap.movePlayerTo(q, r);
        if (!res || !res.started) { _notify(game, '🌿 Can\'t get there', 'There is no way into that cover from here.', 'warning'); return; }
        this._goHide = { q, r, path: InnerMap._playerPath };
    },

    /** Hide in the cover where you stand → true when hidden. */
    hide(game) {
        if (!game || !game.player) return false;
        if (InnerMapCarry.person) { _notify(game, '🌿 Not with someone on your shoulder', `Put ${InnerMapCarry.person.name} down first.`, 'warning'); return true; }
        if (InnerMapCombat._attackState && InnerMapCombat._attackState.targetType === 'npc') { _notify(game, '🌿 Not mid-fight', 'You can\'t hide in the middle of a fight.', 'warning'); return true; }
        const c = this.coverHere();
        if (!c) return false;
        InnerMap.cancelPlayerWalk();
        this.hidden = { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR, kind: c.kind, quality: c.quality, word: c.word, since: _now(), moved: false };
        this._still = 0;
        this._danger = 0;
        this._mark();
        // A lantern shuttered as you go in (a torch can't be: put it out yourself)
        const light = this._light(game.player);
        let lamp = '';
        if (this._darkness() > 0.2 && NightStreets.lit(game.player) && !CarriedLight.lit(game.player)) {
            NightStreets.toggleLight(game.player);
            LightSystem.playerLightDoused = true;
            lamp = ' You shutter your lantern.';
        }
        const torch = light.torch ? ' Your torch burns — anyone looking this way will see you. Put it out.' : '';
        const where = c.kind === 'alley' ? 'into a dark corner' : c.kind === 'crops' ? 'down among the crops' : `${c.kind === 'grass' || c.kind === 'reeds' ? 'down in' : 'behind'} the ${c.word}`;
        _notify(game, '🌿 Hidden', `You get ${where} and keep still.${lamp}${torch} Folk passing close may still notice you; moving makes it likelier. F springs on someone within reach; H comes out.`, torch ? 'warning' : 'info');
        return true;
    },

    /** Out of hiding (a line why, or quiet). */
    unhide(game, why = null, quiet = false) {
        if (!this.hidden) return;
        this.hidden = null;
        this._prompt = null;
        this._danger = 0;
        this._mark();
        if (why && !quiet) _notify(game, '🚶 Out of hiding', why, 'info');
    },

    // ──────────── THE TICK ────────────

    update(dt, game) {
        this._game = game || null;
        if (!InnerMap.active || !game || !game.player || !game.world) {
            if (this._tiles) this._teardown();
            if (this.hidden) { this.hidden = null; this._mark(); }
            return;
        }
        if (this._tiles !== InnerMap.tiles && !InnerMap._insideBuilding) {
            this._teardown();
            this._tiles = InnerMap.tiles;
        }
        if (InnerMap._insideBuilding) { if (this.hidden) this.unhide(game, null, true); this._prompt = null; return; }
        // Walking to hide
        const gh = this._goHide;
        if (gh) {
            if (!InnerMap._playerWalking && InnerMap.playerInnerQ === gh.q && InnerMap.playerInnerR === gh.r) { this._goHide = null; this.hide(game); }
            else if (!InnerMap._playerWalking || InnerMap._playerPath !== gh.path) this._goHide = null;
        }
        const h = this.hidden;
        if (h) {
            // A fight, a talk, a body over the shoulder: out of hiding
            if ((InnerMapCombat._attackState && InnerMapCombat._attackState.targetType === 'npc') || InnerMapCarry.person || game._scene) {
                this.unhide(game, null, true);
            } else if (InnerMap.playerInnerQ !== h.q || InnerMap.playerInnerR !== h.r) {
                // Creeping from cover to cover keeps you hidden
                const c = this.coverHere();
                if (c) Object.assign(h, { q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR, kind: c.kind, quality: c.quality, word: c.word, moved: true });
                else this.unhide(game, `You step out from the ${h.word}.`);
            }
        }
        this._tick -= dt;
        if (this._tick <= 0) {
            const step = 0.25 - this._tick;
            this._tick = 0.25;
            if (this.hidden) this._hiddenTick(game, step);
            else { this._prompt = null; this._hintCover = this.coverHere(); }
        }
        this._lurkTick -= dt;
        if (this._lurkTick <= 0) {
            const step = 0.25 - this._lurkTick;
            this._lurkTick = 0.25;
            this._lurkStep(game, step);
        }
    },

    _teardown() {
        // Those still lying in wait slip away with the map; those sprung are in the fight
        for (const n of this._lurkers) {
            if (n && n._lurk && !n._lurk.sprung) {
                n.state = 'gone';
                const i = (InnerMap.npcs || []).indexOf(n);
                if (i >= 0) InnerMap.npcs.splice(i, 1);
            }
        }
        this._lurkers = [];
        this._visitLurks = 0;
        this._trainedThisVisit = 0;
        this._hourKey = null;
        this.hidden = null;
        this._goHide = null;
        this._prompt = null;
        this._tiles = null;
        this._mark();
    },

    /**
     * Hidden or not, told to the street's other systems without an import
     * (InnerMap._playerHidden: the curfew watch, the watch's stop, the
     * overheard talk read it): null, or { chance, radius } — listenBoost.
     */
    _mark() {
        InnerMap._playerHidden = this.hidden ? this.listenBoost() : null;
    },

    /** Everyone in sight weighs you; who is in reach; listening; Stealth by the minute. */
    _hiddenTick(game, dt) {
        const player = game.player;
        const h = this.hidden;
        const moving = !!InnerMap._playerWalking;
        this._still = moving ? 0 : this._still + dt;
        if (!moving) h.moved = false;
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        const env = {
            cover: h.quality, darkness: this._darkness(), ...this._weather(), ...this._light(player),
            stealth: this._stealth(player), moving: moving || h.moved, armour: Duels.playerArmour(player),
        };
        const C = StealthCover.config();
        const reach = _num(C.ambush.reach, 2);
        let danger = 0, prompt = null, spotter = null;
        for (const npc of InnerMap.npcs || []) {
            if (!npc || BLIND.has(npc.state) || npc._carried || (npc.departing && npc._broke)) continue;
            const d = _dist(npc.q, npc.r, pq, pr);
            if (d > 12) continue;
            if (npc._lurk && !npc._lurk.sprung) continue;
            // Who could be sprung on
            if (d <= reach && !npc._taskFoe && !npc._dialogFrozen && !npc._asleep && (!prompt || d < _dist(prompt.q, prompt.r, pq, pr))) prompt = npc;
            const watcher = {
                guard: npc.type === 'guard', child: npc.type === 'child', asleep: !!npc._asleep,
                alert: !!(InnerMapReactions._responders && InnerMapReactions._responders.has(npc.id)) || !!npc._spottedHider,
                chatting: !!(npc.activity && npc.activity.type === 'chat'),
                working: !!(npc.activity && npc.activity.type && npc.activity.type !== 'chat' && npc.state === 'idle'),
                perceptive: StealthCover.perceptiveTraits(npc.personalityTraits),
            };
            const rate = StealthCover.noticeRate({ ...env, dist: d, watcher });
            if (rate <= 0) continue;
            danger = Math.max(danger, rate);
            if (!spotter && this._roll(game, `see|${npc.id}`) < StealthCover.noticeChance(rate, dt)) spotter = npc;
        }
        this._danger = danger;
        this._prompt = prompt;
        if (spotter) { this._spotted(game, spotter); return; }
        // Stealth by the minute hidden (a minute of the map's time, capped a visit)
        this._hiddenSecs += dt;
        if (this._hiddenSecs >= 60) {
            this._hiddenSecs -= 60;
            const T = C.train;
            if (_num(this._trainedThisVisit) < _num(T.hideMax, 12)) {
                this._trainedThisVisit = _num(this._trainedThisVisit) + 1;
                SocialSkills.train(player, 'stealth', StealthCover.xp('hideMinute'));
            }
        }
        if (this._still >= _num(C.listen.stillSecs, 4)) this._watchAgents(game);
    },

    /** Spotted in cover: they call out, and you are out of hiding. */
    _spotted(game, npc) {
        const h = this.hidden;
        const word = h ? h.word : 'cover';
        npc._spottedHider = true;
        npc.facing = InnerMapCharacters.getDirection(InnerMap.playerInnerQ - npc.q, InnerMap.playerInnerR - npc.r);
        npc.idleTimer = Math.max(_num(npc.idleTimer), 3);
        const guard = npc.type === 'guard';
        const line = StealthCover.line(guard ? 'spottedGuard' : 'spotted', this._roll(game, 'line'));
        if (line) InnerMapReactions.bark(npc, line, 3);
        // Skulking in the bushes: they think a little less of you
        if (!guard && npc.type !== 'child') NpcDisposition.adjustDisposition(npc, -3, game.player);
        this.unhide(game, null, true);
        _notify(game, '👁️ Seen', `${npc.name || 'Someone'} spotted you in the ${word}.${guard && InnerMap._curfew ? ' The watch will want to know what you are about.' : ''}`, 'warning');
    },

    /** Hidden and still near a rival House's agent: you watch them, and they grow suspect. */
    _watchAgents(game) {
        const L = StealthCover.config().listen;
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        const radius = _num(L.agentRadius, 5);
        if (!RivalAgents.list(game.player).length) return;
        for (const npc of InnerMap.npcs || []) {
            if (!npc || !npc._person || BLIND.has(npc.state) || _dist(npc.q, npc.r, pq, pr) > radius) continue;
            const res = RivalAgents.overheard(game.player, game.world, npc._person.id, _num(L.agentSuspicion, 30));
            if (!res) continue;
            if (res.notice) _notify(game, `${res.notice.icon || '🕵️'} ${res.notice.title}`, `From the ${this.hidden ? this.hidden.word : 'shadows'} you watch ${npc.name} meet a stranger and pass him something. ${res.notice.text}`, 'warning');
            else _notify(game, '👂 Watched from cover', `From the ${this.hidden ? this.hidden.word : 'shadows'} you watch ${npc.name} a while: a quiet word with a stranger, a look over the shoulder. Someone here is in a rival's pay, and ${npc.gender === 'female' ? 'she' : 'he'} acts like it.`, 'info');
            return;
        }
    },

    /** ui/innerMapOverheard.js: { chance, radius } boosts while hidden and still. */
    listenBoost() {
        if (!this.hidden) return { chance: 1, radius: 0 };
        const L = StealthCover.config().listen;
        return { chance: _num(L.chanceMult, 2.2), radius: _num(L.radiusBonus, 2) };
    },

    // ──────────── THE AMBUSH ────────────

    /** Is this NPC unaware of you (not fighting you, not after you, not having seen you hide)? */
    _unaware(npc) {
        if (!npc) return false;
        if (npc._spottedHider || npc.state === 'dialog' || npc._dialogFrozen) return false;
        if (InnerMapCombat._npcReactions && InnerMapCombat._npcReactions.has(npc.id)) return false;
        if (InnerMapReactions._responders && InnerMapReactions._responders.has(npc.id)) return false;
        return true;
    },

    /** Out of the cover in a bound to their side: the nearest open cell beside them, within two of you. */
    _lunge(npc) {
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        if (_dist(npc.q, npc.r, pq, pr) <= 1) return true;
        let best = null;
        for (let dr = -1; dr <= 1; dr++) for (let dq = -1; dq <= 1; dq++) {
            if (!dq && !dr) continue;
            const q = npc.q + dq, r = npc.r + dr;
            const t = InnerMap.getTile(q, r);
            if (!t || !t.subTerrain || !t.subTerrain.passable || t.building || t.customBuilding || t.customBuildingPart) continue;
            if ((InnerMap.npcs || []).some(n => n !== npc && n.q === q && n.r === r && !BLIND.has(n.state))) continue;
            const d = _dist(q, r, pq, pr);
            if (d > 2 || (best && d >= best.d)) continue;
            best = { q, r, d };
        }
        if (!best) return false;
        InnerMap.cancelPlayerWalk();
        InnerMap.playerInnerQ = InnerMap._playerPrevQ = best.q;
        InnerMap.playerInnerR = InnerMap._playerPrevR = best.r;
        return true;
    },

    /** What the ambush has to go on: your Stealth, the dark, your light, are they unaware. */
    _ambushCtx(game, npc) {
        const player = game.player;
        const light = this._light(player);
        const darkness = this._darkness();
        return {
            stealth: this._stealth(player), darkness, lit: light.lit && darkness > 0.2, unaware: this._unaware(npc),
            night: darkness >= 0.45 && !(light.lit && darkness > 0.2), guard: npc.type === 'guard', child: npc.type === 'child',
            aggressive: Duels.npcTemperament(npc) === 'aggressive', fromCover: !!this.hidden,
        };
    },

    /** Can you spring on them now (hidden, within reach)? → null or the refusal. */
    _whyNot(game, npc) {
        if (!this.hidden) return 'You are not hidden.';
        if (!npc || BLIND.has(npc.state) || npc._carried) return 'They are not there.';
        const reach = _num(StealthCover.config().ambush.reach, 2);
        if (_dist(npc.q, npc.r, InnerMap.playerInnerQ, InnerMap.playerInnerR) > reach) return `${npc.name} is out of reach.`;
        return null;
    },

    /** F, or Spring on Them: the strike from cover. */
    strike(game, npc = this._prompt) {
        const why = this._whyNot(game, npc);
        if (why) { _notify(game, '⚔️ Ambush', why, 'info'); return false; }
        const ctx = this._ambushCtx(game, npc);
        const sk = InnerMapCombat._playerFightSkill(game.player);
        const sur = StealthCover.surprise({ ...ctx, brawling: sk === 'brawling' });
        const ko = this._roll(game, `ko|${npc.id}`) < sur.koChance;
        const blind = StealthCover.blindside({ unaware: ctx.unaware, felled: ko, darkness: ctx.darkness, lit: ctx.lit });
        if (!this._lunge(npc)) { _notify(game, '⚔️ Ambush', `There is no way to get at ${npc.name} from here.`, 'info'); return false; }
        this.unhide(game, null, true);
        npc._blindside = blind;
        if (ko) { npc._hushed = 10; npc._barked = true; }
        InnerMapCombat._surprise = { npcId: npc.id, mult: sur.mult, ko, label: ko ? 'Felled!' : 'Ambush!' };
        InnerMapCombat.startAttackNPC(game, npc);
        const ia = InnerMapCombat._attackState;
        if (!ia || ia.npc !== npc) { InnerMapCombat._surprise = null; return false; }
        // Caught off guard: their first blow back is slow to come
        const react = InnerMapCombat._npcReactions.get(npc.id);
        if (react && react.mode === 'fight') react.attackTimer = _num(react.attackTimer) + _num(StealthCover.config().ambush.stunSecs, 1.4);
        SocialSkills.train(game.player, 'stealth', StealthCover.xp('ambush') + (blind ? StealthCover.xp('unseen') : 0));
        if (blind) _notify(game, '🌑 Unseen', `${npc.name} never saw who struck ${npc.gender === 'female' ? 'her' : 'him'}.`, 'info');
        return true;
    },

    /** Seize and bind: rope round their wrists before they can cry out (cloth gags them). */
    grab(game, npc) {
        const why = this._whyNot(game, npc);
        if (why) { _notify(game, '➰ Seize', why, 'info'); return false; }
        const inv = game.player.inventory || {};
        const rope = Downed.bindItem(inv);
        if (!rope) { _notify(game, '➰ No rope', 'You need rope to tie anyone up.', 'warning'); return false; }
        const ctx = this._ambushCtx(game, npc);
        let brawling = 1;
        try { brawling = CombatSkills.level(game.player, 'brawling') || 1; } catch (e) { brawling = 1; }
        const p = StealthCover.grabChance({ ...ctx, brawling });
        if (!this._lunge(npc)) { _notify(game, '➰ Seize', `There is no way to get at ${npc.name} from here.`, 'info'); return false; }
        this.unhide(game, null, true);
        npc.facing = InnerMapCharacters.getDirection(InnerMap.playerInnerQ - npc.q, InnerMap.playerInnerR - npc.r);
        if (this._roll(game, `grab|${npc.id}`) >= p) {
            InnerMapReactions.bark(npc, StealthCover.line('grabFailed', this._roll(game, 'gf')) || 'Get off me!', 3);
            _notify(game, '➰ They break free', `${npc.name} twists out of your grip.`, 'warning');
            InnerMapCombat.startAttackNPC(game, npc);
            return false;
        }
        const use = (id) => { inv[id] -= 1; if (inv[id] <= 1e-9) delete inv[id]; };
        use(rope);
        const cloth = Downed.gagItem(inv);
        if (cloth) { use(cloth); npc._gagged = true; }
        npc._bound = true;
        npc._blindside = StealthCover.blindside({ unaware: ctx.unaware, felled: false, darkness: ctx.darkness, lit: ctx.lit });
        if (npc._gagged) { npc._hushed = 10; npc._barked = true; }
        npc.path = null;
        npc.moveProgress = 0;
        npc._targetBuilding = null;
        npc._activity = null;
        InnerMapCarry.markLying(npc);
        InnerMapDowned.wokeBound(npc);
        InnerMapReactions.bark(npc, StealthCover.line('grabbed', this._roll(game, 'gb')) || 'Mmph—!', 2.5);
        npc._assaultRippled = true;
        InnerMapReactions.onViolence(game, npc, 'assault');
        if (!npc._blindside) NpcDisposition.adjustDisposition(npc, -25, game.player);
        SocialSkills.train(game.player, 'stealth', StealthCover.xp('grab') + (npc._blindside ? StealthCover.xp('unseen') : 0));
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, game.world);
        _notify(game, '➰ Seized', `You drag ${npc.name} down and tie ${npc.gender === 'female' ? 'her' : 'him'} hand and foot${npc._gagged ? ', a gag in the mouth' : ''}.${npc._blindside ? ' In the dark, from behind: they never saw your face.' : ''} Click them for what comes next.`, 'warning');
        return true;
    },

    /** A blade at their back: their purse (real coin out of it), or a fight. */
    mug(game, npc) {
        const why = this._whyNot(game, npc);
        if (why) { _notify(game, '💰 Rob', why, 'info'); return false; }
        const ctx = this._ambushCtx(game, npc);
        const armed = Duels.playerWeapon(game.player).id !== 'fists';
        const p = StealthCover.mugChance({ ...ctx, armed, noble: npc.type === 'noble' });
        if (!this._lunge(npc)) { _notify(game, '💰 Rob', `There is no way to get at ${npc.name} from here.`, 'info'); return false; }
        this.unhide(game, null, true);
        npc.facing = InnerMapCharacters.getDirection(InnerMap.playerInnerQ - npc.q, InnerMap.playerInnerR - npc.r);
        if (npc._koSearched || this._roll(game, `mug|${npc.id}`) >= p) {
            InnerMapReactions.bark(npc, StealthCover.line('mugRefused', this._roll(game, 'mr')) || 'Help! Thief!', 3);
            _notify(game, '💰 They won\'t give it up', `${npc.name} won't hand it over.`, 'warning');
            InnerMapCombat.startAttackNPC(game, npc);
            return false;
        }
        const { gold, items } = InnerMapCombat._takeSpoils(npc, game);
        npc._koSearched = true;
        npc._blindside = StealthCover.blindside({ unaware: ctx.unaware, felled: false, darkness: ctx.darkness, lit: ctx.lit });
        InnerMapReactions.bark(npc, StealthCover.line('mugged', this._roll(game, 'mg')) || 'Take it!', 3);
        npc._assaultRippled = true;
        const res = InnerMapReactions.onViolence(game, npc, 'assault');
        // The theft on top of the threat (Underworld heat, the deed's mark), as seen or unseen
        const seen = !!(res && res.witnesses && res.witnesses.some(w => w.seen));
        const s = this._settlement();
        try {
            const C = StreetCrime.config();
            Underworld.recordCrime(game.player, game.world, 'robbery', { kingdom: s ? s.kingdom : null, scale: seen ? 1 : _num(C.heat && C.heat.unseenShare && C.heat.unseenShare.assault, 0.3) });
        } catch (e) { /* no underworld data */ }
        if (!npc._blindside) NpcDisposition.adjustDisposition(npc, -20, game.player);
        npc._broke = true;
        InnerMapReactions._flee(npc, { indoors: false });
        SocialSkills.train(game.player, 'stealth', StealthCover.xp('mug') + (npc._blindside ? StealthCover.xp('unseen') : 0));
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(game.player, game.world);
        const parts = [];
        if (gold > 0) parts.push(`${gold} gold`);
        for (const it of items) parts.push(`${it.qty} ${String(it.id).replace(/_/g, ' ')}`);
        _notify(game, '💰 Robbed', `${npc.name} hands over ${parts.length ? parts.join(', ') : 'an empty purse'} and runs.${npc._blindside ? ' In the dark, from behind: they never saw your face.' : ''}`, 'warning');
        return true;
    },

    // ──────────── THOSE WHO LIE IN WAIT ────────────

    /** Drawn not at all while they lie unseen (innerMapLayers/entities.js), nor listed in a cell's menu. */
    unseenLurker(npc) {
        return !!(npc && npc._lurk && !npc._lurk.seen && !npc._lurk.sprung);
    },

    /** What draws them to you here. */
    _lurkCtx(game) {
        const player = game.player, world = game.world;
        const s = this._settlement();
        const hour = _num(InnerMap.timeOfDay, 12);
        const night = NpcTheft.isNight(hour) || this._darkness() >= 0.45;
        let bounty = 0;
        try { bounty = _num(Gossip.getPlayerNotoriety(player).totalBounty); } catch (e) { bounty = 0; }
        let feud = 0, feudHouse = null;
        const rivals = (player.house && player.house.rivals) || {};
        for (const [key, rv] of Object.entries(rivals)) {
            if (rv && _num(rv.feud) > feud) { feud = _num(rv.feud); feudHouse = rv.name || rv.houseName || key; }
        }
        let assassinPlot = false, nemesis = false, lair = false, poor = false;
        try { assassinPlot = Schemes.active(player).some(sc => sc && sc.type === 'assassin'); } catch (e) { assassinPlot = false; }
        try { nemesis = Nemesis.active(player).length > 0; } catch (e) { nemesis = false; }
        if (s) {
            try { lair = !!NpcTheft._lairNear(world, s, player); } catch (e) { lair = false; }
            try { poor = SettlementWealth.tierOf(SettlementWealth.standing(s, world.day)) === 'poor'; } catch (e) { poor = false; }
        }
        const curfew = !!(InnerMap._curfew && typeof InnerMap._curfewNow === 'function' && InnerMap._curfewNow(hour));
        return { night, wilds: !s, bounty, feud, feudHouse, assassinPlot, nemesis, lair, poor, curfew };
    },

    _lurkStep(game, dt) {
        // Those lying in wait: spotted by you, or springing
        this._lurkers = this._lurkers.filter(n => n && n.state !== 'gone' && !n.dead && (InnerMap.npcs || []).includes(n));
        for (const npc of this._lurkers) this._lurkerTick(game, npc, dt);
        // A new one, once a game hour at most
        const day = _num(game.world.day);
        const hourKey = `${day}|${Math.floor(_num(InnerMap.timeOfDay, 12))}`;
        if (hourKey === this._hourKey) return;
        const first = this._hourKey == null;
        this._hourKey = hourKey;
        // (not the hour you arrive in: give the street a moment)
        if (first || game._scene || game.player.jailState || InnerMap.inJail && InnerMap.inJail()) return;
        const L = StealthCover.config().lurk;
        if (this._visitLurks >= _num(L.maxPerVisit, 2) || this._lurkers.some(n => !n._lurk.sprung)) return;
        const ctx = this._lurkCtx(game);
        if (this._roll(game, 'lurk') >= StealthCover.lurkChance(ctx)) return;
        this._spawnLurker(game, ctx);
    },

    /** Someone takes up a place in cover between you and where you are going. */
    _spawnLurker(game, ctx) {
        const L = StealthCover.config().lurk;
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        const lo = _num(L.minDist, 6), hi = _num(L.maxDist, 14);
        const spots = StreetCover.spots(InnerMap.tiles).filter(s => {
            const d = _dist(s.q, s.r, pq, pr);
            return d >= lo && d <= hi && !(InnerMap.npcs || []).some(n => n.q === s.q && n.r === s.r);
        });
        if (!spots.length) return null;
        const spot = spots[Math.floor(this._roll(game, 'spot') * spots.length) % spots.length];
        const cover = StreetCover.coverAt(InnerMap.tiles, spot.q, spot.r, {});
        if (!cover) return null;
        const kind = StealthCover.lurkKind(this._roll(game, 'kind'), ctx);
        const def = StealthCover.lurkDef(kind);
        let x = (this._roll(game, 'npc') * 1e9) >>> 0;
        const rng = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
        const id = (InnerMap.npcs || []).reduce((m, n) => Math.max(m, _num(n.id)), 0) + 1;
        const npc = InnerMap._makeNpc && (InnerMap._makeNpc('traveler', id, rng) || InnerMap._makeNpc('villager', id, rng));
        if (!npc) return null;
        npc.q = npc.prevQ = npc.targetQ = spot.q;
        npc.r = npc.prevR = npc.targetR = spot.r;
        npc.name = kind === 'agent' && ctx.feudHouse ? `${ctx.feudHouse}'s man` : def.name || 'Hooded stranger';
        npc.roleTitle = def.role || 'Cutthroat';
        npc.state = 'idle';
        npc.idleTimer = 99999;
        npc.path = null;
        npc._nightFolk = true;
        npc._outlaw = kind === 'footpad' || kind === 'cutthroat' || kind === 'outlaw';
        npc._robIntent = _num(def.rob);
        npc._killIntent = _num(def.kill);
        // (fighting off one who lay in wait for you is no crime of yours)
        npc._assaultRippled = true;
        npc.personalityTraits = _num(def.kill) >= 0.2 ? ['bold'] : ['witty'];
        npc._lurk = { kind, seen: false, sprung: false, word: cover.word, quality: cover.quality, house: ctx.feudHouse, at: _now() };
        InnerMap.npcs.push(npc);
        // Tougher than a townsman, as their trade asks
        const maxHp = Math.round((Duels.npcBrawlHp(npc) || InnerMapCombat.NPC_BASE_HEALTH[npc.type] || 60) * Math.max(0.5, _num(def.hp, 1)));
        InnerMapCombat._npcHealth.set(npc.id, { current: maxHp, max: maxHp });
        this._lurkers.push(npc);
        this._visitLurks++;
        return npc;
    },

    _lurkerTick(game, npc, dt) {
        const lk = npc._lurk;
        if (!lk || lk.sprung) return;
        if (BLIND.has(npc.state)) return;
        const player = game.player;
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        const d = _dist(npc.q, npc.r, pq, pr);
        const L = StealthCover.config().lurk;
        // Your eye for them, before they move
        if (!lk.seen && d <= 10) {
            const light = this._light(player);
            const rate = StealthCover.noticeRate({
                dist: d, cover: lk.quality, darkness: this._darkness(), ...this._weather(), watcherLit: light.lit,
                stealth: StealthCover.npcStealth(lk.kind), moving: false, armour: 0,
                watcher: { mult: StealthCover.perception(this._stealth(player), Traits.getEarned(player)) },
            });
            if (rate > 0 && this._roll(game, `eye|${npc.id}`) < StealthCover.noticeChance(rate, dt)) {
                lk.seen = true;
                SocialSkills.train(player, 'stealth', StealthCover.xp('spot'));
                _notify(game, '👁️ Someone in the ' + lk.word, `${_an(npc.roleTitle).replace(/^a/, 'A')} ${String(npc.roleTitle).toLowerCase()} lies in wait in the ${lk.word} ahead${d <= 4 ? ' — and knows you have seen.' : '.'}`, 'warning');
                if (d > 4 && this._roll(game, `flee|${npc.id}`) < _num(L.fleeChance, 0.4)) {
                    InnerMapReactions.bark(npc, StealthCover.line('made', this._roll(game, 'made')) || 'Damn it.', 2.5);
                    lk.sprung = true;
                    npc._broke = true;
                    InnerMapReactions._flee(npc, { indoors: false });
                    return;
                }
                this._spring(game, npc, false);
                return;
            }
        }
        if (d <= _num(L.springReach, 2) && !game._scene && !InnerMapCombat._playerOut) this._spring(game, npc, !lk.seen && !this.hidden);
    },

    /** Out of the cover at you: the first blow theirs if you never saw them. */
    _spring(game, npc, surprise) {
        const lk = npc._lurk;
        lk.sprung = true;
        lk.seen = true;
        const player = game.player;
        const pool = lk.kind === 'assassin' || lk.kind === 'agent' ? 'springAssassin' : lk.kind === 'hunter' ? 'springHunter' : 'spring';
        InnerMapReactions.bark(npc, StealthCover.line(pool, this._roll(game, 'spring'), { house: lk.house || 'Your enemies' }) || 'Got you now.', 3);
        // Out of the cover to your side
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        if (_dist(npc.q, npc.r, pq, pr) > 1) {
            const spot = InnerMap._findPassableAdjacentTile ? InnerMap._findPassableAdjacentTile(pq, pr) : null;
            if (spot) { npc.q = npc.prevQ = spot.q; npc.r = npc.prevR = spot.r; npc.path = null; npc.moveProgress = 0; }
        }
        npc.facing = InnerMapCharacters.getDirection(pq - npc.q, pr - npc.r);
        npc.idleTimer = 5;
        // Who started it: they did (systems/knockout.js reads it if you go down)
        npc._struckPlayerFirst = true;
        npc._provokedBy = 'npc';
        this.unhide(game, null, true);
        InnerMapReactions._respond(npc, 'fight', null);
        const resp = InnerMapReactions._responders.get(npc.id);
        if (resp) resp.left = 90;
        InnerMapCombat._npcReactions.set(npc.id, { mode: 'fight', attackTimer: surprise ? 0.6 : 0.9 });
        const what = `${_an(npc.roleTitle).replace(/^a/, 'A')} ${String(npc.roleTitle).toLowerCase()}`;
        if (surprise) {
            // The blow you never saw coming
            const sur = StealthCover.config().ambush;
            const dmg = Math.max(1, Math.round(PlayerEffects.scaleDamage(player, Duels.npcSwing(npc, () => this._roll(game, 'swing'))) * _num(sur.strikeMult, 1.8)));
            player.health = Math.max(0, _num(player.health) - dmg);
            const T = 32;
            InnerMapCombat._spawnFloat(pq * T + T / 2, pr * T + T * 0.1, dmg, 'player_hit', 'Ambushed!');
            InnerMapCombat._spawnHitFlash(pq * T + T / 2, pr * T + T / 2);
            if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
            _notify(game, '⚠️ Ambush!', `${what} springs out of the ${lk.word} and is on you before you can turn.`, 'error');
            if (player.health <= 0) InnerMapCombat._knockOutPlayer(game, npc);
        } else {
            _notify(game, '⚠️ Ambush!', `${what} comes out of the ${lk.word} at you!`, 'error');
        }
    },

    // ──────────── MENUS ────────────

    /** On a prop that hides you (a bush, a haystack, a stall, a tree): Hide in it. */
    objectItems(game, def, anchorQ, anchorR) {
        if (!game || !game.player || InnerMap._insideBuilding || anchorQ == null) return [];
        const cells = StreetCover.cellsOf(InnerMap.tiles, anchorQ, anchorR);
        if (!cells.length) return [];
        const pq = InnerMap.playerInnerQ, pr = InnerMap.playerInnerR;
        const here = cells.some(c => c.q === pq && c.r === pr);
        if (here && this.hidden) return [];
        const best = cells.slice().sort((a, b) => _dist(a.q, a.r, pq, pr) - _dist(b.q, b.r, pq, pr))[0];
        const kind = cells[0].kind;
        const C = StealthCover.coverDef(kind) || { word: 'cover' };
        const name = String((def && def.name) || C.word).toLowerCase();
        const how = kind === 'crops' ? `Down among the ${name}` : `Behind the ${name}`;
        return [{ type: 'action', action: 'hide_at', label: kind === 'crops' ? 'Hide in the Field' : `Hide Behind the ${(def && def.name) || 'Cover'}`, icon: '🌿', desc: `${how}: hard to see from the street, harder at night. (H)`, q: best.q, r: best.r }];
    },

    /** On yourself: Hide Here / Come Out of Hiding. */
    selfItems(game) {
        if (!game || !game.player || InnerMap._insideBuilding) return [];
        if (this.hidden) return [{ type: 'action', action: 'hide_out', label: 'Come Out of Hiding', icon: '🚶', desc: `Step out of the ${this.hidden.word} (H)` }];
        const c = this.coverHere();
        if (!c) return [];
        return [{ type: 'action', action: 'hide_here', label: `Hide in the ${c.word.replace(/\b\w/g, m => m.toUpperCase())}`, icon: '🌿', desc: 'Keep still and out of sight. (H)' }];
    },

    /** On the people in reach while you hide: spring on them. */
    personItems(game, standing) {
        if (!this.hidden || !Array.isArray(standing)) return [];
        const reach = _num(StealthCover.config().ambush.reach, 2);
        const out = [];
        for (const npc of standing) {
            if (!npc || npc._taskFoe || BLIND.has(npc.state) || this.unseenLurker(npc)) continue;
            if (_dist(npc.q, npc.r, InnerMap.playerInnerQ, InnerMap.playerInnerR) > reach) continue;
            const ctx = this._ambushCtx(game, npc);
            const sur = StealthCover.surprise({ ...ctx, brawling: InnerMapCombat._playerFightSkill(game.player) === 'brawling' });
            const unaware = ctx.unaware ? 'They haven\'t seen you.' : 'They know you are there.';
            out.push({ type: 'header', label: `🌿 Ambush ${npc.name}` });
            out.push({ type: 'action', action: 'hide_strike', label: 'Spring on Them', icon: '⚔️', desc: `A heavy first blow from cover, ${Math.round(sur.koChance * 100)}% to fell them outright. ${unaware} (F)`, npc });
            const rope = Downed.bindItem(game.player.inventory || {});
            if (rope) {
                let brawling = 1;
                try { brawling = CombatSkills.level(game.player, 'brawling') || 1; } catch (e) { brawling = 1; }
                out.push({ type: 'action', action: 'hide_grab', label: 'Seize and Bind', icon: '➰', desc: `Rope round their wrists before they can cry out: ${Math.round(StealthCover.grabChance({ ...ctx, brawling }) * 100)}%.`, npc });
            } else out.push({ type: 'disabled', label: '➰ Seize and Bind — you have no rope' });
            if (!npc._koSearched && npc.type !== 'child') {
                const armed = Duels.playerWeapon(game.player).id !== 'fists';
                out.push({ type: 'action', action: 'hide_mug', label: 'Rob Them', icon: '💰', desc: `${armed ? 'A blade at their back' : 'A hand over their mouth'}: their purse or a fight — ${Math.round(StealthCover.mugChance({ ...ctx, armed, noble: npc.type === 'noble' }) * 100)}% they hand it over.`, npc });
            }
        }
        return out;
    },

    /** The menu's actions (hide_*). → true when handled. */
    handle(game, item) {
        if (!item || typeof item.action !== 'string' || !item.action.startsWith('hide_')) return false;
        switch (item.action) {
            case 'hide_here': if (!this.hide(game)) _notify(game, '🌿 No cover here', 'There is nothing here to hide in.', 'info'); return true;
            case 'hide_out': this.unhide(game, 'You come out of hiding.'); return true;
            case 'hide_at': this.goHide(game, item.q, item.r); return true;
            case 'hide_strike': this.strike(game, item.npc); return true;
            case 'hide_grab': this.grab(game, item.npc); return true;
            case 'hide_mug': this.mug(game, item.npc); return true;
            default: return false;
        }
    },

    /** Keys on the street map: H hides or comes out, F springs on whoever is in reach. → true when used. */
    key(game, e) {
        if (!InnerMap.active || !e || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return false;
        if (typeof document !== 'undefined' && (document.getElementById('npcDialogOverlay') || document.getElementById('customPanel'))) return false;
        if (e.key === 'h' || e.key === 'H') { this.toggle(game); return true; }
        if ((e.key === 'f' || e.key === 'F') && this.hidden) {
            if (this._prompt) this.strike(game, this._prompt);
            else _notify(game, '⚔️ Ambush', 'No one within reach. Wait for someone to pass close by.', 'info');
            return true;
        }
        return false;
    },

    // ──────────── DRAWING ────────────

    /**
     * The player's draw (innerMapLayers/entities.js Phase 4): faint while hidden,
     * the eye over the head, the hint for who is in reach; "H — hide" in cover.
     */
    wrapPlayerDraw(item, ctx, px, py, ds) {
        if (!item || typeof item.draw !== 'function') return;
        const h = this.hidden, prompt = this._prompt, hint = !h && this._hintCover;
        if (!h && !hint) return;
        const draw = item.draw;
        const danger = this._danger;
        item.draw = () => {
            if (h) {
                ctx.save();
                ctx.globalAlpha *= 0.55;
                draw();
                ctx.restore();
                this._drawEye(ctx, px, py - ds * 2.05, ds, danger);
                if (prompt) drawMapText(ctx, `F — spring on ${prompt.name}`, px, py + ds * 0.62, { size: Math.min(14, Math.max(10, ds * 0.14)), family: 'body', color: '#ffd27a' });
            } else {
                draw();
                drawMapText(ctx, `H — hide in the ${hint.word}`, px, py + ds * 0.62, { size: Math.min(12, Math.max(9, ds * 0.12)), family: 'body', color: 'rgba(200,235,190,0.9)', alpha: 0.85 });
            }
        };
    },

    /** The eye: shut and green while no one is looking your way, opening amber to red as notice grows. */
    _drawEye(ctx, x, y, ds, danger) {
        const s = Math.max(7, ds * 0.22);
        // (danger is a rate per second: 0.5/s is being seen within a couple of seconds)
        const open = Math.max(0, Math.min(1, danger / 0.5));
        const col = open < 0.25 ? '120,210,120' : open < 0.6 ? '240,190,80' : '235,90,70';
        ctx.save();
        ctx.fillStyle = 'rgba(10,12,16,0.7)';
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x - s * 1.7, y - s * 0.95, s * 3.4, s * 1.9, s * 0.9);
        else ctx.rect(x - s * 1.7, y - s * 0.95, s * 3.4, s * 1.9);
        ctx.fill();
        ctx.strokeStyle = `rgba(${col},0.95)`;
        ctx.lineWidth = Math.max(1.2, s * 0.18);
        const lid = 0.12 + open * 0.68;
        ctx.beginPath();
        ctx.moveTo(x - s * 1.2, y);
        ctx.quadraticCurveTo(x, y - s * lid * 1.4, x + s * 1.2, y);
        ctx.quadraticCurveTo(x, y + s * lid * 1.4, x - s * 1.2, y);
        ctx.stroke();
        if (open > 0.15) {
            ctx.fillStyle = `rgba(${col},0.95)`;
            ctx.beginPath();
            ctx.arc(x, y, s * 0.32 * Math.min(1, lid * 1.6), 0, Math.PI * 2);
            ctx.fill();
        } else {
            // shut: the lashes
            for (const dx of [-0.6, 0, 0.6]) {
                ctx.beginPath();
                ctx.moveTo(x + dx * s, y + s * 0.15);
                ctx.lineTo(x + dx * s * 1.15, y + s * 0.5);
                ctx.stroke();
            }
        }
        ctx.restore();
    },
};
