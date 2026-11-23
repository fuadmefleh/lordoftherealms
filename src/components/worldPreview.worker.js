// ============================================
// WORLD PREVIEW WORKER — the New Game preview's land, off the main thread
// ============================================
//
// Built by Vite from `new Worker(new URL('./worldPreview.worker.js', import.meta.url))`
// (components/worldPreviewClient.js). It loads the game data itself (DataLoader:
// data/gamedata.json with the mods merged in, as a New Game does) and runs the real
// generator's land stage (world/worldPreview.js) for the New Game settings it is sent.
// Its own module instances: nothing here touches the page's RNG or data.

import { DataLoader } from '../core/dataLoader.js';
import { WorldPreview } from '../world/worldPreview.js';
import { newWorldParams } from '../ui/game/worldParams.js';

let ready = null;

self.onmessage = async (e) => {
    const { id, settings } = e.data || {};
    try {
        if (!ready) ready = DataLoader.initializeAll();
        await ready;
        const { width, height, params } = newWorldParams(settings);
        const preview = WorldPreview.build(width, height, params);
        self.postMessage({ id, ok: true, preview }, WorldPreview.transferables(preview));
    } catch (err) {
        ready = null;
        self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
    }
};
