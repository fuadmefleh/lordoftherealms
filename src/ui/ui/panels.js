// UI — panels methods.
import { UI } from './core.js';
import { Traits } from '../../systems/traits.js';
import { Ailments } from '../../systems/ailments.js';
import { Ledger } from '../../systems/ledger.js';
import { PlayerInventory, Utils, ActionMenu, Religion, Economy, PlayerEconomy, PlayerReligion, Infrastructure, Peoples, CustomObjects, Characters, Culture, Quests, Technology, Banking, MarketDynamics, Taxation, Hex, SaveLoad, audioManager, NpcFamily, Relationships, Housing, Titles, KingdomBonuses, KingdomStability, Treasures, KingdomAI, KingdomNavy } from './_imports.js';

Object.assign(UI.prototype, {
    /**
     * Toggle character panel
     */
    toggleCharacterPanel() {
        const panel = document.getElementById('characterPanel');
        if (panel.classList.contains('hidden')) {
            this.showCharacterPanel();
        } else {
            this.hidePanel('characterPanel');
        }
    },

    /**
     * Show character panel
     */
    showCharacterPanel() {
        const player = this.game.player;
        const body = document.getElementById('characterBody');

        let skillsHtml = '';
        for (const [skill, level] of Object.entries(player.skills)) {
            const barWidth = (level / 10) * 100;
            skillsHtml += `
                <div class="info-row">
                    <span class="info-label">${skill.charAt(0).toUpperCase() + skill.slice(1)}</span>
                    <span class="info-value">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <div style="width:60px; height:6px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden;">
                                <div style="width:${barWidth}%; height:100%; background:var(--gold); border-radius:3px;"></div>
                            </div>
                            <span>${level}</span>
                        </div>
                    </span>
                </div>
            `;
        }

        body.innerHTML = `
            <div style="text-align:center; margin-bottom:16px;">
                <div style="font-size:48px; margin-bottom:8px;">👤</div>
                <div style="font-family:var(--font-display); font-size:20px; color:var(--gold);">${player.name}</div>
                <div style="font-size:12px; color:var(--text-secondary);">${player.title}</div>
                <button data-ui-act="_openDeeds" data-ui-args='[]' style="margin-top:6px; font-size:11px; padding:3px 10px; border-radius:4px; border:1px solid rgba(245,197,66,0.4); background:rgba(245,197,66,0.08); color:var(--gold); cursor:pointer;">🏅 Deeds &amp; Records</button>
            </div>

            <div class="info-section-title">Vitals</div>
            <div class="info-row">
                <span class="info-label">❤️ Health</span>
                <span class="info-value">${player.health} / ${player.maxHealth}</span>
            </div>
            <div class="info-row">
                <span class="info-label">⚡ Stamina</span>
                <span class="info-value">${player.movementRemaining} / ${player.maxStamina}</span>
            </div>
            <div class="info-row">
                <span class="info-label">🎯 Action Points</span>
                <span class="info-value">${player.actionPoints != null ? player.actionPoints : 10} / ${player.maxActionPoints || 10}</span>
            </div>
            <div class="info-row">
                <span class="info-label">💰 Gold</span>
                <span class="info-value">${Utils.formatNumber(player.gold)}</span>
            </div>
            <div class="info-row">
                <span class="info-label">☯ Karma</span>
                <span class="info-value">${player.karma}</span>
            </div>
            <div class="info-row">
                <span class="info-label">⭐ Renown</span>
                <span class="info-value">${player.renown}</span>
            </div>

            <div class="info-section-title">Attributes</div>
            <div class="info-row">
                <span class="info-label">💪 Strength</span>
                <span class="info-value">${player.strength}</span>
            </div>
            <div class="info-row">
                <span class="info-label">💬 Charisma</span>
                <span class="info-value">${player.charisma}</span>
            </div>
            <div class="info-row">
                <span class="info-label">🧠 Intelligence</span>
                <span class="info-value">${player.intelligence}</span>
            </div>
            <div class="info-row">
                <span class="info-label">🙏 Faith</span>
                <span class="info-value">${player.faith}</span>
            </div>
            <div class="info-row">
                <span class="info-label">🍀 Luck</span>
                <span class="info-value">${player.luck}</span>
            </div>
            ${player.soulSoldCount ? `
            <div class="info-row" style="color: #e74c3c;">
                <span class="info-label">🔥 Soul</span>
                <span class="info-value">Sold ×${player.soulSoldCount}</span>
            </div>` : ''}
            ${player.indenturedServitude ? `
            <div class="info-row" style="color: #e67e22;">
                <span class="info-label">⛓️ Servitude</span>
                <span class="info-value">${player.indenturedServitude.daysRemaining} days under ${player.indenturedServitude.captor}</span>
            </div>` : ''}
            ${player.jailState ? `
            <div class="info-row" style="color: #e74c3c;">
                <span class="info-label">🔒 Jail</span>
                <span class="info-value">${player.jailState.daysRemaining} days (${player.jailState.offense} #${player.jailState.offenseNumber})</span>
            </div>` : ''}
            ${player.currentTitle && typeof Titles !== 'undefined' ? (() => {
                const titleDef = Titles.getActiveTitle(player);
                const dutyInfo = Titles.getDutyProgress(player);
                if (!titleDef) return '';
                return `
                <div class="info-section-title">Royal Office</div>
                <div class="info-row">
                    <span class="info-label">${titleDef.icon || '🏅'} Title</span>
                    <span class="info-value" style="color:#ffd700;">${titleDef.name}</span>
                </div>
                ${dutyInfo ? `<div class="info-row">
                    <span class="info-label">📋 Duties</span>
                    <span class="info-value">${dutyInfo.progress}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">⏰ Deadline</span>
                    <span class="info-value" style="color:${dutyInfo.daysLeft <= 5 ? '#f44336' : '#aaa'};">${dutyInfo.daysLeft} days</span>
                </div>` : ''}
                <div class="info-row">
                    <span class="info-label">💰 Salary</span>
                    <span class="info-value">${titleDef.salary} gold/day</span>
                </div>`;
            })() : ''}
            ${player.criminalRecord && (player.criminalRecord.pickpocket > 0 || player.criminalRecord.smuggling > 0) ? `
            <div class="info-row" style="color: #e67e22;">
                <span class="info-label">📋 Record</span>
                <span class="info-value">${player.criminalRecord.pickpocket > 0 ? 'Pickpocket ×' + player.criminalRecord.pickpocket : ''}${player.criminalRecord.pickpocket > 0 && player.criminalRecord.smuggling > 0 ? ', ' : ''}${player.criminalRecord.smuggling > 0 ? 'Smuggling ×' + player.criminalRecord.smuggling : ''}</span>
            </div>` : ''}

            ${this._ailmentsSectionHtml(player)}

            ${this._traitsSectionHtml(player)}

            <div class="info-section-title">Skills</div>
            ${skillsHtml}
        `;

        this.showPanel('characterPanel');
    },

    /**
     * Character-panel section: wounds and sickness (systems/ailments.js) —
     * effects, time left, and remedies from the pack.
     */
    _ailmentsSectionHtml(player) {
        const world = this.game && this.game.world;
        const info = Ailments.describe(player, world);
        const sickParty = Ailments.sickCompanions(player);
        let html = '<div class="info-section-title">Condition</div>';
        if (!info.length) {
            html += '<div style="font-size:11px; color:var(--text-secondary); padding:2px 0 6px;">Hale and whole. No wounds or sickness.</div>';
        }
        const remedies = Ailments.remediesHeld(player);
        for (const a of info) {
            const rec = Ailments.list(player).find(r => r.key === a.key);
            const usable = remedies.filter(r => Ailments.remedyFits(r.def, rec));
            const esc = (s) => String(s).replace(/"/g, '&quot;');
            html += `
                <div class="info-row" title="${esc(Ailments.tooltip(a))}" style="flex-wrap:wrap;">
                    <span class="info-label">${a.icon} ${a.name}${a.contagious ? ' <span style="color:#e67e22; font-size:10px;">contagious</span>' : ''}</span>
                    <span class="info-value" style="font-size:11px; color:#e57373;">${a.effects || ''}</span>
                    <div style="width:100%; font-size:10px; color:var(--text-secondary);">${a.timeText}${a.note ? ` — ${a.note}` : ''}</div>
                    ${usable.length ? `<div style="width:100%; display:flex; gap:4px; flex-wrap:wrap; margin:2px 0 4px;">${usable.map(r =>
                        `<button data-ui-act="_useRemedy" data-ui-args='${JSON.stringify([r.item, a.key])}' style="font-size:10px; padding:2px 6px; border-radius:3px; border:1px solid rgba(245,197,66,0.4); background:rgba(245,197,66,0.08); color:var(--gold); cursor:pointer;">Use ${r.name} (${r.qty})</button>`).join('')}</div>` : ''}
                </div>`;
        }
        if (sickParty.length) {
            for (const s of sickParty) {
                let name = 'A companion';
                try { const npc = Relationships.getNPC(s.npcId); if (npc) name = npc.firstName; } catch (e) { /* unknown */ }
                html += `<div class="info-row"><span class="info-label">🤒 ${name}</span><span class="info-value" style="font-size:11px;">${s.disease}</span></div>`;
            }
        }
        return html;
    },

    /** Character panel → Deeds & Records (ui/actionMenu/deeds.js). */
    _openDeeds() {
        if (this.game) ActionMenu.showDeeds(this.game);
    },

    /** Use a remedy from the pack on a condition (Character panel buttons). */
    _useRemedy(item, key) {
        const game = this.game;
        if (!game || !game.player) return;
        const r = Ailments.useRemedy(game.player, game.world, item, key);
        this.showNotification(r.success ? '🌿 Remedy' : '🌿 No Use', r.success ? r.message : r.reason, r.success ? 'success' : 'error');
        this.updateStats(game.player, game.world);
        this.showCharacterPanel();
    },

    /** Character-panel section: earned traits, progress toward the next, dynasty echo. */
    _traitsSectionHtml(player) {
        const info = Traits.describe(player);
        let html = '<div class="info-section-title">Traits</div>';
        if (!info.earned.length) {
            html += '<div style="font-size:11px; color:var(--text-secondary); padding:2px 0 6px;">You have not yet made a name for yourself. Your deeds will.</div>';
        }
        for (const t of info.earned) {
            const fx = Traits.effectText(t.effects);
            html += `
                <div class="info-row" title="${t.description}">
                    <span class="info-label">${t.icon} ${t.name}</span>
                    <span class="info-value" style="font-size:11px; color:var(--text-secondary);">${fx}</span>
                </div>`;
        }
        if (info.progress.length) {
            html += '<div style="font-size:11px; color:var(--text-secondary); margin-top:6px;">Becoming…</div>';
            for (const p of info.progress) {
                html += `
                <div class="info-row">
                    <span class="info-label">${p.icon} ${p.name}</span>
                    <span class="info-value">
                        <div style="display:flex; align-items:center; gap:6px;" title="${p.displaces ? `Earning it will cost you ${p.displaces}` : ''}">
                            <div style="width:60px; height:6px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden;">
                                <div style="width:${p.pct}%; height:100%; background:#9b7fd0; border-radius:3px;"></div>
                            </div>
                            <span>${p.pct}%</span>
                        </div>
                    </span>
                </div>`;
            }
        }
        if (info.echo.length) {
            html += '<div style="font-size:11px; color:var(--text-secondary); margin-top:6px;">Reputation of the dynasty</div>';
            for (const e of info.echo) {
                html += `
                <div class="info-row" title="Remembered from ${e.from || 'a past ruler'} — fades with time">
                    <span class="info-label">${e.icon} ${e.name}</span>
                    <span class="info-value" style="font-size:11px;">${Math.round(e.strength * 100)}% remembered</span>
                </div>`;
            }
        }
        return html;
    },

    /**
     * Show the Dynasties & Characters overview panel
     */
    showDynastiesPanel() {
        if (!this.game.world || typeof Characters === 'undefined') return;

        const player = this.game.player;
        let html = '';

        for (const kingdom of this.game.world.kingdoms) {
            if (!kingdom.isAlive) continue;
            const cd = kingdom.characterData;
            if (!cd) continue;

            const ruler = cd.ruler;
            if (!ruler || !ruler.isAlive) continue;

            // Gate behind ruler knowledge
            if (!player.knowsAbout(kingdom.id, 'ruler')) {
                html += `
                    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-left:3px solid ${kingdom.color};border-radius:6px;padding:12px;margin-bottom:10px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                            <span style="font-family:var(--font-display);color:var(--gold);font-size:14px;">
                                ${kingdom.name}
                            </span>
                        </div>
                        <div style="color: #95a5a6; font-style: italic; font-size: 12px;">You know nothing of this kingdom's ruling dynasty. Visit their settlements, speak with locals, or meet their lord to learn more.</div>
                    </div>
                `;
                continue;
            }

            // Trait badges
            const traitBadges = ruler.traits.map(t => {
                const colorMap = { positive: '#27ae60', negative: '#c0392b', neutral: '#f1c40f' };
                const col = colorMap[t.category] || '#9a8e7e';
                return `<span style="background:${col}22;color:${col};padding:1px 5px;border-radius:3px;font-size:10px;" title="${t.description}">${t.icon||''} ${t.name}</span>`;
            }).join(' ');

            // Heirs count
            const livingHeirs = cd.children ? cd.children.filter(c => c.isAlive && c.age >= 16).length : 0;
            const totalChildren = cd.children ? cd.children.filter(c => c.isAlive).length : 0;

            // Advisor summary
            let advisorSummary = '';
            if (cd.advisors) {
                const advisorLines = Object.entries(cd.advisors).map(([roleId, adv]) => {
                    if (!adv) return '';
                    const role = Characters.ADVISOR_ROLES[roleId];
                    const loyColor = adv.loyalty > 60 ? '#27ae60' : adv.loyalty > 30 ? '#f39c12' : '#c0392b';
                    return `<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0;">
                        <span>${role.icon} ${role.name}: ${Characters.getFullName(adv)}</span>
                        <span style="color:${loyColor}">${adv.loyalty}%</span>
                    </div>`;
                }).join('');
                advisorSummary = advisorLines;
            }

            // Kingdom bonuses from characters
            // Combined bonuses (ruler, advisors, NPC lord, culture tradition)
            // and the realm's stability — all of these feed the kingdom AI
            let bonusHtml = '';
            // The realm's own traits and the temperament they give its AI
            const traits = KingdomBonuses.describeTraits(kingdom);
            if (traits.length > 0) {
                const pid = KingdomAI.personalityId(kingdom);
                const pers = KingdomAI.PERSONALITIES[pid] || {};
                const traitBadges = traits.map(t => `<span style="background:rgba(255,255,255,0.06);padding:1px 5px;border-radius:3px;" title="${t.summary}">${t.label}</span>`).join(' ');
                bonusHtml += `<div style="font-size:10px;color:var(--text-secondary);margin-top:4px;">🏰 Realm: ${traitBadges}
                    · <span title="${pers.summary || ''}">temperament: ${pers.label || pid}</span></div>`;
                bonusHtml += `<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">${traits.filter(t => t.summary).map(t => `${t.label}: ${t.summary}`).join(' · ')}</div>`;
            }
            const bonusList = KingdomBonuses.summary(kingdom)
                .map(b => `${b.label} ${b.value > 0 ? '+' : ''}${(b.value * 100).toFixed(0)}%`);
            if (bonusList.length > 0) {
                bonusHtml = `<div style="font-size:10px;color:var(--text-secondary);margin-top:4px;">${bonusList.join(' · ')}</div>`;
            }
            // The share of those bonuses that comes from the realm's peoples
            if (kingdom.peoples && kingdom.peoples.bonuses) {
                const fromPeoples = Object.entries(kingdom.peoples.bonuses)
                    .filter(([, v]) => Math.abs(v) >= 0.005)
                    .map(([k, v]) => `${KingdomBonuses.LABELS[k] || k} ${v > 0 ? '+' : ''}${(v * 100).toFixed(0)}%`);
                if (fromPeoples.length > 0) {
                    bonusHtml += `<div style="font-size:10px;color:var(--text-secondary);margin-top:2px;" title="Population-weighted values and traits of the peoples in this realm's settlements (included above)">🏘️ From its peoples: ${fromPeoples.join(' · ')} · harmony ${kingdom.peoples.harmony}</div>`;
                }
            }
            if (typeof kingdom.stability === 'number') {
                const st = kingdom.stability;
                const target = KingdomStability.target(kingdom, this.game.world);
                const why = target.parts.map(p => `${p.label} ${p.value > 0 ? '+' : ''}${p.value}`).join(', ');
                bonusHtml += `<div style="font-size:11px;margin-top:4px;" title="Heading toward ${Math.round(target.value)}: ${why}">🏛️ Stability: <span style="color:${KingdomStability.color(st)}">${Math.round(st)}/100 (${KingdomStability.label(st)})</span> · income ×${KingdomStability.incomeMultiplier(kingdom).toFixed(2)}</div>`;
            }
            // The royal fleet and any blockade of its ports
            if (kingdom.navy && (kingdom.navy.ports || kingdom.navy.strength)) {
                const n = kingdom.navy;
                const by = KingdomNavy.blockaders(kingdom).map(id => (this.game.world.getKingdom(id) || {}).name || id);
                bonusHtml += `<div style="font-size:11px;margin-top:2px;" title="Fleet strength / what its ports and treasury keep afloat">⚓ Fleet: ${n.strength}/${n.cap} · ${n.ports} port${n.ports === 1 ? '' : 's'}${by.length ? ` · <span style="color:#e67e22;">blockaded by ${by.join(', ')} (income ×${KingdomNavy.incomeFactor(kingdom).toFixed(2)})</span>` : ''}</div>`;
            }

            html += `
                <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-left:3px solid ${kingdom.color};border-radius:6px;padding:12px;margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                        <span style="font-family:var(--font-display);color:var(--gold);font-size:14px;">
                            ${kingdom.name}
                        </span>
                        <span style="font-size:11px;color:var(--text-secondary);">
                            Dynasty: ${cd.dynasty.name} (⭐${cd.dynasty.prestige})
                        </span>
                    </div>
                    <div style="font-size:12px;margin-bottom:4px;">
                        👑 <strong>${Characters.getDisplayName(ruler, kingdom)}</strong>, Age ${ruler.age} ${ruler.isIll ? '🤒' : ''}
                    </div>
                    <div style="margin-bottom:4px;">${traitBadges}</div>
                    ${cd.spouse && cd.spouse.isAlive ? `<div style="font-size:11px;color:var(--text-secondary);">💒 Consort: ${Characters.getFullName(cd.spouse)} (${cd.spouse.culture}${cd.spouse.culture !== kingdom.culture ? ' — Foreign' : ''})</div>` : ''}
                    <div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">
                        👨‍👧‍👦 Children: ${totalChildren} (${livingHeirs} eligible heirs)
                    </div>
                    ${bonusHtml}
                    <div style="margin-top:6px;border-top:1px solid rgba(255,255,255,0.05);padding-top:6px;">
                        ${advisorSummary}
                    </div>
                </div>
            `;
        }

        if (!html) {
            html = '<p style="color:var(--text-secondary);">No kingdoms with dynasty data available.</p>';
        }

        this.showCustomPanel('👑 Dynasties & Characters', html);
    },

    /**
     * Show a panel by ID
     */
    showPanel(panelId) {
        document.getElementById(panelId).classList.remove('hidden');
    },

    /**
     * Hide a panel by ID
     */
    hidePanel(panelId) {
        document.getElementById(panelId).classList.add('hidden');
    },

    /**
     * Show a custom panel with dynamic content
     */
    showCustomPanel(title, htmlContent) {
        // A tab bar (setPanelNav) holds while the player moves between its views:
        // it survives re-renders made from inside the panel (or its dialogs), and
        // drops when a panel is opened from elsewhere (the map, the action menu, the HUD)
        const nav = this._panelNav;
        if (nav && !this._panelNavFresh && this._clickInPanel === false) this._panelNav = null;
        this._panelNavFresh = false;
        const navHtml = this._panelNavHtml();
        // A tabbed window keeps one title (the market of a town) whichever tab shows
        if (this._panelNav && this._panelNav.title) title = this._panelNav.title;

        const existing = document.getElementById('customPanel');
        if (existing) {
            // If panel exists, just update the content body to prevent "blips"
            const titleEl = existing.querySelector('.custom-panel-title');
            const changed = titleEl && titleEl.textContent !== title;
            if (titleEl) titleEl.textContent = title;
            const navEl = existing.querySelector('.custom-panel-nav');
            if (navEl) {
                navEl.innerHTML = navHtml;
                navEl.style.display = navHtml ? '' : 'none';
            }
            existing.classList.toggle('custom-panel--hub', !!navHtml);
            const contentBody = existing.querySelector('.custom-panel-body');
            if (contentBody) {
                contentBody.innerHTML = htmlContent;
                // A new view starts at its top; a refresh of the same view keeps its place
                if (changed || this._panelNavSwitched) contentBody.scrollTop = 0;
            }
            this._panelNavSwitched = false;
            return; // Done update
        }

        const panel = document.createElement('div');
        panel.id = 'customPanel';
        panel.className = 'modal-panel' + (navHtml ? ' custom-panel--hub' : '');
        panel.style.cssText = `
            position: fixed;
            top: 7.5vh;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(20, 24, 32, 0.98);
            backdrop-filter: blur(10px);
            border: 2px solid var(--gold);
            border-radius: 8px;
            padding: 0;
            width: min(720px, 94vw);
            max-height: 80vh;
            z-index: 1000;
            box-shadow: 0 10px 40px rgba(0,0,0,0.8);
            overflow: hidden;
            display: flex;
            flex-direction: column;
        `;

        panel.innerHTML = `
            <style>
                #customPanel.custom-panel--hub { height: 80vh; width: min(760px, 94vw) !important; }
                #customPanel .custom-panel-nav { display:flex; flex-wrap:wrap; gap:2px 4px; padding:6px 12px 0; border-bottom:2px solid rgba(245,197,66,0.15); flex:0 0 auto; }
                #customPanel .panel-nav-tab { padding:7px 10px; font-size:13px; font-weight:600; color:rgba(255,255,255,0.55); background:none; border:none; border-radius:4px 4px 0 0;
                    border-bottom:2px solid transparent; margin-bottom:-2px; cursor:pointer; font-family:var(--font-body); white-space:nowrap; transition:color .12s, border-color .12s, background .12s; }
                #customPanel .panel-nav-tab:hover { color:rgba(255,255,255,0.9); background:rgba(255,255,255,0.04); }
                #customPanel .panel-nav-tab.active { color:var(--gold); border-bottom-color:var(--gold); background:rgba(245,197,66,0.08); }
            </style>
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.1); flex: 0 0 auto;">
                <h3 class="custom-panel-title" style="margin: 0; font-family: var(--font-display); color: var(--gold);">${title}</h3>
                <button id="closeCustomPanel" style="background: none; border: none; color: var(--text-primary); font-size: 20px; cursor: pointer;">✕</button>
            </div>
            <div class="custom-panel-nav" style="${navHtml ? '' : 'display:none;'}">${navHtml}</div>
            <div class="custom-panel-body" style="padding: 16px; overflow-y: auto; flex: 1 1 auto; min-height: 0;">
                ${htmlContent}
            </div>
        `;

        document.body.appendChild(panel);

        document.getElementById('closeCustomPanel').addEventListener('click', () => {
            this.hideCustomPanel();
        });
    },

    /**
     * Give the custom panel a tab bar that stays put while the player moves
     * between related views (the market's Buy, Sell, Invest, Ledger, ...).
     * nav = { id, title?, active, items: [{ key, label, title?, run() }] }; call it just
     * before the showCustomPanel that renders the active view.
     */
    setPanelNav(nav) {
        this._panelNav = nav && Array.isArray(nav.items) && nav.items.length ? nav : null;
        this._panelNavFresh = true;
    },

    /** A tab of the panel's tab bar was clicked (data-ui-act="panelNavGo"). */
    panelNavGo(key) {
        const nav = this._panelNav;
        const item = nav && nav.items.find(i => i.key === key);
        if (!item) return;
        nav.active = key;
        this._panelNavSwitched = true;
        // The view's own render keeps the bar (setPanelNav may replace it)
        this._panelNavFresh = true;
        item.run();
    },

    _panelNavHtml() {
        const nav = this._panelNav;
        if (!nav) return '';
        const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
        return nav.items.map(i => `<button class="panel-nav-tab${i.key === nav.active ? ' active' : ''}" data-ui-act="panelNavGo" data-ui-args='${esc(JSON.stringify([i.key]))}'${i.title ? ` title="${esc(i.title)}"` : ''}>${i.label}</button>`).join('');
    },

    /**
     * Hide the custom panel
     */
    hideCustomPanel() {
        const panel = document.getElementById('customPanel');
        if (panel) panel.remove();
        this._panelNav = null;
    },

    /**
     * Show a confirmation modal for returning to the main menu
     */
    _showMainMenuConfirm() {
        const existing = document.getElementById('mainMenuConfirmOverlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'mainMenuConfirmOverlay';
        overlay.style.cssText = `
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.75);
            backdrop-filter: blur(4px);
            z-index: 2000;
            display: flex; align-items: center; justify-content: center;
        `;

        overlay.innerHTML = `
            <div style="
                background: rgba(14,18,26,0.98);
                border: 2px solid var(--gold);
                border-radius: 10px;
                padding: 32px 28px 24px;
                min-width: 340px;
                max-width: 420px;
                box-shadow: 0 12px 48px rgba(0,0,0,0.9);
                text-align: center;
                font-family: var(--font-ui, sans-serif);
            ">
                <div style="font-size: 40px; margin-bottom: 12px;">🏠</div>
                <h2 style="margin: 0 0 10px; color: var(--gold); font-family: var(--font-display);">Return to Main Menu?</h2>
                <p style="margin: 0 0 24px; color: #aaa; font-size: 14px; line-height: 1.5;">
                    Any unsaved progress will be lost.<br>Consider saving before you leave.
                </p>
                <div style="display: flex; gap: 12px; justify-content: center;">
                    <button id="mainMenuConfirmCancel" style="
                        flex: 1; padding: 11px 0;
                        background: rgba(255,255,255,0.07);
                        border: 1px solid rgba(255,255,255,0.15);
                        border-radius: 6px;
                        color: #ccc; font-size: 14px; font-weight: 600;
                        cursor: pointer;
                        transition: background 0.15s;
                    ">Cancel</button>
                    <button id="mainMenuConfirmOk" style="
                        flex: 1; padding: 11px 0;
                        background: #7a2020;
                        border: 1px solid #a33;
                        border-radius: 6px;
                        color: #fff; font-size: 14px; font-weight: 700;
                        cursor: pointer;
                        transition: background 0.15s;
                    ">Leave Game</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const close = () => overlay.remove();

        document.getElementById('mainMenuConfirmCancel').addEventListener('click', () => {
            close();
            this.showSettingsPanel();
        });

        document.getElementById('mainMenuConfirmOk').addEventListener('click', () => {
            close();
            location.reload();
        });

        // Close on backdrop click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                close();
                this.showSettingsPanel();
            }
        });

        // Close on Escape
        const onKey = (e) => {
            if (e.key === 'Escape') {
                close();
                this.showSettingsPanel();
                document.removeEventListener('keydown', onKey);
            }
        };
        document.addEventListener('keydown', onKey);
    },

    /**
     * Show the finances tracking modal
     */
    showFinancesPanel(player, world) {
        if (!player) return;

        const history = player.financeHistory || [];
        const recent = history.slice(-30); // Last 30 days

        // ── Summary stats ──
        let totalIncome = 0, totalExpenses = 0;
        const incomeByType = {};
        const expenseByType = {};
        for (const entry of recent) {
            totalIncome += entry.totalIncome || 0;
            totalExpenses += entry.totalExpenses || 0;
            // (operating flows only: stock, works and loan principal are capital — systems/ledger.js;
            // a trading line that lost money is an expense)
            for (const [k, v] of Object.entries(entry.income || {})) {
                if (Ledger.category(k).kind !== 'op') continue;
                if (v >= 0) incomeByType[k] = (incomeByType[k] || 0) + v;
                else expenseByType[k] = (expenseByType[k] || 0) - v;
            }
            for (const [k, v] of Object.entries(entry.expenses || {})) {
                if (Ledger.category(k).kind !== 'op') continue;
                expenseByType[k] = (expenseByType[k] || 0) + v;
            }
        }
        const netChange = totalIncome - totalExpenses;
        const avgDaily = recent.length > 0 ? Math.round(netChange / recent.length) : 0;

        // Label mapping for nice display
        const labels = {
            faith: '🙏 Faith Income',
            culture: '📚 Cultural Income',
            caravans: '🚚 Caravan Profits',
            contracts: '📜 Contract Pay',
            taxes: '🏛️ Tax Collection',
            armyUpkeep: '⚔️ Army Upkeep',
            loanPayments: '🏦 Loan Payments',
            informants: '🕵️ Informant Upkeep',
            propertyUpkeep: '🏗️ Property Upkeep',
        };

        let html = '<div style="max-height: 500px; overflow-y: auto;">';

        // ── Current Balance ──
        html += `
            <div style="text-align: center; margin-bottom: 16px; padding: 16px; background: rgba(255,255,255,0.04); border-radius: 8px;">
                <div style="font-size: 12px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 1px;">Current Balance</div>
                <div style="font-size: 32px; font-weight: bold; color: var(--gold); font-family: var(--font-display);">💰 ${Utils.formatNumber(player.gold)}</div>
                <div style="font-size: 13px; color: ${avgDaily >= 0 ? '#27ae60' : '#e74c3c'}; margin-top: 4px;">
                    ${avgDaily >= 0 ? '▲' : '▼'} ${avgDaily >= 0 ? '+' : ''}${avgDaily} gold/day avg (last ${recent.length} days)
                </div>
            </div>
        `;

        // ── Summary cards row ──
        html += `
            <div style="display: flex; gap: 8px; margin-bottom: 16px;">
                <div style="flex: 1; padding: 12px; background: rgba(39,174,96,0.1); border: 1px solid rgba(39,174,96,0.3); border-radius: 6px; text-align: center;">
                    <div style="font-size: 11px; color: #27ae60; text-transform: uppercase;">Income (${recent.length}d)</div>
                    <div style="font-size: 20px; font-weight: bold; color: #27ae60;">+${Utils.formatNumber(totalIncome)}</div>
                </div>
                <div style="flex: 1; padding: 12px; background: rgba(231,76,60,0.1); border: 1px solid rgba(231,76,60,0.3); border-radius: 6px; text-align: center;">
                    <div style="font-size: 11px; color: #e74c3c; text-transform: uppercase;">Expenses (${recent.length}d)</div>
                    <div style="font-size: 20px; font-weight: bold; color: #e74c3c;">-${Utils.formatNumber(totalExpenses)}</div>
                </div>
                <div style="flex: 1; padding: 12px; background: rgba(${netChange >= 0 ? '39,174,96' : '231,76,60'},0.1); border: 1px solid rgba(${netChange >= 0 ? '39,174,96' : '231,76,60'},0.3); border-radius: 6px; text-align: center;">
                    <div style="font-size: 11px; color: ${netChange >= 0 ? '#27ae60' : '#e74c3c'}; text-transform: uppercase;">Net (${recent.length}d)</div>
                    <div style="font-size: 20px; font-weight: bold; color: ${netChange >= 0 ? '#27ae60' : '#e74c3c'};">${netChange >= 0 ? '+' : ''}${Utils.formatNumber(netChange)}</div>
                </div>
            </div>
        `;

        // ── Income breakdown ──
        const incomeKeys = Object.keys(incomeByType).sort((a, b) => incomeByType[b] - incomeByType[a]);
        if (incomeKeys.length > 0) {
            html += `<div style="margin-bottom: 16px;">`;
            html += `<div style="font-weight: bold; color: #27ae60; font-size: 13px; margin-bottom: 8px; border-bottom: 1px solid rgba(39,174,96,0.3); padding-bottom: 4px;">Income Sources</div>`;
            for (const k of incomeKeys) {
                const pct = totalIncome > 0 ? Math.round(incomeByType[k] / totalIncome * 100) : 0;
                html += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 12px;">
                        <span style="color: var(--text-secondary);">${labels[k] || Ledger.category(k).name}</span>
                        <span style="display: flex; align-items: center; gap: 8px;">
                            <span style="width: 60px; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; display: inline-block; overflow: hidden;">
                                <span style="display: block; width: ${pct}%; height: 100%; background: #27ae60; border-radius: 3px;"></span>
                            </span>
                            <span style="color: #27ae60; font-weight: bold; min-width: 60px; text-align: right;">+${Utils.formatNumber(incomeByType[k])}</span>
                        </span>
                    </div>
                `;
            }
            html += `</div>`;
        }

        // ── Expense breakdown ──
        const expenseKeys = Object.keys(expenseByType).sort((a, b) => expenseByType[b] - expenseByType[a]);
        if (expenseKeys.length > 0) {
            html += `<div style="margin-bottom: 16px;">`;
            html += `<div style="font-weight: bold; color: #e74c3c; font-size: 13px; margin-bottom: 8px; border-bottom: 1px solid rgba(231,76,60,0.3); padding-bottom: 4px;">Expense Sources</div>`;
            for (const k of expenseKeys) {
                const pct = totalExpenses > 0 ? Math.round(expenseByType[k] / totalExpenses * 100) : 0;
                html += `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 12px;">
                        <span style="color: var(--text-secondary);">${labels[k] || Ledger.category(k).name}</span>
                        <span style="display: flex; align-items: center; gap: 8px;">
                            <span style="width: 60px; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; display: inline-block; overflow: hidden;">
                                <span style="display: block; width: ${pct}%; height: 100%; background: #e74c3c; border-radius: 3px;"></span>
                            </span>
                            <span style="color: #e74c3c; font-weight: bold; min-width: 60px; text-align: right;">-${Utils.formatNumber(expenseByType[k])}</span>
                        </span>
                    </div>
                `;
            }
            html += `</div>`;
        }

        // ── Gold history chart (ASCII-style bar chart) ──
        if (recent.length > 1) {
            html += `<div style="margin-bottom: 8px;">`;
            html += `<div style="font-weight: bold; color: var(--gold); font-size: 13px; margin-bottom: 8px; border-bottom: 1px solid rgba(245,197,66,0.3); padding-bottom: 4px;">Gold Over Time (last ${recent.length} days)</div>`;

            const goldValues = recent.map(e => e.goldEnd);
            const maxGold = Math.max(...goldValues, 1);
            const minGold = Math.min(...goldValues, 0);
            const range = maxGold - minGold || 1;

            html += `<div style="display: flex; align-items: flex-end; gap: 1px; height: 80px; padding: 4px 0;">`;
            for (let i = 0; i < recent.length; i++) {
                const entry = recent[i];
                const heightPct = Math.max(2, ((entry.goldEnd - minGold) / range) * 100);
                const color = entry.netChange >= 0 ? '#27ae60' : '#e74c3c';
                const barWidth = Math.max(3, Math.floor(360 / recent.length) - 1);
                html += `<div title="Day ${entry.day}: ${Utils.formatNumber(entry.goldEnd)}g (${entry.netChange >= 0 ? '+' : ''}${entry.netChange})" 
                    style="width: ${barWidth}px; height: ${heightPct}%; background: ${color}; border-radius: 2px 2px 0 0; min-height: 2px; cursor: help; opacity: 0.8;"></div>`;
            }
            html += `</div>`;
            html += `<div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--text-secondary); margin-top: 2px;">
                <span>${Utils.formatNumber(minGold)}g</span>
                <span>${Utils.formatNumber(maxGold)}g</span>
            </div>`;
            html += `</div>`;
        }

        // ── Recent daily log ──
        if (recent.length > 0) {
            html += `<div>`;
            html += `<div style="font-weight: bold; color: white; font-size: 13px; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.15); padding-bottom: 4px;">Daily Log</div>`;
            const lastDays = recent.slice(-10).reverse(); // Show last 10 entries, newest first
            for (const entry of lastDays) {
                const dayInSeason = ((entry.day - 1) % 30) + 1;
                const incomeStr = entry.totalIncome > 0 ? `<span style="color: #27ae60;">+${entry.totalIncome}</span>` : '';
                const expenseStr = entry.totalExpenses > 0 ? `<span style="color: #e74c3c;">-${entry.totalExpenses}</span>` : '';
                const netColor = entry.netChange >= 0 ? '#27ae60' : '#e74c3c';
                html += `
                    <div style="display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px; border-bottom: 1px solid rgba(255,255,255,0.04);">
                        <span style="color: var(--text-secondary); min-width: 110px;">Day ${dayInSeason}, ${entry.season} Y${entry.year}</span>
                        <span style="display: flex; gap: 12px;">
                            ${incomeStr}
                            ${expenseStr}
                            <span style="color: ${netColor}; font-weight: bold; min-width: 50px; text-align: right;">= ${entry.netChange >= 0 ? '+' : ''}${entry.netChange}</span>
                            <span style="color: var(--gold); min-width: 65px; text-align: right;">${Utils.formatNumber(entry.goldEnd)}g</span>
                        </span>
                    </div>
                `;
            }
            html += `</div>`;
        }

        if (recent.length === 0) {
            html += `<p style="color: var(--text-secondary); text-align: center; padding: 20px;">No financial data yet. End a day to start tracking.</p>`;
        }

        html += '</div>';

        this.showCustomPanel('💰 Finances', html);
    },

    /**
     * Show inventory panel
     */
    showInventoryPanel() {
        const player = this.game.player;

        let inventoryHtml = '<p style="color: var(--text-secondary);">Your inventory is empty.</p>';

        if (player.inventory && Object.keys(player.inventory).length > 0) {
            inventoryHtml = '<div style="display: grid; gap: 8px;">';
            for (const [itemId, quantity] of Object.entries(player.inventory)) {
                if (quantity <= 0) continue;
                // Try to find the item in PlayerEconomy.GOODS
                const item = PlayerEconomy.GOODS ? PlayerEconomy.GOODS[itemId.toUpperCase()] : null;
                const fallbackName = itemId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                const icon = (item && item.icon) ? item.icon : '📦';
                const name = (item && item.name) ? item.name : fallbackName;
                const worth = item && item.basePrice ? `<span style="color: var(--text-secondary); font-size: 11px; margin-left: 6px;">~${item.basePrice}g each</span>` : '';
                // Treasures: what they do, plus enshrine / use buttons
                const info = Treasures.info(itemId);
                let extra = '';
                if (info) {
                    const lines = Treasures.describe(itemId);
                    extra += `<div style="font-size: 11px; color: #ce93d8; margin-top: 4px;">${lines.join(' · ')}</div>`;
                    const btn = 'padding: 3px 8px; margin: 4px 6px 0 0; font-size: 11px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); background: rgba(245,197,66,0.15); color: var(--text-primary); cursor: pointer;';
                    if (info.prestige > 0 && player.house) extra += `<button data-ui-act="dedicateTreasure" data-ui-args='["${itemId}"]' style="${btn}">🏛️ Enshrine (+${info.prestige} Prestige)</button>`;
                    if (info.consume) extra += `<button data-ui-act="useTreasure" data-ui-args='["${itemId}"]' style="${btn}">✋ Use</button>`;
                }
                const title = item && item.description ? ` title="${String(item.description).replace(/"/g, '&quot;')}"` : '';
                inventoryHtml += `
                    <div${title} style="padding: 8px; background: rgba(255,255,255,0.05); border-radius: 4px;">
                        <div style="display: flex; justify-content: space-between;">
                            <span>${icon} ${name}${worth}</span>
                            <span style="color: var(--gold);">×${quantity}</span>
                        </div>${extra}
                    </div>
                `;
            }
            inventoryHtml += '</div>';
        }

        const used = PlayerInventory.getUsedSlots(player);
        const cap = PlayerInventory.getCapacity(player);
        inventoryHtml = `<div style="font-size: 12px; margin-bottom: 8px; color: ${used >= cap ? '#ff9800' : 'var(--text-secondary)'};"
            title="Each kind of good takes a slot. A mount (+5) and each house (+3) add room.">🎒 Packs: ${used}/${cap} kinds of goods</div>` + inventoryHtml;

        this.showCustomPanel('Inventory', inventoryHtml);
    },

    /** Enshrine a treasure in the House hall for Prestige. */
    dedicateTreasure(itemId) {
        const r = Treasures.dedicate(this.game.player, itemId, this.game.world ? this.game.world.day : 0);
        if (r.success) this.showNotification('🏛️ Enshrined', `${Treasures.name(itemId)} now hangs in your hall. +${r.prestige} Prestige.`, 'success');
        else this.showNotification('Cannot Enshrine', r.reason, 'error');
        this.updateStats(this.game.player, this.game.world);
        this.showInventoryPanel();
    },

    /** Use a consumable treasure (holy water, rum). */
    useTreasure(itemId) {
        const r = Treasures.use(this.game.player, itemId);
        if (r.success) {
            const parts = [];
            if (r.health) parts.push(`+${r.health} health`);
            if (r.movement) parts.push(`+${r.movement} movement`);
            this.showNotification(`${(Treasures.def(itemId) || {}).icon || '✋'} ${Treasures.name(itemId)}`, parts.join(', ') || 'Used.', 'success');
        } else {
            this.showNotification('Cannot Use', r.reason, 'error');
        }
        this.updateStats(this.game.player, this.game.world);
        this.showInventoryPanel();
    },

    /**
     * Show quests panel
     */
    /** Accept an offered quest from the journal (max 5 active). */
    acceptQuest(questId) {
        const result = Quests.acceptQuest(this.game.player, questId, this.game.world);
        if (result.success) {
            this.showNotification('📜 Quest Accepted', result.quest.title, 'success');
        } else {
            this.showNotification('Cannot Accept', result.reason, 'error');
        }
        this.showQuestsPanel();
    },

    showQuestsPanel() {
        const player = this.game.player;
        const world = this.game.world;

        let html = '';

        // ── ACTIVE JOBS SECTION ──
        const jobs = [];

        // Jail
        if (player.jailState) {
            const j = player.jailState;
            jobs.push({
                icon: '🔒',
                name: `Serving Jail Time`,
                detail: `Sentenced for ${j.offense} (offense #${j.offenseNumber})`,
                status: `${j.daysRemaining} day(s) remaining`,
                statusColor: '#e74c3c',
                location: j.settlement,
            });
        }

        // Indentured servitude
        if (player.indenturedServitude) {
            const s = player.indenturedServitude;
            jobs.push({
                icon: '⛓️',
                name: `Indentured Servitude`,
                detail: `Bound to ${s.captor}`,
                status: `${s.daysRemaining} day(s) remaining`,
                statusColor: '#e67e22',
                location: null,
            });
        }

        // Mercenary contract
        if (player.activeContract) {
            const c = player.activeContract;
            jobs.push({
                icon: '⚔️',
                name: c.name,
                detail: `Payment: ${c.payment}g`,
                status: `${c.daysRemaining} day(s) remaining`,
                statusColor: '#3498db',
                location: c.settlement,
            });
        }

        // Active bounties
        if (player.activeBounties && player.activeBounties.length > 0) {
            for (const b of player.activeBounties) {
                const daysLeft = b.daysLimit - (b.daysElapsed || 0);
                const isCriminal = b.type === 'criminal_hunt';
                const detail = isCriminal
                    ? `Reward: ${b.actualPay}g — ${b.targetName}, wanted for ${b.crime}.`
                    : `Reward: ${b.actualPay}g — ${b.description || ''}`;
                const status = isCriminal
                    ? (b.status === 'captured_pending_decision'
                        ? 'Captured — awaiting judgment'
                        : `${daysLeft} day(s) left · Last seen (${b.targetQ}, ${b.targetR})`)
                    : `${daysLeft} day(s) left`;
                jobs.push({
                    icon: b.icon || '📜',
                    name: b.name,
                    detail,
                    status,
                    statusColor: daysLeft <= 2 ? '#e74c3c' : '#2ecc71',
                    location: b.fromSettlement || null,
                });
            }
        }

        if (player.festivals && player.festivals.moraleBoostDays > 0) {
            jobs.push({
                icon: '🎉',
                name: 'Festival Spirit',
                detail: `Army morale bonus active (+${Math.round((player.festivals.moraleBoostValue || 0) * 100)}%)`,
                status: `${player.festivals.moraleBoostDays} day(s) remaining`,
                statusColor: '#f39c12',
                location: null,
            });
        }

        // Caravans in transit
        if (player.caravans && player.caravans.length > 0) {
            for (const c of player.caravans) {
                const daysLeft = c.travelDays - (c.daysElapsed || 0);
                jobs.push({
                    icon: '🐫',
                    name: `Caravan to ${c.destination || 'unknown'}`,
                    detail: `Carrying ${c.goods || 'goods'} — Expected profit: ${c.expectedProfit || '?'}g`,
                    status: `${daysLeft} day(s) in transit`,
                    statusColor: '#f39c12',
                    location: null,
                });
            }
        }

        // Ships being built or moving
        if (player.ships && player.ships.length > 0) {
            for (const s of player.ships) {
                if (s.status === 'building') {
                    jobs.push({
                        icon: '🔨',
                        name: `Building ${s.name}`,
                        detail: `Ship under construction`,
                        status: `${s.buildDaysLeft} day(s) left`,
                        statusColor: '#f39c12',
                        location: s.dockedAt || null,
                    });
                } else if (s.status === 'moving') {
                    jobs.push({
                        icon: '⛵',
                        name: `${s.name} en route`,
                        detail: `Sailing to ${s.destinationName || 'destination'}`,
                        status: `${s.travelDaysLeft} day(s) remaining`,
                        statusColor: '#3498db',
                        location: null,
                    });
                }
            }
        }

        // Render active jobs
        html += '<h4 style="margin-top: 0; color:var(--text-primary); border-bottom: 2px solid #3498db; padding-bottom: 8px;">📋 Active Jobs & Commitments</h4>';
        if (jobs.length > 0) {
            for (const job of jobs) {
                html += `
                    <div style="margin-bottom: 8px; padding: 10px 12px; background: rgba(20, 20, 30, 0.5); border-left: 3px solid ${job.statusColor}; border-radius: 4px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <span style="font-size: 15px;">${job.icon}</span>
                                <strong style="color: var(--text-primary); margin-left: 4px;">${job.name}</strong>
                                ${job.location ? `<span style="font-size: 11px; color: var(--text-secondary); margin-left: 6px;">@ ${job.location}</span>` : ''}
                            </div>
                            <span style="font-size: 12px; color: ${job.statusColor}; font-weight: 600;">${job.status}</span>
                        </div>
                        <div style="font-size: 12px; color: var(--text-secondary); margin-top: 3px;">${job.detail}</div>
                    </div>
                `;
            }
        } else {
            html += '<p style="color: var(--text-secondary); font-style: italic;">No active jobs or commitments.</p>';
        }

        // ── ACTIVE QUESTS ──
        html += '<h4 style="margin-top: 24px; color:var(--text-primary); border-bottom: 2px solid var(--gold); padding-bottom: 8px;">Active Quests</h4>';
        if (player.quests && player.quests.active && player.quests.active.length > 0) {
            for (const quest of player.quests.active) {
                const progress = Quests.getProgressSummary(quest);
                html += `
                    <div style="margin-bottom: 16px; padding: 16px; background: rgba(20, 20, 30, 0.6); border: 1px solid rgba(255, 215, 0, 0.3); border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.2);">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                            <div style="font-family: var(--font-display); font-size: 18px; color: var(--gold);">${quest.title}</div>
                            <div style="font-size: 12px; background: rgba(255,215,0,0.1); padding: 4px 8px; border-radius: 12px; color: var(--gold);">Active</div>
                        </div>
                        <div style="font-size: 14px; color: var(--text-secondary); margin-bottom: 12px; font-style: italic;">${quest.description}</div>
                        
                        <div style="background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px;">
                            <div style="font-size: 12px; font-weight: 600; margin-bottom: 4px; color: var(--text-primary);">Objectives:</div>
                            ${quest.objectives.map(obj => `
                                <div style="display: flex; align-items: center; gap: 8px; font-size: 13px; margin-top: 4px; color: ${obj.completed ? '#2ecc71' : 'var(--text-secondary)'};">
                                    <span style="font-size: 16px;">${obj.completed ? '✅' : '⭕'}</span> 
                                    <span>${obj.text} (${obj.current}/${obj.target})</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }
        } else {
            html += '<p style="color: var(--text-secondary); font-style: italic;">No active quests at the moment.</p>';
        }

        // Available quests
        html += '<h4 style="margin-top: 24px; color:var(--text-primary); border-bottom: 2px solid var(--text-secondary); padding-bottom: 8px;">Available Quests</h4>';
        if (player.quests && player.quests.available && player.quests.available.length > 0) {
            for (const quest of player.quests.available) {
                const rewards = JSON.stringify(quest.rewards).replace(/{|}|"/g, '').replace(/,/g, ', ');
                html += `
                    <div style="margin-bottom: 12px; padding: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px;">
                        <div style="font-weight: 600; margin-bottom: 4px; color: var(--text-primary);">${quest.title}</div>
                        <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px;">${quest.description}</div>
                        <div style="display: flex; gap: 8px; align-items: center; font-size: 11px;">
                            <span style="background: rgba(255,215,0,0.1); padding: 2px 6px; border-radius: 4px; color: var(--gold);">Rewards: ${rewards}</span>
                            ${quest.difficulty ? `<span style="color: var(--text-muted); text-transform: capitalize;">${quest.difficulty}</span>` : ''}
                            ${typeof quest.expiresDay === 'number' ? `<span style="color: var(--text-muted);" title="Stale postings come down; the board is refreshed weekly">Posted until day ${quest.expiresDay}</span>` : ''}
                            <button data-ui-act="acceptQuest" data-ui-args='["${quest.id}"]' style="margin-left: auto; padding: 4px 12px; border: none; border-radius: 4px; background: linear-gradient(135deg, var(--gold-dark), var(--gold)); color: #1a1207; font-weight: 700; cursor: pointer;">Accept</button>
                        </div>
                    </div>
                `;
            }
        } else {
            html += '<p style="color: var(--text-secondary); font-style: italic;">No new quests available.</p>';
        }

        // Completed quests
        if (player.quests && player.quests.completed && player.quests.completed.length > 0) {
            html += `<h4 style="margin-top: 24px; color:var(--text-primary); border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">Completed (${player.quests.completed.length})</h4>`;
            html += '<div style="font-size: 13px; color: var(--text-secondary);">Journal → Deeds &amp; Records lists every quest completed and your achievements.</div>';
        }

        this.showCustomPanel('Quest Journal', html);
    },

    /**
     * Show a notification toast (Sims-style card)
     */
    showNotification(title, message, type = 'default') {
        const area = document.getElementById('notificationArea');
        const notif = document.createElement('div');
        notif.className = `notification ${type}`;

        // Icon per type
        const typeIcons = { success: '✅', error: '❌', info: 'ℹ️', default: '📌' };
        const icon = typeIcons[type] || typeIcons.default;

        notif.innerHTML = `
            <div class="notif-accent"></div>
            <div class="notif-icon">${icon}</div>
            <div class="notif-body">
                <div class="notif-title">${title}</div>
                <div class="notif-msg">${message}</div>
            </div>
            <button class="notif-dismiss" title="Dismiss">✕</button>
        `;
        area.appendChild(notif);

        // Dismiss button
        const dismissBtn = notif.querySelector('.notif-dismiss');
        if (dismissBtn) {
            dismissBtn.addEventListener('click', () => {
                notif.style.animation = 'notifOut 0.3s ease forwards';
                setTimeout(() => notif.remove(), 300);
            });
        }

        // Play notification SFX based on type
        if (typeof audioManager !== 'undefined') {
            if (type === 'success') audioManager.playSFX('success');
            else if (type === 'error') audioManager.playSFX('error');
            else audioManager.playSFX('notify');
        }

        // Log notification for history
        const world = this.game && this.game.world;
        const dayInSeason = world ? ((world.day - 1) % 30) + 1 : 1;
        const season = world ? world.season : 'Spring';
        const year = world ? world.year : 1;
        this.notificationLog.push({
            title, message, type,
            day: dayInSeason, season, year,
            timestamp: Date.now()
        });
        // Cap log at 200 entries
        if (this.notificationLog.length > 200) {
            this.notificationLog = this.notificationLog.slice(-200);
        }

        // Auto-remove based on settings duration
        const duration = this._notifDuration || 4000;
        setTimeout(() => {
            notif.style.animation = 'notifOut 0.3s ease forwards';
            setTimeout(() => notif.remove(), 300);
        }, duration);
    },

    /**
     * Show the event log panel with all past notifications
     */
    showEventLogPanel() {
        const log = this.notificationLog;
        let html = '<div style="max-width: 650px;">';

        if (log.length === 0) {
            html += '<p style="color: var(--text-secondary); text-align: center; padding: 24px;">No events recorded yet.</p>';
        } else {
            // Show newest first
            const typeIcons = {
                success: '✅', error: '❌', info: 'ℹ️', default: '📌'
            };
            const typeBorders = {
                success: 'var(--accent-green)', error: 'var(--accent-red)',
                info: 'var(--accent-blue)', default: 'var(--gold)'
            };
            for (let i = log.length - 1; i >= 0; i--) {
                const entry = log[i];
                const icon = typeIcons[entry.type] || typeIcons.default;
                const borderColor = typeBorders[entry.type] || typeBorders.default;
                html += `
                    <div style="padding: 8px 12px; margin-bottom: 6px; background: rgba(255,255,255,0.03); border-left: 3px solid ${borderColor}; border-radius: 4px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
                            <span style="font-family: var(--font-display); font-size: 12px; font-weight: 600; color: var(--gold); text-transform: uppercase; letter-spacing: 0.5px;">${icon} ${entry.title}</span>
                            <span style="font-size: 11px; color: var(--text-muted);">Day ${entry.day}, ${entry.season}, Year ${entry.year}</span>
                        </div>
                        <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.4;">${entry.message}</div>
                    </div>`;
            }
        }

        html += '</div>';
        this.showCustomPanel('📋 Event Log', html);
    },
});
