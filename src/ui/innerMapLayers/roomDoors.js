// InnerMapRenderer — the let rooms' doors of an inn (mixed in via Object.assign;
// which doors and whose: world/innerMap/guestRooms.js, systems/roomLocks.js).
// A door locked to the player is drawn shut in its doorway with a small brass
// lock; the room their key opens and a door they picked stand ajar (a thin
// edge of the door against the frame). Each let room's number is painted on
// a little plate over the doorway, gold for yours.

import { InnerMapRenderer } from '../innerMapRenderer.js';
import { InnerMap } from '../../world/innerMap.js';

Object.assign(InnerMapRenderer, {
    _renderRoomDoors(ctx, camera) {
        if (!InnerMap.active || !InnerMap._insideBuilding || !InnerMap._guestDoors) return;
        const floor = InnerMap._floor || 0;
        const T = this.TILE_SIZE;
        const ds = T * camera.zoom;
        const W = ctx.canvas.width, H = ctx.canvas.height;
        const art = this._interiorArt && this._interiorArt.door;
        const c = Array.isArray(art) ? art[0] : art;
        const img = c && this._getSheetByPath ? this._getSheetByPath(c.sheet) : null;
        const mine = InnerMap.yourGuestRoom ? InnerMap.yourGuestRoom() : null;
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        for (const d of InnerMap._guestDoors) {
            if (d.floor !== floor) continue;
            const p = camera.worldToScreenFast(d.q * T, d.r * T);
            const x = Math.floor(p.x), y = Math.floor(p.y), s = Math.ceil(ds);
            if (x > W || y > H || x + s < 0 || y + s < 0) continue;
            if (InnerMap.guestDoorLocked(d)) {
                if (img) {
                    const k = this._sheetScale(img);
                    ctx.drawImage(img, c.sx * k, c.sy * k, (c.sw || 32) * k, (c.sh || 32) * k, x, y, s, s);
                } else {
                    ctx.fillStyle = '#6b4a2b';
                    ctx.fillRect(x + s * 0.1, y, s * 0.8, s);
                }
                // the lock: a small brass plate and its keyhole
                ctx.fillStyle = '#d9b45a';
                ctx.fillRect(x + s * 0.62, y + s * 0.5, s * 0.14, s * 0.18);
                ctx.fillStyle = '#2a1a0a';
                ctx.fillRect(x + s * 0.67, y + s * 0.55, s * 0.04, s * 0.08);
            } else {
                // ajar: the door's edge swung back against the frame
                ctx.fillStyle = 'rgba(90, 60, 32, 0.9)';
                ctx.fillRect(x, y, Math.max(2, s * 0.14), s);
            }
            if (d.no != null && ds >= 14) {
                const own = mine && mine.key === d.key;
                const fs = Math.max(8, Math.round(ds * 0.28));
                ctx.font = `700 ${fs}px 'Inter', sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                const label = String(d.no);
                const tw = ctx.measureText(label).width + fs * 0.6;
                const cx = x + s / 2, cy = y + fs * 0.55;
                ctx.fillStyle = own ? 'rgba(245, 197, 66, 0.95)' : 'rgba(40, 28, 16, 0.85)';
                ctx.fillRect(cx - tw / 2, cy - fs * 0.55, tw, fs * 1.1);
                ctx.fillStyle = own ? '#2a1a0a' : '#e8d3a0';
                ctx.fillText(label, cx, cy + 1);
            }
        }
        ctx.restore();
    },
});
