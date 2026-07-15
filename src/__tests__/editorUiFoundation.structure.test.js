/**
 * Guard for the shared editor design-system foundation (editor-ui.css +
 * editor-ui.js). Every editor HTML must link both, plus the Google Fonts
 * used by the game identity, so the whole modding suite stays on one
 * cohesive, game-aligned theme. Also pins two invariants that were fixed
 * during the cleanup: the dead "Palettes" tab is gone, and the Vite build
 * copies editor-ui.js into the output (it is a classic, non-bundled script).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const read = (f) => readFileSync(path.join(ROOT, f), 'utf-8');

const EDITOR_HTML = [
  'editor.html',
  'world_editor.html',
  'sprite_editor.html',
  'spritesheet_editor.html',
  'interior_editor.html',
  'terrain_editor.html',
];

describe('editor UI foundation', () => {
  it('the shared foundation files exist at the project root', () => {
    expect(existsSync(path.join(ROOT, 'editor-ui.css'))).toBe(true);
    expect(existsSync(path.join(ROOT, 'editor-ui.js'))).toBe(true);
  });

  it('every editor links editor-ui.css, editor-ui.js, and the game fonts', () => {
    for (const file of EDITOR_HTML) {
      const html = read(file);
      expect(html, `${file} → editor-ui.css`).toContain('editor-ui.css');
      expect(html, `${file} → editor-ui.js`).toContain('editor-ui.js');
      expect(html, `${file} → Cinzel/Inter fonts`).toContain('family=Cinzel');
    }
  });

  it('the shared token block out-specifies each editor\'s local :root', () => {
    // `:root:root` (0,2,0) must win over each file's own `:root` (0,1,0) so
    // the game palette re-themes the whole suite during the additive phase.
    expect(read('editor-ui.css')).toContain(':root:root');
  });

  it('the dead Palettes tab and its missing source are fully removed', () => {
    const hub = read('editor.html');
    expect(hub).not.toContain('palette_maker.html');
    expect(hub).not.toContain("switchTab('palettes')");
  });

  it('the Vite build copies editor-ui.js into the output', () => {
    const cfg = read('vite.config.js');
    expect(cfg).toContain('editor-ui.js');
  });
});
