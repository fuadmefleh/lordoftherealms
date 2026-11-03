// ============================================
// AUTO-CHART — walking a standing order to chart an area
// ============================================
// The order itself (which tiles, when to stop, charting each one) is
// Cartography's (systems/cartography/charting.js → player.autoChart). This
// drives it through the game loop like any journey: walk to the nearest
// uncharted tile, chart it on arrival (onPlayerArrived calls back here),
// and rest when the day's action points run out (endDay calls back here in
// the morning). Escape, or giving any other order to move, ends it.
import { Cartography, ActionMenu } from './_gameImports.js';

/** Names of the maps the draft can be drawn into now. */
function _ready(game) {
    return Cartography.drawOptions(game.player, game.world).filter(o => o.ready).map(o => o.name);
}

/** Take the next step of the order, if there is one and the player is free to. */
export function _autoChartStep() {
    const player = this.player;
    const world = this.world;
    if (!player || !world || !player.autoChart || player.isMoving || this.isProcessingTurn) return;
    const halt = Cartography.autoChartHalt(player);
    if (halt) {
        const n = Cartography.stopAutoChart(player);
        this.ui.showNotification('🧭 Charting Stopped', `You stop charting because ${halt}. ${n} tile${n === 1 ? '' : 's'} charted on this survey.`, 'warning');
        return;
    }
    for (let guard = 0; guard < 12; guard++) {
        const before = _ready(this);
        const res = Cartography.autoChartNext(player, world);
        if (res.charted) {
            const now = _ready(this).filter(n => !before.includes(n));
            if (now.length) this.ui.showNotification('🗺️ Enough Charted', `You have charted enough for: ${now.join(', ')}. Draw it from Cartography whenever you like; the survey goes on.`, 'success');
        }
        if (res.done) {
            const view = Cartography.draftCount(player);
            this.ui.showNotification('🧭 Survey Complete', `${res.reason || 'The area is charted.'} ${view} tile${view === 1 ? '' : 's'} on your sheets. Open Cartography to draw a map.`, 'success');
            this.ui.updateStats(player, world);
            return;
        }
        this.ui.updateStats(player, world);
        // No strength left today: rest, and go on in the morning
        if ((player.actionPoints || 0) < 1 || !((player.movementRemaining || 0) > 0)) {
            this.ui.showNotification('🧭 Resting for the Night', 'You make camp and will go on charting in the morning. Press Escape to stop.', 'info');
            this.endDay();
            return;
        }
        if (player.q === res.next.q && player.r === res.next.r) continue;
        if (player.moveTo(res.next.q, res.next.r, world)) {
            this.camera.following = true;
            return;
        }
        // No way to that tile: leave it out and try the next
        Cartography.autoChartSkip(player, res.next.q, res.next.r);
    }
}

/** Begin an order from the Cartography panel. */
export function startAutoChart(radius) {
    const res = Cartography.startAutoChart(this.player, this.world, radius);
    if (!res.success) {
        this.ui.showNotification('🧭 Auto-Chart', res.reason, 'error');
        return res;
    }
    if (this.ui.hideCustomPanel) this.ui.hideCustomPanel();
    if (typeof ActionMenu.close === 'function') ActionMenu.close();
    this.ui.showNotification('🧭 Auto-Charting', `You set out to chart the ${res.tiles} uncharted tile${res.tiles === 1 ? '' : 's'} around you, resting each night. Press Escape to stop.`, 'info');
    this._autoChartStep();
    return res;
}

/** End an order (Escape, or another order to move). Quiet when there is none. */
export function stopAutoChart(why = 'You stop charting.') {
    if (!this.player || !this.player.autoChart) return 0;
    const n = Cartography.stopAutoChart(this.player);
    this.ui.showNotification('🧭 Charting Stopped', `${why} ${n} tile${n === 1 ? '' : 's'} charted on this survey.`, 'default');
    return n;
}
