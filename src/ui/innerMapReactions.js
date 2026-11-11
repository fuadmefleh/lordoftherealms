// ============================================
// INNER MAP REACTIONS — the street reacts when the player turns violent
// ============================================
// The UI half of systems/streetCrime.js. When the player starts beating
// someone (assault) or kills them (murder) on the inner map:
//
//   - the witnesses are chosen (StreetCrime.selectWitnesses) and the deed
//     recorded (StreetCrime.record: rumour, heat, karma, memories);
//   - each witness reacts on the spot (StreetCrime.reactionFor): a bark over
//     their head, then they flee to the edge of the map, cower where they
//     stand, stand and shout, come at the player (kin), or run to arrest
//     (guards, who also come running from out of sight);
//   - a guard who reaches the player opens the watch's choice scene
//     (ui/actionMenu/streetWatch.js);
//   - arriving in a town where an unanswered crime is still remembered, the
//     nearest guard comes for the player.
//
// Barks are drawn over the NPCs after the sprites (render, called from
// InnerMapCombat.render).

import { InnerMap } from '../world/innerMap.js';
import { CustomObjects } from '../world/customObjects.js';
import { StreetCrime } from '../systems/streetCrime.js';
import { Utils } from '../core/utils.js';
import { Duels } from '../systems/duels.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { SocialSkills } from '../systems/socialSkills.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { InnerMapRenderer } from './innerMapRenderer.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { ActionMenu } from './actionMenu.js';
import { NpcDialog } from './npcDialog.js';
import { labelZoom, textPx } from './mapInk.js';

function _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
}

function _dist(aq, ar, bq, br) {
    return Math.max(Math.abs(aq - bq), Math.abs(ar - br));
}

export const InnerMapReactions = {
    // npc.id → { mode: 'fight'|'arrest', left (game seconds of chase left), repath, incidentId, speed, confronted }
    _responders: new Map(),
    // npcs given a burst of speed to flee: npc.id → original speed
    _fleeing: new Map(),
    _visitKey: null,
    _lastTick: 0,
    _arrivalAt: 0,
    _arrivalChecked: true,

    /**
     * The player has harmed `victim`: pick the witnesses, record the crime,
     * and set the street reacting. Returns StreetCrime.record's result plus
     * the witnesses.
     */
    onViolence(game, victim, crime) {
        if (!game || !game.player || !victim || !InnerMap.active) return null;
        const C = StreetCrime.config();
        const player = game.player;
        const world = game.world;
        const day = (world && world.day) || 0;
        // (Stealth: seen and heard from less far off, the watch slower to start — systems/socialSkills.js)
        this._player = game.player;
        const scene = { q: victim.q, r: victim.r, indoors: !!InnerMap._insideBuilding, sightCut: SocialSkills.perk(game.player, 'stealth', 'sight') };
        const npcs = InnerMap.npcs || [];
        const witnesses = StreetCrime.selectWitnesses(npcs, scene, victim);
        let playerAttack = 0;
        try { playerAttack = Duels.fromPlayer(player, { mods: PlayerEffects.duelModifiers(player), fresh: true }).attack; } catch (e) { playerAttack = 0; }
        const seed = `${day}|${StreetCrime.npcKey(victim)}|${crime}`;
        for (const w of witnesses) {
            w.react = StreetCrime.reactionFor(w, crime, { seed, victimName: victim.name, playerAttack, royal: this._royal(game) });
            w.mood = w.react.mood;
        }
        const wt = InnerMap.currentWorldTile || {};
        const res = StreetCrime.record(player, world, { crime, victim, witnesses, q: wt.q, r: wt.r, scene, onMap: npcs });

        // The street reacts
        const secs = (C.reactions && C.reactions.barkSeconds) || 3.6;
        for (const w of witnesses) {
            const npc = w.npc;
            if (npc._dialogFrozen) continue;
            if (w.react.bark) this.bark(npc, w.react.bark, secs);
            switch (w.react.act) {
                case 'arrest': this._respond(npc, 'arrest', res && res.incident); break;
                case 'fight': this._respond(npc, 'fight', res && res.incident); break;
                case 'flee': this._flee(npc, scene); break;
                case 'cower': this._hold(npc, 14); break;
                default: this._hold(npc, 10); break;
            }
        }
        // Who has already reacted to this victim's beating (onOngoing adds the newcomers)
        victim._incidentId = res && res.incident ? res.incident.id : victim._incidentId;
        victim._crime = crime;
        if (!victim._reacted) victim._reacted = new Set();
        for (const w of witnesses) victim._reacted.add(w.npc.id);
        this._earshot(npcs, scene, victim, witnesses, `${seed}|heard`);
        // A beaten victim cries out
        if (crime === 'assault' && !victim._barked) {
            victim._barked = true;
            const line = StreetCrime.bark('victim', 'assault', StreetCrime._moodOf(victim), { victim: victim.name }, seed);
            if (line) this.bark(victim, line, secs);
        }

        if (game.ui && typeof game.ui.showNotification === 'function') {
            const seen = witnesses.filter(w => w.seen);
            const guards = witnesses.filter(w => w.react.act === 'arrest').length;
            const royal = this._royal(game) && witnesses.some(w => w.role === 'guard');
            if (seen.length) {
                const names = seen.slice(0, 3).map(w => w.npc.name).join(', ');
                game.ui.showNotification(crime === 'murder' ? '👁️ Witnessed!' : '👁️ Seen!',
                    `${seen.length} saw you ${crime === 'murder' ? 'kill' : crime === 'vandalism' ? 'smashing' : 'attack'} ${victim.name} (${names}${seen.length > 3 ? '…' : ''}). They will remember it, and the town will talk.${guards ? ' The watch is coming!' : royal ? ' Your watch looks the other way.' : ''}`,
                    'warning');
            } else if (crime === 'murder') {
                game.ui.showNotification('🤫 Unseen', `No one saw you kill ${victim.name}. The body will be found all the same.`, 'warning');
            }
        }
        return { ...(res || {}), witnesses };
    },

    /**
     * The player has struck one of the town's things (a well, a stall, a lamp, a
     * barrel, the furniture in someone's house): vandalism. Those who see it
     * shout, flee or stand; the watch comes to arrest. Once a thing (the
     * first blow is enough); not in the wild, nor in the player's own home.
     * Returns onViolence's result, or null when it isn't the town's to break.
     */
    onVandalism(game, q, r, defId) {
        if (!game || !game.player || !InnerMap.active) return null;
        const ref = InnerMap._currentWorldTileRef;
        if (!(ref && ref.settlement)) return null;
        const inside = InnerMap._insideBuilding;
        if (inside && InnerMap.isOwnHome && InnerMap.isOwnHome(inside)) return null;
        const tile = InnerMap.getTile(q, r);
        if (!tile) return null;
        const townThing = !!inside || /^tp_/.test(String(defId || '')) || tile._townCore || tile._townFade != null || tile._lot || tile._plaza;
        if (!townThing) return null;
        // The player's own ship at the pier is theirs to break
        if (tile.customObject && tile.customObject.playerShip) return null;
        // Gathering is work, not damage: chopping a tree, quarrying a rock, picking a bush
        // (anything with a resource to take) draws no one's ire
        let gathered = null;
        try { gathered = CustomObjects.getDef(defId); } catch (e) { gathered = null; }
        if (gathered && gathered.resource) return null;
        const wt = InnerMap.currentWorldTile || {};
        const day = (game.world && game.world.day) || 0;
        const key = `${day}|${wt.q},${wt.r}|${inside ? `${inside.q},${inside.r}|` : ''}${q},${r}`;
        if (!this._vandalised) this._vandalised = new Set();
        if (this._vandalised.has(key)) return null;
        this._vandalised.add(key);
        let def = null;
        try { def = CustomObjects.getDef(defId); } catch (e) { def = null; }
        const name = String((def && def.name) || 'the town’s property').replace(/\s*\(.*\)$/, '');
        const victim = { id: `thing:${key}`, name: /^the\s/i.test(name) ? name : `the ${name.toLowerCase()}`, type: 'property', q, r };
        return this.onViolence(game, victim, 'vandalism');
    },

    /**
     * Out of sight but within earshot (sight.hearRadius): the cries turn heads.
     * The timid (children, the cautious and kind) hurry off; the rest stop and
     * look toward the trouble. Not witnesses: they saw nothing to tell.
     */
    _earshot(npcs, scene, victim, witnesses, seed) {
        if (scene.indoors) return;
        const C = StreetCrime.config();
        const radius = Number(C.sight && C.sight.hearRadius) || 0;
        if (radius <= 0) return;
        const hidden = new Set(C.sight.hiddenStates || []);
        const seen = new Set(witnesses.map(w => w.npc.id));
        const fear = new Set((C.reactions && C.reactions.fearTraits) || []);
        const lines = (C.barks && C.barks.heard) || [];
        let n = 0;
        for (const npc of npcs) {
            if (npc === victim || npc.state === 'unconscious' || seen.has(npc.id) || (victim._reacted && victim._reacted.has(npc.id)) || (victim._heard && victim._heard.has(npc.id)) || hidden.has(npc.state) || npc._dialogFrozen || npc._taskFoe) continue;
            if (_dist(npc.q, npc.r, scene.q, scene.r) > radius) continue;
            const timid = npc.type === 'child' || (npc.personalityTraits || []).some(t => fear.has(t));
            // Heard, not seen: should they come into sight of it, they react as a witness then
            if (!victim._heard) victim._heard = new Set();
            victim._heard.add(npc.id);
            if (timid) this._flee(npc, scene);
            else {
                this._hold(npc, 8);
                npc.facing = InnerMapCharacters.getDirection(scene.q - npc.q, scene.r - npc.r);
            }
            // Every other one calls out (a chorus of six is noise)
            if (lines.length && n++ % 2 === 0) {
                let h = 0;
                for (const ch of `${seed}|${npc.id}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
                this.bark(npc, lines[h % lines.length], 3);
            } else {
                // …and the rest still visibly start at the noise
                this.bark(npc, StreetCrime.foundEmote(timid ? 'fear' : 'anger', `${seed}|${npc.id}`), 2.5);
            }
        }
    },

    /**
     * The fight goes on (a chase down the street, a beating that lasts): anyone
     * who comes within sight of it now reacts as the first witnesses did, and
     * is added to the incident as a witness. Called every second or so by
     * InnerMapCombat while the player keeps at it.
     */
    onOngoing(game, victim) {
        if (!game || !game.player || !victim || !InnerMap.active || !victim._reacted) return;
        const C = StreetCrime.config();
        const crime = victim._crime || 'assault';
        const day = (game.world && game.world.day) || 0;
        // (Stealth: seen and heard from less far off, the watch slower to start — systems/socialSkills.js)
        this._player = game.player;
        const scene = { q: victim.q, r: victim.r, indoors: !!InnerMap._insideBuilding, sightCut: SocialSkills.perk(game.player, 'stealth', 'sight') };
        const npcs = InnerMap.npcs || [];
        const fresh = StreetCrime.selectWitnesses(npcs, scene, victim).filter(w => !victim._reacted.has(w.npc.id));
        if (!fresh.length) {
            // No one new in sight: those within earshot still turn at the noise
            this._earshot(npcs, scene, victim, [], `${day}|${StreetCrime.npcKey(victim)}|heard|late`);
            return;
        }
        let playerAttack = 0;
        try { playerAttack = Duels.fromPlayer(game.player, { mods: PlayerEffects.duelModifiers(game.player), fresh: true }).attack; } catch (e) { playerAttack = 0; }
        const seed = `${day}|${StreetCrime.npcKey(victim)}|${crime}|late`;
        const incident = victim._incidentId != null ? StreetCrime._incident(game.player, victim._incidentId) : null;
        const secs = (C.reactions && C.reactions.barkSeconds) || 3.6;
        for (const w of fresh) {
            victim._reacted.add(w.npc.id);
            w.react = StreetCrime.reactionFor(w, crime, { seed, victimName: victim.name, playerAttack, royal: this._royal(game) });
            w.mood = w.react.mood;
            const npc = w.npc;
            if (npc._dialogFrozen) continue;
            if (w.react.bark) this.bark(npc, w.react.bark, secs);
            switch (w.react.act) {
                case 'arrest': this._respond(npc, 'arrest', incident); break;
                case 'fight': this._respond(npc, 'fight', incident); break;
                case 'flee': this._flee(npc, scene); break;
                case 'cower': this._hold(npc, 14); break;
                default: this._hold(npc, 10); break;
            }
        }
        StreetCrime.addWitnesses(game.player, incident, fresh, victim, crime, day);
        const guards = fresh.filter(w => w.react.act === 'arrest');
        if (guards.length && game.ui && typeof game.ui.showNotification === 'function') {
            game.ui.showNotification('🛡️ The Watch', `${guards[0].npc.name} has seen you attacking ${victim.name} and is coming!`, 'error');
        }
    },

    /** The player rules this town's realm: its watch stands down (StreetCrime.aboveLaw). */
    _royal(game) {
        const ref = InnerMap._currentWorldTileRef;
        return !!(game && ref && ref.settlement && StreetCrime.aboveLaw(game.player, game.world, ref.settlement));
    },

    /** A line shouted over an NPC's head for `secs` seconds. */
    bark(npc, text, secs = 3.6) {
        if (!npc || !text) return;
        npc._bark = { text, until: _now() + secs * 1000 };
    },

    /** Freeze an NPC where they stand (cowering, shouting) for a while. */
    _hold(npc, secs) {
        if (npc.state === 'inside_building' && !InnerMap._insideBuilding) return;
        npc.path = null;
        npc.moveProgress = 0;
        if (npc.state === 'walking') npc.state = 'idle';
        npc.idleTimer = Math.max(npc.idleTimer || 0, secs);
        const dq = InnerMap.playerInnerQ - npc.q;
        const dr = InnerMap.playerInnerR - npc.r;
        npc.facing = InnerMapCharacters.getDirection(dq, dr);
    },

    /** Run for the edge of the map (gone for this visit); indoors, cower instead. */
    _flee(npc, scene) {
        if (scene.indoors) { this._hold(npc, 12); return; }
        const edge = InnerMap._findNearestEdgeTile(npc.q, npc.r);
        const path = edge ? InnerMap._findPath(npc.q, npc.r, edge.q, edge.r) : null;
        if (!path || path.length < 2) { this._hold(npc, 10); return; }
        const run = (StreetCrime.config().reactions || {}).runSpeed || 2.4;
        if (!this._fleeing.has(npc.id)) this._fleeing.set(npc.id, npc.speed);
        npc.speed = (this._fleeing.get(npc.id) || npc.speed || 1) * run;
        npc.departing = true;
        npc.path = path.slice(1);
        npc.pathIndex = 0;
        npc.moveProgress = 0;
        npc.prevQ = npc.q;
        npc.prevR = npc.r;
        npc.state = 'walking';
    },

    /** Send an NPC after the player: to fight (kin) or to arrest (the watch). */
    _respond(npc, mode, incident) {
        const R = StreetCrime.config().reactions || {};
        const prev = this._responders.get(npc.id);
        if (prev && prev.mode === 'arrest' && mode === 'fight') return;
        this._responders.set(npc.id, {
            // (the chase runs on game time: a slow frame or a paused game doesn't cut it short)
            mode, left: R.chaseSeconds || 30, repath: 0,
            // (a stealthy player: the watch takes a moment to notice before it gives chase)
            wait: mode === 'arrest' && !prev && this._player ? SocialSkills.perk(this._player, 'stealth', 'watchDelay') : 0,
            incidentId: incident ? incident.id : (prev && prev.incidentId), speed: prev ? prev.speed : npc.speed,
            confronted: false,
        });
        npc.speed = (prev ? prev.speed : npc.speed || 1) * (R.runSpeed || 2.4);
        npc.departing = false;
    },

    /** Stop chasing (the matter is settled, or the player got away). */
    release(npcId) {
        const r = this._responders.get(npcId);
        this._responders.delete(npcId);
        const npc = (InnerMap.npcs || []).find(n => n.id === npcId);
        if (npc && r && r.speed) npc.speed = r.speed;
        if (npc) {
            npc.path = null;
            if (npc.state === 'walking') npc.state = 'idle';
            npc.idleTimer = 3;
        }
        InnerMapCombat._npcReactions.delete(npcId);
    },

    /** The player resists: the guard fights. */
    guardResists(npcId) {
        const r = this._responders.get(npcId);
        if (r) {
            r.mode = 'fight';
            r.left = 60;
        }
        InnerMapCombat._npcReactions.set(npcId, { mode: 'fight', attackTimer: InnerMapCombat.NPC_ATTACK_INTERVAL });
    },

    reset() {
        if (this._followers) this._followers.clear();
        this._lastInside = InnerMap._insideBuilding || null;
        this._responders.clear();
        this._fleeing.clear();
        this._gathering.clear();
    },

    // ══════════════════════════════════════════════
    // UPDATE — each frame, from InnerMapCombat.update
    // ══════════════════════════════════════════════

    update(deltaTime, game) {
        if (!InnerMap.active) { this.reset(); this._visitKey = null; return; }
        this._game = game;
        const wt = InnerMap.currentWorldTile || {};
        const key = `${wt.q},${wt.r}`;
        // A new visit: another town, or this one again after time away on the world map
        const now = _now();
        const away = now - this._lastTick > 1500;
        this._lastTick = now;
        if (key !== this._visitKey || away) {
            this._visitKey = key;
            this.reset();
            this._arrivalAt = _now();
            this._arrivalChecked = false;
        }
        // Arriving where an unanswered crime is still remembered: the watch comes
        if (!this._arrivalChecked && _now() - this._arrivalAt > 2500 && !InnerMap._insideBuilding) {
            this._arrivalChecked = true;
            this._watchOnArrival(game, key);
        }
        // Into a building and out again: whoever's after the player follows them through the door
        this._trackDoors();
        if (this._responders.size) this._driveResponders(deltaTime, game);
        // Bodies in the street: whoever comes upon one reacts (twice a second is plenty)
        this._bodyScan = (this._bodyScan || 0) - deltaTime;
        if (this._bodyScan <= 0) {
            this._bodyScan = 0.5;
            this._scanBodies(game);
        }
    },

    // ══════════════════════════════════════════════
    // THROUGH THE DOOR — no hiding indoors from the watch
    // ══════════════════════════════════════════════

    // npc.id → { npc, at, outside: {q, r} }: on their way in after the player
    _followers: new Map(),
    _lastInside: null,

    /** Notice the player going in or out of a building. */
    _trackDoors() {
        const inside = InnerMap._insideBuilding || null;
        if (inside !== this._lastInside) {
            const was = this._lastInside;
            this._lastInside = inside;
            if (inside && !was) this._playerWentIn();
            else if (!inside && was) this._playerCameOut();
        }
        if (inside && this._followers.size) this._bringFollowersIn();
    },

    /**
     * The player has ducked into a building: everyone chasing them within
     * reach heads for the door, and comes in after them once they'd have got
     * there (the further off, the longer). Those too far off lose them.
     */
    _playerWentIn() {
        const outer = InnerMap._outerMapState;
        if (!outer || !outer.npcs) return;
        // The prisoner in their cell is no one's to chase
        if (InnerMap.inJail && InnerMap.inJail()) return;
        const door = { q: outer.playerInnerQ, r: outer.playerInnerR };
        const R = (StreetCrime.config().reactions || {});
        const reach = Number(R.followRadius) || 25;
        const now = _now();
        for (const [id] of [...this._responders]) {
            const npc = outer.npcs.find(n => n.id === id);
            if (!npc || npc.state === 'gone' || npc.state === 'unconscious') continue;
            const d = _dist(npc.q, npc.r, door.q, door.r);
            if (d > reach) { this.release(id); continue; }
            const secs = Math.min(9, Math.max(1.5, d / Math.max(0.5, (npc.speed || 1) * 2)));
            this._followers.set(id, { npc, at: now + secs * 1000, outside: door });
            npc.path = null;
        }
    },

    /** Those due come in through the door, and keep after the player inside. */
    _bringFollowersIn() {
        const now = _now();
        const inside = InnerMap._insideBuilding;
        for (const [id, f] of [...this._followers]) {
            if (now < f.at) continue;
            this._followers.delete(id);
            if (!this._responders.has(id)) continue;
            const npc = f.npc;
            // In at the door (the bottom row's doorway), a step inside
            let dq = Math.floor(InnerMap.width / 2), dr = InnerMap.height - 2;
            for (let r = InnerMap.height - 1; r >= 0; r--) {
                const row = InnerMap.tiles[r] || [];
                const q = row.findIndex(t => t && t._isDoor);
                if (q >= 0) { dq = q; dr = Math.max(0, r - 1); break; }
            }
            npc._followedFrom = f.outside;
            npc.q = npc.prevQ = npc.targetQ = dq;
            npc.r = npc.prevR = npc.targetR = dr;
            npc.path = null;
            npc.moveProgress = 0;
            npc.state = 'idle';
            npc.idleTimer = 1;
            npc.departing = false;
            npc._targetBuilding = null;
            if (!InnerMap.npcs.includes(npc)) InnerMap.npcs.push(npc);
            const lines = ((StreetCrime.config().barks || {}).followIn) || [];
            const line = lines.length ? lines[Math.floor(Utils.random() * lines.length) % lines.length] : 'You can\'t hide in there!';
            this.bark(npc, line, 3);
            if (inside && this._game && this._game.ui && typeof this._game.ui.showNotification === 'function') {
                this._game.ui.showNotification(npc.type === 'guard' ? '🛡️ The Watch Follows' : '⚔️ Followed', `${npc.name} comes in through the door after you.`, 'error');
            }
        }
    },

    /** Back out on the street: those who came in after the player come out with them. */
    _playerCameOut() {
        this._followers.clear();
        for (const npc of InnerMap.npcs || []) {
            if (!npc._followedFrom) continue;
            const at = npc._followedFrom;
            npc._followedFrom = null;
            npc.q = npc.prevQ = npc.targetQ = at.q;
            npc.r = npc.prevR = npc.targetR = at.r;
            npc.path = null;
            npc.moveProgress = 0;
            npc.state = 'idle';
            npc.idleTimer = 1;
        }
    },

    // ══════════════════════════════════════════════
    // BODIES — the street comes upon the dead
    // ══════════════════════════════════════════════

    // npc.id → { q, r, secs }: walking over to a body, to stand by it once there
    _gathering: new Map(),

    /**
     * Anyone who comes within sight of a body — lying where it fell, or over
     * the player's shoulders — reacts once: kin mourn at its side, the watch
     * looks into it, the timid run, the rest gather round or stare. Caught
     * standing over it or carrying it, the player is seen for a killer
     * (StreetCrime.foundReaction).
     */
    _scanBodies(game) {
        this._settleGatherers();
        this._cueMourners();
        const bodies = InnerMapCombat.corpsesHere();
        if (!bodies.length || !game || !game.player) return;
        const F = StreetCrime.config().found || {};
        const radius = Number(F.radius) || 6;
        const overRadius = Number(F.overRadius) || 1;
        const hidden = new Set(StreetCrime.config().sight.hiddenStates || []);
        const indoors = !!InnerMap._insideBuilding;
        const pq = InnerMap.playerInnerQ;
        const pr = InnerMap.playerInnerR;
        const carried = InnerMapCombat._carrying;
        const day = (game.world && game.world.day) || 0;
        const secs = (StreetCrime.config().reactions || {}).barkSeconds || 3.6;
        for (const body of bodies) {
            const isCarried = body === carried;
            const at = isCarried ? { q: pq, r: pr } : { q: body.q, r: body.r };
            const set = isCarried ? (body._seenCarried = body._seenCarried || new Set()) : (body._found = body._found || new Set());
            const sawKilling = body._npc && body._npc._reacted;
            const playerOver = !isCarried && _dist(pq, pr, body.q, body.r) <= overRadius;
            const fresh = [];
            let chorus = 0;
            for (const npc of InnerMap.npcs || []) {
                if (!npc || npc === body._npc || set.has(npc.id) || npc.state === 'gone' || npc.state === 'unconscious' || npc._dialogFrozen || npc._taskFoe) continue;
                if (!indoors && hidden.has(npc.state)) continue;
                if (sawKilling && sawKilling.has(npc.id)) continue; // they saw it done; they've reacted
                if (this._responders.has(npc.id) || this._fleeing.has(npc.id)) continue;
                if (!indoors && _dist(npc.q, npc.r, at.q, at.r) > radius) continue;
                set.add(npc.id);
                const r = StreetCrime.foundReaction(npc, body, { carried: isCarried, playerOver, royal: this._royal(game), seed: `${day}|${body.name}|${body.at}` });
                if (r.mood === 'fear' || r.mood === 'anger') npc.mood = r.mood;
                // Everyone visibly reacts: kin, the watch and the first of the crowd say a line;
                // the rest of the crowd gasp, recoil, shout — a crowd of full sentences is noise
                const says = r.bark && (r.role !== 'bystander' || r.implicates || chorus++ % 2 === 0);
                this.bark(npc, says ? r.bark : StreetCrime.foundEmote(r.mood, `${day}|${body.name}|${npc.id}`), secs);
                // Mourners go on weeping by the body
                if (r.act === 'mourn') npc._mournCue = { mood: r.mood, until: _now() + (Number(F.mournSeconds) || 30) * 1000, next: _now() + secs * 1000 + 1500 };
                this._actOnBody(npc, r, at, F);
                fresh.push({ npc, r });
            }
            if (fresh.length) this._bodyFound(game, body, fresh, isCarried, day);
        }
    },

    /** Set one finder moving (or still) as their reaction says. */
    _actOnBody(npc, r, at, F) {
        const scene = { q: at.q, r: at.r, indoors: !!InnerMap._insideBuilding };
        switch (r.act) {
            case 'flee': this._flee(npc, scene); break;
            case 'cower': this._hold(npc, 14); break;
            case 'arrest': this._respond(npc, 'arrest', null); break;
            case 'stand': this._hold(npc, 10); break;
            case 'mourn': this._approach(npc, at, Number(F.mournSeconds) || 30); break;
            case 'investigate':
            case 'gather': this._approach(npc, at, Number(F.holdSeconds) || 12); break;
            default:
                this._hold(npc, Number(F.holdSeconds) || 12);
                npc.facing = InnerMapCharacters.getDirection(at.q - npc.q, at.r - npc.r);
        }
    },

    /** Walk over to stand beside a spot (a body), then stay there a while looking at it. */
    _approach(npc, at, secs) {
        if (_dist(npc.q, npc.r, at.q, at.r) <= 1) { this._standBy(npc, at, secs); return; }
        const path = InnerMap._findPath(npc.q, npc.r, at.q, at.r);
        if (!path || path.length < 3) { this._standBy(npc, at, secs); return; }
        npc.path = path.slice(1, -1);
        npc.pathIndex = 0;
        npc.moveProgress = 0;
        npc.prevQ = npc.q;
        npc.prevR = npc.r;
        npc.state = 'walking';
        npc.departing = false;
        npc._targetBuilding = null;
        this._gathering.set(npc.id, { q: at.q, r: at.r, secs, until: _now() + 30000 });
    },

    _standBy(npc, at, secs) {
        this._hold(npc, secs);
        npc.facing = InnerMapCharacters.getDirection(at.q - npc.q, at.r - npc.r);
    },

    /** Kin and friends by a body sob now and again while they stay. */
    _cueMourners() {
        const now = _now();
        for (const npc of InnerMap.npcs || []) {
            const c = npc && npc._mournCue;
            if (!c) continue;
            if (now > c.until || npc.state === 'gone' || this._fleeing.has(npc.id) || this._responders.has(npc.id)) { npc._mournCue = null; continue; }
            if (now < c.next || (npc._bark && npc._bark.until > now) || npc.state === 'walking') continue;
            c.next = now + 6000;
            this.bark(npc, StreetCrime.foundEmote('grief', `${Math.floor(now / 1000)}|${npc.id}`), 2.5);
        }
    },

    /** Those who walked over to a body stop beside it and stay. */
    _settleGatherers() {
        if (!this._gathering.size) return;
        const now = _now();
        for (const [id, g] of [...this._gathering]) {
            const npc = (InnerMap.npcs || []).find(n => n.id === id);
            if (!npc || now > g.until || this._responders.has(id) || this._fleeing.has(id)) { this._gathering.delete(id); continue; }
            if (_dist(npc.q, npc.r, g.q, g.r) <= 1 || !(npc.path && npc.pathIndex < npc.path.length)) {
                this._gathering.delete(id);
                this._standBy(npc, g, g.secs);
            }
        }
    },

    /**
     * After a body is found: word of it, and — when the player was caught with
     * it — the finders become witnesses to the killing (StreetCrime.addWitnesses).
     */
    _bodyFound(game, body, fresh, isCarried, day) {
        const caught = fresh.filter(f => f.r.implicates);
        const victim = body._npc || { name: body.name };
        const incident = victim._incidentId != null ? StreetCrime._incident(game.player, victim._incidentId) : null;
        if (caught.length) {
            StreetCrime.addWitnesses(game.player, incident,
                caught.map(f => ({ npc: f.npc, seen: true, role: f.r.role === 'guard' ? 'guard' : f.r.role, kinWord: f.r.kinWord, mood: f.r.mood === 'grief' ? 'fear' : f.r.mood })),
                victim, 'murder', day);
            for (const f of caught) {
                if (f.r.act === 'arrest' && incident) this._responders.get(f.npc.id).incidentId = incident.id;
            }
        }
        if (!game.ui || typeof game.ui.showNotification !== 'function') return;
        const first = fresh[0].npc.name || 'Someone';
        if (caught.length) {
            const guards = caught.filter(f => f.r.act === 'arrest').length;
            game.ui.showNotification(isCarried ? '👁️ Seen with a body!' : '👁️ Caught over the body!',
                `${caught.slice(0, 3).map(f => f.npc.name).join(', ')}${caught.length > 3 ? '…' : ''} saw you ${isCarried ? `carrying ${body.name}'s body` : `standing over ${body.name}'s body`}.${guards ? ' The watch is coming!' : ' They will remember it.'}`,
                'warning');
        } else if (!body._announced) {
            body._announced = true;
            const mourner = fresh.find(f => f.r.act === 'mourn' && f.r.kinWord);
            game.ui.showNotification('💀 A Body Found',
                mourner ? `${mourner.npc.name} has found ${body.name} — their ${mourner.r.kinWord} — dead in the street.` : `${first} has come upon ${body.name}'s body. Folk are gathering.`,
                'info');
        }
    },

    _watchOnArrival(game, key) {
        if (!game || !game.player || game.player.jailState) return;
        const day = (game.world && game.world.day) || 0;
        const inc = StreetCrime.pendingAt(game.player, key, day);
        if (!inc) return;
        const hidden = new Set(StreetCrime.config().sight.hiddenStates || []);
        let best = null;
        for (const n of InnerMap.npcs || []) {
            if (n.type !== 'guard' || hidden.has(n.state)) continue;
            const d = _dist(n.q, n.r, InnerMap.playerInnerQ, InnerMap.playerInnerR);
            if (!best || d < best.d) best = { n, d };
        }
        if (!best) return;
        this.bark(best.n, StreetCrime.watchBark(`${key}|${inc.id}`) || 'You there! Stop!');
        this._respond(best.n, 'arrest', inc);
        if (game.ui && typeof game.ui.showNotification === 'function') {
            game.ui.showNotification('🛡️ The Watch', `${best.n.name} has recognised you: the ${inc.k === 'murder' ? 'killing' : inc.k === 'vandalism' ? 'smashing' : 'beating'} of ${inc.victim} has not been forgotten here.`, 'error');
        }
    },

    _driveResponders(deltaTime, game) {
        const pq = InnerMap.playerInnerQ;
        const pr = InnerMap.playerInnerR;
        for (const [id, r] of [...this._responders]) {
            const npc = (InnerMap.npcs || []).find(n => n.id === id);
            // (One on their way in through the door after the player is still after them)
            if (!npc && this._followers.has(id)) continue;
            if (!npc || npc.state === 'gone') { this._responders.delete(id); continue; }
            if (r.wait > 0) { r.wait -= deltaTime; continue; }
            r.left -= deltaTime;
            if (r.left <= 0) { this.release(id); continue; }
            if (npc._dialogFrozen) continue;
            if (npc.state === 'inside_building' && !InnerMap._insideBuilding) continue;
            const d = _dist(npc.q, npc.r, pq, pr);
            if (d <= 1) {
                npc.path = null;
                npc.moveProgress = 0;
                if (npc.state === 'walking') npc.state = 'idle';
                npc.idleTimer = 5;
                npc.facing = InnerMapCharacters.getDirection(pq - npc.q, pr - npc.r);
                if (r.mode === 'fight') {
                    if (!InnerMapCombat._npcReactions.has(id)) {
                        InnerMapCombat._npcReactions.set(id, { mode: 'fight', attackTimer: InnerMapCombat.NPC_ATTACK_INTERVAL });
                    }
                } else if (r.mode === 'arrest' && !r.confronted) {
                    this._confront(game, npc, r);
                }
                continue;
            }
            // Keep going while the path still ends beside the player; re-plan
            // (keeping the step under way) when they have moved off
            r.repath -= deltaTime;
            const walking = npc.path && npc.pathIndex < npc.path.length;
            const end = walking ? npc.path[npc.path.length - 1] : null;
            if (walking && (r.repath > 0 || _dist(end.q, end.r, pq, pr) <= 1)) continue;
            r.repath = 0.6;
            const path = InnerMap._findPath(npc.q, npc.r, pq, pr);
            if (!path || path.length < 3) continue;
            const step = walking ? npc.path[npc.pathIndex] : null;
            const keep = step && path[1] && path[1].q === step.q && path[1].r === step.r ? npc.moveProgress : 0;
            // Stop a step short of the player
            npc.path = path.slice(1, -1);
            npc.pathIndex = 0;
            npc.moveProgress = keep;
            if (!keep) { npc.prevQ = npc.q; npc.prevR = npc.r; }
            npc.state = 'walking';
            npc._targetBuilding = null;
        }
    },

    /** A guard has caught up with the player: the watch's choice scene. */
    _confront(game, npc, r) {
        if (!game || !game.player || game.player.jailState) return;
        if (game._scene || NpcDialog.active) return; // try again next frame
        r.confronted = true;
        const inc = r.incidentId != null ? StreetCrime._incident(game.player, r.incidentId) : null;
        const day = (game.world && game.world.day) || 0;
        const open = inc && !inc.answered ? inc : StreetCrime.pendingAt(game.player, this._visitKey, day);
        if (!open) { this.release(npc.id); return; }
        r.incidentId = open.id;
        this.openWatch(game, npc, open);
    },

    /** Open the watch's scene for a guard and an incident. */
    openWatch(game, npc, incident) {
        if (!game || !npc || !incident) return;
        if (InnerMapCombat._attackState) InnerMapCombat.cancelAttack();
        ActionMenu.showScene(game, 'street_watch', { incidentId: incident.id, guardId: npc.id, guardName: npc.name || 'The guard' });
    },

    // ══════════════════════════════════════════════
    // RENDER — barks over heads, on top of the sprites
    // ══════════════════════════════════════════════

    render(ctx, camera) {
        if (!InnerMap.active || !InnerMap.npcs) return;
        const now = _now();
        const T = InnerMapRenderer.TILE_SIZE;
        const ds = T * camera.zoom;
        // Said over a place: the church's bell over its roof (world/innerMap/townScenes.js)
        for (const sb of InnerMap._spotBarks || []) {
            if (sb.tiles !== InnerMap.tiles || now > sb.until) continue;
            const s = camera.worldToScreen(sb.q * T + T / 2, sb.r * T);
            this._drawBubble(ctx, sb.text, s.x, s.y - ds * 1.2, camera.zoom, Math.min(1, (sb.until - now) / 400));
        }
        for (const npc of InnerMap.npcs) {
            const b = npc._bark;
            if (!b) continue;
            if (now > b.until) { npc._bark = null; continue; }
            if (b.from && now < b.from) continue; // the second half of a conversation (world/innerMap/townLife.js)
            if (npc.state === 'inside_building' && !InnerMap._insideBuilding) continue;
            let wx = npc.q * T + T / 2;
            // (a vendor behind a stall's counter is drawn down at the counter: world/innerMap/townScenes.js)
            let wy = npc._behindCounter ? (npc._behindCounter.row + 1) * T - T * 0.6 : npc.r * T + T / 2;
            if (npc.path && npc.pathIndex < npc.path.length) {
                const t = npc.path[npc.pathIndex];
                wx += (t.q * T + T / 2 - wx) * (npc.moveProgress || 0);
                wy += (t.r * T + T / 2 - wy) * (npc.moveProgress || 0);
            }
            const s = camera.worldToScreen(wx, wy);
            const charScale = npc.type === 'child' ? 0.7 : 1.0;
            const left = (b.until - now) / 1000;
            const alpha = Math.min(1, left / 0.4);
            this._drawBubble(ctx, b.text, s.x, s.y - ds * 1.75 * charScale, camera.zoom, alpha);
        }
    },

    _drawBubble(ctx, text, x, y, zoom, alpha) {
        const shown = text.length > 48 ? `${text.slice(0, 47)}…` : text;
        const px = textPx(11 * labelZoom(zoom), 11);
        ctx.save();
        ctx.globalAlpha *= Math.max(0, alpha);
        ctx.font = `700 ${px}px 'Inter', sans-serif`;
        const w = ctx.measureText(shown).width + px * 1.2;
        const h = px * 1.7;
        const bx = x - w / 2;
        // (kept below the top bar: a priest at the altar against the far wall)
        const by = Math.max(y - h, ctx.canvas.height * 0.09);
        ctx.fillStyle = 'rgba(250, 244, 228, 0.95)';
        ctx.strokeStyle = 'rgba(60, 40, 20, 0.85)';
        ctx.lineWidth = Math.max(1, px * 0.1);
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') ctx.roundRect(bx, by, w, h, h * 0.4);
        else ctx.rect(bx, by, w, h);
        ctx.moveTo(x - px * 0.4, by + h);
        ctx.lineTo(x, by + h + px * 0.55);
        ctx.lineTo(x + px * 0.4, by + h);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#3a2412';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shown, x, by + h / 2);
        ctx.restore();
    },
};
