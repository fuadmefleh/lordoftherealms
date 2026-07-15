/**
 * Guard for the npcDialog.js by-hand split. Its 8 mutable module `let` vars were
 * consolidated into a shared `dialogState` object, then the 30 functions were
 * split into npcDialog/{helpers,render,choices}.js + shared.js + the facade in
 * index.js (data tables already live in npcDialog.data.js).
 *
 * A no-undef static pass over the split dir verified every cross-group reference
 * resolves — it caught render/choices functions referencing the NpcDialog facade
 * without importing it (fixed via a call-time cycle import).
 */
import { describe, it, expect } from 'vitest';
import { NpcDialog } from '../ui/npcDialog.js';
import { dialogState } from '../ui/npcDialog/shared.js';

const STATE_KEYS = ['_active', '_game', '_npc', '_lines', '_lineIndex', '_overlay', '_typewriteTimer', '_typewriteComplete'];

describe('NpcDialog split', () => {
    it('facade exposes active/open/close and the getter reads shared state', () => {
        expect(typeof NpcDialog.open).toBe('function');
        expect(typeof NpcDialog.close).toBe('function');
        expect(NpcDialog.active).toBe(false);
        expect(NpcDialog.active).toBe(dialogState._active);
    });

    it('the shared dialogState carries all 8 consolidated fields', () => {
        const missing = STATE_KEYS.filter((k) => !(k in dialogState));
        expect(missing).toEqual([]);
        expect(STATE_KEYS).toHaveLength(8);
    });
});
