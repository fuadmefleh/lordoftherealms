// NpcPortrait — paints an NPC's own LPC sprite as a pixel-art bust on a canvas,
// for the conversation window and the "People Here" cards. Falls back to the
// NPC's emoji (the caller's element) while sprites load or when there are none.
import { InnerMapCharacters } from './innerMapCharacters.js';
import { DataLoader } from '../core/dataLoader.js';
import { appearancePresetId, registerAppearance, gearKit } from './playerAppearance.js';

// The head-and-shoulders region of a 64×64 LPC frame
const CROP_X = 14, CROP_Y = 10, CROP = 36;

function _preset(npc) {
    if (!npc || !InnerMapCharacters.isReady()) return null;
    if (!npc.preset) npc.preset = InnerMapCharacters.getPresetForNPC(npc.type, npc.id || 0, npc.gender);
    return npc.preset && InnerMapCharacters.getComposited(npc.preset) ? npc.preset : null;
}

let _loading = null;

export const NpcPortrait = {
    /**
     * The sprites normally load with the inner-map renderer; on the overworld
     * nothing has asked for them yet, so a portrait starts the load itself.
     */
    ensureLoaded() {
        if (InnerMapCharacters.isReady() || _loading) return _loading || Promise.resolve();
        _loading = DataLoader.load('innerMapRenderer.json')
            .then((cfg) => {
                if (!cfg) return;
                if (!InnerMapCharacters._presets.male_noble) InnerMapCharacters.configure(cfg);
                return InnerMapCharacters.loadAll();
            })
            .catch(() => { /* the emoji stays */ })
            .finally(() => { _loading = null; });
        return _loading;
    },

    /** The player's own sprite: the look they chose (in the arms they wear), else a noble of their gender. */
    playerPreset(player) {
        if (player && player.appearance) return appearancePresetId(player.appearance, gearKit(player));
        const gender = player && player.gender === 'female' ? 'female' : 'male';
        return `${gender}_noble`;
    },

    /**
     * Give a HUD portrait slot (the character card, the top bar) the player's
     * breathing bust. The slot keeps its emoji underneath until the sprite is
     * ready, and only remounts when the preset changes.
     */
    attachPlayer(el, player) {
        if (!el || typeof el.appendChild !== 'function' || typeof document.createElement !== 'function') return;
        const preset = this.playerPreset(player);
        InnerMapCharacters.playerPreset = preset;
        if (el.dataset && el.dataset.preset === preset) return;
        if (el.dataset) el.dataset.preset = preset;
        if (el._stopPortrait) el._stopPortrait();
        let canvas = el.querySelector && el.querySelector('canvas.hud-portrait-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.className = 'hud-portrait-canvas';
            canvas.width = canvas.height = 96;
            el.appendChild(canvas);
        }
        const subject = { preset };
        this.ensureLoaded()
            .then(() => (player && player.appearance ? registerAppearance(player.appearance, gearKit(player)) : null))
            .then(() => {
                if (!el.dataset || el.dataset.preset !== preset) return;
                el.classList.toggle('has-sprite', this.hasSprite(subject));
                el._stopPortrait = this.mount(canvas, subject);
            });
    },

    /** True when the NPC has a sprite that can be painted. */
    hasSprite(npc) {
        return !!_preset(npc);
    },

    /**
     * Draw one frame of the bust, filling the canvas. `time` drives the idle
     * (breathing) cycle. Returns false when there is no sprite to draw.
     */
    paint(canvas, npc, time = 0, presetOverride = null) {
        const preset = presetOverride || _preset(npc);
        if (!canvas || !preset) return false;
        const ctx = canvas.getContext('2d');
        if (!ctx) return false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;
        const s = canvas.width / CROP;
        return InnerMapCharacters.drawCharacter(ctx, preset, 'idle', InnerMapCharacters.DIR_DOWN, time,
            -CROP_X * s, -CROP_Y * s, 64 * s, 64 * s);
    },

    /**
     * Draw a preset's bust into the square (x, y, size) of any context — the
     * player's token on the world map. False when the sprite isn't loaded.
     */
    drawBust(ctx, preset, time, x, y, size) {
        if (!ctx || !preset || !InnerMapCharacters.isReady() || !InnerMapCharacters.getComposited(preset)) return false;
        const s = size / CROP;
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        const ok = InnerMapCharacters.drawCharacter(ctx, preset, 'idle', InnerMapCharacters.DIR_DOWN, time,
            x - CROP_X * s, y - CROP_Y * s, 64 * s, 64 * s);
        ctx.restore();
        return ok !== false;
    },

    /**
     * Keep the bust breathing until the returned stop() is called or the canvas
     * leaves the page. `fallbackEl` is shown whenever there is no sprite.
     */
    mount(canvas, npc, fallbackEl = null) {
        let raf = 0;
        let stopped = false;
        const tick = () => {
            if (stopped || !canvas.isConnected) return;
            const ok = this.paint(canvas, npc, performance.now() / 1000);
            canvas.style.visibility = ok ? 'visible' : 'hidden';
            if (fallbackEl) fallbackEl.style.display = ok ? 'none' : '';
            raf = requestAnimationFrame(tick);
        };
        tick();
        return () => { stopped = true; cancelAnimationFrame(raf); };
    },
};
