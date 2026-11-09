// ============================================
// INNER MAP RENDERER — UI SYSTEMS
// Weather particles, HUD overlay, context menu,
// and action handlers.
// Mixed into InnerMapRenderer via Object.assign.
// ============================================

import { InnerMapRenderer } from './innerMapRenderer.js';
import { InnerMap } from '../world/innerMap.js';
import { Terrain } from '../world/terrain.js';
import { Utils } from '../core/utils.js';
import { ActionMenu } from './actionMenu.js';
import { CustomObjects } from '../world/customObjects.js';
import { InnerMapCombat } from './innerMapCombat.js';
import { InnerMapDigging } from './innerMapDigging.js';
import { Relationships } from '../systems/relationships.js';
import { Containers } from '../systems/containers.js';
import { CustomBuildings } from '../world/customBuildings.js';
import { BuildingCreator } from './buildingCreator.js';
import { Hotbar } from './hotbar.js';
import { PlayerInventory } from '../player/inventory.js';
import { PlayerActions } from '../player/playerActions.js';
import { NpcDialog } from './npcDialog.js';
import { ObjectActions } from './objectActions.js';
import { DevotionPanel } from './actionMenu/devotion.js';
import { NpcPortrait } from './npcPortrait.js';
import { InnerMapJail } from './innerMapJail.js';
import { InnerMapLots } from './innerMapLots.js';
import { InnerMapGraves } from './innerMapGraves.js';
import { InnerMapLocks } from './innerMapLocks.js';
import { InnerMapDeck } from './innerMapDeck.js';
import { InnerMapAnimals } from './innerMapAnimals.js';
import { InnerMapFurnish } from './innerMapFurnish.js';
import { InnerMapFarming } from './innerMapFarming.js';
import { InnerMapFields } from './innerMapFields.js';
import { InnerMapGranary } from './innerMapGranary.js';
import { InnerMapGates } from './innerMapGates.js';
import { InnerMapDiving } from './innerMapDiving.js';
import { InnerMapClimbing } from './innerMapClimbing.js';
import { NpcDisposition } from '../systems/npcDisposition.js';
import { Townsfolk } from '../systems/townsfolk.js';
import { PracticeSkills } from '../systems/practiceSkills.js';
import { Gathering } from '../player/gathering.js';
import { _dispositionLabel } from './npcDialog/helpers.js';
import { drawGlyph, buildingGlyph, pictureIcon } from './icons.js';
import { uiZoom } from './uiScale.js';

/** Building actions that open a town panel, offered only where the town keeps that business. */
const TOWN_SERVICES = new Set(['guildhall', 'bank', 'found_bank', 'underwriter', 'bourse', 'post_house', 'seek_physician',
    'cartography', 'odd_jobs', 'mint', 'treasury', 'public_works', 'estates']);

/** The ground a tile shows ("🌿 Grass", "👣 Street"), not the generation roll it was made from. */
const _groundLabel = (tile) => {
    const g = InnerMap.groundName(tile);
    return `${g.icon} ${g.name}`;
};

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

        // Laid out in interface units, scaled with the Interface Size setting
        // like the panels around it
        const z = uiZoom();
        const W = canvas.width / z;
        const barHeight = 48;
        ctx.save();
        ctx.scale(z, z);
        ctx.fillStyle = 'rgba(16, 20, 28, 0.92)';
        ctx.fillRect(0, 0, W, barHeight);
        ctx.fillStyle = 'rgba(245,197,66,0.15)';
        ctx.fillRect(0, barHeight - 1, W, 1);

        /** A glyph then text; returns where the next run goes (its left edge for 'right', its right edge otherwise). */
        const run = (glyph, text, x, y, font, color, align = 'left') => {
            ctx.font = font;
            ctx.fillStyle = color;
            ctx.textAlign = 'left';
            const size = parseFloat(/(\d+)px/.exec(font)[1]) * 1.2;
            const tw = ctx.measureText(text).width;
            const left = align === 'right' ? x - tw - (glyph ? size + 5 : 0)
                : align === 'center' ? x - (tw + (glyph ? size + 5 : 0)) / 2 : x;
            let tx = left;
            if (glyph) {
                drawGlyph(ctx, glyph, left + size / 2, y, size, color, 1.9);
                tx += size + 5;
            }
            ctx.fillText(text, tx, y);
            return align === 'right' ? left : tx + tw;
        };

        const worldTile = InnerMap.currentWorldTile;
        const terrainId = summary.parentTerrain;
        const terrainDef = Terrain.TYPES[terrainId.toUpperCase()] || {};
        ctx.textBaseline = 'middle';

        const settlement = InnerMap._currentWorldTileRef && InnerMap._currentWorldTileRef.settlement;
        const insideBuilding = InnerMap._insideBuilding;
        const locationName = insideBuilding
            ? insideBuilding.name
            : settlement ? settlement.name : (terrainDef.name || terrainId);
        run(insideBuilding ? buildingGlyph(insideBuilding) : 'map', locationName, 16, barHeight / 2 - 8,
            "600 14px 'Cinzel', serif", '#f5c542');

        let subInfo;
        if (insideBuilding) {
            subInfo = `Interior · ${insideBuilding.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`;
        } else if (settlement) {
            subInfo = `${settlement.type} · Pop: ${Utils.formatNumber(settlement.population)}`;
        } else {
            subInfo = `${terrainDef.name || terrainId} (${worldTile.q}, ${worldTile.r})`;
        }
        const weatherGlyphs = { clear: 'sun', cloudy: 'storm', rain: 'droplet', storm: 'storm', snow: 'snowflake' };
        const wt = InnerMap.weather;
        const tmp = InnerMap.temperature;
        const subFont = "400 12px 'Inter', sans-serif";
        const subColor = 'rgba(255,255,255,0.7)';
        let x = run(null, subInfo, 16, barHeight / 2 + 9, subFont, subColor);
        if (wt || tmp) {
            const weather = `${wt ? wt.type : ''}${tmp ? ` ${tmp.celsius}°C` : ''}`.trim();
            x = run(null, ' · ', x, barHeight / 2 + 9, subFont, subColor);
            run(wt ? weatherGlyphs[wt.type] : null, weather, x, barHeight / 2 + 9, subFont, subColor);
        }

        const timeStr = InnerMap.getTimeString();
        const period = InnerMap.getTimePeriod();
        const periodGlyph = period === 'evening' || period === 'night' ? 'moon' : 'sun';
        run(periodGlyph, timeStr, W / 2, barHeight / 2 - 6, "700 15px 'Inter', sans-serif", '#ffffff', 'center');

        const barWidth = 120;
        const barX = W / 2 - barWidth / 2;
        const barY = barHeight / 2 + 8;
        const progress = InnerMap.timeOfDay / 24;
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.fillRect(barX, barY, barWidth, 4);
        ctx.fillStyle = progress > 0.75 ? '#e74c3c' : progress > 0.5 ? '#f39c12' : '#4FC3F7';
        ctx.fillRect(barX, barY, barWidth * progress, 4);

        const infoFont = "500 12px 'Inter', sans-serif";
        const hintFont = "400 11px 'Inter', sans-serif";
        const rx = W - 16;
        if (insideBuilding) {
            run(buildingGlyph(insideBuilding), `Inside: ${insideBuilding.name}`, rx, barHeight / 2 - 6, infoFont, 'rgba(255,255,255,0.8)', 'right');
            run(null, 'ESC to exit building · Left-click to interact', rx, barHeight / 2 + 10, hintFont, 'rgba(255,200,100,0.75)', 'right');
        } else {
            const buildingCount = InnerMap.buildings.length;
            const npcCount = InnerMap.npcs.length;
            if (buildingCount > 0) {
                const left = run('council', `${npcCount} people`, rx, barHeight / 2 - 6, infoFont, 'rgba(255,255,255,0.8)', 'right');
                run('house', `${buildingCount} buildings`, left - 14, barHeight / 2 - 6, infoFont, 'rgba(255,255,255,0.8)', 'right');
            } else {
                run(null, `Explored: ${summary.exploredPercent}%  ·  Discoveries: ${summary.discoveredEncounters}/${summary.encounters}`,
                    rx, barHeight / 2 - 6, infoFont, 'rgba(255,255,255,0.8)', 'right');
            }
            run(null, 'ESC to return · Left-click to interact', rx, barHeight / 2 + 10, hintFont, 'rgba(255,255,255,0.55)', 'right');
        }
        ctx.restore();
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

        // Inside the town's granary: the keeper sells grain wherever you are (ui/innerMapGranary.js)
        const inGranary = InnerMap._insideBuilding && InnerMap._insideBuilding.type === 'granary'
            ? InnerMapGranary.menuItems(game, InnerMap._insideBuilding) : [];
        if (inGranary.length) menuItems.push({ type: 'header', label: '🌾 The Granary' }, ...inGranary, { type: 'separator' });

        // ── Building actions ──
        if (building) {
            const actions = InnerMap.getBuildingActions(building);
            menuItems.push({ type: 'header', label: `${building.icon} ${building.name}` });
            // Show ownership info
            if (building.ownerName) {
                const ownerLabel = building.isPlayerOwned
                    ? `👤 Owned by you`
                    : `👤 ${building.ownerTitle ? building.ownerTitle + ': ' : ''}${building.ownerName}`;
                menuItems.push({ type: 'disabled', label: ownerLabel });
            }
            // A house to let or for sale (ui/innerMapLots.js)
            menuItems.push(...InnerMapLots.buildingItems(game, building));
            // The town's granary sells the grain it can spare (ui/innerMapGranary.js)
            menuItems.push(...InnerMapGranary.menuItems(game, building));
            // Add "Enter" action for buildings
            menuItems.push({ type: 'action', action: 'enter_building', label: 'Enter', icon: '🚪', desc: `Enter ${building.name}`, building });
            // A barred seat's lock to pick (ui/innerMapLocks.js)
            menuItems.push(...InnerMapLocks.menuItems(game, building));
            // A building of several floors: straight up to one from the front door (world/innerMap/floors.js)
            const floors = InnerMap.floorsOf ? InnerMap.floorsOf(building, game) : 1;
            for (let k = 1; k < floors; k++) {
                const room = InnerMap.floorRoom(building, k);
                const where = InnerMap.floorLabel(k).replace(/^the /, '');
                menuItems.push({ type: 'action', action: 'enter_building', floor: k, label: `Go Up to the ${where.replace(/^./, c => c.toUpperCase())}`, icon: '⬆️', desc: `In at the door and up the stairs: ${room.name}`, building });
            }
            // A service the town doesn't keep (no guild here, no mint, nothing to treat) is left off
            const offered = this._townServices(game);
            for (const action of actions) {
                if (TOWN_SERVICES.has(action) && offered && !offered.has(action)) continue;
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
            const typeIcons = { rock: '⛰️', tree: '🌲', plant: '🌿', decoration: '✨', furniture: '💺', building: '🏠', other: '📦' };
            const objIcon = typeIcons[customObjDef.objectType] || '📦';
            menuItems.push({ type: 'header', label: `${objIcon} ${customObjDef.name || customObjDef.id}` });
            // (a gate has its own Open/Close below, and nothing to strike)
            const _isGate = (customObjDef.tags || []).includes('gate');
            if (!_isGate) menuItems.push({ type: 'action', action: 'interact_object', label: 'Interact', icon: '🤚', desc: `Interact with ${customObjDef.name || 'this object'}`, customObjDef, objAnchorQ, objAnchorR });
            // ── Editor-defined object actions (sleep, cook, craft, etc.) ──
            let objActionItems = ObjectActions.buildMenuItems(game, customObjDef, objAnchorQ, objAnchorR);
            // Objects without editor-assigned actions are still usable when
            // their name says what they are (a sprite "Oak Bed", "Anvil", …).
            if (objActionItems.length === 0) {
                const furnType = ObjectActions.inferFurnitureType(customObjDef.name || customObjDef.id);
                if (furnType) {
                    objActionItems = ObjectActions.buildFurnitureMenuItems(game,
                        { type: furnType, name: customObjDef.name || customObjDef.id },
                        InnerMap._insideBuilding, objAnchorQ, objAnchorR);
                }
            }
            if (objActionItems.length > 0) {
                menuItems.push({ type: 'separator' });
                for (const ai of objActionItems) menuItems.push(ai);
            }
            // A ship: over the side from her deck, or up her side from the water (ui/innerMapDiving.js)
            menuItems.push(...InnerMapDiving.shipItems(game, q, r));
            // A town field: bring in its crop, or help yourself (ui/innerMapFields.js)
            if ((customObjDef.tags || []).includes('field')) menuItems.push(...InnerMapFields.menuItems(game, objAnchorQ, objAnchorR));
            // A gate in a fence: open it or shut it (ui/innerMapGates.js)
            if ((customObjDef.tags || []).includes('gate')) menuItems.push(...InnerMapGates.menuItems(game, objAnchorQ, objAnchorR));
            // A tree to fell or a stump to grub out: one order, with how many blows it will
            // take you and what it gives (player/gathering.js; world/innerMap/felling.js)
            const _chopped = customObjDef.resource && (customObjDef.topples || customObjDef.objectType === 'stump');
            if (_chopped) {
                const it = this._fellingItem(game, customObjDef, objAnchorQ, objAnchorR);
                if (it) menuItems.push(it);
            } else if (customObjDef.resource) {
                const resName = (customObjDef.resource.type || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                menuItems.push({ type: 'action', action: 'harvest_object', label: `Harvest ${resName}`, icon: '⛏️', desc: `Gather resources from this ${customObjDef.name || 'object'}`, customObjDef, objAnchorQ, objAnchorR });
            }
            // Attack option — available for any attackable object
            const _objAttackVerbs = { rock: 'Strike', tree: 'Chop', plant: 'Cut', decoration: 'Strike', furniture: 'Strike', building: 'Strike', other: 'Attack' };
            const _attackVerb = _objAttackVerbs[customObjDef.objectType] || 'Attack';
            const _objHpTile = (objAnchorQ != null) ? InnerMap.getTile(objAnchorQ, objAnchorR) : null;
            const _objHp = (_objHpTile && _objHpTile.customObject && _objHpTile.customObject.currentHealthPct != null) ? _objHpTile.customObject.currentHealthPct : 100;
            // (not a field: there is nothing there to strike)
            if (!(customObjDef.tags || []).includes('field') && !_isGate && !_chopped) menuItems.push({ type: 'action', action: 'attack_object', label: `${_attackVerb} ${customObjDef.name || 'Object'}`, icon: '🗡️', desc: `HP: ${Math.ceil(_objHp)}%`, customObjDef, objAnchorQ, objAnchorR });
        }

        // Built-in overlay interactions removed (editor-authored objects only)

        // ── Bodies, and the ground dug here (ui/innerMapDigging.js) ──
        if (!building) this._groundMenu(menuItems, tile, q, r);
        // ── A grave, a plot, a bone mill or ossuary of yours (ui/innerMapGraves.js) ──
        if (!building) menuItems.push(...InnerMapGraves.menuItems(game, tile, q, r));

        // ── Someone beaten senseless (ui/innerMapCombat.js, systems/knockout.js) ──
        for (const npc of npcsHere.filter(n => n.state === 'unconscious').slice(0, 2)) {
            if (menuItems.length > 0) menuItems.push({ type: 'separator' });
            menuItems.push({ type: 'header', label: `💫 ${npc.name}, senseless` });
            menuItems.push({ type: 'action', action: 'ko_finish', label: 'Finish Them Off', icon: '🗡️', desc: 'Kill them where they lie. It is murder.', npc });
            if (!npc._koSearched) menuItems.push({ type: 'action', action: 'ko_rob', label: 'Go Through Their Pockets', icon: '🖐️', desc: 'Take what they carry while they\'re out', npc });
            menuItems.push({ type: 'action', action: 'ko_leave', label: 'Leave Them Be', icon: '🚶', desc: 'They\'ll come round in a while', npc });
        }
        const standing = npcsHere.filter(n => n.state !== 'unconscious');

        // ── NPC actions ──
        if (standing.length > 0) {
            if (menuItems.length > 0) menuItems.push({ type: 'separator' });
            menuItems.push({ type: 'header', label: '👥 People Here' });
            for (const npc of standing.slice(0, 5)) {
                const npcDef = InnerMap.NPC_TYPES[npc.type] || {};
                const npcHealth = (typeof InnerMapCombat !== 'undefined') ? InnerMapCombat.getNPCHealth(npc.id) : null;
                const hpDesc = npcHealth ? `${Math.ceil(npcHealth.current)}/${npcHealth.max} HP` : '';
                menuItems.push({ type: 'person', npc, role: npc.roleTitle || npcDef.name || npc.type, hpDesc, asleep: !!npc._asleep });
            }
        }

        // ── An animal here: hunt it, fight it, butcher its carcass (ui/innerMapAnimals.js) ──
        if (!building) {
            const animalItems = InnerMapAnimals.menuItems(game, q, r);
            if (animalItems.length && menuItems.length === 0) animalItems.shift();
            menuItems.push(...animalItems);
        }

        // ── Ground item pick-up ──
        if (tile.groundItem && !building) {
            if (menuItems.length > 0) menuItems.push({ type: 'separator' });
            const gi = tile.groundItem;
            menuItems.push({ type: 'header', label: `${gi.icon} ${gi.name}` });
            if (gi.placedBy === 'wreck') menuItems.push({ type: 'action', action: 'pickup_ground_item', label: `Salvage ${gi.name}`, icon: '⚓', desc: 'Wreckage on the water: swim or wade out to it and haul it in', groundItemTileQ: q, groundItemTileR: r });
            else menuItems.push({ type: 'action', action: 'pickup_ground_item', label: `Pick Up ${gi.name}`, icon: '🖐️', desc: 'Add this item back to your inventory', groundItemTileQ: q, groundItemTileR: r });
        }

        // ── Terrain actions (only for bare terrain, no building or object) ──
        if (!building && !customObjDef && (!builtinOverlay || !builtinOverlay.type)) {
            if (menuItems.length > 0) menuItems.push({ type: 'separator' });

            // ── Interior-specific actions ──
            if (tile._isInterior) {
                menuItems.push({ type: 'header', label: _groundLabel(tile) });

                // Stairs: up or down to the next floor (world/innerMap/floors.js)
                if (tile._stairs) {
                    const to = tile._stairs.to;
                    const up = to > (InnerMap._floor || 0);
                    const room = to > 0 ? InnerMap.floorRoom(InnerMap._insideBuilding, to) : null;
                    menuItems.push({ type: 'action', action: 'take_stairs', label: up ? 'Climb the Stairs' : 'Go Downstairs', icon: up ? '⬆️' : '⬇️', desc: `To ${InnerMap.floorLabel(to)}${room ? ` (${room.name})` : ''}`, stairsTo: to });
                }

                // Door = exit
                if (tile._isDoor) {
                    menuItems.push({ type: 'action', action: 'exit_building', label: 'Exit Building', icon: '🚪', desc: 'Step back outside' });
                }

                // Furniture interaction
                if (tile._furniture) {
                    // Inspecting a container opens it (its own entry, not a second 'Look Inside')
                    const isBox = Containers.isContainer(tile._furniture.type);
                    for (const ai of ObjectActions.buildFurnitureMenuItems(game, tile._furniture, InnerMap._insideBuilding, q, r)) {
                        if (isBox && ai._objectActionKey === 'look_inside') continue;
                        menuItems.push(ai);
                    }
                    menuItems.push({ type: 'action', action: 'interact_furniture', label: `Inspect ${tile._furniture.name}`, icon: '🔍', desc: isBox ? 'See what it holds, and take (or steal) it' : `Examine the ${tile._furniture.name}`, _furniture: tile._furniture, objAnchorQ: q, objAnchorR: r });
                }

                if (!isPlayerHere && tile.subTerrain.passable) {
                    menuItems.push({ type: 'action', action: 'move_here', label: 'Move Here', icon: '🚶', desc: 'Walk to this spot' });
                }

                // A home of your own: furnish it, move or put away a piece (ui/innerMapFurnish.js)
                menuItems.push(...InnerMapFurnish.menuItems(game, tile, q, r));

                // Always show exit option when inside a building
                if (InnerMap._insideBuilding) {
                    menuItems.push({ type: 'separator' });
                    menuItems.push({ type: 'header', label: '🚪 Navigation' });
                    menuItems.push({ type: 'action', action: 'exit_building', label: 'Exit Building', icon: '🚪', desc: `Leave ${InnerMap._insideBuilding.name}` });
                }
            } else {
                // Regular outdoor terrain
                menuItems.push({ type: 'header', label: _groundLabel(tile) });

                if (!isPlayerHere) {
                    // Water you can't stand in: swim there (world/innerMap/swimming.js, player/swimming.js)
                    const swimTo = !tile.subTerrain.passable && InnerMap.isSwimmable(q, r);
                    if (!swimTo) menuItems.push({ type: 'action', action: 'move_here', label: 'Move Here', icon: '🚶', desc: 'Walk to this spot' });
                    else if (InnerMap._swimAllowed) menuItems.push({ type: 'action', action: 'move_here', label: 'Swim Here', icon: '🏊', desc: 'Into the water: slow, tiring — and cold in winter' });
                    else menuItems.push({ type: 'disabled', label: `🏊 Swim — ${InnerMap._swimRefusal || 'not now'}` });
                }
                // Water: cast a line into it, from the bank (or pier, bridge or deck) beside it
                if ((tile._wet || tile._sea) && !/frozen|ice/.test(tile.subTerrain.id || '')) {
                    menuItems.push({ type: 'action', action: 'fish_here', label: 'Fish Here', icon: '🎣', desc: tile._deep ? 'Deep water: bigger fish, and a harder fight' : 'Cast a line from the bank' });
                }
                // Water deep enough to swim: dive and scavenge the bottom (ui/innerMapDiving.js)
                menuItems.push(...InnerMapDiving.menuItems(game, tile, q, r));
                // A crag's rock face: up it or down it (ui/innerMapClimbing.js)
                menuItems.push(...InnerMapClimbing.menuItems(game, tile, q, r));

                // Terrain interaction actions: till, sow, water, harvest (ui/innerMapFarming.js)
                menuItems.push(...InnerMapFarming.menuItems(game, tile, q, r));
                // (not through a crop in the ground: Pull It Up first)
                const sown = InnerMapFarming.cellAt(game, q, r);
                if (InnerMapDigging.canDig(tile) && !(sown && sown.crop)) {
                    menuItems.push({ type: 'action', action: 'dig_hole', label: 'Dig a Hole', icon: '⛏️', desc: 'Dig into the ground here (you might turn something up)' });
                }

                if (tile.encounter && tile.encounter.discovered) {
                    menuItems.push({ type: 'action', action: 'examine', label: `Examine ${tile.encounter.name}`, icon: tile.encounter.icon, desc: tile.encounter.description });
                }

                // A building lot: its sale and its building, wherever on it you click (ui/innerMapLots.js)
                if (!isPlayerHere && tile._lot && !tile.building) {
                    const lotItems = InnerMapLots.tileItems(game, tile, q, r);
                    if (lotItems) menuItems.push(...lotItems);
                }

                if (isPlayerHere && tile.subTerrain.passable && !tile.building) {
                    const worldTile = game.world ? game.world.getTile(game.player.q, game.player.r) : null;
                    const isSettlement = worldTile && worldTile.settlement && worldTile.settlement.type;
                    // In town, land goes by the lot (ui/innerMapLots.js); out in the wilds, build where you will
                    const lotItems = isSettlement ? InnerMapLots.tileItems(game, tile, q, r) : null;
                    if (lotItems) {
                        menuItems.push(...lotItems);
                        menuItems.push({ type: 'action', action: 'buy_house', label: 'Buy a House', icon: '🏠', desc: 'Purchase a house in this settlement' });
                    } else {
                    menuItems.push({ type: 'separator' });
                    menuItems.push({ type: 'header', label: '🏗️ Build' });
                    menuItems.push({ type: 'action', action: 'build_custom', label: 'Design & Build', icon: '🏗️', desc: 'Open the building creator to design your own building' });
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

        // The jail: only what a prisoner can do (ui/innerMapJail.js)
        if (InnerMap.inJail && InnerMap.inJail()) menuItems.splice(0, menuItems.length, ...InnerMapJail.menuItems(game, tile, q, r, npcsHere));
        // On deck: the helm, the hold, orders to the crew — not "Strike Galleon" (ui/innerMapDeck.js)
        else if (InnerMapDeck.active(game)) InnerMapDeck.menuItems(game, menuItems, tile, q, r, npcsHere);

        if (menuItems.length === 0) return;

        const menu = document.createElement('div');
        menu.id = 'innerMapContextMenu';
        menu.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(16,20,28,0.97);backdrop-filter:blur(14px);border:1px solid rgba(245,197,66,0.35);border-radius:12px;z-index:1300;box-shadow:0 12px 48px rgba(0,0,0,0.85),0 0 0 1px rgba(245,197,66,0.08);overflow:hidden;font-family:var(--font-body,'Inter',sans-serif);display:flex;flex-direction:column;max-width:calc(92vw / var(--ui-zoom));max-height:calc(90vh / var(--ui-zoom));min-width:280px;`;

        const locationLabel = building ? `${building.icon} ${building.name}` : npcsHere.length > 0 ? `👥 People Here` : _groundLabel(tile);
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
        // A heading with nothing under it (the road you stand on, before the lot's own heading) is dropped
        for (let i = categories.length - 1; i >= 0; i--) if (!categories[i].items.length) categories.splice(i, 1);

        const personItems = [];
        const liveItems = []; // greyed-out entries whose text counts down (a diver's breath coming back)
        let bodyHTML = `<div style="padding:6px;display:flex;flex-direction:column;gap:3px;">`;
        for (const cat of categories) {
            if (cat.label) {
                bodyHTML += `<div style="padding:7px 10px;font-size:11px;font-family:var(--font-display,'Inter',sans-serif);color:var(--gold,#f5c542);letter-spacing:1px;text-transform:uppercase;border-bottom:1px solid rgba(245,197,66,0.12);background:rgba(245,197,66,0.03);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-radius:4px;margin-bottom:3px;">${cat.label}</div>`;
            }
            for (const item of cat.items) {
                if (item.type === 'person') {
                    bodyHTML += this._personCardHTML(item, personItems.length, game);
                    personItems.push(item);
                } else if (item.type === 'disabled') {
                    // The label's own leading emoji is the row's icon (not a 🚫 beside a 📜); a reason, when given, shows under it
                    const lead = typeof item.live === 'function' ? null : /^(\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}]*)\s+/u.exec(String(item.label || ''));
                    const dIcon = item.icon || (lead ? lead[1] : '🚫');
                    const dLabel = lead ? String(item.label).slice(lead[0].length) : item.label;
                    bodyHTML += `<div style="display:flex;align-items:center;gap:7px;background:rgba(255,255,255,0.015);border:1px solid rgba(255,255,255,0.04);padding:6px 8px;border-radius:5px;color:rgba(255,255,255,0.38);font-family:var(--font-body,'Inter',sans-serif);white-space:nowrap;min-width:0;"><span style="font-size:16px;width:22px;text-align:center;flex-shrink:0;opacity:0.6;">${dIcon}</span><div style="flex:1;min-width:0;"><div style="font-size:12px;overflow:hidden;text-overflow:ellipsis;"${typeof item.live === 'function' ? ` data-live="${liveItems.push(item) - 1}"` : ''}>${dLabel}</div>${item.desc ? `<div style="font-size:11px;color:rgba(255,255,255,0.32);margin-top:2px;white-space:normal;line-height:1.35;">${item.desc}</div>` : ''}</div></div>`;
                } else {
                    bodyHTML += `<button class="inner-ctx-btn" data-action="${item.action||''}" style="display:flex;align-items:center;gap:7px;background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.05);padding:6px 8px;border-radius:5px;color:var(--text-primary,#e0e0e0);cursor:pointer;text-align:left;transition:background 0.12s,border-color 0.12s;font-family:var(--font-body,'Inter',sans-serif);white-space:nowrap;min-width:0;width:100%;" onmouseover="this.style.background='rgba(245,197,66,0.12)';this.style.borderColor='rgba(245,197,66,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.025)';this.style.borderColor='rgba(255,255,255,0.05)'"><span style="font-size:16px;width:22px;text-align:center;flex-shrink:0;">${pictureIcon(item.icon||'📋')}</span><div style="flex:1;min-width:0;"><div style="display:flex;align-items:center;gap:6px;"><span style="font-size:12px;font-weight:600;color:#e0e0e0;overflow:hidden;text-overflow:ellipsis;">${item.label}</span></div>${item.desc ? `<div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.desc}</div>` : ''}</div></button>`;
                }
            }
        }
        bodyHTML += `</div>`;

        menu.innerHTML = headerHTML + bodyHTML;
        document.body.appendChild(menu);
        if (liveItems.length) {
            this._ctxLiveTimer = setInterval(() => {
                if (!menu.isConnected) { clearInterval(this._ctxLiveTimer); this._ctxLiveTimer = null; return; }
                menu.querySelectorAll('[data-live]').forEach((el) => {
                    const it = liveItems[Number(el.dataset.live)];
                    const text = it && it.live();
                    if (text && el.textContent !== text) el.textContent = text;
                });
            }, 250);
        }

        document.getElementById('closeInnerContextMenu').addEventListener('click', () => this.closeContextMenu());

        const allActionItems = [];
        for (const cat of categories) { for (const item of cat.items) { if (item.type !== 'disabled' && item.type !== 'person') allActionItems.push(item); } }

        // People: a card each, with their portrait and a Talk / Attack pair
        menu.querySelectorAll('.ctx-person').forEach((card) => {
            const p = personItems[Number(card.dataset.pi)];
            if (!p) return;
            const canvas = card.querySelector('canvas');
            const ok = NpcPortrait.paint(canvas, p.npc, 0);
            canvas.style.display = ok ? '' : 'none';
            card.querySelector('.ctx-person-emoji').style.display = ok ? 'none' : '';
            card.querySelector('.ctx-person-talk').addEventListener('click', () => {
                this.closeContextMenu();
                // Asleep in bed: wake them first (world/innerMap/floors.js)
                this._handleContextAction(game, { type: 'action', action: p.npc._asleep ? 'wake_npc' : 'talk_npc', npc: p.npc }, q, r);
            });
            card.querySelector('.ctx-person-attack').addEventListener('click', () => {
                this.closeContextMenu();
                this._handleContextAction(game, { type: 'action', action: 'attack_npc', npc: p.npc }, q, r);
            });
        });

        const buttons = menu.querySelectorAll('.inner-ctx-btn');
        let actionIdx = 0;
        buttons.forEach(btn => {
            const item = allActionItems[actionIdx++];
            if (item) { btn.addEventListener('click', () => { this.closeContextMenu(); this._handleContextAction(game, item, q, r); }); }
        });

        // Click-away closes it. The handler is kept so closeContextMenu (any
        // close: a button, Escape, a new menu) removes it — otherwise a stale
        // one outlives its menu and closes the next menu on its first click.
        const closeHandler = (e) => { if (!menu.contains(e.target)) this.closeContextMenu(); };
        this._ctxCloseHandler = closeHandler;
        this._ctxCloseTimer = setTimeout(() => {
            this._ctxCloseTimer = null;
            if (this._ctxCloseHandler === closeHandler) document.addEventListener('mousedown', closeHandler);
        }, 50);
    },

    /** A "People Here" card: portrait, who they are, how they feel about you, Talk / Attack. */
    _personCardHTML(item, index, game = null) {
        const npc = item.npc;
        // What they're good at (systems/practiceSkills.js): a fisher's diving, a sailor's swimming
        let skills = '';
        try {
            const holder = Townsfolk.npcSkills(npc, game && game.world, InnerMap.currentWorldTile);
            const top = PracticeSkills.notable(holder).slice(0, 2);
            if (top.length) skills = `<div class="ctx-person-skills" style="font-size:11px;color:rgba(160,220,240,0.8);margin-top:2px;">${top.map(t => `<span title="${t.name}: level ${t.level} (${t.levelName})">${t.icon} ${t.levelName} ${t.name.toLowerCase()}</span>`).join(' · ')}</div>`;
        } catch (e) { skills = ''; }
        const mem = NpcDisposition.getMemory(npc);
        const mood = _dispositionLabel(mem.disposition);
        const role = item.role ? item.role.charAt(0).toUpperCase() + item.role.slice(1) : '';
        const asleep = !!npc._asleep;
        const doing = npc.activity && !asleep ? `<span class="ctx-person-doing">${npc.activity.icon} ${npc.activity.label}</span>` : '';
        const met = (asleep ? `<span class="ctx-person-asleep">💤 Asleep${npc._asleep.bedroll ? ' on a bedroll' : ''}</span>` : '')
            + (mem.timesSpoken > 0 ? '' : '<span class="ctx-person-new">New face</span>');
        return `<div class="ctx-person${asleep ? ' asleep' : ''}" data-pi="${index}" style="--mood:${mood.color}">`
            + '<div class="ctx-person-portrait"><canvas width="72" height="72"></canvas>'
            + `<span class="ctx-person-emoji">${npc.icon}</span></div>`
            + '<div class="ctx-person-info">'
            + `<div class="ctx-person-name">${npc.fullName || npc.name}${met}</div>`
            + `<div class="ctx-person-role">${role}${npc.age != null ? `, ${npc.age}` : ''}${doing}</div>`
            + skills
            + `<div class="ctx-person-mood"><span class="ctx-person-mood-bar"><span style="width:${Math.max(4, mem.disposition)}%"></span></span>${mood.icon} ${mood.text}</div>`
            + '</div>'
            + '<div class="ctx-person-actions">'
            + (asleep
                ? `<button class="ctx-person-talk" title="Wake ${npc.name} (they won't thank you for it)">😴 Wake</button>`
                : `<button class="ctx-person-talk" title="Talk to ${npc.name}">💬 Talk</button>`)
            + `<button class="ctx-person-attack" title="Attack ${npc.name}${item.hpDesc ? ` (${item.hpDesc})` : ''}">⚔️</button>`
            + '</div></div>';
    },

    closeContextMenu() {
        const menu = document.getElementById('innerMapContextMenu');
        if (menu) menu.remove();
        if (this._ctxCloseTimer) { clearTimeout(this._ctxCloseTimer); this._ctxCloseTimer = null; }
        if (this._ctxLiveTimer) { clearInterval(this._ctxLiveTimer); this._ctxLiveTimer = null; }
        if (this._ctxCloseHandler) {
            document.removeEventListener('mousedown', this._ctxCloseHandler);
            this._ctxCloseHandler = null;
        }
    },

    // ══════════════════════════════════════════════
    // CONTEXT MENU ACTION HANDLERS
    // ══════════════════════════════════════════════

    /** Furniture / object uses happen in person: these actions walk over first. */
    _needsApproach(item) {
        return item.action === 'interact_furniture' || item.action.startsWith('obj_action_') || item.action.startsWith('field_');
    },

    /**
     * Walk to the furniture or object an action targets, then perform it
     * facing the thing (with a short use animation). Anyone using it steps aside.
     */
    _approachThenAct(game, item, q, r) {
        const tq = item.objAnchorQ != null ? item.objAnchorQ : q;
        const tr = item.objAnchorR != null ? item.objAnchorR : r;
        const furnType = item._furniture ? item._furniture.type
            : (item.customObjDef && item.customObjDef.furnitureType)
            || ObjectActions.inferFurnitureType(item.customObjDef && (item.customObjDef.name || item.customObjDef.id));
        const label = (item._furniture && item._furniture.name) || (item.customObjDef && item.customObjDef.name) || 'that';

        const result = InnerMap.approachAndThen(tq, tr, () => {
            InnerMapRenderer._playerFacing = InnerMap.getDirectionToward(tq, tr);
            const occupant = InnerMap.getFurnitureOccupant(tq, tr);
            if (occupant) InnerMap.yieldFurniture(occupant);
            const activity = furnType && InnerMap.FURNITURE_ACTIVITIES[furnType];
            if (activity && item.action !== 'interact_furniture') {
                // Hammering at an anvil must not damage it — swap in a harmless emote.
                const anim = activity.anim === 'slash' ? 'emotes' : activity.anim;
                InnerMap.startInteraction(tq, tr, null, 0, anim);
            }
            this._handleContextAction(game, { ...item, _approached: true }, q, r);
        });
        if (result === 'unreachable') {
            game.ui.showNotification('Blocked', `You can't reach the ${label}.`, 'error');
        }
    },

    /**
     * The order to fell a tree or grub out a stump (a harvest_object action):
     * about how many blows it will take you (its hardness, your Woodcutting and
     * axe: InnerMap._computeObjectDamage) and what it gives.
     */
    _fellingItem(game, def, aq, ar) {
        const tile = aq != null ? InnerMap.getTile(aq, ar) : null;
        const hp = tile && tile.customObject && tile.customObject.currentHealthPct != null ? tile.customObject.currentHealthPct : 100;
        const dmg = InnerMap._computeObjectDamage(game.player, def);
        const blows = dmg > 0 ? Math.max(1, Math.ceil(hp / dmg)) : '?';
        const nice = (id) => id.replace(/_/g, ' ');
        const res = def.resource || {};
        const gives = [`${res.amount || 1} ${nice(res.type || 'wood')}`];
        for (const g of def.gives || []) {
            const when = Array.isArray(g.seasons) ? ` in ${g.seasons.join(' or ')}` : g.chance != null && g.chance < 1 ? ' maybe' : '';
            if (!gives.some(x => x.endsWith(nice(g.item)))) gives.push(`${nice(g.item)}${when}`);
        }
        const tool = Gathering.toolFor(game.player, def);
        const stump = def.objectType === 'stump';
        const label = stump ? `Grub Out the ${def.name || 'Stump'}` : `Fell the ${def.name || 'Tree'}`;
        const desc = `About ${blows} blow${blows === 1 ? '' : 's'}${tool ? ` with your ${tool.name}` : ''} · ${gives.join(', ')}${stump ? ' · clears the ground' : ''}`;
        return { type: 'action', action: 'harvest_object', label, icon: '🌲', desc, customObjDef: def, objAnchorQ: aq, objAnchorR: ar };
    },

    /** The menu entries for bodies on a tile and for a hole or grave dug there. */
    _groundMenu(menuItems, tile, q, r) {
        const sep = () => { if (menuItems.length > 0) menuItems.push({ type: 'separator' }); };
        const carried = InnerMapCombat._carrying;
        if (carried) {
            sep();
            menuItems.push({ type: 'header', label: `👤 Carrying ${carried.name}` });
            menuItems.push({ type: 'action', action: 'drop_body', label: 'Put the Body Down', icon: '⬇️', desc: 'Lay them down where you stand' });
        }
        const bodies = InnerMapCombat.corpsesHere().filter(c => c !== carried && c.q === q && c.r === r);
        for (const body of bodies.slice(0, 2)) {
            sep();
            menuItems.push({ type: 'header', label: `🕯️ ${body.name}, dead` });
            if (!body.searched) menuItems.push({ type: 'action', action: 'search_body', label: 'Search the Body', icon: '🖐️', desc: 'Go through their pockets', body });
            if (!carried && InnerMapAnimals._carry) menuItems.push({ type: 'disabled', label: 'Carry the Body: your hands are full' });
            else if (!carried) menuItems.push({ type: 'action', action: 'carry_body', label: 'Carry the Body', icon: '👤', desc: 'Drag them along with you (you walk slower)', body });
            const hole = InnerMapDigging.holeNear(body.q, body.r);
            if (hole) {
                menuItems.push({ type: 'action', action: 'bury_body', label: 'Bury Them in the Hole', icon: '⚰️', desc: 'Lay them in the hole and fill it in', body, holeQ: hole.q, holeR: hole.r });
            } else {
                const spot = InnerMapDigging.diggableNear(body.q, body.r);
                if (spot) menuItems.push({ type: 'action', action: 'dig_grave', label: 'Dig a Grave for Them', icon: '⛏️', desc: 'Dig a hole beside the body, then bury them', body, holeQ: spot.q, holeR: spot.r });
            }
        }
        const dug = tile && tile._dug;
        if (!dug) return;
        if (dug.kind === 'hole') {
            sep();
            menuItems.push({ type: 'header', label: '🕳️ A Hole' });
            const inside = InnerMapCombat.corpsesHere().find(c => c !== carried && c.q === q && c.r === r);
            const beside = InnerMapCombat.corpsesHere().find(c => c !== carried && Math.max(Math.abs(c.q - q), Math.abs(c.r - r)) === 1);
            if (carried) {
                menuItems.push({ type: 'action', action: 'bury_body', label: `Lay ${carried.name} in the Hole`, icon: '⚰️', desc: 'Bury them here', body: carried, holeQ: q, holeR: r });
            } else if (inside || beside) {
                const b = inside || beside;
                menuItems.push({ type: 'action', action: 'bury_body', label: `Bury ${b.name} Here`, icon: '⚰️', desc: 'Lay them in the hole and fill it in', body: b, holeQ: q, holeR: r });
            }
            menuItems.push({ type: 'action', action: 'fill_hole', label: 'Fill In the Hole', icon: '⬛', desc: inside ? `Fill it in over ${inside.name}` : 'Shovel the earth back in', holeQ: q, holeR: r });
        } else if (dug.kind === 'grave') {
            sep();
            menuItems.push({ type: 'header', label: `⚰️ Grave of ${dug.name || 'someone'}` });
            menuItems.push({ type: 'action', action: 'pay_respects', label: 'Pay Your Respects', icon: '🕯️', desc: 'Stand a while by the grave', holeQ: q, holeR: r });
            menuItems.push({ type: 'action', action: 'exhume_grave', label: 'Dig Up the Grave', icon: '⛏️', desc: 'Dig the body back up', holeQ: q, holeR: r });
        }
    },

    /** Bodies and ground work: handled here, before the generic walk-to-the-tile. */
    _handleGroundAction(game, item) {
        const start = (kind, hq, hr, opts) => {
            const res = InnerMapDigging.start(game, kind, hq, hr, opts);
            if (res === 'unreachable') game.ui.showNotification('Blocked', 'You can\'t reach that spot.', 'error');
        };
        switch (item.action) {
            case 'dig_hole': start('dig', item.q, item.r); return true;
            case 'fill_hole': start('fill', item.holeQ, item.holeR); return true;
            case 'exhume_grave': start('exhume', item.holeQ, item.holeR); return true;
            case 'bury_body': start('bury', item.holeQ, item.holeR, { corpse: item.body }); return true;
            case 'dig_grave': start('dig', item.holeQ, item.holeR, { then: { kind: 'bury', corpse: item.body } }); return true;
            case 'drop_body': {
                const body = InnerMapDigging.drop();
                if (body) game.ui.showNotification('⬇️ Put down', `You lay ${body.name} down.`, 'info');
                return true;
            }
            case 'pay_respects': {
                const go = () => InnerMapDigging.payRespects(game, item.holeQ, item.holeR);
                if (InnerMap.approachAndThen(item.holeQ, item.holeR, go) === 'unreachable') go();
                return true;
            }
            case 'ko_leave': return true;
            case 'ko_finish': case 'ko_rob': {
                const npc = item.npc;
                const act = () => {
                    if (!npc || npc.state !== 'unconscious') return;
                    if (item.action === 'ko_finish') InnerMapCombat.finishOff(npc, game);
                    else InnerMapCombat.robKnockedOut(npc, game);
                };
                const res = InnerMap.approachAndThen(npc.q, npc.r, act);
                if (res === 'unreachable') game.ui.showNotification('Blocked', `You can't reach ${npc.name}.`, 'error');
                return true;
            }
            case 'search_body': case 'carry_body': {
                const body = item.body;
                const act = () => {
                    if (!InnerMapCombat._corpses.includes(body)) return;
                    if (item.action === 'search_body') InnerMapCombat.searchBody(body, game);
                    else {
                        InnerMapDigging.carry(body);
                        game.ui.showNotification('👤 Carrying', `You heave ${body.name} up. Find a hole to bury them in, or put them down somewhere.`, 'info');
                    }
                };
                const res = InnerMap.approachAndThen(body.q, body.r, act);
                if (res === 'unreachable') game.ui.showNotification('Blocked', `You can't reach ${body.name}.`, 'error');
                return true;
            }
            default: return false;
        }
    },

    _handleContextAction(game, item, q, r) {
        if (InnerMapJail.handle(game, item)) return;
        if (InnerMapDeck.handle(game, item)) return;
        if (/^(lot|vacancy)_/.test(item.action || '') && InnerMapLots.handle(game, item)) return;
        if (/^grave_/.test(item.action || '') && InnerMapGraves.handle(game, item)) return;
        if (/^furnish_/.test(item.action || '') && InnerMapFurnish.handle(game, item)) return;
        if (/^farm_/.test(item.action || '') && InnerMapFarming.handle(game, item, q, r)) return;
        if (item.action === 'hunt_animal') {
            if (item.animal && InnerMap.animals.includes(item.animal)) ActionMenu.huntAnimal(game, item.animal);
            return;
        }
        if (item.action === 'herd_panel') { ActionMenu.showHerds(game); return; }
        if (/^animal_/.test(item.action || '') && InnerMapAnimals.handle(game, item)) return;
        const action = item.action;
        const playerQ = InnerMap.playerInnerQ;
        const playerR = InnerMap.playerInnerR;
        const dist = Math.abs(playerQ - q) + Math.abs(playerR - r);

        if (action === 'move_here') {
            InnerMap.cancelPlayerWalk();
            const walk = InnerMap.movePlayerTo(q, r);
            if (walk && walk.refused) game.ui.showNotification('🏊 Not Now', walk.refused, 'warning');
            return;
        }
        if (this._handleGroundAction(game, { ...item, q, r })) return;

        // Something lying (or floating) out of reach: go to it (swim, for wreckage on the water), then take it
        if (action === 'pickup_ground_item' && !item._approached && Math.max(Math.abs(playerQ - q), Math.abs(playerR - r)) > 1) {
            InnerMap.cancelPlayerWalk();
            const walk = InnerMap.movePlayerTo(q, r);
            if (walk && walk.started) {
                InnerMap._pendingAction = { q, r, run: () => this._handleContextAction(game, { ...item, _approached: true }, q, r) };
            } else {
                game.ui.showNotification('🖐️ Out of Reach', (walk && walk.refused) || 'You can\'t get to it from here.', 'warning');
            }
            return;
        }

        if (!item._approached && this._needsApproach(item)) {
            this._approachThenAct(game, item, q, r);
            return;
        }
        if (/^field_/.test(action) && InnerMapFields.handle(game, item)) return;
        if (/^granary_/.test(action) && InnerMapGranary.handle(game, item)) return;
        if (/^gate_/.test(action) && InnerMapGates.handle(game, item)) return;
        if (action === 'lock_door' && InnerMapLocks.handle(game, item, q, r, it => this._handleContextAction(game, it, q, r))) return;
        if (/^dive_/.test(action) && InnerMapDiving.handle(game, item, q, r)) return;
        if (/^climb_/.test(action) && InnerMapClimbing.handle(game, item, q, r)) return;

        // (fishing goes to the bank, never out to the water it casts into)
        if (dist > 1 && !item._approached && action !== 'fish_here') {
            InnerMap.cancelPlayerWalk();
            InnerMap.movePlayerTo(q, r);
        }

        switch (action) {
            case 'trade': case 'browse_goods': case 'buy_weapons': case 'buy_tools': case 'buy_food': case 'buy_drink': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined' && !ActionMenu.refuseIfOutlawed(game, worldTile)) ActionMenu.showTradeMenu(game, worldTile);
                break;
            }
            case 'talk_merchant': case 'talk_locals': case 'talk_priest': case 'talk_captain':
            case 'wake_npc': {
                // Shake a sleeper awake (world/innerMap/floors.js): they sit up, none too pleased, and you can talk
                const npc = item.npc;
                if (!npc) break;
                const wake = () => {
                    if (!npc._asleep) return;
                    if (InnerMap._wakeNpc) InnerMap._wakeNpc(npc);
                    npc.idleTimer = Math.max(npc.idleTimer || 0, 40);
                    NpcDisposition.adjustDisposition(npc, -3, game.player);
                    const night = InnerMap.townPeriod && InnerMap.townPeriod() === 'night';
                    game.ui.showNotification(`😴 ${npc.name}`, `${npc.name} stirs, blinks up at you and sits up. "${night ? 'Wha— at this hour? What is it?' : 'Mm? What is it?'}"`, 'info');
                    this._handleContextAction(game, { type: 'action', action: 'talk_npc', npc }, npc.q, npc.r);
                };
                // Beside the bed: shake them now; further off, go over first
                if (Math.max(Math.abs(playerQ - npc.q), Math.abs(playerR - npc.r)) <= 1) { wake(); break; }
                const adj = InnerMap.findAdjacentPassable(npc.q, npc.r);
                InnerMap.cancelPlayerWalk();
                const walk = adj ? InnerMap.movePlayerTo(adj.q, adj.r) : null;
                if (walk && walk.started) InnerMap._pendingAction = { q: npc.q, r: npc.r, run: wake };
                else game.ui.showNotification('Blocked', `You can't get to ${npc.name}.`, 'error');
                break;
            }
            case 'talk_guard': case 'talk_official': case 'ask_directions': case 'talk_npc': {
                const npc = item.npc;
                if (npc) {
                    // Freeze the NPC immediately so they don't wander off
                    npc._dialogFrozen = true;
                    npc._preDialogState = npc.state;
                    npc.state = 'dialog';
                    npc.path = null;
                    npc.moveProgress = 0;

                    // If player is already adjacent, open dialog immediately
                    const adjDist = Math.abs(playerQ - npc.q) + Math.abs(playerR - npc.r);
                    if (adjDist <= 1) {
                        NpcDialog.open(game, npc);
                    } else {
                        // Find passable tile adjacent to the NPC
                        const adj = InnerMap.findAdjacentPassable(npc.q, npc.r);
                        if (adj) {
                            InnerMap.cancelPlayerWalk();
                            InnerMap._pendingDialog = { npc, game };
                            const walkResult = InnerMap.movePlayerTo(adj.q, adj.r);
                            if (!walkResult.started) {
                                InnerMap._pendingDialog = null;
                                npc._dialogFrozen = false;
                                npc.state = npc._preDialogState || 'idle';
                                npc.idleTimer = 1;
                                game.ui.showNotification('Blocked', `Cannot reach ${npc.name}!`, 'error');
                            }
                        } else {
                            npc._dialogFrozen = false;
                            npc.state = npc._preDialogState || 'idle';
                            npc.idleTimer = 1;
                            game.ui.showNotification('Blocked', `Cannot reach ${npc.name}!`, 'error');
                        }
                    }
                } else {
                    // Fallback for building-based NPCs without an NPC object
                    const name = item.building ? item.building.name : 'someone';
                    game.ui.showNotification(`💬 ${name}`, '"Not much to say right now."', 'info');
                    if (game.player.modifyNeed) {
                        game.player.modifyNeed('social', 5);
                    }
                }
                break;
            }
            case 'tavern': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') ActionMenu.handleAction(game, worldTile, 'tavern');
                break;
            }
            case 'lodging': case 'manage_lodging': {
                // A guest house, inn, hotel or roadhouse (ui/actionMenu/lodging.js)
                const bld = item.building || InnerMap._insideBuilding;
                const id = bld && bld.establishmentId;
                if (action === 'manage_lodging' && id) ActionMenu.lodgingAct(game, 'tab', id, 'run');
                else ActionMenu.showLodgings(game, game.world.getTile(game.player.q, game.player.r), id || null);
                break;
            }
            case 'rest': {
                game.ui.showNotification('💤 Rest', 'You rest for a while and recover some energy.', 'info');
                if (game.player.modifyNeed) {
                    game.player.modifyNeed('energy', 15);
                    game.player.modifyNeed('comfort', 8);
                    // Resting inside a building is better
                    if (InnerMap._insideBuilding) {
                        game.player.modifyNeed('energy', 5);
                        game.player.modifyNeed('comfort', 5);
                    }
                }
                // Advance time by 1 hour
                InnerMap._timeAccumulator = InnerMap.TIME_SCALE;
                break;
            }
            case 'pray': case 'meditate': {
                // The devotion model: faith, place, diminishing returns (systems/devotion.js)
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                const kind = action === 'meditate' ? 'meditate' : 'pray';
                const place = worldTile && worldTile.holySite ? 'holy' : 'temple';
                DevotionPanel.devote(game, worldTile, kind, { place, endDay: false });
                if (game.player.modifyNeed) {
                    game.player.modifyNeed('comfort', 12);
                    game.player.modifyNeed('fun', 5);
                    game.player.modifyNeed('social', -3); // solitary activity
                }
                break;
            }
            case 'donate': {
                // Alms by recipient: temple, the poor, a guild, someone in need (systems/devotion.js)
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                DevotionPanel.showDonate(game, worldTile, 'temple');
                if (game.player.modifyNeed) game.player.modifyNeed('social', 3);
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
            case 'repair': case 'view_notices': case 'pay_taxes': case 'seek_blessing': case 'seek_audience':
            case 'buy_horse': case 'stable_horse': case 'report_crime': {
                // Building services — real menus backed by player/settlementServices.js
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (!worldTile || !worldTile.settlement) {
                    game.ui.showNotification('ℹ️ Closed', 'There is no one here to serve you.', 'info');
                    break;
                }
                const open = {
                    repair: () => ActionMenu.showBlacksmithMenu(game, worldTile),
                    view_notices: () => ActionMenu.handleAction(game, worldTile, 'bounty_board'),
                    pay_taxes: () => ActionMenu.showTributeMenu(game, worldTile),
                    seek_blessing: () => ActionMenu.showBlessingMenu(game, worldTile),
                    seek_audience: () => ActionMenu.showAudienceMenu(game, worldTile),
                    buy_horse: () => ActionMenu.showStableMenu(game, worldTile),
                    stable_horse: () => ActionMenu.showStableMenu(game, worldTile),
                    report_crime: () => ActionMenu.showGuardMenu(game, worldTile),
                };
                // Outlaws are turned away everywhere but the guard tower, where they can settle up
                if (action !== 'report_crime' && ActionMenu.refuseIfOutlawed(game, worldTile)) break;
                open[action]();
                break;
            }
            case 'bathe': {
                // The bathhouse: a few coppers for a hot bath (hygiene, comfort, an hour)
                const cost = 2;
                if ((game.player.gold || 0) < cost) {
                    game.ui.showNotification('🛁 Bathhouse', `A bath is ${cost} gold, and you haven't got it.`, 'error');
                    break;
                }
                game.player.gold -= cost;
                if (game.player.modifyNeed) {
                    game.player.modifyNeed('hygiene', 60);
                    game.player.modifyNeed('comfort', 15);
                }
                InnerMap._timeAccumulator = InnerMap.TIME_SCALE;
                game.ui.showNotification('🛁 Bathhouse', `You soak in a hot bath for an hour (${cost} gold). Mind your clothes are clean, or the smell comes back.`, 'success');
                game.ui.updateStats(game.player, game.world);
                break;
            }
            case 'wash_clothes': {
                // The bathhouse laundry: a copper to have your clothes scrubbed in hot water
                const cost = 1;
                if ((game.player.gold || 0) < cost) {
                    game.ui.showNotification('🧺 Laundry', 'The laundress wants a gold piece first.', 'error');
                    break;
                }
                const gained = game.player.washClothes ? game.player.washClothes(100) : 0;
                if (!(gained > 0)) {
                    game.ui.showNotification('🧺 Laundry', 'Your clothes are already clean.', 'info');
                    break;
                }
                game.player.gold -= cost;
                const cs = game.player.clothesState();
                game.ui.showNotification('🧺 Laundry', `Your clothes come back scrubbed and dry: ${cs.label.toLowerCase()} (${cs.freshness}%) for ${cost} gold.`, 'success');
                game.ui.updateStats(game.player, game.world);
                break;
            }
            case 'store_goods': case 'collect_goods': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') ActionMenu.handleAction(game, worldTile, 'collect_goods');
                break;
            }
            case 'guildhall': case 'bank': case 'found_bank': case 'underwriter': case 'bourse': case 'post_house':
            case 'seek_physician': case 'cartography': case 'odd_jobs': case 'mint':
            case 'treasury': case 'public_works': case 'estates': {
                // The town's own panel for the business this building keeps (ui/actionMenu)
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (!worldTile || !worldTile.settlement) break;
                const offered = this._townServices(game);
                if (offered && !offered.has(action)) {
                    game.ui.showNotification('ℹ️ Closed', 'There is no one here to see to that.', 'info');
                    break;
                }
                if (ActionMenu.refuseIfOutlawed(game, worldTile)) break;
                ActionMenu.handleAction(game, worldTile, action);
                break;
            }
            case 'examine': {
                // Walk up to it, then face the encounter's choices (player/wilds.js)
                const tile = InnerMap.getTile(q, r);
                const enc = tile && tile.encounter;
                if (enc) {
                    const open = () => { if (tile.encounter === enc) game._showEncounterNotification(enc); };
                    if (InnerMap.approachAndThen(q, r, open) === 'unreachable') {
                        game.ui.showNotification(`${enc.icon} ${enc.name}`, 'You cannot find a way to reach it.', 'info');
                    }
                }
                break;
            }
            case 'build_custom': {
                // Open the building creator
                if (typeof BuildingCreator !== 'undefined' && BuildingCreator.open) {
                    BuildingCreator.open(game, q, r);
                } else {
                    game.ui.showNotification('🏗️ Building Creator', 'Building creator is not available.', 'error');
                }
                break;
            }
            case 'build_property': {
                const worldTile = game.world.getTile(game.player.q, game.player.r);
                if (worldTile && typeof ActionMenu !== 'undefined') { InnerMap._pendingPropertyPosition = { q, r }; InnerMap._pendingLot = null; ActionMenu.handleAction(game, worldTile, 'build_property'); }
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
                // Waiting is boring but restful if sheltered
                if (game.player.modifyNeed) {
                    game.player.modifyNeed('fun', -3);
                    if (InnerMap._insideBuilding) {
                        game.player.modifyNeed('comfort', 3);
                    }
                }
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
                            if (typeof game._configureInnerMapCamera === 'function') {
                                game._configureInnerMapCamera('interior');
                            } else if (game.innerMapCamera) {
                                const tileSize = InnerMapRenderer.tileSize;
                                const innerPixelWidth = tileSize * InnerMap.width;
                                const innerPixelHeight = tileSize * InnerMap.height;
                                game.innerMapCamera.setWorldBounds(0, innerPixelHeight);
                                const canvasW = game.canvas.width;
                                const canvasH = game.canvas.height;
                                const fitZoom = Math.min(canvasW / innerPixelWidth, canvasH / innerPixelHeight);
                                const zoomLevel = (Number.isFinite(fitZoom) && fitZoom > 0) ? fitZoom * 0.9 : 1.5;
                                game.innerMapCamera.minZoom = Math.max(0.5, zoomLevel * 0.6);
                                game.innerMapCamera.maxZoom = Math.max(game.innerMapCamera.minZoom + 0.5, zoomLevel * 2.5);
                                game.innerMapCamera.zoom = zoomLevel;
                                game.innerMapCamera.targetZoom = zoomLevel;
                                const pWorld = InnerMap.getPlayerWorldPos();
                                game.innerMapCamera.centerOn(pWorld.x, pWorld.y);
                                game.innerMapCamera.precomputeFrame();
                            }
                            if (item.floor && typeof game._takeStairs === 'function') game._takeStairs(item.floor, { fromDoor: true });
                            else game.ui.showNotification(`🚪 Entered ${building.name}`, `You step inside ${building.name}. Press ESC or click "Exit" to leave.`, 'info');
                        } else {
                            const no = InnerMap._entryRefused;
                            const who = no && no.by ? `${no.by.name}, ${no.by.roleTitle || 'Guard'}` : building.name;
                            game.ui.showNotification(no && no.by ? `💂 ${who}` : '🚪 Locked', no && no.text ? (no.by ? `"${no.text}"` : no.text) : `You cannot enter ${building.name} right now.`, 'warning');
                        }
                    }
                }
                break;
            }
            case 'exit_building': {
                if (typeof game._leaveBuilding === 'function') game._leaveBuilding();
                break;
            }
            case 'take_stairs': {
                // Beside them: up (or down) now; further off: walk there, and the stairs take you on arrival
                if (dist <= 1 && typeof game._takeStairs === 'function') game._takeStairs(item.stairsTo);
                else { InnerMap.cancelPlayerWalk(); InnerMap.movePlayerTo(q, r); }
                break;
            }
            case 'fish_here': {
                // From the bank by this water (ui/actionMenu/skills.js doFish → the casting task)
                const water = InnerMap.getTile(q, r);
                if (!water) break;
                if (InnerMap.isPlayerSwimming && InnerMap.isPlayerSwimming()) {
                    game.ui.showNotification('🎣 Fishing', 'You can\'t fish while you\'re swimming. Get to the bank first.', 'warning');
                    break;
                }
                // Dry ground to stand on: not the shallows, a ford or the water itself
                const dryBank = (t) => !!(t && t.subTerrain.passable && !t._wet && !t._sea && !t.building && !t.customObjectPart);
                const REACH = 3; // how far a line is cast
                let bank = null;
                const here = InnerMap.getTile(playerQ, playerR);
                if (dryBank(here) && Math.max(Math.abs(q - playerQ), Math.abs(r - playerR)) <= REACH) {
                    bank = { q: playerQ, r: playerR }; // cast from where you stand
                } else {
                    // the nearest dry bank within a cast of the water, the closer to you the better
                    let best = Infinity;
                    for (let dr = -REACH; dr <= REACH; dr++) {
                        for (let dq = -REACH; dq <= REACH; dq++) {
                            const x = q + dq, y = r + dr;
                            if (!dryBank(InnerMap.getTile(x, y))) continue;
                            const d = Math.max(Math.abs(dq), Math.abs(dr)) * 10 + Math.abs(x - playerQ) + Math.abs(y - playerR);
                            if (d < best) { best = d; bank = { q: x, r: y }; }
                        }
                    }
                }
                if (!bank) { game.ui.showNotification('🎣 Fishing', 'There is no bank close enough to cast from. Try nearer the shore.', 'warning'); break; }
                const kind = water._waterKind || (water._sea ? 'sea' : 'pond');
                const depth = kind === 'sea' ? (water._deep ? 'deep' : 'mid') : kind === 'lake' ? (water._deep ? 'mid' : 'shallow') : 'shallow';
                const wt = game.world.getTile(game.player.q, game.player.r);
                if (wt) ActionMenu.doFish(game, wt, { spots: [bank], depth, target: { q, r } });
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
                                const dir = InnerMap.getDirectionTowardObject(aQ, aR, cDef);
                                InnerMapRenderer._playerFacing = dir;
                            } else {
                                InnerMap._pendingInteraction = { anchorQ: aQ, anchorR: aR, defId: cDef.id };
                                InnerMap.movePlayerTo(adj.q, adj.r);
                            }
                        } else {
                            game.ui.showNotification('Blocked', 'Cannot reach that object!', 'error');
                        }
                    } else if (cDef.animation && cDef.animation !== 'none') {
                        // Non-resource object with an animation (e.g. chair → sitting)
                        const adj = InnerMap.findAdjacentToObject(aQ, aR, cDef);
                        if (adj) {
                            if (InnerMap.playerInnerQ === adj.q && InnerMap.playerInnerR === adj.r) {
                                InnerMap.startInteraction(aQ, aR, cDef.id, 0);
                                const dir = InnerMap.getDirectionTowardObject(aQ, aR, cDef);
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
                            const dir = InnerMap.getDirectionTowardObject(hAQ, hAR, hDef);
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
                if (Containers.isContainer(furn.type)) {
                    ObjectActions.execute(game, 'look_inside', { name: furn.name, icon: furn.icon, furnitureType: furn.type }, item.objAnchorQ != null ? item.objAnchorQ : q, item.objAnchorR != null ? item.objAnchorR : r);
                    break;
                }
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
            case 'pickup_ground_item': {
                const gTile = InnerMap.getTile(item.groundItemTileQ, item.groundItemTileR);
                if (gTile && gTile.groundItem && gTile.groundItem.gold) {
                    // A strongbox from a wreck: its gold into your purse
                    const gi = gTile.groundItem;
                    game.player.gold = (game.player.gold || 0) + gi.gold;
                    game.ui.showNotification(`${gi.icon} Salvage`, `You prise the strongbox open: ${gi.gold} gold.`, 'success');
                    delete gTile.groundItem;
                    game.ui.updateStats(game.player, game.world);
                } else if (gTile && gTile.groundItem) {
                    const gi = gTile.groundItem;
                    // Add item back to player inventory (if there is room)
                    if (!PlayerInventory.addItem(game.player, gi.itemId, gi.quantity || 1).success) {
                        game.ui.showNotification('🎒 Inventory Full', PlayerInventory.fullMessage(game.player), 'warning');
                        break;
                    }
                    game.ui.showNotification(`${gi.icon} Picked Up`, `Picked up ${gi.name}.`, 'success');
                    delete gTile.groundItem;
                    game.ui.updateStats(game.player, game.world);
                    // Refresh hotbar if available
                    Hotbar.refresh();
                }
                break;
            }
            default:
                // ── Handle object actions (obj_action_sleep, obj_action_cook, etc.) ──
                if (action.startsWith('obj_action_')) {
                    const actionKey = action.slice('obj_action_'.length);
                    ObjectActions.execute(game, actionKey, item.customObjDef, item.objAnchorQ, item.objAnchorR);
                } else {
                    game.ui.showNotification('ℹ️ Action', `${action} is not available right now.`, 'info');
                }
                break;
        }
    },

    /** The town actions on offer where the player stands (PlayerActions), or null outside a settlement. */
    _townServices(game) {
        const tile = game.world.getTile(game.player.q, game.player.r);
        if (!tile || !tile.settlement) return null;
        return new Set((PlayerActions.getAvailableActions(game.player, tile, game.world) || []).map(a => a.type));
    },

    _getActionDef(action) {
        const defs = this._actionDefs || {};
        return defs[action] || { label: action, icon: '❓', desc: '' };
    },
});
