// UI — propertiesSettings methods.
import { UI } from './core.js';
import { applyUiScale, UI_SCALE_OPTIONS } from '../uiScale.js';
import { Utils, ActionMenu, Religion, Economy, PlayerEconomy, PlayerReligion, Infrastructure, Peoples, CustomObjects, Characters, Culture, Quests, Technology, Banking, MarketDynamics, Taxation, Hex, SaveLoad, audioManager, NpcFamily, Relationships, Housing, House, NpcBrain } from './_imports.js';

Object.assign(UI.prototype, {
    // ============================================
    // MY PROPERTIES PANEL
    // ============================================
    showPropertiesPanel(player, world) {
        const houses = player.houses || [];
        const properties = player.properties || [];

        let html = '<div style="max-height:520px;overflow-y:auto;">';

        // ── Owned Houses ───────────────────────────────────────
        html += `<h4 style="margin-top:0;">🏠 Owned Houses <span style="font-size:12px;font-weight:400;color:var(--text-secondary);">(${houses.length})</span></h4>`;

        if (houses.length === 0) {
            html += '<div style="font-size:12px;color:var(--text-secondary);padding:8px;margin-bottom:12px;">You don\'t own any houses yet. Visit a settlement and buy one.</div>';
        } else {
            for (const house of houses) {
                const ht = Housing.getHouseType(house.typeId);
                const name = ht ? ht.name : house.typeId;
                const icon = ht ? ht.icon : '🏠';
                const isHere = (house.q === player.q && house.r === player.r);
                const condColor = house.condition >= 80 ? '#27ae60' : house.condition >= 50 ? '#f39c12' : '#e74c3c';

                html += `<div style="border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:8px;background:rgba(255,255,255,0.02);">`;
                html += `<div style="display:flex;justify-content:space-between;align-items:flex-start;">`;
                html += `<div>`;
                html += `<div style="font-weight:bold;font-size:13px;">${icon} ${name}</div>`;
                html += `<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">📍 ${house.settlementName || `(${house.q}, ${house.r})`}</div>`;
                html += `<div style="font-size:11px;margin-top:2px;">🔧 Condition: <span style="color:${condColor};">${house.condition}%</span>`;
                if (house.upgrades && house.upgrades.length > 0) {
                    html += ` · 🛠️ ${house.upgrades.length} upgrade${house.upgrades.length !== 1 ? 's' : ''}`;
                }
                html += `</div>`;
                html += `</div>`;
                html += `<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;">`;
                if (isHere) {
                    html += `<span style="font-size:11px;color:#27ae60;font-style:italic;">You are here</span>`;
                } else {
                    html += `<button onclick="window._travelToProperty(${house.q},${house.r})" style="font-size:11px;padding:3px 8px;">🧭 Travel Here</button>`;
                }
                html += `</div>`;
                html += `</div>`;
                html += `</div>`;
            }
        }

        // ── Owned Properties (farms, mines, etc.) ─────────────
        html += `<h4 style="margin-top:12px;">🏗️ Properties & Businesses <span style="font-size:12px;font-weight:400;color:var(--text-secondary);">(${properties.length})</span></h4>`;

        if (properties.length === 0) {
            html += '<div style="font-size:12px;color:var(--text-secondary);padding:8px;">You haven\'t built any farms, mines, or workshops yet.</div>';
        } else {
            for (const prop of properties) {
                const isHere = (prop.q === player.q && prop.r === player.r);
                const statusLabel = prop.underConstruction
                    ? `<span style="color:#f39c12;font-size:10px;">🏗️ Building (${prop.constructionDaysLeft || '?'}d left)</span>`
                    : `<span style="color:#27ae60;font-size:10px;">✅ Active</span>`;

                html += `<div style="border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:8px;background:rgba(255,255,255,0.02);">`;
                html += `<div style="display:flex;justify-content:space-between;align-items:flex-start;">`;
                html += `<div>`;
                html += `<div style="font-weight:bold;font-size:13px;">${prop.icon || '🏗️'} ${prop.name}</div>`;
                html += `<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">📍 (${prop.q}, ${prop.r}) ${statusLabel}</div>`;
                if (prop.produces) {
                    const storage = prop.storage || 0;
                    html += `<div style="font-size:11px;margin-top:2px;">📦 ${prop.produces}: ${storage} stored · +${prop.productionRate || 0}/day</div>`;
                }
                html += `</div>`;
                html += `<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;">`;
                if (isHere) {
                    html += `<span style="font-size:11px;color:#27ae60;font-style:italic;">You are here</span>`;
                } else {
                    html += `<button onclick="window._travelToProperty(${prop.q},${prop.r})" style="font-size:11px;padding:3px 8px;">🧭 Travel Here</button>`;
                }
                html += `</div>`;
                html += `</div>`;
                html += `</div>`;
            }
        }

        html += '</div>';

        this.showCustomPanel('🏠 My Properties', html);

        window._travelToProperty = (q, r) => {
            this.hideCustomPanel();
            const moved = this.game.player.moveTo(q, r, this.game.world);
            if (moved) {
                this.game.renderer.reachableHexes = this.game.player.getReachableHexes(this.game.world);
                const dest = this.game.world.getTile(q, r);
                const destName = dest?.settlement?.name || `(${q}, ${r})`;
                this.showNotification('🧭 Travelling', `Heading to ${destName}...`, 'info');
            } else {
                this.showNotification('Cannot Travel', 'No path to that location.', 'error');
            }
        };
    },

    // ============================================
    // MAP MODES & DATA VISUALIZATION
    // ============================================
    /**
     * Toggle the map mode selector dropdown
     */
    showMapModeSelector() {
        const existing = document.getElementById('mapModeDropdown');
        if (existing) {
            existing.remove();
            return;
        }

        const modes = [
            { id: 'normal',    icon: '🗺️', label: 'Normal',    desc: 'Default terrain view' },
            { id: 'political', icon: '🏰', label: 'Political',  desc: 'Kingdom territories' },
            { id: 'religion',  icon: '🙏', label: 'Religion',   desc: 'Faith distribution' },
            { id: 'wealth',    icon: '💰', label: 'Wealth',     desc: 'Economic output' },
            { id: 'military',  icon: '⚔️', label: 'Military',  desc: 'Army strength' },
            { id: 'trade',     icon: '🐪', label: 'Trade',      desc: 'Routes & resources' },
            { id: 'prices',    icon: '📈', label: 'Trade Map',  desc: 'Known prices of a good (G: next good)' },
            { id: 'culture',   icon: '🎭', label: 'Culture',    desc: 'Cultural influence' },
        ];

        const currentMode = this.game.renderer.mapMode;

        const dropdown = document.createElement('div');
        dropdown.id = 'mapModeDropdown';
        dropdown.style.cssText = `
            position: fixed;
            top: 52px;
            right: 10px;
            background: rgba(12, 18, 32, 0.96);
            backdrop-filter: blur(12px);
            border: 1px solid var(--gold);
            border-radius: 8px;
            padding: 8px 0;
            z-index: 500;
            min-width: 200px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.7);
        `;

        let html = `<div style="padding: 4px 14px 8px; font-family: var(--font-display); color: var(--gold); font-size: 13px; border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 4px;">Map Mode</div>`;

        for (const m of modes) {
            const active = m.id === currentMode;
            html += `<div class="map-mode-option${active ? ' active' : ''}" data-mode="${m.id}" style="
                display: flex; align-items: center; gap: 10px; padding: 8px 14px; cursor: pointer;
                background: ${active ? 'rgba(245,197,66,0.12)' : 'transparent'};
                border-left: 3px solid ${active ? 'var(--gold)' : 'transparent'};
                transition: background 0.15s;
            ">
                <span style="font-size: 18px;">${m.icon}</span>
                <div>
                    <div style="color: ${active ? 'var(--gold)' : 'var(--text-primary)'}; font-size: 13px; font-weight: ${active ? 'bold' : 'normal'};">${m.label}</div>
                    <div style="color: var(--text-secondary); font-size: 11px;">${m.desc}</div>
                </div>
            </div>`;
        }

        // Extra buttons for data panels
        html += `<div style="border-top: 1px solid rgba(255,255,255,0.08); margin-top: 4px; padding-top: 4px;">`;
        html += `<div class="map-mode-option" data-action="graphs" style="display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;">
            <span style="font-size:18px;">📊</span>
            <div>
                <div style="color:var(--text-primary);font-size:13px;">Economic Trends</div>
                <div style="color:var(--text-secondary);font-size:11px;">Graphs & kingdom stats</div>
            </div>
        </div>`;
        html += `<div class="map-mode-option" data-action="eventlog" style="display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;">
            <span style="font-size:18px;">📜</span>
            <div>
                <div style="color:var(--text-primary);font-size:13px;">Event Log</div>
                <div style="color:var(--text-secondary);font-size:11px;">Major world events</div>
            </div>
        </div>`;
        html += `<div class="map-mode-option" data-action="ledger" style="display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;">
            <span style="font-size:18px;">📒</span>
            <div>
                <div style="color:var(--text-primary);font-size:13px;">Merchant's Ledger</div>
                <div style="color:var(--text-secondary);font-size:11px;">Known prices, spreads, your trading</div>
            </div>
        </div>`;
        html += `<div class="map-mode-option" data-action="economy" style="display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;">
            <span style="font-size:18px;">📰</span>
            <div>
                <div style="color:var(--text-primary);font-size:13px;">Economic Chronicle</div>
                <div style="color:var(--text-secondary);font-size:11px;">Realms' prices, fashions, your worth</div>
            </div>
        </div>`;
        html += `<div class="map-mode-option" data-action="compare" style="display:flex;align-items:center;gap:10px;padding:8px 14px;cursor:pointer;">
            <span style="font-size:18px;">⚖️</span>
            <div>
                <div style="color:var(--text-primary);font-size:13px;">Kingdom Comparison</div>
                <div style="color:var(--text-secondary);font-size:11px;">Side-by-side analysis</div>
            </div>
        </div>`;
        html += `</div>`;

        dropdown.innerHTML = html;
        document.body.appendChild(dropdown);

        // Event handlers
        dropdown.querySelectorAll('.map-mode-option').forEach(el => {
            el.addEventListener('mouseenter', () => el.style.background = 'rgba(245,197,66,0.08)');
            el.addEventListener('mouseleave', () => {
                const isActive = el.dataset.mode === currentMode;
                el.style.background = isActive ? 'rgba(245,197,66,0.12)' : 'transparent';
            });

            el.addEventListener('click', () => {
                if (el.dataset.mode) {
                    this.setMapMode(el.dataset.mode);
                } else if (el.dataset.action === 'graphs') {
                    this.showEconomicTrends();
                } else if (el.dataset.action === 'eventlog') {
                    this.showEventLog();
                } else if (el.dataset.action === 'ledger') {
                    ActionMenu.showMerchantLedger(this.game);
                } else if (el.dataset.action === 'economy') {
                    ActionMenu.showEconomy(this.game);
                } else if (el.dataset.action === 'compare') {
                    this.showKingdomComparison();
                }
                dropdown.remove();
            });
        });

        // Close on click outside
        setTimeout(() => {
            const closeHandler = (e) => {
                if (!dropdown.contains(e.target) && e.target.id !== 'btnMapModes') {
                    dropdown.remove();
                    document.removeEventListener('click', closeHandler);
                }
            };
            document.addEventListener('click', closeHandler);
        }, 10);
    },

    /**
     * Set the active map mode
     */
    setMapMode(mode) {
        this.game.renderer.mapMode = mode;
        // Force minimap redraw
        if (this.game.minimap) this.game.minimap.invalidate();

        const labels = {
            normal: 'Normal', political: 'Political', religion: 'Religion',
            wealth: 'Wealth', military: 'Military', trade: 'Trade Routes', prices: 'Trade Map (known prices)', culture: 'Culture'
        };
        this.showNotification('Map Mode', `${labels[mode] || mode} view active`, 'info');

        // Update button indicator
        const btn = document.getElementById('btnMapModes');
        if (btn) {
            btn.style.borderBottom = mode !== 'normal' ? '2px solid var(--gold)' : 'none';
        }
    },

    /**
     * Show economic trends with canvas-drawn sparkline graphs
     */
    showEconomicTrends() {
        const world = this.game.world;
        const player = this.game.player;

        // Collect kingdom economic data
        const kingdoms = world.kingdoms.filter(k => k.isAlive);

        // Build kingdom summary table
        let kingdomRows = '';
        for (const k of kingdoms) {
            const popStr = Utils.formatNumber(k.population);
            const milStr = Utils.formatNumber(k.military);
            const treasuryStr = Utils.formatNumber(k.treasury);
            const territories = k.territory.length;
            const faithName = k.religion ? (Religion.FAITHS[k.religion.faithId]?.name || 'Unknown') : 'None';
            const cultureInf = k.cultureData ? Math.round(k.cultureData.influence) : 0;

            kingdomRows += `<tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                <td style="padding:8px;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${k.color};margin-right:6px;"></span>${k.name}</td>
                <td style="padding:8px;text-align:right;">${popStr}</td>
                <td style="padding:8px;text-align:right;color:#e74c3c;">${milStr}</td>
                <td style="padding:8px;text-align:right;color:#f5c542;">${treasuryStr}</td>
                <td style="padding:8px;text-align:right;">${territories}</td>
                <td style="padding:8px;text-align:right;">${cultureInf}%</td>
            </tr>`;
        }

        // Player finance sparkline
        const history = player.financeHistory || [];
        let sparklineHtml = '';
        if (history.length > 1) {
            sparklineHtml = `
                <div style="margin-top:16px;">
                    <div class="info-section-title">Your Financial Trends (Last ${history.length} days)</div>
                    <canvas id="financeSparkline" width="520" height="160" style="width:100%;height:160px;border-radius:6px;background:rgba(0,0,0,0.3);margin-top:8px;"></canvas>
                    <div style="display:flex;gap:16px;margin-top:6px;font-size:11px;">
                        <span style="color:#27ae60;">● Gold Balance</span>
                        <span style="color:#3498db;">● Daily Income</span>
                        <span style="color:#e74c3c;">● Daily Expenses</span>
                    </div>
                </div>`;
        }

        // Market price trends
        let marketHtml = '';
        if (typeof MarketDynamics !== 'undefined') {
            const summary = MarketDynamics.getMarketSummary(player.q, player.r, world);
            if (Array.isArray(summary) && summary.length) {
                let priceRows = '';
                for (const data of summary) {
                    const trendIcon = data.trend === 'rising' ? '📈' : data.trend === 'falling' ? '📉' : '➡️';
                    const trendColor = data.trend === 'rising' ? '#e74c3c' : data.trend === 'falling' ? '#27ae60' : 'var(--text-secondary)';
                    priceRows += `<tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                        <td style="padding:6px;">${data.icon || ''} ${data.name || data.id}${data.label ? ` <span style="color:${data.color};font-size:10px;">${data.label}</span>` : ''}</td>
                        <td style="padding:6px;text-align:right;color:var(--gold);">${Math.round(data.price || data.currentPrice || 0)}</td>
                        <td style="padding:6px;text-align:right;color:${trendColor};">${trendIcon} ${data.trend || 'stable'}</td>
                    </tr>`;
                }
                if (priceRows) {
                    marketHtml = `
                        <div style="margin-top:16px;">
                            <div class="info-section-title">Market Prices Near You</div>
                            <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;">
                                <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.15);">
                                    <th style="text-align:left;padding:6px;color:var(--text-secondary);">Good</th>
                                    <th style="text-align:right;padding:6px;color:var(--text-secondary);">Price</th>
                                    <th style="text-align:right;padding:6px;color:var(--text-secondary);">Trend</th>
                                </tr></thead>
                                <tbody>${priceRows}</tbody>
                            </table>
                        </div>`;
                }
            }
        }

        const html = `
            <div class="info-section-title">Kingdom Economic Overview</div>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:12px;">
                    <thead><tr style="border-bottom:1px solid rgba(255,255,255,0.15);">
                        <th style="text-align:left;padding:8px;color:var(--text-secondary);">Kingdom</th>
                        <th style="text-align:right;padding:8px;color:var(--text-secondary);">Pop.</th>
                        <th style="text-align:right;padding:8px;color:var(--text-secondary);">Military</th>
                        <th style="text-align:right;padding:8px;color:var(--text-secondary);">Treasury</th>
                        <th style="text-align:right;padding:8px;color:var(--text-secondary);">Tiles</th>
                        <th style="text-align:right;padding:8px;color:var(--text-secondary);">Culture</th>
                    </tr></thead>
                    <tbody>${kingdomRows}</tbody>
                </table>
            </div>
            ${sparklineHtml}
            ${marketHtml}
        `;

        this.showCustomPanel('📊 Economic Trends', html);

        // Draw sparkline after DOM is ready
        if (history.length > 1) {
            setTimeout(() => this.drawFinanceSparkline(history), 50);
        }
    },

    /**
     * Draw finance sparkline chart on a canvas element
     */
    drawFinanceSparkline(history) {
        const canvas = document.getElementById('financeSparkline');
        if (!canvas) return;

        // Set high-DPI resolution
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        const w = rect.width;
        const h = rect.height;
        const pad = { top: 10, right: 10, bottom: 24, left: 50 };
        const plotW = w - pad.left - pad.right;
        const plotH = h - pad.top - pad.bottom;

        // Extract data series
        const goldData = history.map(d => d.gold);
        const incomeData = history.map(d => d.totalIncome || 0);
        const expenseData = history.map(d => d.totalExpenses || 0);

        const allValues = [...goldData, ...incomeData, ...expenseData];
        const maxVal = Math.max(...allValues, 1);
        const minVal = Math.min(...allValues, 0);
        const range = maxVal - minVal || 1;

        // Grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = pad.top + (plotH * i / 4);
            ctx.beginPath();
            ctx.moveTo(pad.left, y);
            ctx.lineTo(w - pad.right, y);
            ctx.stroke();

            // Labels
            const val = maxVal - (range * i / 4);
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(Math.round(val), pad.left - 6, y + 4);
        }

        // X-axis labels
        const step = Math.max(1, Math.floor(history.length / 6));
        for (let i = 0; i < history.length; i += step) {
            const x = pad.left + (plotW * i / (history.length - 1));
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`D${history[i].day || i + 1}`, x, h - 6);
        }

        // Helper: draw line
        const drawLine = (data, color, lineWidth = 2) => {
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            for (let i = 0; i < data.length; i++) {
                const x = pad.left + (plotW * i / Math.max(1, data.length - 1));
                const y = pad.top + plotH - (plotH * (data[i] - minVal) / range);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        };

        drawLine(goldData, '#27ae60', 2.5);
        drawLine(incomeData, '#3498db', 1.5);
        drawLine(expenseData, '#e74c3c', 1.5);
    },

    /**
     * Show detailed event log panel
     */
    showEventLog() {
        const world = this.game.world;
        const events = world.events || [];
        const history = world.history || [];

        // Combine and sort
        const allEvents = [];

        // Current game events
        for (const ev of events) {
            allEvents.push({
                day: ev.day || world.day,
                year: ev.year || world.year,
                category: ev.category || 'GENERAL',
                text: ev.text || ev.description || JSON.stringify(ev),
                kingdom: ev.kingdom || null,
                impact: ev.impact || null,
            });
        }

        // Historical events
        for (const h of history) {
            allEvents.push({
                day: 0,
                year: h.year || 0,
                category: 'HISTORY',
                text: h.text || '',
                kingdom: h.kingdom || null,
                impact: null,
            });
        }

        // Sort: recent first
        allEvents.sort((a, b) => {
            if (b.year !== a.year) return b.year - a.year;
            return (b.day || 0) - (a.day || 0);
        });

        // Category colors
        const catColors = {
            POLITICAL: '#3498db',
            ECONOMIC: '#f5c542',
            MILITARY: '#e74c3c',
            NATURAL: '#27ae60',
            RELIGIOUS: '#8e44ad',
            HISTORY: '#7f8c8d',
            GENERAL: '#95a5a6',
        };

        const catIcons = {
            POLITICAL: '👑',
            ECONOMIC: '💰',
            MILITARY: '⚔️',
            NATURAL: '🌿',
            RELIGIOUS: '🙏',
            HISTORY: '📖',
            GENERAL: '📌',
        };

        // Filter tabs
        let filterHtml = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">`;
        filterHtml += `<button class="event-log-filter active" data-cat="ALL" style="padding:4px 10px;border-radius:12px;border:1px solid var(--gold);background:rgba(245,197,66,0.15);color:var(--gold);cursor:pointer;font-size:11px;">All</button>`;
        for (const [cat, color] of Object.entries(catColors)) {
            filterHtml += `<button class="event-log-filter" data-cat="${cat}" style="padding:4px 10px;border-radius:12px;border:1px solid ${color};background:transparent;color:${color};cursor:pointer;font-size:11px;">${catIcons[cat] || ''} ${cat[0] + cat.slice(1).toLowerCase()}</button>`;
        }
        filterHtml += `</div>`;

        // Event entries
        let eventsHtml = `<div id="eventLogEntries">`;
        if (allEvents.length === 0) {
            eventsHtml += `<p style="color:var(--text-secondary);text-align:center;padding:20px;">No events recorded yet.</p>`;
        } else {
            const maxShow = Math.min(allEvents.length, 150);
            for (let i = 0; i < maxShow; i++) {
                const ev = allEvents[i];
                const cat = (ev.category || 'GENERAL').toUpperCase();
                const color = catColors[cat] || '#95a5a6';
                const icon = catIcons[cat] || '📌';
                const timeStr = ev.year > 0 ? (ev.day > 0 ? `Day ${((ev.day - 1) % 30) + 1}, Year ${ev.year}` : `Year ${ev.year}`) : '';

                let impactHtml = '';
                if (ev.impact) {
                    const impacts = typeof ev.impact === 'object' ? ev.impact : {};
                    const parts = [];
                    for (const [k, v] of Object.entries(impacts)) {
                        if (typeof v === 'number') {
                            parts.push(`<span style="color:${v >= 0 ? '#27ae60' : '#e74c3c'};font-size:10px;">${k}: ${v >= 0 ? '+' : ''}${v}</span>`);
                        }
                    }
                    if (parts.length) impactHtml = `<div style="margin-top:3px;">${parts.join(' · ')}</div>`;
                }

                eventsHtml += `<div class="event-log-entry" data-category="${cat}" style="
                    padding: 8px 12px; margin-bottom: 4px; border-radius: 6px;
                    border-left: 3px solid ${color}; background: rgba(255,255,255,0.02);
                ">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-size:13px;">${icon} ${ev.text}</span>
                        <span style="color:var(--text-secondary);font-size:10px;white-space:nowrap;margin-left:8px;">${timeStr}</span>
                    </div>
                    ${impactHtml}
                </div>`;
            }
            if (allEvents.length > maxShow) {
                eventsHtml += `<p style="color:var(--text-secondary);text-align:center;font-size:11px;padding:8px;">... and ${allEvents.length - maxShow} more events</p>`;
            }
        }
        eventsHtml += `</div>`;

        const html = `
            <div style="margin-bottom:8px;color:var(--text-secondary);font-size:12px;">
                ${allEvents.length} events recorded · ${history.length} historical · ${events.length} current game
            </div>
            ${filterHtml}
            ${eventsHtml}
        `;

        this.showCustomPanel('📜 World Event Log', html);

        // Wire filter buttons
        setTimeout(() => {
            document.querySelectorAll('.event-log-filter').forEach(btn => {
                btn.addEventListener('click', () => {
                    // Toggle active
                    document.querySelectorAll('.event-log-filter').forEach(b => {
                        b.classList.remove('active');
                        b.style.background = 'transparent';
                    });
                    btn.classList.add('active');
                    btn.style.background = 'rgba(245,197,66,0.15)';

                    const cat = btn.dataset.cat;
                    document.querySelectorAll('.event-log-entry').forEach(entry => {
                        if (cat === 'ALL' || entry.dataset.category === cat) {
                            entry.style.display = 'block';
                        } else {
                            entry.style.display = 'none';
                        }
                    });
                });
            });
        }, 50);
    },

    /**
     * Show kingdom comparison panel with bar charts
     */
    showKingdomComparison() {
        const world = this.game.world;
        const kingdoms = world.kingdoms.filter(k => k.isAlive);

        if (kingdoms.length === 0) {
            this.showCustomPanel('⚖️ Kingdom Comparison', '<p style="color:var(--text-secondary);">No living kingdoms to compare.</p>');
            return;
        }

        // Gather data for comparison
        const metrics = [
            { key: 'population', label: 'Population', icon: '👥', format: v => Utils.formatNumber(v) },
            { key: 'military', label: 'Military Strength', icon: '⚔️', format: v => Utils.formatNumber(v) },
            { key: 'treasury', label: 'Treasury', icon: '💰', format: v => Utils.formatNumber(v) },
            { key: 'territory', label: 'Territory Size', icon: '🏴', format: v => v },
            { key: 'settlements', label: 'Settlements', icon: '🏘️', format: v => v },
            { key: 'piety', label: 'Piety', icon: '🙏', format: v => Math.round(v) },
            { key: 'culture', label: 'Cultural Influence', icon: '🎭', format: v => Math.round(v) + '%' },
            { key: 'scholarship', label: 'Scholarship', icon: '📚', format: v => Math.round(v) },
        ];

        // Build data
        const data = kingdoms.map(k => {
            // Count settlements
            let settlementCount = 0;
            for (const t of k.territory) {
                const tile = world.getTile(t.q, t.r);
                if (tile && tile.settlement) settlementCount++;
            }

            return {
                kingdom: k,
                population: k.population,
                military: k.military,
                treasury: k.treasury,
                territory: k.territory.length,
                settlements: settlementCount,
                piety: k.religion ? (k.religion.piety || 0) : 0,
                culture: k.cultureData ? (k.cultureData.influence || 0) : 0,
                scholarship: k.cultureData ? (k.cultureData.scholarship || 0) : 0,
            };
        });

        let html = '';

        // Radar-style summary with bar charts per metric
        for (const metric of metrics) {
            const values = data.map(d => d[metric.key]);
            const maxVal = Math.max(...values, 1);

            html += `<div style="margin-bottom:16px;">
                <div class="info-section-title" style="font-size:12px;">${metric.icon} ${metric.label}</div>`;

            for (let i = 0; i < data.length; i++) {
                const d = data[i];
                const k = d.kingdom;
                const val = d[metric.key];
                const pct = Math.round((val / maxVal) * 100);

                html += `<div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
                    <span style="width:100px;font-size:11px;color:var(--text-secondary);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${k.name}">${k.name.split(' ').pop()}</span>
                    <div style="flex:1;height:18px;background:rgba(255,255,255,0.05);border-radius:9px;overflow:hidden;position:relative;">
                        <div style="height:100%;width:${pct}%;background:${k.color};border-radius:9px;transition:width 0.3s;"></div>
                    </div>
                    <span style="width:60px;font-size:11px;color:var(--text-primary);text-align:right;">${metric.format(val)}</span>
                </div>`;
            }

            html += `</div>`;
        }

        // Diplomatic relations matrix
        html += `<div style="margin-top:16px;">
            <div class="info-section-title" style="font-size:12px;">🤝 Diplomatic Relations</div>
            <div style="overflow-x:auto;margin-top:8px;">
                <table style="border-collapse:collapse;font-size:11px;width:100%;">
                    <thead><tr>
                        <th style="padding:4px;"></th>`;

        for (const k of kingdoms) {
            html += `<th style="padding:4px;color:${k.color};text-align:center;font-size:10px;" title="${k.name}">${k.name.split(' ').pop().substring(0, 5)}</th>`;
        }
        html += `</tr></thead><tbody>`;

        for (const k1 of kingdoms) {
            html += `<tr><td style="padding:4px;color:${k1.color};font-size:10px;" title="${k1.name}">${k1.name.split(' ').pop().substring(0, 7)}</td>`;
            for (const k2 of kingdoms) {
                if (k1.id === k2.id) {
                    html += `<td style="padding:4px;text-align:center;color:var(--text-secondary);">—</td>`;
                } else {
                    const rel = k1.relations ? (k1.relations[k2.id] || 0) : 0;
                    const relColor = rel > 30 ? '#27ae60' : rel < -30 ? '#e74c3c' : '#f5c542';
                    const atWar = k1.wars && k1.wars.includes(k2.id);
                    const allied = k1.allies && k1.allies.includes(k2.id);
                    let relText = rel.toString();
                    if (atWar) relText = '⚔️';
                    if (allied) relText = '🤝';
                    html += `<td style="padding:4px;text-align:center;color:${relColor};font-size:10px;" title="${k1.name} → ${k2.name}: ${rel}">${relText}</td>`;
                }
            }
            html += `</tr>`;
        }
        html += `</tbody></table></div></div>`;

        // Power ranking
        html += `<div style="margin-top:16px;">
            <div class="info-section-title" style="font-size:12px;">🏆 Power Ranking</div>`;

        const ranked = [...data].sort((a, b) => {
            const scoreA = a.population * 0.3 + a.military * 2 + a.treasury * 0.5 + a.territory * 10;
            const scoreB = b.population * 0.3 + b.military * 2 + b.treasury * 0.5 + b.territory * 10;
            return scoreB - scoreA;
        });

        for (let i = 0; i < ranked.length; i++) {
            const d = ranked[i];
            const k = d.kingdom;
            const score = Math.round(d.population * 0.3 + d.military * 2 + d.treasury * 0.5 + d.territory * 10);
            const medals = ['🥇', '🥈', '🥉', '4th', '5th'];

            html += `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
                <span style="font-size:16px;min-width:24px;text-align:center;">${medals[i] || (i+1)+'th'}</span>
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${k.color};"></span>
                <span style="flex:1;color:var(--text-primary);font-size:12px;">${k.name}</span>
                <span style="color:var(--gold);font-size:12px;font-weight:bold;">${Utils.formatNumber(score)} pts</span>
            </div>`;
        }
        html += `</div>`;

        this.showCustomPanel('⚖️ Kingdom Comparison', html);
    },

    /**
     * Apply loaded settings to game systems
     */
    applySettings(settings) {
        if (!settings) settings = UI.loadSettings();

        // Auto-save interval
        SaveLoad.AUTO_SAVE_INTERVAL = settings.autoSaveEnabled ? settings.autoSaveInterval : 0;

        // Renderer display
        if (this.game.renderer) {
            this.game.renderer.showResources = settings.showResources;
            this.game.renderer.showTerritories = settings.showTerritories;
            this.game.renderer.mapMode = settings.defaultMapMode;

            // Update toggle button states in the UI
            const resEl = document.getElementById('resourceToggleState');
            if (resEl) {
                resEl.textContent = settings.showResources ? 'ON' : 'OFF';
                resEl.classList.toggle('on', settings.showResources);
            }
            const bordEl = document.getElementById('borderToggleState');
            if (bordEl) {
                bordEl.textContent = settings.showTerritories ? 'ON' : 'OFF';
                bordEl.classList.toggle('on', settings.showTerritories);
            }
        }

        // Camera
        if (this.game.camera) {
            this.game.camera.smoothSpeed = settings.cameraSmoothSpeed;
            this.game.camera.minZoom = settings.minZoom;
            this.game.camera.maxZoom = settings.maxZoom;
            this.game.camera.panSpeedBase = settings.panSpeed;
            this.game.camera.zoomStep = settings.zoomSensitivity;
        }

        // Inner map camera (apply same settings)
        if (this.game.innerMapCamera) {
            this.game.innerMapCamera.smoothSpeed = settings.cameraSmoothSpeed;
            this.game.innerMapCamera.minZoom = settings.minZoom;
            this.game.innerMapCamera.maxZoom = settings.maxZoom;
            this.game.innerMapCamera.panSpeedBase = settings.panSpeed;
            this.game.innerMapCamera.zoomStep = settings.zoomSensitivity;
        }

        // Interface size (zooms all HUD chrome; ui/uiScale.js)
        applyUiScale(settings.uiScale);

        // Minimap
        const minimap = document.getElementById('minimapCanvas');
        if (minimap) {
            minimap.parentElement.style.display = settings.showMinimap ? '' : 'none';
        }

        // Day counter
        const dayCounter = document.getElementById('dayCounter');
        if (dayCounter) {
            dayCounter.style.display = settings.showDayCounter ? '' : 'none';
        }

        // Store notification duration for use in showNotification
        this._notifDuration = (settings.notificationDuration || 4) * 1000;
        this._confirmEndDay = settings.confirmEndDay || false;
        // The Steward's Counsel morning brief (ui/actionMenu/counsel.js)
        this._morningBrief = settings.morningBrief !== false;
        // Heralds' proclamations and overheard town talk (systems/heralds.js, systems/chatter.js)
        this._heralds = settings.heralds !== false;
        this._townChatter = settings.townChatter !== false;

        // Wire (or unwire) the local LLM NPC brain per settings.
        if (typeof NpcBrain !== 'undefined') {
            NpcBrain.applyFromSettings(settings, House);
        }
    },

    /**
     * Show the in-game settings panel
     */
    showSettingsPanel() {
        const s = UI.loadSettings();

        const mapModeOptions = [
            { value: 'normal', label: 'Normal' },
            { value: 'political', label: 'Political' },
            { value: 'religion', label: 'Religion' },
            { value: 'wealth', label: 'Wealth' },
            { value: 'military', label: 'Military' },
            { value: 'trade', label: 'Trade' },
            { value: 'culture', label: 'Culture' },
        ];
        const mapModeSelect = mapModeOptions.map(o =>
            `<option value="${o.value}" ${s.defaultMapMode === o.value ? 'selected' : ''}>${o.label}</option>`
        ).join('');

        const uiScaleSelect = UI_SCALE_OPTIONS.map(o =>
            `<option value="${o.value}" ${String(s.uiScale) === o.value ? 'selected' : ''}>${o.label}</option>`
        ).join('');

        const html = `
        <div class="game-settings-panel">
            <!-- Gameplay -->
            <div class="gs-section">
                <div class="gs-section-title">Gameplay</div>
                <div class="gs-row">
                    <label>Auto-Save</label>
                    <label class="gs-toggle">
                        <input type="checkbox" id="gsAutoSave" ${s.autoSaveEnabled ? 'checked' : ''}>
                        <span class="gs-toggle-slider"></span>
                    </label>
                </div>
                <div class="gs-row" id="gsAutoSaveIntervalRow" style="${s.autoSaveEnabled ? '' : 'opacity:0.4;pointer-events:none'}">
                    <label>Auto-Save Interval</label>
                    <div class="gs-range-group">
                        <input type="range" id="gsAutoSaveInterval" min="1" max="30" value="${s.autoSaveInterval}">
                        <span class="gs-range-val" id="gsAutoSaveIntervalVal">${s.autoSaveInterval} days</span>
                    </div>
                </div>
                <div class="gs-row">
                    <label>Confirm End Day</label>
                    <label class="gs-toggle">
                        <input type="checkbox" id="gsConfirmEndDay" ${s.confirmEndDay ? 'checked' : ''}>
                        <span class="gs-toggle-slider"></span>
                    </label>
                </div>
                <div class="gs-row">
                    <label title="One notification each new day with the Steward's top three matters">Steward's Morning Brief</label>
                    <label class="gs-toggle">
                        <input type="checkbox" id="gsMorningBrief" ${s.morningBrief !== false ? 'checked' : ''}>
                        <span class="gs-toggle-slider"></span>
                    </label>
                </div>
                <div class="gs-row">
                    <label>Heralds' Proclamations<br><span style="font-size:10px;color:var(--text-secondary);">Great news cried as it reaches you</span></label>
                    <label class="gs-toggle">
                        <input type="checkbox" id="gsHeralds" ${s.heralds !== false ? 'checked' : ''}>
                        <span class="gs-toggle-slider"></span>
                    </label>
                </div>
                <div class="gs-row">
                    <label>Overheard Town Talk<br><span style="font-size:10px;color:var(--text-secondary);">A passer-by's remark on arriving in a town</span></label>
                    <label class="gs-toggle">
                        <input type="checkbox" id="gsTownChatter" ${s.townChatter !== false ? 'checked' : ''}>
                        <span class="gs-toggle-slider"></span>
                    </label>
                </div>
                <div class="gs-row">
                    <label>Notification Duration</label>
                    <div class="gs-range-group">
                        <input type="range" id="gsNotifDuration" min="1" max="10" value="${s.notificationDuration}">
                        <span class="gs-range-val" id="gsNotifDurationVal">${s.notificationDuration}s</span>
                    </div>
                </div>
            </div>

            <!-- AI Brain (Experimental) -->
            <div class="gs-section">
                <div class="gs-section-title">AI Brain (Experimental)</div>
                <div class="gs-row">
                    <label>Enable Local LLM NPCs<br><span style="font-size:10px;color:var(--text-secondary);">Requires a local llama-server. Falls back safely when off/offline.</span></label>
                    <label class="gs-toggle">
                        <input type="checkbox" id="gsLlmEnabled" ${s.llmEnabled ? 'checked' : ''}>
                        <span class="gs-toggle-slider"></span>
                    </label>
                </div>
                <div class="gs-row">
                    <label>Server Endpoint</label>
                    <input type="text" id="gsLlmEndpoint" value="${s.llmEndpoint || 'http://127.0.0.1:8080'}" style="flex:1;min-width:0;padding:4px 6px;">
                </div>
                <div class="gs-row">
                    <label>Model</label>
                    <input type="text" id="gsLlmModel" value="${s.llmModel || 'local'}" style="flex:1;min-width:0;padding:4px 6px;">
                </div>
                <div class="gs-row">
                    <label>Temperature</label>
                    <div class="gs-range-group">
                        <input type="range" id="gsLlmTemperature" min="0" max="1.5" step="0.05" value="${s.llmTemperature != null ? s.llmTemperature : 0.7}">
                        <span class="gs-range-val" id="gsLlmTemperatureVal">${s.llmTemperature != null ? s.llmTemperature : 0.7}</span>
                    </div>
                </div>
                <div class="gs-row">
                    <button class="gs-btn" id="gsLlmTest" style="flex:1;">🔌 Test Connection</button>
                </div>
                <div class="gs-row">
                    <div id="gsLlmTestResult" style="font-size:11px;color:var(--text-secondary);min-height:14px;flex:1;word-break:break-word;"></div>
                </div>
            </div>

            <!-- Display -->
            <div class="gs-section">
                <div class="gs-section-title">Display</div>
                <div class="gs-row">
                    <label>Interface Size<br><span style="font-size:10px;color:var(--text-secondary);">Scales menus, panels and the HUD; Auto fits your screen</span></label>
                    <select id="gsUiScale" class="gs-select">${uiScaleSelect}</select>
                </div>
                <div class="gs-row">
                    <label>Show Resources</label>
                    <label class="gs-toggle">
                        <input type="checkbox" id="gsShowResources" ${s.showResources ? 'checked' : ''}>
                        <span class="gs-toggle-slider"></span>
                    </label>
                </div>
                <div class="gs-row">
                    <label>Show Kingdom Borders</label>
                    <label class="gs-toggle">
                        <input type="checkbox" id="gsShowTerritories" ${s.showTerritories ? 'checked' : ''}>
                        <span class="gs-toggle-slider"></span>
                    </label>
                </div>
                <div class="gs-row">
                    <label>Default Map Mode</label>
                    <select id="gsDefaultMapMode" class="gs-select">${mapModeSelect}</select>
                </div>
                <div class="gs-row">
                    <label>Show Minimap</label>
                    <label class="gs-toggle">
                        <input type="checkbox" id="gsShowMinimap" ${s.showMinimap ? 'checked' : ''}>
                        <span class="gs-toggle-slider"></span>
                    </label>
                </div>
                <div class="gs-row">
                    <label>Show Day Counter</label>
                    <label class="gs-toggle">
                        <input type="checkbox" id="gsShowDayCounter" ${s.showDayCounter ? 'checked' : ''}>
                        <span class="gs-toggle-slider"></span>
                    </label>
                </div>
            </div>

            <!-- Camera -->
            <div class="gs-section">
                <div class="gs-section-title">Camera</div>
                <div class="gs-row">
                    <label>Scroll Speed</label>
                    <div class="gs-range-group">
                        <input type="range" id="gsPanSpeed" min="100" max="800" step="50" value="${s.panSpeed}">
                        <span class="gs-range-val" id="gsPanSpeedVal">${s.panSpeed}</span>
                    </div>
                </div>
                <div class="gs-row">
                    <label>Camera Smoothing</label>
                    <div class="gs-range-group">
                        <input type="range" id="gsSmoothSpeed" min="1" max="20" value="${s.cameraSmoothSpeed}">
                        <span class="gs-range-val" id="gsSmoothSpeedVal">${s.cameraSmoothSpeed}</span>
                    </div>
                </div>
                <div class="gs-row">
                    <label>Zoom Sensitivity</label>
                    <div class="gs-range-group">
                        <input type="range" id="gsZoomSens" min="0.05" max="0.3" step="0.05" value="${s.zoomSensitivity}">
                        <span class="gs-range-val" id="gsZoomSensVal">${s.zoomSensitivity}</span>
                    </div>
                </div>
                <div class="gs-row">
                    <label>Min Zoom</label>
                    <div class="gs-range-group">
                        <input type="range" id="gsMinZoom" min="0.2" max="0.8" step="0.05" value="${s.minZoom}">
                        <span class="gs-range-val" id="gsMinZoomVal">${s.minZoom}</span>
                    </div>
                </div>
                <div class="gs-row">
                    <label>Max Zoom</label>
                    <div class="gs-range-group">
                        <input type="range" id="gsMaxZoom" min="1.0" max="3.0" step="0.1" value="${s.maxZoom}">
                        <span class="gs-range-val" id="gsMaxZoomVal">${s.maxZoom}</span>
                    </div>
                </div>
            </div>

            <!-- Data Management -->
            <div class="gs-section">
                <div class="gs-section-title">Audio</div>
                <div class="gs-row">
                    <label>Master Volume</label>
                    <div class="gs-range-group">
                        <input type="range" id="gsAudioMaster" min="0" max="100" value="${Math.round((typeof audioManager !== 'undefined' ? audioManager.masterVolume : 0.5) * 100)}">
                        <span class="gs-range-val" id="gsAudioMasterVal">${Math.round((typeof audioManager !== 'undefined' ? audioManager.masterVolume : 0.5) * 100)}%</span>
                    </div>
                </div>
                <div class="gs-row">
                    <label>Music Volume</label>
                    <div class="gs-range-group">
                        <input type="range" id="gsAudioMusic" min="0" max="100" value="${Math.round((typeof audioManager !== 'undefined' ? audioManager.musicVolume : 0.6) * 100)}">
                        <span class="gs-range-val" id="gsAudioMusicVal">${Math.round((typeof audioManager !== 'undefined' ? audioManager.musicVolume : 0.6) * 100)}%</span>
                    </div>
                </div>
                <div class="gs-row">
                    <label>Ambience Volume</label>
                    <div class="gs-range-group">
                        <input type="range" id="gsAudioAmbience" min="0" max="100" value="${Math.round((typeof audioManager !== 'undefined' ? audioManager.ambienceVolume : 0.4) * 100)}">
                        <span class="gs-range-val" id="gsAudioAmbienceVal">${Math.round((typeof audioManager !== 'undefined' ? audioManager.ambienceVolume : 0.4) * 100)}%</span>
                    </div>
                </div>
                <div class="gs-row">
                    <label>SFX Volume</label>
                    <div class="gs-range-group">
                        <input type="range" id="gsAudioSfx" min="0" max="100" value="${Math.round((typeof audioManager !== 'undefined' ? audioManager.sfxVolume : 0.7) * 100)}">
                        <span class="gs-range-val" id="gsAudioSfxVal">${Math.round((typeof audioManager !== 'undefined' ? audioManager.sfxVolume : 0.7) * 100)}%</span>
                    </div>
                </div>
                <div class="gs-row">
                    <label>Mute All</label>
                    <label class="gs-toggle">
                        <input type="checkbox" id="gsAudioMute" ${(typeof audioManager !== 'undefined' && audioManager.muted) ? 'checked' : ''}>
                        <span class="gs-toggle-slider"></span>
                    </label>
                </div>
            </div>

            <!-- Data Management -->
            <div class="gs-section">
                <div class="gs-section-title">Data</div>
                <div class="gs-row gs-btn-row">
                    <button class="gs-btn" id="gsSaveNow">💾 Save Now</button>
                    <button class="gs-btn" id="gsExport">📤 Export Save</button>
                    <button class="gs-btn" id="gsImport">📥 Import Save</button>
                </div>
            </div>

            <!-- Actions -->
            <div class="gs-actions">
                <button class="gs-btn gs-btn-secondary" id="gsResetDefaults">Reset Defaults</button>
                <button class="gs-btn gs-btn-danger" id="gsMainMenu" style="background:#7a2a2a;color:#fff;border:1px solid #a33;">🏠 Main Menu</button>
                <button class="gs-btn gs-btn-primary" id="gsApply">Apply & Close</button>
            </div>
        </div>`;

        this.showCustomPanel('⚙️ Settings', html);

        // Wait a tick for DOM to render, then bind events
        requestAnimationFrame(() => this._bindSettingsEvents());
    },

    /**
     * Bind all interactive events inside the settings panel
     */
    _bindSettingsEvents() {
        // Range sliders — live value display
        const rangeBindings = [
            { id: 'gsAutoSaveInterval', valId: 'gsAutoSaveIntervalVal', suffix: ' days' },
            { id: 'gsNotifDuration', valId: 'gsNotifDurationVal', suffix: 's' },
            { id: 'gsPanSpeed', valId: 'gsPanSpeedVal', suffix: '' },
            { id: 'gsSmoothSpeed', valId: 'gsSmoothSpeedVal', suffix: '' },
            { id: 'gsZoomSens', valId: 'gsZoomSensVal', suffix: '' },
            { id: 'gsMinZoom', valId: 'gsMinZoomVal', suffix: '' },
            { id: 'gsMaxZoom', valId: 'gsMaxZoomVal', suffix: '' },
            { id: 'gsAudioMaster', valId: 'gsAudioMasterVal', suffix: '%' },
            { id: 'gsAudioMusic', valId: 'gsAudioMusicVal', suffix: '%' },
            { id: 'gsAudioAmbience', valId: 'gsAudioAmbienceVal', suffix: '%' },
            { id: 'gsAudioSfx', valId: 'gsAudioSfxVal', suffix: '%' },
            { id: 'gsLlmTemperature', valId: 'gsLlmTemperatureVal', suffix: '' },
        ];
        for (const rb of rangeBindings) {
            const el = document.getElementById(rb.id);
            const valEl = document.getElementById(rb.valId);
            if (el && valEl) {
                el.addEventListener('input', () => {
                    valEl.textContent = el.value + rb.suffix;
                });
            }
        }

        // Interface size previews live; Apply keeps it, closing without Apply reverts
        const uiScaleEl = document.getElementById('gsUiScale');
        if (uiScaleEl) {
            uiScaleEl.addEventListener('change', () => applyUiScale(uiScaleEl.value));
        }

        // Auto-save toggle enables/disables interval row
        const autoSaveCheck = document.getElementById('gsAutoSave');
        const intervalRow = document.getElementById('gsAutoSaveIntervalRow');
        if (autoSaveCheck && intervalRow) {
            autoSaveCheck.addEventListener('change', () => {
                intervalRow.style.opacity = autoSaveCheck.checked ? '1' : '0.4';
                intervalRow.style.pointerEvents = autoSaveCheck.checked ? '' : 'none';
            });
        }

        // LLM — Test Connection (uses the values currently in the inputs)
        const llmTestBtn = document.getElementById('gsLlmTest');
        if (llmTestBtn) {
            llmTestBtn.addEventListener('click', async () => {
                const resultEl = document.getElementById('gsLlmTestResult');
                const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
                const endpoint = getVal('gsLlmEndpoint') || 'http://127.0.0.1:8080';
                const model = getVal('gsLlmModel') || 'local';
                const temperature = parseFloat(getVal('gsLlmTemperature')) || 0.7;
                if (resultEl) {
                    resultEl.style.color = 'var(--text-secondary)';
                    resultEl.textContent = `⏳ Testing ${endpoint} …`;
                }
                llmTestBtn.disabled = true;
                try {
                    const r = await NpcBrain.testConnection({ endpoint, model, temperature });
                    if (resultEl) {
                        if (r.ok) {
                            resultEl.style.color = '#7fd07f';
                            resultEl.textContent = `✓ Connected — model replied: "${r.detail}"`;
                        } else {
                            resultEl.style.color = '#e08080';
                            resultEl.textContent = `✗ ${r.stage === 'health' ? 'Unreachable' : 'Query failed'}: ${r.detail}`;
                        }
                    }
                } catch (e) {
                    if (resultEl) {
                        resultEl.style.color = '#e08080';
                        resultEl.textContent = `✗ Error: ${(e && e.message) || 'unknown'}`;
                    }
                } finally {
                    llmTestBtn.disabled = false;
                }
            });
        }

        // Save Now
        const saveBtn = document.getElementById('gsSaveNow');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                const result = SaveLoad.saveGame(this.game);
                this.showNotification(result.success ? 'Saved' : 'Error',
                    result.success ? 'Game saved successfully' : 'Failed to save: ' + result.error,
                    result.success ? 'success' : 'error');
            });
        }

        // Export
        const exportBtn = document.getElementById('gsExport');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => {
                if (typeof SaveLoad.exportSave === 'function') {
                    SaveLoad.exportSave();
                    this.showNotification('Export', 'Save file downloaded', 'success');
                }
            });
        }

        // Import
        const importBtn = document.getElementById('gsImport');
        if (importBtn) {
            importBtn.addEventListener('click', () => {
                if (typeof SaveLoad.importSave === 'function') {
                    SaveLoad.importSave(this.game);
                }
            });
        }

        // Reset Defaults
        const resetBtn = document.getElementById('gsResetDefaults');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                const defaults = UI.getDefaultSettings();
                UI.saveSettings(defaults);
                this.applySettings(defaults);
                this.hideCustomPanel();
                this.showSettingsPanel(); // Reopen with defaults
                this.showNotification('Settings', 'Reset to defaults', 'info');
            });
        }

        // Main Menu
        const mainMenuBtn = document.getElementById('gsMainMenu');
        if (mainMenuBtn) {
            mainMenuBtn.addEventListener('click', () => {
                this.hideCustomPanel();
                this._showMainMenuConfirm();
            });
        }

        // Apply & Close
        const applyBtn = document.getElementById('gsApply');
        if (applyBtn) {
            applyBtn.addEventListener('click', () => {
                this._applyAndSaveSettings();
            });
        }
    },

    /**
     * Gather values from settings form, save and apply
     */
    _applyAndSaveSettings() {
        const getVal = (id) => {
            const el = document.getElementById(id);
            return el ? el.value : null;
        };
        const getChecked = (id) => {
            const el = document.getElementById(id);
            return el ? el.checked : false;
        };

        const settings = {
            autoSaveEnabled: getChecked('gsAutoSave'),
            autoSaveInterval: parseInt(getVal('gsAutoSaveInterval')) || 5,
            notificationDuration: parseInt(getVal('gsNotifDuration')) || 4,
            showResources: getChecked('gsShowResources'),
            showTerritories: getChecked('gsShowTerritories'),
            defaultMapMode: getVal('gsDefaultMapMode') || 'normal',
            uiScale: getVal('gsUiScale') || 'auto',
            cameraSmoothSpeed: parseInt(getVal('gsSmoothSpeed')) || 6,
            panSpeed: parseInt(getVal('gsPanSpeed')) || 400,
            zoomSensitivity: parseFloat(getVal('gsZoomSens')) || 0.1,
            minZoom: parseFloat(getVal('gsMinZoom')) || 0.55,
            maxZoom: parseFloat(getVal('gsMaxZoom')) || 1.5,
            showDayCounter: getChecked('gsShowDayCounter'),
            showMinimap: getChecked('gsShowMinimap'),
            confirmEndDay: getChecked('gsConfirmEndDay'),
            morningBrief: getChecked('gsMorningBrief'),
            heralds: getChecked('gsHeralds'),
            townChatter: getChecked('gsTownChatter'),
            llmEnabled: getChecked('gsLlmEnabled'),
            llmEndpoint: getVal('gsLlmEndpoint') || 'http://127.0.0.1:8080',
            llmModel: getVal('gsLlmModel') || 'local',
            llmTemperature: parseFloat(getVal('gsLlmTemperature')) || 0.7,
        };

        // Apply audio settings directly to audioManager
        if (typeof audioManager !== 'undefined') {
            audioManager.setMasterVolume((parseInt(getVal('gsAudioMaster')) || 50) / 100);
            audioManager.setMusicVolume((parseInt(getVal('gsAudioMusic')) || 60) / 100);
            audioManager.setAmbienceVolume((parseInt(getVal('gsAudioAmbience')) || 40) / 100);
            audioManager.setSfxVolume((parseInt(getVal('gsAudioSfx')) || 70) / 100);
            const shouldMute = getChecked('gsAudioMute');
            if (shouldMute !== audioManager.muted) {
                audioManager.toggleMute();
            }
            // Update mute button appearance
            const btn = document.getElementById('btnAudioToggle');
            if (btn) {
                btn.classList.toggle('muted', audioManager.muted);
                const iconSpan = btn.querySelector('.audio-icon');
                if (iconSpan) iconSpan.textContent = audioManager.muted ? '🔇' : '🔊';
            }
        }

        UI.saveSettings(settings);
        this.applySettings(settings);
        this.hideCustomPanel();
        this.showNotification('Settings', 'Settings saved', 'success');
    },
});

Object.assign(UI, {
    // ============================================
    // SETTINGS PANEL
    // ============================================
    /**
     * Get current settings with defaults
     */
    getDefaultSettings() {
        return {
            autoSaveEnabled: true,
            autoSaveInterval: 5,
            notificationDuration: 4,
            showResources: true,
            showTerritories: false,
            defaultMapMode: 'normal',
            uiScale: 'auto',
            cameraSmoothSpeed: 6,
            panSpeed: 400,
            zoomSensitivity: 0.1,
            minZoom: 0.55,
            maxZoom: 1.5,
            showDayCounter: true,
            showMinimap: true,
            confirmEndDay: false,
            morningBrief: true,
            heralds: true,
            townChatter: true,
            // Local LLM NPC brain (Spec 2) — off by default.
            llmEnabled: false,
            llmEndpoint: 'http://127.0.0.1:8080',
            llmModel: 'local',
            llmTemperature: 0.7,
        };
    },

    /**
     * Load settings from localStorage
     */
    loadSettings() {
        try {
            const json = localStorage.getItem('lord_of_realms_settings');
            if (json) {
                const saved = JSON.parse(json);
                return { ...UI.getDefaultSettings(), ...saved };
            }
        } catch (e) {
            console.warn('Failed to load settings:', e);
        }
        return UI.getDefaultSettings();
    },

    /**
     * Save settings to localStorage
     */
    saveSettings(settings) {
        try {
            localStorage.setItem('lord_of_realms_settings', JSON.stringify(settings));
            return true;
        } catch (e) {
            console.warn('Failed to save settings:', e);
            return false;
        }
    },
});
