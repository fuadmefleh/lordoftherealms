// Object-action helper + modal functions (stateless; take game as a param).
import { InnerMap } from '../../world/innerMap.js';
import { Hotbar } from '../hotbar.js';
import { PlayerInventory } from '../../player/inventory.js';
import { FOOD_ITEMS, COOK_RECIPES, CRAFT_RECIPES, SMELT_RECIPES, BREW_RECIPES, HEAL_ITEMS, MODAL_STYLE, MODAL_HEADER_STYLE, MODAL_BODY_STYLE, MODAL_FOOTER_STYLE } from './data.js';
import { OBJECT_ACTIONS } from './actions.js';

export function _getPlayerFoods(game) {
    const inv = game.player.inventory || {};
    const foods = [];
    for (const [id, def] of Object.entries(FOOD_ITEMS)) {
        const qty = inv[id] || 0;
        if (qty > 0) foods.push({ id, qty, ...def });
    }
    return foods;
}

export function _getCookableItems(game) {
    const inv = game.player.inventory || {};
    return COOK_RECIPES.filter(r => {
        for (const [item, amt] of Object.entries(r.ingredients)) {
            if ((inv[item] || 0) < amt) return false;
        }
        return true;
    });
}

export function _canCraftRecipe(game, recipe) {
    const inv = game.player.inventory || {};
    for (const [item, amt] of Object.entries(recipe.ingredients)) {
        if ((inv[item] || 0) < amt) return false;
    }
    return true;
}

export function _consumeIngredients(game, ingredients) {
    if (!game.player.inventory) game.player.inventory = {};
    for (const [item, amt] of Object.entries(ingredients)) {
        game.player.inventory[item] = Math.max(0, (game.player.inventory[item] || 0) - amt);
        if (game.player.inventory[item] <= 0) delete game.player.inventory[item];
    }
}

/** Add results to the inventory; returns the PlayerInventory.addItems summary (dropped = didn't fit). */
export function _giveResults(game, results) {
    if (!game.player.inventory) game.player.inventory = {};
    return PlayerInventory.addItems(game.player, results);
}

/** The world tile of the settlement the player is visiting, or null. */
export function _settlementTile(game) {
    const tile = game.world && game.world.getTile ? game.world.getTile(game.player.q, game.player.r) : null;
    return tile && tile.settlement ? tile : null;
}

export function _advanceTime(hours) {
    InnerMap.timeOfDay += hours;
    // Handle day rollover
    while (InnerMap.timeOfDay >= 24) {
        InnerMap.timeOfDay -= 24;
        if (typeof InnerMap.endDay === 'function') {
            InnerMap.endDay();
        }
    }
    // Reset accumulator so the next partial hour starts fresh
    InnerMap._timeAccumulator = 0;
}

export function _applyEffects(game, effects) {
    if (!effects || !game.player.modifyNeed) return;
    for (const [need, amount] of Object.entries(effects)) {
        game.player.modifyNeed(need, amount);
    }
}

export function _btn(label, primary = false, onclick = '') {
    const bg = primary
        ? 'background:var(--gold, #f5c542);color:#1a1a2e;font-weight:700;'
        : 'background:rgba(255,255,255,0.08);color:#ccc;';
    return `<button onclick="${onclick}" style="${bg}border:none;border-radius:6px;padding:8px 18px;cursor:pointer;font-size:13px;font-family:inherit;transition:filter .15s" onmouseenter="this.style.filter='brightness(1.15)'" onmouseleave="this.style.filter=''">${label}</button>`;
}

export function _removeModal(id) {
    const el = document.getElementById(id);
    if (el) el.remove();
}

export function _showSleepModal(game, objDef, cost = 0) {
    _removeModal('objActionModal');
    const id = 'objActionModal';
    const modal = document.createElement('div');
    modal.id = id;
    modal.style.cssText = MODAL_STYLE;

    const currentHour = Math.floor(InnerMap.timeOfDay || 8);
    const maxHours = Math.max(1, 24 - currentHour);
    const suggestedHours = Math.min(8, maxHours);

    modal.innerHTML = `
        <div style="${MODAL_HEADER_STYLE}">
            <span style="font-size:28px">🛏️</span>
            <div>
                <div style="font-family:var(--font-display,'Cinzel',serif);font-size:16px;color:var(--gold,#f5c542)">Sleep</div>
                <div style="font-size:11px;color:#999">${cost > 0 ? `A night's lodging costs ${cost} gold` : 'Rest to recover energy and health'}</div>
            </div>
        </div>
        <div style="${MODAL_BODY_STYLE}">
            <div style="display:flex;align-items:center;gap:10px">
                <span style="font-size:13px;color:#aaa;white-space:nowrap">Hours:</span>
                <input type="range" id="sleepHoursRange" min="1" max="${maxHours}" value="${suggestedHours}" style="flex:1;accent-color:var(--gold,#f5c542)">
                <span id="sleepHoursLabel" style="font-size:18px;font-weight:700;color:var(--gold,#f5c542);min-width:32px;text-align:center">${suggestedHours}</span>
            </div>
            <div style="background:rgba(255,255,255,0.04);border-radius:6px;padding:10px 12px;font-size:12px;line-height:1.7">
                <div>⏰ Current time: <strong>${_formatHour(currentHour)}</strong></div>
                <div id="sleepWakeTime">🌅 Wake at: <strong>${_formatHour(currentHour + suggestedHours)}</strong></div>
                <div style="margin-top:6px;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px">
                    <div>💤 Energy restored: <span style="color:#5ddb6a" id="sleepEnergyPreview">+${_calcSleepEnergy(suggestedHours)}</span></div>
                    <div>❤️ Health restored: <span style="color:#e86a6a" id="sleepHealthPreview">+${_calcSleepHealth(suggestedHours)}</span></div>
                    <div>🛋️ Comfort: <span style="color:#6ab8db" id="sleepComfortPreview">+${_calcSleepComfort(suggestedHours)}</span></div>
                </div>
            </div>
        </div>
        <div style="${MODAL_FOOTER_STYLE}">
            ${_btn('Cancel', false, `document.getElementById('${id}').remove()`)}
            ${_btn(cost > 0 ? `💤 Sleep (${cost}g)` : '💤 Sleep', true, `window._execSleep()`)}
        </div>
    `;
    document.body.appendChild(modal);

    // Wire up slider
    const slider = document.getElementById('sleepHoursRange');
    slider.addEventListener('input', () => {
        const h = parseInt(slider.value);
        document.getElementById('sleepHoursLabel').textContent = h;
        document.getElementById('sleepWakeTime').innerHTML = `🌅 Wake at: <strong>${_formatHour(currentHour + h)}</strong>`;
        document.getElementById('sleepEnergyPreview').textContent = `+${_calcSleepEnergy(h)}`;
        document.getElementById('sleepHealthPreview').textContent = `+${_calcSleepHealth(h)}`;
        document.getElementById('sleepComfortPreview').textContent = `+${_calcSleepComfort(h)}`;
    });

    window._execSleep = () => {
        const hours = parseInt(document.getElementById('sleepHoursRange').value);
        _removeModal(id);
        if (cost > 0) {
            if ((game.player.gold || 0) < cost) {
                game.ui.showNotification('🛏️ Lodging', `You can't afford a room (${cost} gold).`, 'error');
                delete window._execSleep;
                return;
            }
            game.player.gold -= cost;
        }
        _advanceTime(hours);
        if (game.player.modifyNeed) {
            game.player.modifyNeed('energy', _calcSleepEnergy(hours));
            game.player.modifyNeed('comfort', _calcSleepComfort(hours));
        }
        const hpGain = _calcSleepHealth(hours);
        if (hpGain > 0) {
            game.player.health = Math.min(game.player.maxHealth || 100, (game.player.health || 100) + hpGain);
        }
        game.ui.showNotification('💤 Slept', `You slept for ${hours} hours and feel refreshed.`, 'success');
        game.ui.updateStats(game.player, game.world);
        Hotbar.refresh();
        delete window._execSleep;
    };
}

export function _calcSleepEnergy(hours) { return Math.round(hours * 8 + 5); }

export function _calcSleepHealth(hours) { return Math.round(hours * 2); }

export function _calcSleepComfort(hours) { return Math.round(hours * 4 + 5); }

export function _formatHour(h) {
    h = ((h % 24) + 24) % 24;
    if (h === 0) return '12:00 AM';
    if (h < 12) return `${h}:00 AM`;
    if (h === 12) return '12:00 PM';
    return `${h - 12}:00 PM`;
}

export function _showEatModal(game, objDef) {
    _removeModal('objActionModal');
    const foods = _getPlayerFoods(game);
    if (!foods.length) { game.ui.showNotification('🍽️ No Food', 'You have nothing to eat.', 'error'); return; }

    const id = 'objActionModal';
    const modal = document.createElement('div');
    modal.id = id;
    modal.style.cssText = MODAL_STYLE;

    let foodListHtml = foods.map((f, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:6px;cursor:pointer;transition:background .15s"
             onmouseenter="this.style.background='rgba(245,197,66,0.1)'"
             onmouseleave="this.style.background='rgba(255,255,255,0.03)'"
             onclick="window._execEat('${f.id}')">
            <span style="font-size:22px">${f.icon}</span>
            <div style="flex:1">
                <div style="font-size:13px;font-weight:600">${f.label} <span style="color:#888;font-weight:400">×${f.qty}</span></div>
                <div style="font-size:11px;color:#888">🍖 +${f.hunger} hunger${f.energy ? ` · ⚡ +${f.energy} energy` : ''}${f.fun ? ` · 🎉 +${f.fun} fun` : ''}</div>
            </div>
        </div>
    `).join('');

    modal.innerHTML = `
        <div style="${MODAL_HEADER_STYLE}">
            <span style="font-size:28px">🍽️</span>
            <div>
                <div style="font-family:var(--font-display,'Cinzel',serif);font-size:16px;color:var(--gold,#f5c542)">Eat</div>
                <div style="font-size:11px;color:#999">Choose something to eat</div>
            </div>
        </div>
        <div style="${MODAL_BODY_STYLE}">
            ${foodListHtml}
        </div>
        <div style="${MODAL_FOOTER_STYLE}">
            ${_btn('Cancel', false, `document.getElementById('${id}').remove()`)}
        </div>
    `;
    document.body.appendChild(modal);

    window._execEat = (foodId) => {
        const def = FOOD_ITEMS[foodId];
        if (!def) return;
        const inv = game.player.inventory || {};
        if ((inv[foodId] || 0) <= 0) return;
        inv[foodId]--;
        if (inv[foodId] <= 0) delete inv[foodId];
        if (game.player.modifyNeed) {
            if (def.hunger) game.player.modifyNeed('hunger', def.hunger);
            if (def.energy) game.player.modifyNeed('energy', def.energy);
            if (def.fun) game.player.modifyNeed('fun', def.fun);
            if (def.social) game.player.modifyNeed('social', def.social);
            if (def.comfort) game.player.modifyNeed('comfort', def.comfort);
        }
        _removeModal(id);
        game.ui.showNotification(`${def.icon} Ate ${def.label}`, `Mmm, delicious! Hunger restored.`, 'success');
        game.ui.updateStats(game.player, game.world);
        Hotbar.refresh();
        delete window._execEat;
    };
}

export function _showRecipeModal(game, objDef, title, icon, recipes) {
    _removeModal('objActionModal');
    const id = 'objActionModal';
    const modal = document.createElement('div');
    modal.id = id;
    modal.style.cssText = MODAL_STYLE;

    let recipeHtml = recipes.map((r, i) => {
        const canMake = _canCraftRecipe(game, r);
        const opacity = canMake ? '1' : '0.4';
        const cursor = canMake ? 'cursor:pointer;' : 'cursor:not-allowed;';
        const ingredientStr = Object.entries(r.ingredients).map(([k, v]) => {
            const has = (game.player.inventory || {})[k] || 0;
            const color = has >= v ? '#5ddb6a' : '#e86a6a';
            return `<span style="color:${color}">${k.replace(/_/g, ' ')} ${has}/${v}</span>`;
        }).join(' · ');
        const resultStr = Object.entries(r.result).map(([k, v]) => `${v}× ${k.replace(/_/g, ' ')}`).join(', ');
        return `
            <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:6px;opacity:${opacity};${cursor}transition:background .15s"
                 ${canMake ? `onmouseenter="this.style.background='rgba(245,197,66,0.1)'" onmouseleave="this.style.background='rgba(255,255,255,0.03)'" onclick="window._execRecipe(${i})"` : ''}>
                <span style="font-size:22px">${r.icon}</span>
                <div style="flex:1">
                    <div style="font-size:13px;font-weight:600">${r.label}</div>
                    <div style="font-size:11px;color:#888">${r.desc}</div>
                    <div style="font-size:10px;margin-top:2px">Needs: ${ingredientStr}</div>
                    <div style="font-size:10px;color:#6ab8db">Yields: ${resultStr}</div>
                </div>
            </div>
        `;
    }).join('');

    modal.innerHTML = `
        <div style="${MODAL_HEADER_STYLE}">
            <span style="font-size:28px">${icon}</span>
            <div>
                <div style="font-family:var(--font-display,'Cinzel',serif);font-size:16px;color:var(--gold,#f5c542)">${title}</div>
                <div style="font-size:11px;color:#999">Select a recipe to produce</div>
            </div>
        </div>
        <div style="${MODAL_BODY_STYLE}">
            ${recipeHtml || '<div style="color:#888;font-size:13px;text-align:center;padding:20px">No recipes available with your current materials.</div>'}
        </div>
        <div style="${MODAL_FOOTER_STYLE}">
            ${_btn('Cancel', false, `document.getElementById('${id}').remove()`)}
        </div>
    `;
    document.body.appendChild(modal);

    window._execRecipe = (idx) => {
        const recipe = recipes[idx];
        if (!recipe || !_canCraftRecipe(game, recipe)) return;
        const invBefore = { ...(game.player.inventory || {}) };
        _consumeIngredients(game, recipe.ingredients);
        const given = _giveResults(game, recipe.result);
        if (given.full) {
            // No room for the product — undo the craft rather than destroy the ingredients
            game.player.inventory = invBefore;
            game.ui.showNotification('🎒 Inventory Full', PlayerInventory.fullMessage(game.player), 'warning');
            return;
        }
        _advanceTime(1);
        _removeModal(id);
        const resultStr = Object.entries(recipe.result).map(([k, v]) => `${v}× ${k.replace(/_/g, ' ')}`).join(', ');
        game.ui.showNotification(`${recipe.icon} ${recipe.label}`, `Produced ${resultStr}!`, 'success');
        game.ui.updateStats(game.player, game.world);
        Hotbar.refresh();
        delete window._execRecipe;
    };
}

export function _showFishModal(game, objDef) {
    _removeModal('objActionModal');
    const id = 'objActionModal';
    const modal = document.createElement('div');
    modal.id = id;
    modal.style.cssText = MODAL_STYLE;

    modal.innerHTML = `
        <div style="${MODAL_HEADER_STYLE}">
            <span style="font-size:28px">🎣</span>
            <div>
                <div style="font-family:var(--font-display,'Cinzel',serif);font-size:16px;color:var(--gold,#f5c542)">Fishing</div>
                <div style="font-size:11px;color:#999">Cast your line and wait for a bite</div>
            </div>
        </div>
        <div style="${MODAL_BODY_STYLE}">
            <div style="text-align:center;padding:10px">
                <div id="fishStatus" style="font-size:15px;margin-bottom:12px">🌊 Casting your line...</div>
                <div style="width:100%;height:8px;background:rgba(255,255,255,0.1);border-radius:4px;overflow:hidden">
                    <div id="fishBar" style="height:100%;width:0%;background:var(--gold,#f5c542);border-radius:4px;transition:width 0.3s"></div>
                </div>
                <div id="fishTimer" style="font-size:11px;color:#888;margin-top:6px">Waiting...</div>
            </div>
        </div>
        <div style="${MODAL_FOOTER_STYLE}">
            ${_btn('Cancel', false, `window._cancelFishing()`)}
        </div>
    `;
    document.body.appendChild(modal);

    const totalTime = 3000 + Math.random() * 4000; // 3-7 seconds
    const luck = (game.player.luck || 5) / 10;
    const startTime = Date.now();
    let cancelled = false;

    const fishStatuses = [
        '🌊 Casting your line...',
        '🎣 Waiting patiently...',
        '🐟 Something nibbles...',
        '🎯 A tug on the line!',
    ];

    const timer = setInterval(() => {
        if (cancelled) { clearInterval(timer); return; }
        const elapsed = Date.now() - startTime;
        const progress = Math.min(100, (elapsed / totalTime) * 100);
        const bar = document.getElementById('fishBar');
        const status = document.getElementById('fishStatus');
        const timerEl = document.getElementById('fishTimer');
        if (bar) bar.style.width = progress + '%';
        if (status) {
            const idx = Math.min(fishStatuses.length - 1, Math.floor(progress / 25));
            status.textContent = fishStatuses[idx];
        }
        if (timerEl) timerEl.textContent = `${Math.ceil((totalTime - elapsed) / 1000)}s remaining...`;

        if (elapsed >= totalTime) {
            clearInterval(timer);
            _removeModal(id);
            _advanceTime(1);

            // Determine catch
            const catchRoll = Math.random() + luck * 0.3;
            if (catchRoll > 0.35) {
                const catchAmount = 1 + Math.floor(Math.random() * 3);
                if (!game.player.inventory) game.player.inventory = {};
                game.player.inventory.fish = (game.player.inventory.fish || 0) + catchAmount;
                game.ui.showNotification('🐟 Caught!', `You caught ${catchAmount} fish!`, 'success');
                if (game.player.modifyNeed) {
                    game.player.modifyNeed('fun', 12);
                    game.player.modifyNeed('comfort', -3);
                }
            } else {
                game.ui.showNotification('🎣 Nothing', 'The fish got away this time.', 'info');
                if (game.player.modifyNeed) {
                    game.player.modifyNeed('fun', -5);
                }
            }
            game.ui.updateStats(game.player, game.world);
            Hotbar.refresh();
        }
    }, 100);

    window._cancelFishing = () => {
        cancelled = true;
        clearInterval(timer);
        _removeModal(id);
        delete window._cancelFishing;
    };
}

export function _showStoreModal(game, objDef, anchorQ, anchorR) {
    _removeModal('objActionModal');
    const id = 'objActionModal';
    const modal = document.createElement('div');
    modal.id = id;
    modal.style.cssText = MODAL_STYLE + 'min-width:420px;max-width:520px;';

    // Get or create storage for this object
    const tile = InnerMap.getTile(anchorQ, anchorR);
    // Editor objects keep storage on customObject; procedural furniture on _furniture.
    const holder = tile && (tile.customObject || tile._furniture);
    if (!holder) { game.ui.showNotification('📦 Error', 'Cannot access storage.', 'error'); return; }
    if (!holder._storage) holder._storage = {};
    const storage = holder._storage;
    const inv = game.player.inventory || {};

    function renderContent() {
        const playerItems = Object.entries(inv).filter(([, v]) => v > 0);
        const storedItems = Object.entries(storage).filter(([, v]) => v > 0);

        let html = `
            <div style="${MODAL_HEADER_STYLE}">
                <span style="font-size:28px">📦</span>
                <div>
                    <div style="font-family:var(--font-display,'Cinzel',serif);font-size:16px;color:var(--gold,#f5c542)">Storage</div>
                    <div style="font-size:11px;color:#999">${objDef ? objDef.name : 'Container'}</div>
                </div>
            </div>
            <div style="${MODAL_BODY_STYLE}">
                <div style="display:flex;gap:12px;flex-wrap:wrap">
                    <div style="flex:1;min-width:180px">
                        <div style="font-size:12px;font-weight:600;color:var(--gold,#f5c542);margin-bottom:6px">📦 Stored Items</div>
                        ${storedItems.length ? storedItems.map(([k, v]) => `
                            <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px;background:rgba(255,255,255,0.03);border-radius:4px;margin-bottom:3px;font-size:12px">
                                <span>${k.replace(/_/g, ' ')} ×${v}</span>
                                <button onclick="window._storageAction('take','${k}')" style="background:rgba(93,219,106,0.2);color:#5ddb6a;border:none;border-radius:3px;padding:2px 8px;cursor:pointer;font-size:11px">Take</button>
                            </div>
                        `).join('') : '<div style="font-size:11px;color:#666;padding:8px">Empty</div>'}
                    </div>
                    <div style="flex:1;min-width:180px">
                        <div style="font-size:12px;font-weight:600;color:#6ab8db;margin-bottom:6px">🎒 Your Items</div>
                        ${playerItems.length ? playerItems.map(([k, v]) => `
                            <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 8px;background:rgba(255,255,255,0.03);border-radius:4px;margin-bottom:3px;font-size:12px">
                                <span>${k.replace(/_/g, ' ')} ×${v}</span>
                                <button onclick="window._storageAction('store','${k}')" style="background:rgba(106,184,219,0.2);color:#6ab8db;border:none;border-radius:3px;padding:2px 8px;cursor:pointer;font-size:11px">Store</button>
                            </div>
                        `).join('') : '<div style="font-size:11px;color:#666;padding:8px">No items</div>'}
                    </div>
                </div>
            </div>
            <div style="${MODAL_FOOTER_STYLE}">
                ${_btn('Close', false, `document.getElementById('${id}').remove()`)}
            </div>
        `;
        modal.innerHTML = html;
    }

    renderContent();
    document.body.appendChild(modal);

    window._storageAction = (action, itemId) => {
        if (action === 'store') {
            if ((inv[itemId] || 0) <= 0) return;
            inv[itemId]--;
            if (inv[itemId] <= 0) delete inv[itemId];
            storage[itemId] = (storage[itemId] || 0) + 1;
        } else if (action === 'take') {
            if ((storage[itemId] || 0) <= 0) return;
            storage[itemId]--;
            if (storage[itemId] <= 0) delete storage[itemId];
            if (!PlayerInventory.addItem(game.player, itemId, 1).success) {
                storage[itemId] = (storage[itemId] || 0) + 1;
                game.ui.showNotification('🎒 Inventory Full', PlayerInventory.fullMessage(game.player), 'warning');
                return;
            }
        }
        renderContent();
        game.ui.updateStats(game.player, game.world);
        Hotbar.refresh();
    };
}

export function _showHealModal(game, objDef) {
    _removeModal('objActionModal');
    const id = 'objActionModal';
    const modal = document.createElement('div');
    modal.id = id;
    modal.style.cssText = MODAL_STYLE;

    const inv = game.player.inventory || {};
    const healItems = Object.entries(HEAL_ITEMS)
        .filter(([itemId]) => (inv[itemId] || 0) > 0)
        .map(([itemId, def]) => ({ itemId, qty: inv[itemId], ...def }));

    const currentHp = game.player.health || 100;
    const maxHp = game.player.maxHealth || 100;

    let listHtml = healItems.map(h => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:6px;cursor:pointer;transition:background .15s"
             onmouseenter="this.style.background='rgba(232,106,106,0.1)'"
             onmouseleave="this.style.background='rgba(255,255,255,0.03)'"
             onclick="window._execHeal('${h.itemId}')">
            <span style="font-size:22px">${h.icon}</span>
            <div style="flex:1">
                <div style="font-size:13px;font-weight:600">${h.label} <span style="color:#888;font-weight:400">×${h.qty}</span></div>
                <div style="font-size:11px;color:#888">❤️ +${h.heal} HP${h.energy ? ` · ⚡ +${h.energy} energy` : ''}</div>
            </div>
        </div>
    `).join('');

    modal.innerHTML = `
        <div style="${MODAL_HEADER_STYLE}">
            <span style="font-size:28px">💊</span>
            <div>
                <div style="font-family:var(--font-display,'Cinzel',serif);font-size:16px;color:var(--gold,#f5c542)">Heal</div>
                <div style="font-size:11px;color:#999">HP: ${currentHp}/${maxHp}</div>
            </div>
        </div>
        <div style="${MODAL_BODY_STYLE}">
            ${listHtml || '<div style="color:#888;font-size:13px;text-align:center;padding:20px">No healing items available.</div>'}
        </div>
        <div style="${MODAL_FOOTER_STYLE}">
            ${_btn('Cancel', false, `document.getElementById('${id}').remove()`)}
        </div>
    `;
    document.body.appendChild(modal);

    window._execHeal = (itemId) => {
        const def = HEAL_ITEMS[itemId];
        if (!def || (inv[itemId] || 0) <= 0) return;
        inv[itemId]--;
        if (inv[itemId] <= 0) delete inv[itemId];
        game.player.health = Math.min(maxHp, currentHp + def.heal);
        if (def.energy && game.player.modifyNeed) game.player.modifyNeed('energy', def.energy);
        _removeModal(id);
        game.ui.showNotification(`${def.icon} Healed`, `Restored ${def.heal} HP!`, 'success');
        game.ui.updateStats(game.player, game.world);
        Hotbar.refresh();
        delete window._execHeal;
    };
}
