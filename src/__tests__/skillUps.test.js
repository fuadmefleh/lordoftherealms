// Level-ups told by the game loop (ui/skillUps.js): several at once are all
// told, one after another, none folded away; each reaches the Activity Log.

import { describe, it, expect, beforeAll } from 'vitest';
import { DataLoader } from '../core/dataLoader.js';
import { announceSkillUps, queueSkillUps } from '../ui/skillUps.js';
import { Endurance } from '../player/endurance.js';
import { PracticeSkills } from '../systems/practiceSkills.js';
import { UI } from '../ui/ui/index.js';

beforeAll(async () => {
    if (!DataLoader._gamedata) await DataLoader.initializeAll();
});

describe('level-up announcements', () => {
    it('two level-ups in the same frame are both told, a beat apart', () => {
        const shown = [];
        const game = { player: { skills: {} }, ui: { showNotification: (t, m) => shown.push(t + ' ' + m) } };
        queueSkillUps([
            { icon: '🧗', name: 'Climbing', text: 'Climbing rose to level 2.' },
            { icon: '🏃', name: 'Endurance', text: 'Endurance rose to level 2.' },
        ]);
        let now = 100000;
        announceSkillUps(game, now);
        announceSkillUps(game, now + 16);
        expect(shown.length).toBe(1);
        for (let i = 0; i < 100 && shown.length < 2; i++) announceSkillUps(game, (now += 50));
        expect(shown.length).toBe(2);
        expect(shown[0]).toMatch(/Climbing/);
        expect(shown[1]).toMatch(/Endurance/);
    });

    it('an Endurance level-up queued on the player is told by the loop', () => {
        const shown = [];
        const player = { skills: {}, practiceSkills: { endurance: PracticeSkills.xpForLevel(2) - 0.5 } };
        const game = { player, ui: { showNotification: (t, m) => shown.push(m) } };
        Endurance.train(player, 5);
        queueSkillUps(Endurance.takeQueued(player));
        for (let now = 200000; now < 203000 && !shown.length; now += 50) announceSkillUps(game, now);
        expect(shown.join(' ')).toMatch(/Endurance rose to level/);
    });

    it('the Activity Log refreshes for each entry, even once the log is full', () => {
        const ui = Object.create(UI.prototype);
        ui.notificationLog = Array.from({ length: 200 }, (_, i) => ({ title: `old ${i}`, message: '', type: 'info' }));
        let refreshed = 0;
        ui.updateEventsPanel = () => { refreshed++; };
        ui._logNotification('🏃 Endurance Improved', 'Endurance rose to level 2.', 'success');
        expect(ui.notificationLog.length).toBe(200);
        expect(ui.notificationLog[199].title).toMatch(/Endurance/);
        expect(ui._notifSeq).toBe(1);
        return new Promise(res => requestAnimationFrame(() => { expect(refreshed).toBe(1); res(); }));
    });
});
