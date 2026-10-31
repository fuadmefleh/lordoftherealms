// Map icons are drawn as the engraved glyph set (ui/icons.js), not emoji:
// every emoji that data or the renderer puts on the world map has a glyph.
import { describe, it, expect } from 'vitest';
import { GLYPHS, glyphFor, furnitureGlyph, buildingGlyph } from '../ui/icons.js';
import { InnerMap } from '../world/innerMap.js';
import { DataLoader } from '../core/dataLoader.js';

describe('map glyphs', () => {
    it('resolves names, emoji with variation selectors, and gives null for strangers', () => {
        expect(glyphFor('tree')).toBe('tree');
        expect(glyphFor('⛏️')).toBe('ore');
        expect(glyphFor('🏚️')).toBe('ruin');
        expect(glyphFor('✨')).toBe('nugget');
        expect(glyphFor('🦄')).toBe(null);
        expect(glyphFor('')).toBe(null);
    });

    it('every glyph part is a path string', () => {
        for (const [name, parts] of Object.entries(GLYPHS)) {
            expect(Array.isArray(parts), name).toBe(true);
            for (const p of parts) expect(typeof p === 'string' && /^[~#]?M/.test(p), `${name}: ${p}`).toBe(true);
        }
    });

    it('covers every icon data puts on the world map', async () => {
        const terrain = await DataLoader.load('terrain.json');
        const religion = await DataLoader.load('religion.json');
        const culture = await DataLoader.load('culture.json');
        const patronage = await DataLoader.load('patronage.json');
        const lairs = await DataLoader.load('outlawLairs.json');
        const discovery = await DataLoader.load('discovery.json');
        const hinterland = await DataLoader.load('hinterland.json');
        const icons = (o) => Object.values(o || {}).map(v => v && v.icon).filter(Boolean);
        const all = [
            ...icons(terrain.resources),
            ...icons(religion.holySiteTypes),
            ...icons(culture.buildingTypes),
            ...icons(patronage.greatWorks),
            ...icons(lairs.kinds),
            ...icons(discovery.kinds),
            ...icons(hinterland.kinds),
        ];
        expect(all.length).toBeGreaterThan(30);
        const missing = all.filter(e => !glyphFor(e));
        expect(missing).toEqual([]);
    });

    it('covers the inner maps: furniture, what townsfolk do at it, buildings and people', () => {
        const furniture = Object.values(InnerMap.INTERIOR_LAYOUTS).flatMap(l => l.furniture || []);
        expect(furniture.length).toBeGreaterThan(30);
        expect(furniture.filter(f => !furnitureGlyph(f)).map(f => `${f.type} ${f.icon}`)).toEqual([]);
        const activities = Object.values(InnerMap.FURNITURE_ACTIVITIES).map(a => a.icon);
        expect(activities.filter(e => !glyphFor(e))).toEqual([]);
        const people = Object.values(InnerMap.NPC_TYPES).map(t => t.icon);
        expect(people.filter(e => !glyphFor(e))).toEqual([]);
        // Every building has a glyph of its own, not the house it falls back to
        const buildings = [
            ...Object.entries(InnerMap.BUILDING_TYPES).map(([type, d]) => ({ type, icon: d.icon })),
            ...Object.entries(InnerMap.PROPERTY_BUILDING_DEFS).map(([type, d]) => ({ type: 'player_' + type, icon: d.icon })),
        ];
        expect(buildings.filter(b => b.type !== 'house' && b.type !== 'barn' && buildingGlyph(b) === 'house')
            .map(b => b.type)).toEqual([]);
        expect(buildingGlyph({ type: 'barn', icon: '🏚️' })).toBe('house');
        expect(furnitureGlyph({ type: 'rack', icon: '🛡️' })).toBe('shield');
    });
});
