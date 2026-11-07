// ============================================
// INNER MAP — opening and shutting a gate
// ============================================
// A gate in a field or pasture fence (world/innerMap/gates.js) offers
// "Open Gate" or "Close Gate": the player walks over to it first (like any
// object), then swings it. Walking into a shut gate opens it too (the walk
// itself does that); a gate can't be shut on someone standing in it.

import { InnerMap } from '../world/innerMap.js';

export const InnerMapGates = {
    /** The Open/Close entry for the gate at (q, r), if there is one. */
    menuItems(game, q, r) {
        const g = InnerMap.gateAt(q, r);
        if (!g) return [];
        return g.open
            ? [{ type: 'action', action: 'gate_close', label: 'Close Gate', icon: '🚪', desc: 'Swing it shut: it keeps beasts in, and out', objAnchorQ: q, objAnchorR: r }]
            : [{ type: 'action', action: 'gate_open', label: 'Open Gate', icon: '🚪', desc: 'Swing it open: it stays open till someone shuts it', objAnchorQ: q, objAnchorR: r }];
    },

    /** Run gate_open / gate_close. Returns true when it was ours. */
    handle(game, item) {
        if (!item || (item.action !== 'gate_open' && item.action !== 'gate_close')) return false;
        const q = item.objAnchorQ, r = item.objAnchorR;
        const open = item.action === 'gate_open';
        const swing = () => {
            const res = InnerMap.setGateOpen(q, r, open);
            if (res === 'occupied') {
                game.ui.showNotification('🚪 Someone in the Way', InnerMap.playerInnerQ === q && InnerMap.playerInnerR === r
                    ? 'Step out of the gateway first.' : 'Someone is standing in the gateway.', 'warning');
            }
        };
        const res = InnerMap.approachAndThen(q, r, swing);
        if (res === 'unreachable') game.ui.showNotification('Blocked', 'You can\'t reach the gate.', 'error');
        return true;
    },
};
