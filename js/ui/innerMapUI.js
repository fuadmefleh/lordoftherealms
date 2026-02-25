// ============================================
// INNER MAP RENDERER — UI SYSTEMS
// Weather particles, HUD overlay, context menu,
// and action handlers.
// Mixed into InnerMapRenderer via Object.assign.
// ============================================

Object.assign(InnerMapRenderer, {

    // ══════════════════════════════════════════════
    // WEATHER PARTICLES
    // ══════════════════════════════════════════════

    _renderWeatherParticles(ctx, canvas, camera, deltaTime) {
        const w = InnerMap.weather;
        if (!w || w.type === 'clear' || w.type === 'cloudy' || w.type === 'none') return;

        const cw = canvas.width, ch = canvas.height;
        const intensity = Math.min(w.intensity, 1);

        if (w.type === 'rain' || w.type === 'storm') {
            const dropCount = Math.floor(40 + intensity * 80);
            ctx.save();
            ctx.strokeStyle = w.type === 'storm' ? 'rgba(160,180,220,0.5)' : 'rgba(170,195,230,0.35)';
            ctx.lineWidth = w.type === 'storm' ? 1.8 : 1.2;
            ctx.beginPath();

            this._weatherParticleTimer += deltaTime;
            const t = this._weatherParticleTimer * 120;
            for (let i = 0; i < dropCount; i++) {
                const seed = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
                const sx = ((seed * 1.17 + t * 0.7 + i * 37) % cw + cw) % cw;
                const sy = ((seed * 2.31 + t * 2.5 + i * 53) % ch + ch) % ch;
                const len = (8 + intensity * 8) * (w.type === 'storm' ? 1.4 : 1.0);
                ctx.moveTo(sx, sy);
                ctx.lineTo(sx - 2, sy + len);
            }
            ctx.stroke();
            ctx.restore();

            if (w.type === 'storm' && Math.random() < 0.008) {
                ctx.fillStyle = 'rgba(255,255,255,0.25)';
                ctx.fillRect(0, 0, cw, ch);
            }
        } else if (w.type === 'snow') {
            const flakeCount = Math.floor(30 + intensity * 60);
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            this._weatherParticleTimer += deltaTime;
            const t = this._weatherParticleTimer * 40;
            ctx.beginPath();
            for (let i = 0; i < flakeCount; i++) {
                const seed = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
                const sx = ((seed * 3.71 + t * 0.3 + i * 41 + Math.sin(t * 0.02 + i) * 20) % cw + cw) % cw;
                const sy = ((seed * 1.93 + t * 0.8 + i * 61) % ch + ch) % ch;
                const rad = 1.2 + (Math.abs(seed * 7) % 2);
                ctx.moveTo(sx + rad, sy);
                ctx.arc(sx, sy, rad, 0, Math.PI * 2);
            }
            ctx.fill();
            ctx.restore();
        }
    },

    // ══════════════════════════════════════════════
    // HUD — Top bar overlay
    // ══════════════════════════════════════════════

    _renderHUD(ctx, canvas) {
        const summary = InnerMap.getSummary();
        if (!summary) return;

        const barHeight = 48;
        ctx.fillStyle = 'rgba(16, 20, 28, 0.92)';
        ctx.fillRect(0, 0, canvas.width, barHeight);
        ctx.fillStyle = 'rgba(245,197,66,0.15)';
        ctx.fillRect(0, barHeight - 1, canvas.width, 1);

        const worldTile = InnerMap.currentWorldTile;
        const terrainId = summary.parentTerrain;
        const terrainDef = Terrain.TYPES[terrainId.toUpperCase()] || {};

        ctx.font = '600 13px "Inter", sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#f5c542';

        const settlement = InnerMap._currentWorldTileRef && InnerMap._currentWorldTileRef.settlement;
        const locationName = settlement ? settlement.name : (terrainDef.name || terrainId);
        ctx.fillText(`🗺️ ${locationName}`, 16, barHeight / 2 - 8);

        ctx.font = '400 11px "Inter", sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        const subInfo = settlement
            ? `${settlement.type} · Pop: ${Utils.formatNumber(settlement.population)}`
            : `${terrainDef.name || terrainId} (${worldTile.q}, ${worldTile.r})`;

        const wIcons = { clear: '☀️', cloudy: '☁️', rain: '🌧️', storm: '⛈️', snow: '❄️' };
        const wt = InnerMap.weather;
        const tmp = InnerMap.temperature;
        let weatherStr = '';
        if (wt) weatherStr += ` · ${wIcons[wt.type] || ''} ${wt.type}`;
        if (tmp) weatherStr += ` ${tmp.celsius}°C`;
        ctx.fillText(subInfo + weatherStr, 16, barHeight / 2 + 8);

        const timeStr = InnerMap.getTimeString();
        const period = InnerMap.getTimePeriod();
        const periodIcons = { morning: '🌅', midday: '☀️', afternoon: '🌤️', evening: '🌇', night: '🌙' };
        ctx.font = '700 15px "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(`${periodIcons[period] || '⏰'} ${timeStr}`, canvas.width / 2, barHeight / 2 - 6);

        const barWidth = 120;
        const barX = canvas.width / 2 - barWidth / 2;
        const barY = barHeight / 2 + 8;
        const progress = InnerMap.timeOfDay / 24;
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(barX, barY, barWidth, 4);
        ctx.fillStyle = progress > 0.75 ? '#e74c3c' : progress > 0.5 ? '#f39c12' : '#4FC3F7';
        ctx.fillRect(barX, barY, barWidth * progress, 4);

        ctx.textAlign = 'right';
        ctx.font = '500 11px "Inter", sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        const buildingCount = InnerMap.buildings.length;
        const npcCount = InnerMap.npcs.length;
        if (buildingCount > 0) {
            ctx.fillText(`🏠 ${buildingCount} buildings  👥 ${npcCount} people`, canvas.width - 16, barHeight / 2 - 6);
        } else {
            ctx.fillText(`Explored: ${summary.exploredPercent}%  |  Discoveries: ${summary.discoveredEncounters}/${summary.encounters}`, canvas.width - 16, barHeight / 2 - 6);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '400 10px "Inter", sans-serif';
        ctx.fillText('ESC to return · Right-click to move/interact', canvas.width - 16, barHeight / 2 + 10);
    },

    // ══════════════════════════════════════════════
    // CONTEXT MENU — Right-click building/NPC interaction
    // ══════════════════════════════════════════════

    showContextMenu(game, q, r, screenX, screenY) {
        this.closeContextMenu();

        const tile = InnerMap.getTile(q, r);
        if (!tile || !tile.visible) return;

        const building = InnerMap.getBuildingAt(q, r);
        const npcsHere = InnerMap.getNPCsAt(q, r);
        const isPlayerHere = (q === InnerMap.playerInnerQ && r === InnerMap.playerInnerR);

        const menuItems = [];

        if (building) {
            const actions = InnerMap.getBuildingActions(building);
            menuItems.push({ type: 'header', label: `${building.icon} ${building.name}` });
            for (const action of actions) {
                if (action === 'closed') {
                    menuItems.push({ type: 'disabled', label: '🚫 Closed', desc: 'This place is closed for the night' });
                    continue;
                }
                const actionDef = this._getActionDef(action);
                menuItems.push({ type: 'action', action, label: actionDef.label, icon: actionDef.icon, desc: actionDef.desc, building });
            }
        }

        if (npcsHere.length > 0) {
            if (menuItems.length > 0) menuItems.push({ type: 'separator' });
            menuItems.push({ type: 'header', label: '👥 People Here' });
            for (const npc of npcsHere.slice(0, 5)) {
                const npcDef = InnerMap.NPC_TYPES[npc.type] || {};
                menuItems.push({ type: 'action', action: 'talk_npc', label: `Talk to ${npc.name}`, icon: npc.icon, desc: `${npcDef.name || npc.type}`, npc });
            }
        }

        if (!building) {
            if (menuItems.length > 0) menuItems.push({ type: 'separator' });
            menuItems.push({ type: 'header', label: `${tile.subTerrain.icon} ${tile.subTerrain.name}` });
            if (!isPlayerHere) {
                menuItems.push({ type: 'action', action: 'move_here', label: 'Move Here', icon: '🚶', desc: 'Walk to this spot' });
            }
            if (tile.encounter && tile.encounter.discovered) {
                menuItems.push({ type: 'action', action: 'examine', label: `Examine ${tile.encounter.name}`, icon: tile.encounter.icon, desc: tile.encounter.description });
            }
            if (isPlayerHere && tile.subTerrain.passable && !tile.building) {
                const worldTile = game.world ? game.world.getTile(game.player.q, game.player.r) : null;
                const isSettlement = worldTile && worldTile.settlement && worldTile.settlement.type;
                menuItems.push({ type: 'separator' });
                menuItems.push({ type: 'header', label: '🏗️ Build' });
                menuItems.push({ type: 'action', action: 'build_property', label: 'Build Property', icon: '🏗️', desc: 'Construct a farm, mine, workshop, etc.' });
                menuItems.push({ type: 'action', action: 'build_temple', label: 'Build Temple', icon: '⛩️', desc: 'Construct a place of worship' });
                menuItems.push({ type: 'action', action: 'build_cultural', label: 'Build Cultural Building', icon: '📚', desc: 'Library, theater, university, or monument' });
                menuItems.push({ type: 'action', action: 'build_infrastructure', label: 'Build Infrastructure', icon: '🛤️', desc: 'Roads, bridges, or irrigation' });
                if (isSettlement) {
                    menuItems.push({ type: 'action', action: 'buy_house', label: 'Buy a House', icon: '🏠', desc: 'Purchase a house in this settlement' });
                }
            }
            if (isPlayerHere) {
                menuItems.push({ type: 'separator' });
                menuItems.push({ type: 'header', label: '⚙️ General' });
                menuItems.push({ type: 'action', action: 'wait_here', label: 'Wait', icon: '⏳', desc: 'Wait and let time pass' });
                menuItems.push({ type: 'action', action: 'rest', label: 'Rest', icon: '💤', desc: 'Take a break and recover' });
            }
        }

        if (menuItems.length === 0) return;

        const menu = document.createElement('div');
        menu.id = 'innerMapContextMenu';
        menu.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(16,20,28,0.97);backdrop-filter:blur(14px);border:1px solid rgba(245,197,66,0.35);border-radius:12px;z-index:1300;box-shadow:0 12px 48px rgba(0,0,0,0.85),0 0 0 1px rgba(245,197,66,0.08);overflow:hidden;font-family:var(--font-body,'Inter',sans-serif);display:flex;flex-direction:column;max-width:92vw;max-height:90vh;min-width:280px;`;

        const locationLabel = building ? `${building.icon} ${building.name}` : npcsHere.length > 0 ? `👥 People Here` : `${tile.subTerrain.icon} ${tile.subTerrain.name}`;
        const timeStr = InnerMap.getTimeString ? InnerMap.getTimeString() : '';

        let headerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.06);background:rgba(245,197,66,0.04);flex-shrink:0;"><div><div style="font-family:var(--font-display,'Inter',sans-serif);font-size:14px;color:var(--gold,#f5c542);letter-spacing:0.5px;">Actions</div><div style="font-size:11px;color:var(--text-secondary,rgba(255,255,255,0.5));margin-top:1px;">${locationLabel}</div></div><div style="display:flex;align-items:center;gap:12px;">${timeStr ? `<span style="font-size:11px;color:#f39c12;background:rgba(243,156,18,0.12);padding:2px 8px;border-radius:4px;">🕐 ${timeStr}</span>` : ''}<button id="closeInnerContextMenu" style="background:none;border:none;color:rgba(255,255,255,0.4);font-size:18px;cursor:pointer;padding:4px 6px;line-height:1;transition:color 0.15s;" onmouseover="this.style.color='#fff'" onmouseout="this.style.color='rgba(255,255,255,0.4)'">✕</button></div></div>`;

        const categories = [];
        let currentCat = null;
        for (const item of menuItems) {
            if (item.type === 'header') { currentCat = { label: item.label, items: [] }; categories.push(currentCat); }
            else if (item.type === 'separator') { currentCat = null; }
            else if (currentCat) { currentCat.items.push(item); }
            else { currentCat = { label: '', items: [item] }; categories.push(currentCat); }
        }

        let bodyHTML = `<div style="padding:6px;display:flex;flex-direction:column;gap:3px;">`;
        for (const cat of categories) {
            if (cat.label) {
                bodyHTML += `<div style="padding:7px 10px;font-size:11px;font-family:var(--font-display,'Inter',sans-serif);color:var(--gold,#f5c542);letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid rgba(245,197,66,0.12);background:rgba(245,197,66,0.03);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-radius:4px;margin-bottom:3px;">${cat.label}</div>`;
            }
            for (const item of cat.items) {
                if (item.type === 'disabled') {
                    bodyHTML += `<div style="display:flex;align-items:center;gap:7px;background:rgba(255,255,255,0.015);border:1px solid rgba(255,255,255,0.04);padding:6px 8px;border-radius:5px;color:rgba(255,255,255,0.3);font-family:var(--font-body,'Inter',sans-serif);white-space:nowrap;min-width:0;"><span style="font-size:16px;width:22px;text-align:center;flex-shrink:0;">🚫</span><span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;">${item.label}</span></div>`;
                } else {
                    bodyHTML += `<button class="inner-ctx-btn" data-action="${item.action||''}" style="display:flex;align-items:center;gap:7px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.05);padding:6px 8px;border-radius:5px;color:var(--text-primary,#e0e0e0);cursor:pointer;text-align:left;transition:background 0.12s,border-color 0.12s;font-family:var(--font-body,'Inter',sans-serif);white-space:nowrap;min-width:0;width:100%;" onmouseover="this.style.background='rgba(245,197,66,0.12)';this.style.borderColor='rgba(245,197,66,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.025)';this.style.borderColor='rgba(255,255,255,0.05)'"><span style="font-size:16px;width:22px;text-align:center;flex-shrink:0;">${item.icon||'📋'}</span><div style="flex:1;min-width:0;"><div style="display:flex;align-items:center;gap:6px;"><span style="font-size:12px;font-weight:600;color:#e0e0e0;overflow:hidden;text-overflow:ellipsis;">${item.label}</span></div>${item.desc ? `<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.desc}</div>` : ''}</div></button>`;
                }
            }
        }
        bodyHTML += `</div>`;

        menu.innerHTML = headerHTML + bodyHTML;
        document.body.appendChild(menu);

        document.getElementById('closeInnerContextMenu').addEventListener('click', () => this.closeContextMenu());

        const allActionItems = [];
        for (const cat of categories) { for (const item of cat.items) { if (item.type !== 'disabled') allActionItems.push(item); } }

        const buttons = menu.querySelectorAll('.inner-ctx-btn');
        let actionIdx = 0;
        buttons.forEach(btn => {
            const item = allActionItems[actionIdx++];
            if (item) { btn.addEventListener('click', () => { this.closeContextMenu(); this._handleContextAction(game, item, q, r); }); }
        });

        const closeHandler = (e) => { if (!menu.contains(e.target)) { this.closeContextMenu(); document.removeEventListener('mousedown', closeHandler); } };
        setTimeout(() => document.addEventListener('mousedown', closeHandler), 50);
    },

    closeContextMenu() {
        const menu = document.getElementById('innerMapContextMenu');
        if (menu) menu.remove();
    },

    // ══════════════════════════════════════════════
    // CONTEXT MENU ACTION HANDLERS
    // ══════════════════════════════════════════════

    _handleContextAction(game, item, q, r) {
        const action = item.action;
        const playerQ = InnerMap.playerInnerQ;
        const playerR = InnerMap.playerInnerR;
        const dist = Math.abs(playerQ - q) + Math.abs(playerR - r);

        if (action === 'move_here') {
            InnerMap.cancelPlayerWalk();
            InnerMap.movePlayerTo(q, r);
            return;
        }

        if (dist > 1) {
            InnerMap.cancelPlayerWalk();
            InnerMap.movePlayerTo(q, r);
        }

        switch (action) {
            case 'trade': case 'browse_goods': case 'buy_weapons': case 'buy_tools': case 'buy_food': case 'buy_drink': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') ActionMenu.showTradeMenu(game, worldTile);
                break;
            }
            case 'talk_merchant': case 'talk_locals': case 'talk_priest': case 'talk_captain':
            case 'talk_guard': case 'talk_official': case 'ask_directions': case 'talk_npc': {
                const npc = item.npc;
                const name = npc ? npc.name : (item.building ? item.building.name : 'someone');
                const rumors = [
                    'I heard bandits on the road to the east.', 'The harvest was good this year, prices should be fair.',
                    'A traveling merchant passed through with exotic goods.', 'The lord has been raising taxes again...',
                    'Strange lights were seen in the forest last night.', 'A caravan from the capital is expected any day now.',
                    'The well water has been tasting odd lately.', 'They say there\'s treasure hidden in the old ruins.',
                    'Watch yourself at night, the guards are spread thin.', 'The blacksmith just got a shipment of fine ore.',
                ];
                game.ui.showNotification(`💬 ${name}`, `"${rumors[Math.floor(Math.random() * rumors.length)]}"`, 'info');
                break;
            }
            case 'tavern': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') ActionMenu.handleAction(game, worldTile, 'tavern');
                break;
            }
            case 'rest': { game.ui.showNotification('💤 Rest', 'You rest for a while and recover some energy.', 'info'); break; }
            case 'pray': case 'meditate': { game.ui.showNotification('🙏 Prayer', 'You spend time in quiet contemplation.', 'info'); break; }
            case 'donate': {
                if (game.player.gold >= 10) {
                    game.player.gold -= 10;
                    game.ui.showNotification('💰 Donation', 'You donated 10 gold to the church. Your karma improves.', 'success');
                    game.player.karma = (game.player.karma || 0) + 1;
                    game.ui.updateStats(game.player, game.world);
                } else { game.ui.showNotification('💰 Donation', 'You don\'t have enough gold to donate.', 'error'); }
                break;
            }
            case 'recruit': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') ActionMenu.handleAction(game, worldTile, 'recruit');
                break;
            }
            case 'train_combat': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') ActionMenu.handleAction(game, worldTile, 'train_combat');
                break;
            }
            case 'repair': { game.ui.showNotification('🔧 Repair', 'The blacksmith can repair your equipment.', 'info'); break; }
            case 'view_notices': { game.ui.showNotification('📜 Notice Board', 'Check back later for quests and bounties.', 'info'); break; }
            case 'pay_taxes': { game.ui.showNotification('💰 Tax Office', 'Tax collection is handled automatically each week.', 'info'); break; }
            case 'seek_blessing': { game.ui.showNotification('✨ Blessing', 'The priest offers a blessing for your journey.', 'info'); break; }
            case 'seek_audience': { game.ui.showNotification('🏛️ Audience', 'The lord is not currently receiving visitors.', 'info'); break; }
            case 'store_goods': case 'collect_goods': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') ActionMenu.handleAction(game, worldTile, 'collect_goods');
                break;
            }
            case 'buy_horse': case 'stable_horse': { game.ui.showNotification('🐴 Stable', 'Horse trading is not yet available.', 'info'); break; }
            case 'report_crime': { game.ui.showNotification('🗼 Guards', 'The guards note your report. They\'ll look into it.', 'info'); break; }
            case 'examine': {
                const tile = InnerMap.getTile(q, r);
                if (tile && tile.encounter) game.ui.showNotification(`${tile.encounter.icon} ${tile.encounter.name}`, tile.encounter.description, 'info');
                break;
            }
            case 'build_property': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') { InnerMap._pendingPropertyPosition = { q, r }; ActionMenu.handleAction(game, worldTile, 'build_property'); }
                break;
            }
            case 'build_temple': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') ActionMenu.handleAction(game, worldTile, 'build_temple');
                break;
            }
            case 'build_cultural': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') ActionMenu.handleAction(game, worldTile, 'build_cultural');
                break;
            }
            case 'build_infrastructure': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') ActionMenu.handleAction(game, worldTile, 'build_infrastructure');
                break;
            }
            case 'buy_house': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') ActionMenu.handleAction(game, worldTile, 'buy_house');
                break;
            }
            case 'wait_here': {
                InnerMap._timeAccumulator = InnerMap.TIME_SCALE;
                game.ui.showNotification('⏳ Wait', 'You wait for an hour...', 'info');
                break;
            }
            default:
                game.ui.showNotification('ℹ️ Action', `${action} is not available right now.`, 'info');
                break;
        }
    },

    _getActionDef(action) {
        const defs = this._actionDefs || {};
        return defs[action] || { label: action, icon: '❓', desc: '' };
    },
});
