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
        const insideBuilding = InnerMap._insideBuilding;
        const locationName = insideBuilding
            ? `${insideBuilding.icon} ${insideBuilding.name}`
            : settlement ? settlement.name : (terrainDef.name || terrainId);
        ctx.fillText(`🗺️ ${locationName}`, 16, barHeight / 2 - 8);

        ctx.font = '400 11px "Inter", sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        let subInfo;
        if (insideBuilding) {
            subInfo = `Interior · ${insideBuilding.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`;
        } else if (settlement) {
            subInfo = `${settlement.type} · Pop: ${Utils.formatNumber(settlement.population)}`;
        } else {
            subInfo = `${terrainDef.name || terrainId} (${worldTile.q}, ${worldTile.r})`;
        }

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

        // Show building interior info if inside a building
        if (InnerMap._insideBuilding) {
            const bldg = InnerMap._insideBuilding;
            ctx.fillText(`🚪 Inside: ${bldg.icon} ${bldg.name}`, canvas.width - 16, barHeight / 2 - 6);
            ctx.fillStyle = 'rgba(255,200,100,0.7)';
            ctx.font = '400 10px "Inter", sans-serif';
            ctx.fillText('ESC to exit building · Left-click to interact', canvas.width - 16, barHeight / 2 + 10);
        } else {
            const buildingCount = InnerMap.buildings.length;
            const npcCount = InnerMap.npcs.length;
            if (buildingCount > 0) {
                ctx.fillText(`🏠 ${buildingCount} buildings  👥 ${npcCount} people`, canvas.width - 16, barHeight / 2 - 6);
            } else {
                ctx.fillText(`Explored: ${summary.exploredPercent}%  |  Discoveries: ${summary.discoveredEncounters}/${summary.encounters}`, canvas.width - 16, barHeight / 2 - 6);
            }
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.font = '400 10px "Inter", sans-serif';
            ctx.fillText('ESC to return · Left-click to interact', canvas.width - 16, barHeight / 2 + 10);
        }
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

        // ── Resolve custom object on this tile ──
        let customObjDef = null;
        let objAnchorQ = null, objAnchorR = null;
        if (typeof CustomObjects !== 'undefined') {
            if (tile.customObject) {
                customObjDef = CustomObjects.getDef(tile.customObject.defId);
                objAnchorQ = q; objAnchorR = r;
            } else if (tile.customObjectPart) {
                const anchor = InnerMap.getTile(tile.customObjectPart.anchorQ, tile.customObjectPart.anchorR);
                if (anchor && anchor.customObject) {
                    customObjDef = CustomObjects.getDef(anchor.customObject.defId);
                    objAnchorQ = tile.customObjectPart.anchorQ;
                    objAnchorR = tile.customObjectPart.anchorR;
                }
            }
        }

        // Built-in overlay objects are disabled (editor-authored objects only)
        const builtinOverlay = null;

        const menuItems = [];

        // ── Building actions ──
        if (building) {
            const actions = InnerMap.getBuildingActions(building);
            menuItems.push({ type: 'header', label: `${building.icon} ${building.name}` });
            // Add "Enter" action for buildings
            menuItems.push({ type: 'action', action: 'enter_building', label: 'Enter', icon: '🚪', desc: `Enter ${building.name}`, building });
            for (const action of actions) {
                if (action === 'closed') {
                    menuItems.push({ type: 'disabled', label: '🚫 Closed', desc: 'This place is closed for the night' });
                    continue;
                }
                const actionDef = this._getActionDef(action);
                menuItems.push({ type: 'action', action, label: actionDef.label, icon: actionDef.icon, desc: actionDef.desc, building });
            }
        }

        // ── Custom object actions ──
        if (customObjDef && !building) {
            if (menuItems.length > 0) menuItems.push({ type: 'separator' });
            const typeIcons = { rock: '🪨', tree: '🌲', plant: '🌿', decoration: '✨', furniture: '🪑', building: '🏠', other: '📦' };
            const objIcon = typeIcons[customObjDef.objectType] || '📦';
            menuItems.push({ type: 'header', label: `${objIcon} ${customObjDef.name || customObjDef.id}` });
            menuItems.push({ type: 'action', action: 'interact_object', label: 'Interact', icon: '🤚', desc: `Interact with ${customObjDef.name || 'this object'}`, customObjDef, objAnchorQ, objAnchorR });
            if (customObjDef.resource) {
                const resName = (customObjDef.resource.type || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                menuItems.push({ type: 'action', action: 'harvest_object', label: `Harvest ${resName}`, icon: '⛏️', desc: `Gather resources from this ${customObjDef.name || 'object'}`, customObjDef, objAnchorQ, objAnchorR });
            }
            // Attack option — available for any attackable object
            const _objAttackVerbs = { rock: 'Strike', tree: 'Chop', plant: 'Cut', decoration: 'Strike', furniture: 'Strike', building: 'Strike', other: 'Attack' };
            const _attackVerb = _objAttackVerbs[customObjDef.objectType] || 'Attack';
            const _objHpTile = (objAnchorQ != null) ? InnerMap.getTile(objAnchorQ, objAnchorR) : null;
            const _objHp = (_objHpTile && _objHpTile.customObject && _objHpTile.customObject.currentHealthPct != null) ? _objHpTile.customObject.currentHealthPct : 100;
            menuItems.push({ type: 'action', action: 'attack_object', label: `${_attackVerb} ${customObjDef.name || 'Object'}`, icon: '🪓', desc: `HP: ${Math.ceil(_objHp)}%`, customObjDef, objAnchorQ, objAnchorR });
        }

        // Built-in overlay interactions removed (editor-authored objects only)

        // ── NPC actions ──
        if (npcsHere.length > 0) {
            if (menuItems.length > 0) menuItems.push({ type: 'separator' });
            menuItems.push({ type: 'header', label: '👥 People Here' });
            for (const npc of npcsHere.slice(0, 5)) {
                const npcDef = InnerMap.NPC_TYPES[npc.type] || {};
                const npcHealth = (typeof InnerMapCombat !== 'undefined') ? InnerMapCombat.getNPCHealth(npc.id) : null;
                const hpDesc = npcHealth ? `⚔️ ${Math.ceil(npcHealth.current)}/${npcHealth.max} HP` : `${npcDef.name || npc.type}`;
                menuItems.push({ type: 'action', action: 'talk_npc', label: `Talk to ${npc.name}`, icon: npc.icon, desc: `${npcDef.name || npc.type}`, npc });
                menuItems.push({ type: 'action', action: 'attack_npc', label: `Attack ${npc.name}`, icon: '⚔️', desc: hpDesc, npc });
            }
        }

        // ── Terrain actions (only for bare terrain, no building or object) ──
        if (!building && !customObjDef && (!builtinOverlay || !builtinOverlay.type)) {
            if (menuItems.length > 0) menuItems.push({ type: 'separator' });

            // ── Interior-specific actions ──
            if (tile._isInterior) {
                menuItems.push({ type: 'header', label: `${tile.subTerrain.icon} ${tile.subTerrain.name}` });

                // Door = exit
                if (tile._isDoor) {
                    menuItems.push({ type: 'action', action: 'exit_building', label: 'Exit Building', icon: '🚪', desc: 'Step back outside' });
                }

                // Furniture interaction
                if (tile._furniture) {
                    menuItems.push({ type: 'action', action: 'interact_furniture', label: `Inspect ${tile._furniture.name}`, icon: tile._furniture.icon, desc: `Examine the ${tile._furniture.name}`, _furniture: tile._furniture });
                }

                if (!isPlayerHere && tile.subTerrain.passable) {
                    menuItems.push({ type: 'action', action: 'move_here', label: 'Move Here', icon: '🚶', desc: 'Walk to this spot' });
                }

                // Always show exit option when inside a building
                if (InnerMap._insideBuilding) {
                    menuItems.push({ type: 'separator' });
                    menuItems.push({ type: 'header', label: '🚪 Navigation' });
                    menuItems.push({ type: 'action', action: 'exit_building', label: 'Exit Building', icon: '🚪', desc: `Leave ${InnerMap._insideBuilding.name}` });
                }
            } else {
                // Regular outdoor terrain
                menuItems.push({ type: 'header', label: `${tile.subTerrain.icon} ${tile.subTerrain.name}` });

                if (!isPlayerHere) {
                    menuItems.push({ type: 'action', action: 'move_here', label: 'Move Here', icon: '🚶', desc: 'Walk to this spot' });
                }

                // Terrain interaction actions
                if (tile.subTerrain.passable) {
                    menuItems.push({ type: 'action', action: 'till_land', label: 'Till Land', icon: '🌾', desc: 'Prepare the soil for farming' });
                    menuItems.push({ type: 'action', action: 'dig_here', label: 'Dig Here', icon: '⛏️', desc: 'Dig into the ground to find resources' });
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
            }
        }

        // ── General actions (always available when not on a building) ──
        if (!building || isPlayerHere) {
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
            case 'enter_building': {
                const building = item.building;
                if (building) {
                    // Walk to an adjacent tile first if far away
                    if (dist > 2) {
                        InnerMap.cancelPlayerWalk();
                        InnerMap.movePlayerTo(q, r);
                    }
                    // Enter the building interior
                    if (typeof InnerMap.enterBuilding === 'function') {
                        const success = InnerMap.enterBuilding(building, game);
                        if (success) {
                            // Re-setup the camera for the smaller interior
                            const tileSize = InnerMapRenderer.tileSize;
                            const innerPixelWidth = tileSize * InnerMap.width;
                            const innerPixelHeight = tileSize * InnerMap.height;
                            if (game.innerMapCamera) {
                                game.innerMapCamera.setWorldBounds(0, innerPixelHeight);
                                const canvasW = game.canvas.width;
                                const canvasH = game.canvas.height;
                                const zoomLevel = Math.min(canvasW / innerPixelWidth, canvasH / innerPixelHeight) * 0.85;
                                game.innerMapCamera.minZoom = Math.min(0.1, zoomLevel);
                                game.innerMapCamera.zoom = zoomLevel;
                                game.innerMapCamera.targetZoom = zoomLevel;
                                const pWorld = InnerMap.getPlayerWorldPos();
                                game.innerMapCamera.centerOn(pWorld.x, pWorld.y);
                            }
                            game.ui.showNotification(`🚪 Entered ${building.name}`, `You step inside ${building.name}. Press ESC or click "Exit" to leave.`, 'info');
                        } else {
                            game.ui.showNotification('🚪 Locked', `You cannot enter ${building.name} right now.`, 'error');
                        }
                    }
                }
                break;
            }
            case 'exit_building': {
                if (typeof InnerMap.exitBuilding === 'function') {
                    InnerMap.exitBuilding(game);
                    // Re-setup the camera for the outer inner map
                    const tileSize = InnerMapRenderer.tileSize;
                    const innerPixelWidth = tileSize * InnerMap.width;
                    const innerPixelHeight = tileSize * InnerMap.height;
                    if (game.innerMapCamera) {
                        game.innerMapCamera.setWorldBounds(0, innerPixelHeight);
                        const canvasW = game.canvas.width;
                        const canvasH = game.canvas.height;
                        const zoomLevel = Math.min(canvasW / innerPixelWidth, canvasH / innerPixelHeight) * 0.95;
                        game.innerMapCamera.minZoom = Math.min(0.1, zoomLevel);
                        game.innerMapCamera.zoom = zoomLevel;
                        game.innerMapCamera.targetZoom = zoomLevel;
                        const pWorld = InnerMap.getPlayerWorldPos();
                        game.innerMapCamera.centerOn(pWorld.x, pWorld.y);
                    }
                    game.ui.showNotification('🚪 Exited Building', 'You step back outside.', 'info');
                }
                break;
            }
            case 'till_land': {
                if (dist > 1) { InnerMap.cancelPlayerWalk(); InnerMap.movePlayerTo(q, r); }
                const tile = InnerMap.getTile(q, r);
                if (tile && tile.subTerrain.passable) {
                    tile.baseTerrain = 'dirt';
                    tile.subTerrain = { id: 'tilled_soil', name: 'Tilled Soil', icon: '🌾', color: '#8b7355', passable: true };
                    tile._tilled = true;
                    game.ui.showNotification('🌾 Till Land', 'You till the land, preparing it for planting.', 'success');
                } else {
                    game.ui.showNotification('❌ Cannot Till', 'This terrain cannot be tilled.', 'error');
                }
                break;
            }
            case 'dig_here': {
                if (dist > 1) { InnerMap.cancelPlayerWalk(); InnerMap.movePlayerTo(q, r); }
                // Random chance of finding something
                const digRoll = Math.random();
                if (digRoll < 0.15) {
                    const goldFound = Math.floor(Math.random() * 20) + 5;
                    game.player.gold += goldFound;
                    game.ui.updateStats(game.player, game.world);
                    game.ui.showNotification('⛏️ Dig Here', `You dug up ${goldFound} gold coins buried in the ground!`, 'success');
                } else if (digRoll < 0.30) {
                    const resources = ['iron ore', 'clay', 'flint', 'ancient pottery shard', 'gemstone'];
                    const found = resources[Math.floor(Math.random() * resources.length)];
                    game.ui.showNotification('⛏️ Dig Here', `You found ${found} while digging!`, 'success');
                } else if (digRoll < 0.40) {
                    game.ui.showNotification('⛏️ Dig Here', 'You uncovered an old bone. Probably nothing important.', 'info');
                } else {
                    game.ui.showNotification('⛏️ Dig Here', 'You dug for a while but found nothing of interest.', 'info');
                }
                break;
            }
            case 'interact_object': {
                const cDef = item.customObjDef;
                const aQ = item.objAnchorQ;
                const aR = item.objAnchorR;
                if (cDef && aQ != null) {
                    if (cDef.resource) {
                        // Start resource interaction (walk to it if needed)
                        const adj = InnerMap.findAdjacentToObject(aQ, aR, cDef);
                        if (adj) {
                            if (InnerMap.playerInnerQ === adj.q && InnerMap.playerInnerR === adj.r) {
                                InnerMap.startInteraction(aQ, aR, cDef.id,
                                    InnerMap._computeObjectDamage(game.player, cDef));
                                const dir = InnerMap.getDirectionToward(aQ, aR);
                                InnerMapRenderer._playerFacing = dir;
                            } else {
                                InnerMap._pendingInteraction = { anchorQ: aQ, anchorR: aR, defId: cDef.id };
                                InnerMap.movePlayerTo(adj.q, adj.r);
                            }
                        } else {
                            game.ui.showNotification('Blocked', 'Cannot reach that object!', 'error');
                        }
                    } else {
                        game.ui.showNotification(`🤚 ${cDef.name || 'Object'}`, `You inspect the ${cDef.name || 'object'}. It doesn't seem to do anything special.`, 'info');
                    }
                }
                break;
            }
            case 'harvest_object': {
                const hDef = item.customObjDef;
                const hAQ = item.objAnchorQ;
                const hAR = item.objAnchorR;
                if (hDef && hAQ != null && hDef.resource) {
                    const adj = InnerMap.findAdjacentToObject(hAQ, hAR, hDef);
                    if (adj) {
                        if (InnerMap.playerInnerQ === adj.q && InnerMap.playerInnerR === adj.r) {
                            InnerMap.startInteraction(hAQ, hAR, hDef.id,
                                InnerMap._computeObjectDamage(game.player, hDef));
                            const dir = InnerMap.getDirectionToward(hAQ, hAR);
                            InnerMapRenderer._playerFacing = dir;
                        } else {
                            InnerMap._pendingInteraction = { anchorQ: hAQ, anchorR: hAR, defId: hDef.id };
                            InnerMap.movePlayerTo(adj.q, adj.r);
                        }
                    } else {
                        game.ui.showNotification('Blocked', 'Cannot reach that object!', 'error');
                    }
                }
                break;
            }
            case 'attack_npc': {
                const npc = item.npc;
                if (npc && typeof InnerMapCombat !== 'undefined') {
                    InnerMapCombat.startAttackNPC(game, npc);
                }
                break;
            }
            case 'attack_object': {
                const cDef = item.customObjDef;
                const aQ   = item.objAnchorQ;
                const aR   = item.objAnchorR;
                if (cDef && aQ != null && typeof InnerMapCombat !== 'undefined') {
                    InnerMapCombat.startAttackObject(game, aQ, aR, cDef.id);
                } else if (cDef && aQ != null) {
                    // Fallback: use existing interaction if combat module not loaded
                    const adj = InnerMap.findAdjacentToObject(aQ, aR, cDef);
                    if (adj) {
                        InnerMap._pendingInteraction = { anchorQ: aQ, anchorR: aR, defId: cDef.id };
                        if (InnerMap.playerInnerQ === adj.q && InnerMap.playerInnerR === adj.r) {
                            InnerMap.startInteraction(aQ, aR, cDef.id, InnerMap._computeObjectDamage(game.player, cDef));
                        } else {
                            InnerMap.movePlayerTo(adj.q, adj.r);
                        }
                    }
                }
                break;
            }
            case 'interact_overlay': {
                game.ui.showNotification(`🤚 ${item.overlayType || 'Object'}`, `You examine the ${item.overlayType || 'natural formation'}. It could be harvested with the right tools.`, 'info');
                break;
            }
            case 'interact_furniture': {
                const furn = item._furniture;
                if (!furn) break;
                const furnitureMessages = {
                    table: 'A sturdy table. You could sit here and rest.',
                    throne: 'An ornate chair fit for nobility. You dare not sit in it.',
                    bookshelf: 'Rows of leather-bound books line the shelves. Some look quite old.',
                    chest: 'A locked chest. You\'d need a key or lockpicks to open it.',
                    candle: 'A flickering candle illuminates the room with warm light.',
                    banner: 'A decorative banner bearing a coat of arms.',
                    bar: 'A well-worn bar counter, stained with years of use.',
                    barrel: 'A wooden barrel. You can hear liquid sloshing inside.',
                    fireplace: 'A warm fire crackles in the hearth. It\'s quite cozy.',
                    bed: 'A place to rest. You could sleep here to restore energy.',
                    rack: 'Weapons and equipment hang neatly on display.',
                    anvil: 'A heavy iron anvil, scarred from countless hammer strikes.',
                    forge: 'The forge glows with intense heat. Sparks fly occasionally.',
                    stall: 'A merchant\'s stall with goods on display.',
                    altar: 'A sacred altar. You feel a sense of reverence here.',
                    pew: 'A wooden bench for worship and meditation.',
                    statue: 'An imposing stone statue gazes back at you.',
                    crate: 'A wooden crate. It seems to contain supplies.',
                    scales: 'A set of merchant\'s scales for measuring goods.',
                    well: 'A deep well. You can hear water far below.',
                    bucket: 'A simple wooden bucket.',
                    stairs: 'Stairs leading to another floor. (Not accessible yet)',
                };
                const msg = furnitureMessages[furn.type] || `You examine the ${furn.name}.`;
                game.ui.showNotification(`${furn.icon} ${furn.name}`, msg, 'info');
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
