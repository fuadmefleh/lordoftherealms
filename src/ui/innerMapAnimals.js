// ============================================
// INNER MAP ANIMALS — drawing the beasts, their bites, and their menu
// ============================================
// The animals themselves (where they graze, how they wander, bolt, stalk and
// rush) live in world/innerMap/animals.js on InnerMap.animals; this:
//   * draws them from their sheets (data/animals.json: walk / attack / death,
//     a row per direction, up/left/down/right), a death played once and held,
//     a carcass fading once butchered, one carried over the shoulders or
//     dragged behind the player;
//   * feeds them the player's walk, stealth and the hour each frame, and
//     answers what they did: a bite comes off the player's health (armour and
//     Divine Protection soften it, as a blow in a brawl), mauled to nothing
//     the player blacks out and comes round hours later, the beast gone;
//   * fights them: "Fight the wolf" closes and swings (the duel engine's
//     swing, as against a man); bitten while idle, the player turns on it;
//   * offers on one: Hunt (ui/mapTasks/wildTasks.js through ActionMenu.huntAnimal,
//     judged by the hunting rules), Fight / Slaughter; and on a carcass (every
//     kill leaves one, kept on world.wildlife.carcasses by the world layer)
//     Carry / Put Down (by its weight: data species.weight, carcass.maxCarry;
//     the walk slows, as with a body (ui/innerMapDigging.js); left behind on
//     leaving the map) and Butcher — by hand only, work at the spot through
//     InnerMapDigging.start and time on the clock (InnerMap.passHours); its
//     loot (data species.loot, systems/wildTasks.js animalLoot) thinned as
//     it rots (InnerMap.carcassYield).
//     A village's sheep or cattle killed is theft from the village — fined
//     if anyone saw it (systems/underworld.js, systems/laws.js).

import { InnerMap } from '../world/innerMap.js';
import { InnerMapTasks } from './innerMapTasks.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { InnerMapDigging } from './innerMapDigging.js';
import { InnerMapRenderer } from './innerMapRenderer.js';
import { InnerMapCharacters } from './innerMapCharacters.js';
import { PlayerEffects } from '../player/playerEffects.js';
import { Hunting } from '../player/foraging.js';
import { Ailments } from '../systems/ailments.js';
import { Knockout } from '../systems/knockout.js';
import { Underworld } from '../systems/underworld.js';
import { Laws } from '../systems/laws.js';
import { Ledger } from '../systems/ledger.js';
import { WildTasks } from '../systems/wildTasks.js';
import { DataLoader } from '../core/dataLoader.js';
import { Utils } from '../core/utils.js';

const _num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const _fmt = (s, v) => String(s == null ? '' : s).replace(/\{(\w+)\}/g, (m, k) => (v[k] == null ? m : String(v[k])));
const _cheb = (a, b) => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r));
const _me = () => ({ q: InnerMap.playerInnerQ, r: InnerMap.playerInnerR });
const _notify = (game, title, body, kind = 'info') => {
    if (game && game.ui && typeof game.ui.showNotification === 'function') game.ui.showNotification(title, body, kind);
};
const HOSTILE = new Set(['stalk', 'charge', 'attack']);

export const InnerMapAnimals = {
    _imgs: new Map(),
    /** The fight the player is in with a beast: { a, swingT, chaseT, path }. */
    _fight: null,
    /** The carcass the player is carrying: { a, tiles, base, how, lastQ, lastR }. */
    _carry: null,
    /** What has been told this visit (a pack's stalk, a bear's warning): once each. */
    _told: new Set(),
    _toldMap: null,

    /** The sheet at `path`, or null while it loads. */
    image(path) {
        if (!path || typeof Image === 'undefined') return null;
        let img = this._imgs.get(path);
        if (!img) {
            img = new Image();
            img.src = path;
            this._imgs.set(path, img);
        }
        return img.complete && img.naturalWidth ? img : null;
    },

    /** Which sheet and cell: its row by facing; the frame by the walk, the swing, or the fall. */
    frame(a, sp) {
        const rows = sp.rows || { up: 0, left: 1, down: 2, right: 3 };
        const row = _num(rows[a.facing], _num(rows.down, 2));
        const cols = Math.max(1, _num(sp.cols, 4));
        const sheets = sp.sheets || {};
        if (a.state === 'dead') {
            const col = Math.min(cols - 1, Math.floor(_num(a.deadT) * _num(sp.deathFps, 6)));
            return { sheet: sheets.death || sp.sheet, row, col };
        }
        if (a.state === 'attack') {
            const swing = cols / Math.max(1, _num(sp.attackFps, 8));
            if (_num(a.atkT) < swing && sheets.attack) return { sheet: sheets.attack, row, col: Math.min(cols - 1, Math.floor(_num(a.atkT) * _num(sp.attackFps, 8))) };
            return { sheet: sheets.walk || sp.sheet, row, col: 0 };
        }
        const sheet = sheets.walk || sp.sheet;
        const moving = !!(a.next || a.moving);
        if (!moving) return { sheet, row, col: 0 };
        const fast = a.state === 'flee' || a.state === 'charge';
        const fps = fast ? _num(sp.fleeFps, 12) : _num(sp.walkFps, 6);
        const phase = (a.id ? a.id.length * 0.37 : 0);
        return { sheet, row, col: Math.floor(a.animT * fps + phase) % cols };
    },

    /**
     * Draw one animal with its feet at (fx, fy) on screen; `ds` is a tile's
     * size on screen. False when the sheet is not loaded yet.
     */
    drawAt(ctx, a, sp, fx, fy, ds, o = {}) {
        const f = this.frame(a, sp);
        const img = this.image(f.sheet);
        if (!img) return false;
        const fw = _num(sp.frameW, 112), fh = _num(sp.frameH, 112);
        const scale = _num(sp.scale, 1) * _num(o.scale, 1);
        const k = (_num(sp.drawTiles, 2) * scale * ds) / fw;
        const [ax, ay] = Array.isArray(sp.anchor) ? sp.anchor : [fw / 2, fh];
        const bcfg = InnerMap.animalConfig().behaviour || {};
        const fade = a.state === 'dead' && a.butchered ? Math.max(0, 1 - _num(a.fadeT) / Math.max(1, _num(bcfg.butcheredSeconds, 20))) : 1;
        const big = _num(sp.drawTiles, 2) * scale / 2;
        // A soft shadow under the body: long side on, short end on
        const side = a.facing === 'left' || a.facing === 'right' || a.state === 'dead';
        if (!o.noShadow) {
            ctx.save();
            ctx.globalAlpha = 0.28 * fade;
            ctx.fillStyle = '#000';
            ctx.beginPath();
            ctx.ellipse(fx, fy - ds * 0.04, (side ? 0.5 : 0.2) * ds * big, ds * 0.08 * big, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        const smooth = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = k < 1; // a sheet scaled down is smoothed; scaled up it stays crisp
        if (fade < 1) { ctx.save(); ctx.globalAlpha = fade; }
        ctx.drawImage(img, f.col * fw, f.row * fh, fw, fh, Math.round(fx - ax * k), Math.round(fy - ay * k), Math.round(fw * k), Math.round(fh * k));
        if (fade < 1) ctx.restore();
        ctx.imageSmoothingEnabled = smooth;
        // Hurt: its blood on a bar over it
        if (a.state !== 'dead' && a.hp < a.maxHp) {
            const w = Math.max(18, ds * 0.9), h = Math.max(3, ds * 0.08);
            const top = Math.round(fy - (ay - 34) * k) - h - 2;
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(Math.round(fx - w / 2) - 1, top - 1, Math.round(w) + 2, Math.round(h) + 2);
            ctx.fillStyle = a.hp / a.maxHp > 0.5 ? '#6fcf4f' : a.hp / a.maxHp > 0.25 ? '#e5b83a' : '#e0473a';
            ctx.fillRect(Math.round(fx - w / 2), top, Math.round(w * a.hp / a.maxHp), Math.round(h));
            ctx.restore();
        }
        return true;
    },

    /** Push the visible animals into the depth-sorted sprite list (ui/innerMapLayers/entities.js). */
    collect(items, ctx, camera, T) {
        const list = InnerMap.animals;
        if (!list || !list.length || InnerMap._insideBuilding) return;
        const ds = T * camera.zoom;
        const cfg = InnerMap.animalConfig();
        const W = ctx.canvas.width, H = ctx.canvas.height;
        for (const a of list) {
            const sp = InnerMap.animalSpecies(a.species, cfg);
            if (!sp) continue;
            if (this._carry && this._carry.a === a) { this._collectCarried(items, ctx, camera, T, a, sp); continue; }
            const p = InnerMap.animalPos(a);
            const tile = InnerMap.tiles[Math.round(p.r)] && InnerMap.tiles[Math.round(p.r)][Math.round(p.q)];
            if (!tile || !tile.visible) continue;
            const s = camera.worldToScreenFast(p.q * T + T / 2, p.r * T + T / 2);
            const fx = s.x, fy = s.y + ds * 0.3;
            const reach = ds * Math.max(3, _num(sp.drawTiles, 2) * 1.2);
            if (fx < -reach || fx > W + reach || fy < -reach || fy > H + reach) continue;
            // A carcass lies flat: whoever stands by it is drawn over it
            const sortY = a.state === 'dead' ? p.r * T + T * 0.4 : p.r * T + T;
            items.push({ sortY, zLayer: 2, sortX: p.q, draw: () => {
                if (!this.drawAt(ctx, a, sp, fx, fy, ds)) {
                    ctx.save();
                    ctx.fillStyle = 'rgba(150,100,50,0.9)';
                    ctx.beginPath(); ctx.ellipse(fx, fy - ds * 0.3, ds * 0.3, ds * 0.18, 0, 0, Math.PI * 2); ctx.fill();
                    ctx.restore();
                }
            } });
        }
    },

    /**
     * The carcass the player carries: a small one over the shoulders (drawn
     * just after the player), a big one dragged on the ground behind them.
     */
    _collectCarried(items, ctx, camera, T, a, sp) {
        const ds = T * camera.zoom;
        const pos = InnerMap.getPlayerWorldPos ? InnerMap.getPlayerWorldPos() : { x: InnerMap.playerInnerQ * T + T / 2, y: InnerMap.playerInnerR * T + T / 2 };
        const px = pos.x, py = pos.y;
        if (this._carry.how === 'shoulder') {
            const s = camera.worldToScreenFast(px, py);
            const fx = s.x, fy = s.y - ds * 0.45;
            items.push({ sortY: py + T / 2 + 0.5, zLayer: 2, sortX: px / T, draw: () => {
                this.drawAt(ctx, a, sp, fx, fy, ds, { scale: 0.6, noShadow: true });
            } });
            return;
        }
        // Dragged: on the ground a little behind the player (away from the way they face)
        const back = [[0, 1], [1, 0], [0, -1], [-1, 0]][_num(InnerMapRenderer._playerFacing, 2)] || [0, -1];
        const cx = px + back[0] * T * 0.75, cy = py + back[1] * T * 0.75;
        const s = camera.worldToScreenFast(cx, cy);
        const fx = s.x, fy = s.y + ds * 0.3;
        items.push({ sortY: cy + T * 0.4 - T / 2, zLayer: 2, sortX: cx / T, draw: () => {
            this.drawAt(ctx, a, sp, fx, fy, ds);
        } });
    },

    /** Is it dark on the map (the hunters bolder)? */
    _night() {
        const t = _num(InnerMap.timeOfDay, 12);
        return t < 6 || t >= 20;
    },

    /** Each frame: the beasts' lives, with the player's walk, stealth and the hour; then what they did. */
    update(dt, game) {
        if (this._toldMap !== InnerMap.tiles) { this._toldMap = InnerMap.tiles; this._told.clear(); this._fight = null; }
        if (this._carry) this._tickCarry(game);
        if (!InnerMap.active || InnerMap._insideBuilding || !InnerMap.animals || !InnerMap.animals.length) return;
        const player = game && game.player;
        // A hunt put aside without a word (another task begun over it): its beast goes free
        if (!(InnerMapTasks.isActive && InnerMapTasks.isActive())) {
            for (const a of InnerMap.animals.slice()) if (a.hunted) InnerMap.releaseAnimal(a);
        }
        const down = !player || !(player.health > 0) || !!InnerMapCombat._playerOut;
        const events = InnerMap.updateAnimals(dt, {
            walking: !!InnerMap._playerWalking,
            stealth: _num(player && player.skills && player.skills.stealth, 1),
            night: this._night(),
            noTarget: down,
        });
        for (const ev of events) this._event(game, ev);
        if (this._fight) this._tickFight(dt, game);
    },

    // ── What the beasts did ──

    _event(game, ev) {
        const cfg = InnerMap.animalConfig();
        const words = cfg.words || {};
        const a = ev.a;
        const sp = InnerMap.animalSpecies(a.species, cfg) || {};
        const name = String(sp.name || a.species).toLowerCase();
        const once = (key) => {
            const k = `${a.herd || a.id}|${key}`;
            if (this._told.has(k)) return false;
            this._told.add(k);
            return true;
        };
        if (ev.type === 'bite') { this._bite(game, a, sp, ev.dmg); return; }
        if (ev.type === 'threat' && once('threat')) {
            const w = words.threat || {};
            _notify(game, `${sp.icon || '🐾'} Too close`, _fmt(w[a.species] || w.default || 'The {name} stands its ground.', { name }), 'warning');
        } else if (ev.type === 'stalk' && once('stalk')) {
            const w = words.stalk || {};
            _notify(game, `${sp.icon || '🐾'} Stalked`, _fmt(w[a.species] || w.default || 'The {name} is coming for you.', { name }), 'warning');
        } else if (ev.type === 'charge' && once('charge')) {
            _notify(game, `${sp.icon || '🐾'} ${sp.name || 'It'} charges`, _fmt(words.charge || 'The {name} charges!', { name }), 'error');
        }
    },

    /** A bite (a kick, a gore, a stomp) lands on the player. */
    _bite(game, a, sp, raw) {
        const player = game && game.player;
        if (!player || InnerMapCombat._playerOut) return;
        const dmg = Math.max(0, Math.round(PlayerEffects.scaleDamage(player, raw)));
        player.health = Math.max(0, _num(player.health, 100) - dmg);
        const T = InnerMapRenderer.TILE_SIZE;
        InnerMapCombat._spawnFloat(InnerMap.playerInnerQ * T + T / 2, InnerMap.playerInnerR * T + T * 0.1, dmg, 'player_hit');
        InnerMapCombat._spawnHitFlash(InnerMap.playerInnerQ * T + T / 2, InnerMap.playerInnerR * T + T / 2);
        if (player.health <= 0) { this._mauled(game, a, sp); return; }
        const wound = dmg >= 8 ? Ailments.maybeWound(player, game.world, 'beast') : null;
        if (wound) _notify(game, `${wound.icon} Wounded`, `The ${String(sp.name || 'beast').toLowerCase()} leaves you with ${/^[aeiou]/i.test(wound.name) ? 'an' : 'a'} ${wound.name.toLowerCase()}.`, 'warning');
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
        // Set on while standing about: you turn on it
        if (!this._fight && !InnerMap._playerWalking && !(InnerMapTasks.isActive && InnerMapTasks.isActive()) && !InnerMapCombat._attackState) {
            this.startFight(game, a, { auto: true });
        }
    },

    /** Mauled to nothing: the player blacks out; the beasts leave the body be. */
    _mauled(game, a, sp) {
        const player = game.player;
        if (InnerMapCombat._playerOut) return;
        InnerMapCombat._playerOut = true;
        player.health = 0;
        this._fight = null;
        if (this._carry) this.drop(game);
        InnerMap.cancelPlayerWalk && InnerMap.cancelPlayerWalk();
        const cfg = InnerMap.animalConfig();
        const me = _me();
        for (const x of InnerMap.animals) if (HOSTILE.has(x.state) || x.state === 'threat') InnerMap._animalBackOff(x, me, null, cfg);
        const words = cfg.words || {};
        const name = String(sp.name || a.species).toLowerCase();
        _notify(game, `${sp.icon || '🐾'} Mauled`, _fmt(words.mauled || 'The {name} mauls you senseless.', { name }), 'error');
        const wake = () => {
            InnerMapCombat._playerOut = false;
            const res = Knockout.playerWakes(player, { act: 'leave' });
            InnerMap.timeOfDay = Math.min(23, _num(InnerMap.timeOfDay, 8) + res.hours);
            const wound = Ailments.maybeWound(player, game.world, 'beast');
            // the beasts have wandered off by the time you come round
            for (const x of InnerMap.animals) if (x.state !== 'dead') x.cool = Math.max(x.cool, 60);
            _notify(game, '💫 You Come Round', _fmt(words.wake || 'You come round {hours} hours later. The {name} has gone.', { hours: res.hours, name })
                + (wound ? ` ${wound.icon} ${wound.name}.` : ''), 'warning');
            if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
        };
        if (typeof InnerMapCombat._blackout === 'function') InnerMapCombat._blackout(game, 2600, wake);
        else wake();
    },

    // ── Fighting a beast ──

    /** Close with the beast and fight it hand to hand. */
    startFight(game, a, o = {}) {
        if (!a || a.state === 'dead' || !InnerMap.animals.includes(a)) return false;
        if (InnerMapCombat._attackState && InnerMapCombat.cancelAttack) InnerMapCombat.cancelAttack();
        // a fight wants both hands: what you carry goes down
        if (this._carry) this.drop(game);
        // The first blow at once when it is at hand (a bitten player answers a beat later)
        const every = _num((InnerMap.animalConfig().fight || {}).swingEvery, 0.55);
        this._fight = { a, swingT: o.auto ? every * 0.5 : every, chaseT: 0, path: null };
        if (!o.auto) this._tickFight(0, game);
        return true;
    },

    stopFight() {
        const f = this._fight;
        if (f && f.path && InnerMap._playerPath === f.path && InnerMap.cancelPlayerWalk) InnerMap.cancelPlayerWalk();
        this._fight = null;
    },

    _tickFight(dt, game) {
        const f = this._fight;
        const a = f.a;
        const player = game && game.player;
        if (!player || !InnerMap.animals.includes(a) || a.state === 'dead' || InnerMapCombat._playerOut) { this._fight = null; return; }
        // The player walked off somewhere else: that ends it
        if (InnerMap._playerWalking && InnerMap._playerPath && InnerMap._playerPath !== f.path) { this._fight = null; return; }
        const me = _me();
        const at = { q: Math.round(InnerMap.animalPos(a).q), r: Math.round(InnerMap.animalPos(a).r) };
        const d = _cheb(me, at);
        if (d > 25) {
            this.stopFight();
            const sp = InnerMap.animalSpecies(a.species) || {};
            _notify(game, '🏃 Got away', `The ${String(sp.name || 'beast').toLowerCase()} got away.`, 'info');
            return;
        }
        if (d > 1) {
            f.chaseT -= dt;
            if (f.chaseT <= 0) {
                f.chaseT = 0.35;
                const res = InnerMap.movePlayerTo ? InnerMap.movePlayerTo(at.q, at.r) : null;
                f.path = res && res.started ? InnerMap._playerPath : null;
            }
            return;
        }
        if (f.path) {
            if (InnerMap._playerPath === f.path && InnerMap.cancelPlayerWalk) InnerMap.cancelPlayerWalk();
            f.path = null;
        }
        InnerMapRenderer._playerFacing = InnerMapCharacters.getDirection(at.q - me.q, at.r - me.r);
        const cfg = InnerMap.animalConfig();
        f.swingT += dt;
        const every = _num((cfg.fight || {}).swingEvery, 0.55);
        if (f.swingT < every) return;
        f.swingT -= every;
        const base = InnerMapCombat._computePlayerDamage(player);
        const dmg = Math.max(1, Math.round(base * (0.875 + Utils.random() * 0.25)));
        const T = InnerMapRenderer.TILE_SIZE;
        InnerMapCombat._spawnFloat(at.q * T + T / 2, at.r * T + T * 0.1, dmg, 'hit');
        InnerMapCombat._spawnHitFlash(at.q * T + T / 2, at.r * T + T / 2);
        const res = InnerMap.hurtAnimal(game.world, a, dmg, me, cfg);
        for (const ev of res.events) this._event(game, ev);
        if (res.killed) {
            this._fight = null;
            this._killed(game, a);
        } else if (a.state === 'flee') {
            // it breaks and runs: you let it go
            this._fight = null;
        }
    },

    /** A beast killed by the player's own hand. */
    _killed(game, a) {
        const cfg = InnerMap.animalConfig();
        const sp = InnerMap.animalSpecies(a.species, cfg) || {};
        const name = String(sp.name || a.species).toLowerCase();
        if (a.livestock && a.owner) { this.livestockTheft(game, a, sp); return; }
        _notify(game, `${sp.icon || '🐾'} Killed`, _fmt((cfg.words || {}).killed || 'The {name} is dead.', { name }), 'success');
    },

    /**
     * A village's beast killed: theft. Seen by anyone on the map near enough,
     * a fine (the realm's law scales it) and standing lost; unseen, it still
     * weighs on you (and the underworld's heat). Returns { seen, fine }.
     */
    livestockTheft(game, a, sp = InnerMap.animalSpecies(a.species) || {}) {
        const player = game && game.player;
        const world = game && game.world;
        if (!player) return { seen: false, fine: 0 };
        const L = InnerMap.animalConfig().livestock || {};
        const owner = a.owner || {};
        const kingdom = owner.kingdom != null ? owner.kingdom : null;
        const town = owner.name || 'the village';
        const radius = _num(L.seenRadius, 14);
        const seen = (InnerMap.npcs || []).some(n => n && n.state !== 'unconscious' && n.state !== 'inside_building' && n.state !== 'gone'
            && Math.max(Math.abs(n.q - a.q), Math.abs(n.r - a.r)) <= radius);
        const wt = InnerMap.currentWorldTile || {};
        const name = String(sp.name || a.species).toLowerCase();
        const value = _num(sp.value, 15);
        if (seen) {
            const law = Laws.punishment(world, kingdom);
            const fine = Math.min(_num(player.gold), Math.max(5, Math.round(value * _num(L.fineMult, 2) * _num(law.fine, 1))));
            player.gold = _num(player.gold) - fine;
            if (fine) Ledger.record(player, 'fines', -fine);
            if (kingdom != null && player.reputation) player.reputation[kingdom] = _num(player.reputation[kingdom]) - _num(L.reputation, 3);
            Underworld.recordCrime(player, world, 'theft', {
                kingdom, caught: true, q: wt.q, r: wt.r,
                victim: { name: `a shepherd of ${town}`, type: 'farmer', icon: '🧑‍🌾' },
            });
            _notify(game, '⚖️ Seen', `You were seen killing ${town}'s ${name}. It's theft: fined ${fine} gold${kingdom != null ? ', and your name is mud hereabouts' : ''}.`, 'error');
            if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, world);
            return { seen: true, fine };
        }
        Underworld.recordCrime(player, world, 'theft', { kingdom, caught: false, scale: Math.min(1.5, 0.4 + value / 60) });
        _notify(game, `${sp.icon || '🐑'} Unseen`, `You killed ${town}'s ${name}, and no one saw. Butcher it quick.`, 'warning');
        return { seen: false, fine: 0 };
    },

    // ── Butchering ──

    /**
     * Butcher the carcass by hand: put it down if carried, walk beside it and
     * work there a while (InnerMapDigging.start: walking off stops it), the
     * clock moving on by its size. Returns InnerMapDigging.start's answer
     * ('now' | 'walking' | 'unreachable'), or false when there is nothing to butcher.
     */
    butcher(game, a) {
        if (!a || a.state !== 'dead' || a.butchered || !InnerMap.animals.includes(a)) return false;
        if (this._carry && this._carry.a === a) this.drop(game, { quiet: true });
        this._fight = null;
        const cfg = InnerMap.animalConfig();
        const C = InnerMap.carcassConfig(cfg);
        const time = InnerMap.butcherTime(a, cfg);
        const res = InnerMapDigging.start(game, 'butcher', a.q, a.r, {
            seconds: time.seconds,
            verb: 'Butchering',
            needs: C.needs || { energy: -4, hygiene: -8 },
            onTile: true,
            onDone: (g) => {
                if (!InnerMap.animals.includes(a) || a.butchered) return;
                if (time.minutes > 0 && InnerMap.passHours) InnerMap.passHours(time.minutes / 60);
                this._butcherNow(g || game, a);
            },
        });
        if (res === 'unreachable') _notify(game, 'Blocked', 'You can\'t reach it.', 'error');
        return res;
    },

    /**
     * The carcass's loot (data: species.loot) into the packs, thinned as it
     * rots (InnerMap.carcassYield). It is gone after. Returns the trip, or null.
     */
    _butcherNow(game, a) {
        const player = game && game.player;
        const world = game && game.world;
        if (!player || !a || a.state !== 'dead' || a.butchered) return null;
        const share = InnerMap.carcassYield(world, a);
        if (this._carry && this._carry.a === a) this.drop(game, { quiet: true });
        if (!InnerMap.butcherAnimal(a, world)) return null;
        const sp = InnerMap.animalSpecies(a.species) || {};
        const tables = ((DataLoader.get && DataLoader.get('earlyJobs')) || DataLoader.earlyJobs || {}).hunting;
        const loot = WildTasks.animalLoot(sp, (tables && tables.loot_table) || {});
        let found = Hunting.strikeLoot(loot, player);
        // Gone off: only part of it is worth the taking (rounded at random, so a little is still a chance)
        if (share < 1) found = found.map(f => ({ ...f, qty: Math.floor(f.qty * share + Utils.random()) })).filter(f => f.qty > 0);
        const trip = Hunting.finishTrip(player, found);
        const name = String(sp.name || a.species).toLowerCase();
        const words = InnerMap.animalConfig().words || {};
        const got = trip.kept.map(f => `${f.entry.icon || ''} ${f.entry.name} x${f.qty}`.trim());
        let body = got.length ? `You butcher the ${name}: ${got.join(', ')}.` : `There is nothing worth taking from the ${name}.`;
        if (share < 1) body += ` ${share <= 0.5 ? (words.rotten || 'It is far gone.') : (words.stale || 'It has begun to turn.')}`;
        if (trip.lost.length) body += ` No room for ${trip.lost.map(f => `${f.entry.name} x${f.qty}`).join(', ')}.`;
        if (trip.rankUp) body += ` Your craft grows: ${trip.rankUp.icon} ${trip.rankUp.name}.`;
        _notify(game, `${(InnerMap.animalConfig().butcher || {}).icon || '🔪'} Butchered`, body, got.length ? 'success' : 'info');
        if (game.ui && typeof game.ui.updateStats === 'function') game.ui.updateStats(player, game.world);
        return trip;
    },

    // ── Carrying a carcass (as a body is carried: ui/innerMapDigging.js) ──

    /** Can the player carry it just now? InnerMap.canCarryAnimal, and hands free of a body. */
    canCarry(game, a) {
        const player = game && game.player;
        const chk = InnerMap.canCarryAnimal(a, _num(player && player.strength, 5));
        if (chk.ok && InnerMapCombat._carrying) return { ...chk, ok: false, reason: 'hands full' };
        if (chk.ok && this._carry && this._carry.a !== a) return { ...chk, ok: false, reason: 'hands full' };
        return chk;
    },

    /** Walk to the carcass and pick it up (or drag it): the walk slows by its weight. */
    carry(game, a) {
        const chk = this.canCarry(game, a);
        if (!chk.ok) return false;
        const act = () => {
            if (!InnerMap.animals.includes(a) || a.butchered || (this._carry && this._carry.a === a)) return;
            this.pickUp(game, a);
        };
        if (_cheb(_me(), a) <= 1) { act(); return true; }
        const res = InnerMap.approachAndThen ? InnerMap.approachAndThen(a.q, a.r, act) : null;
        if (res === 'unreachable') { _notify(game, 'Blocked', 'You can\'t reach it.', 'error'); return false; }
        if (!InnerMap.approachAndThen) act();
        return true;
    },

    /** It is in the player's arms (or in tow) now. */
    pickUp(game, a) {
        const chk = this.canCarry(game, a);
        if (!chk.ok) return false;
        if (this._carry) this.drop(game, { quiet: true });
        const base = _num(InnerMap._playerSpeed, 4);
        this._carry = { a, tiles: InnerMap.tiles, base, how: chk.how, lastQ: null, lastR: null };
        a.carried = true;
        InnerMap._playerSpeed = base * chk.speed;
        this._tickCarry(game);
        const sp = InnerMap.animalSpecies(a.species) || {};
        const words = InnerMap.animalConfig().words || {};
        const line = chk.how === 'shoulder' ? (words.carry || 'You heave the {name} up.') : (words.drag || 'You drag the {name} along.');
        _notify(game, `${sp.icon || '🐾'} Carrying`, _fmt(line, { name: String(sp.name || a.species).toLowerCase() }), 'info');
        return true;
    },

    /** Put the carcass down where the player stands. o.quiet: no word of it. Returns the carcass. */
    drop(game, o = {}) {
        const c = this._carry;
        if (!c) return null;
        this._carry = null;
        const a = c.a;
        if (InnerMap._playerSpeed != null) InnerMap._playerSpeed = c.base;
        a.carried = false;
        a.drawQ = a.drawR = null;
        if (c.tiles === InnerMap.tiles && InnerMap.active && !InnerMap._insideBuilding) {
            a.q = InnerMap.playerInnerQ; a.r = InnerMap.playerInnerR;
        }
        InnerMap.noteCarcassMoved(game && game.world, a);
        if (!o.quiet) {
            const sp = InnerMap.animalSpecies(a.species) || {};
            const words = InnerMap.animalConfig().words || {};
            _notify(game, '⬇️ Put down', _fmt(words.drop || 'You put the {name} down.', { name: String(sp.name || a.species).toLowerCase() }), 'info');
        }
        return a;
    },

    /** Each frame while carrying: it goes where the player goes; off the map (or indoors) it is left behind. */
    _tickCarry(game) {
        const c = this._carry;
        const a = c.a;
        const gone = !InnerMap.active || InnerMap._insideBuilding || c.tiles !== InnerMap.tiles
            || !InnerMap.animals.includes(a) || a.state !== 'dead' || a.butchered;
        if (gone) {
            const sp = InnerMap.animalSpecies(a.species) || {};
            const words = InnerMap.animalConfig().words || {};
            const left = !a.butchered && a.state === 'dead';
            this.drop(game, { quiet: true });
            if (left) _notify(game, `${sp.icon || '🐾'} Left behind`, _fmt(words.leftBehind || 'You leave the {name} where you stood.', { name: String(sp.name || a.species).toLowerCase() }), 'info');
            return;
        }
        // Busy with something else (a hunt, a task): it goes down first
        if (InnerMapTasks.isActive && InnerMapTasks.isActive()) { this.drop(game); return; }
        a.q = InnerMap.playerInnerQ; a.r = InnerMap.playerInnerR;
        a.facing = ['up', 'left', 'down', 'right'][_num(InnerMapRenderer._playerFacing, 2)] || a.facing;
        // Keep where it is on the books as it moves (left at the edge, it lies there next time)
        if (a.q !== c.lastQ || a.r !== c.lastR) {
            c.lastQ = a.q; c.lastR = a.r;
            InnerMap.noteCarcassMoved(game && game.world, a);
        }
    },

    // ── The context menu ──

    /** What the player can do with an animal at (q, r): hunt, fight or slaughter it, butcher its carcass. */
    menuItems(game, q, r) {
        if (InnerMap._insideBuilding || !InnerMap.animals || !InnerMap.animals.length) return [];
        const cfg = InnerMap.animalConfig();
        const h = cfg.hunt || {};
        const fight = cfg.fight || {};
        const bu = cfg.butcher || {};
        const busy = InnerMapTasks.isActive && InnerMapTasks.isActive();
        const out = [];
        const world = game && game.world;
        const butcherItem = (a, lower, extra = '') => {
            const mins = InnerMap.butcherTime(a, cfg).minutes;
            const time = mins >= 60 ? `about ${Math.round(mins / 30) / 2} hours` : `about ${mins} minutes`;
            return { type: 'action', action: 'animal_butcher', label: `${bu.label || 'Butcher'} the ${lower}`, icon: bu.icon || '🔪',
                desc: `${_fmt(bu.desc || 'Take its meat and hide.', { name: lower })} (${time})${extra}`, animal: a };
        };
        const rotNote = (a) => {
            const share = InnerMap.carcassYield(world, a, cfg);
            return share >= 1 ? '' : share <= 0.5 ? ', rotting' : ', turning';
        };
        // What the player carries: put it down (or butcher it) wherever they stand
        const carried = this._carry && this._carry.a;
        if (carried && InnerMap.animals.includes(carried)) {
            const sp = InnerMap.animalSpecies(carried.species, cfg) || {};
            const lower = String(sp.name || carried.species).toLowerCase();
            out.push({ type: 'separator' });
            out.push({ type: 'header', label: `${sp.icon || '🐾'} Carrying a dead ${lower}${rotNote(carried)}` });
            out.push({ type: 'action', action: 'animal_drop', label: `Put the ${lower} down`, icon: '⬇️', desc: 'Lay it down where you stand', animal: carried });
            out.push(butcherItem(carried, lower, ' — put down here first'));
        }
        for (const a of InnerMap.getAnimalsNear(q, r, 1).slice(0, 3)) {
            if (a === carried) continue;
            const sp = InnerMap.animalSpecies(a.species, cfg);
            if (!sp) continue;
            const name = sp.name || a.species;
            const lower = name.toLowerCase();
            out.push({ type: 'separator' });
            if (a.state === 'dead') {
                out.push({ type: 'header', label: `${sp.icon || '🐾'} A dead ${lower}${a.butchered ? '' : rotNote(a)}` });
                if (a.butchered) { out.push({ type: 'disabled', label: 'Already butchered' }); continue; }
                out.push(butcherItem(a, lower));
                const chk = this.canCarry(game, a);
                const words = cfg.words || {};
                if (chk.ok) {
                    out.push({ type: 'action', action: 'animal_carry', label: `${chk.how === 'shoulder' ? 'Carry' : 'Drag'} the ${lower}`, icon: chk.how === 'shoulder' ? '🎒' : '🪢',
                        desc: `${chk.kg} kg: ${chk.speed >= 0.9 ? 'it hardly slows you' : `you walk at ${Math.round(chk.speed * 100)}% pace`}`, animal: a });
                } else if (chk.reason === 'too heavy') {
                    out.push({ type: 'disabled', label: `Carry the ${lower}: ${_fmt(words.tooHeavy || 'too heavy ({kg} kg)', { kg: chk.kg, name: lower })}` });
                } else if (chk.reason === 'hands full') {
                    out.push({ type: 'disabled', label: `Carry the ${lower}: ${words.handsFull || 'your hands are full'}` });
                }
                continue;
            }
            const mood = { flee: 'running', alert: 'watching you', walk: 'ambling', threat: 'warning you off', stalk: 'stalking you', charge: 'charging!', attack: 'on you!' }[a.state]
                || (a.livestock ? 'grazing in the pasture' : 'grazing');
            out.push({ type: 'header', label: `${sp.icon || '🦌'} ${name}, ${mood}` });
            if (a.hunted || busy) {
                out.push({ type: 'disabled', label: a.hunted ? 'You are stalking it' : 'Finish what you are doing first' });
                continue;
            }
            if (sp.huntable !== false && !a.livestock && !HOSTILE.has(a.state)) {
                out.push({ type: 'action', action: 'hunt_animal', label: `${h.label || 'Hunt'} the ${lower}`, icon: h.icon || '🏹',
                    desc: _fmt(h.desc || 'Creep up on the {name} and loose.', { name: lower }), animal: a });
            }
            if (a.livestock && a.owner) {
                out.push({ type: 'action', action: 'animal_fight', label: `${fight.slaughter || 'Slaughter'} the ${lower}`, icon: '🔪',
                    desc: _fmt(fight.slaughterDesc || 'It belongs to {owner}: killing it is theft.', { owner: a.owner.name || 'the village' }), animal: a });
            } else {
                const hp = a.hp < a.maxHp ? ` (${Math.ceil(a.hp)}/${a.maxHp} HP)` : '';
                out.push({ type: 'action', action: 'animal_fight', label: `${fight.label || 'Fight'} the ${lower}`, icon: fight.icon || '⚔️',
                    desc: _fmt(fight.desc || 'Fight the {name}.', { name: lower }) + hp, animal: a });
            }
        }
        return out;
    },

    /** The menu's animal actions (ui/innerMapUI.js). True when handled. */
    handle(game, item) {
        const a = item && item.animal;
        if (!a || !InnerMap.animals.includes(a)) return item && /^animal_/.test(item.action || '');
        if (item.action === 'animal_fight') { this.startFight(game, a); return true; }
        if (item.action === 'animal_butcher') { this.butcher(game, a); return true; }
        if (item.action === 'animal_carry') {
            const chk = this.canCarry(game, a);
            if (!chk.ok) {
                const words = InnerMap.animalConfig().words || {};
                const why = chk.reason === 'too heavy' ? _fmt(words.tooHeavy || 'too heavy ({kg} kg)', { kg: chk.kg }) : (words.handsFull || 'your hands are full');
                _notify(game, '🚫 Cannot carry it', `${why.charAt(0).toUpperCase()}${why.slice(1)}.`, 'error');
            } else this.carry(game, a);
            return true;
        }
        if (item.action === 'animal_drop') { this.drop(game); return true; }
        return false;
    },
};
