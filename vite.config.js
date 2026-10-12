import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tiny plugin to copy classic (non-module) editor scripts into the build
// output. These are referenced via plain <script src="…"> in the editor
// HTML files, which Vite intentionally does not bundle, so we emit them
// verbatim to dist-web instead.
function copyEditorAssets() {
  const files = ['editor-modstore.js', 'editor-ui.js', 'editor-core.js', 'world-editor-tools.js'];
  return {
    name: 'copy-editor-assets',
    generateBundle() {
      for (const file of files) {
        const src = path.resolve(__dirname, file);
        if (fs.existsSync(src)) {
          this.emitFile({
            type: 'asset',
            fileName: file,
            source: fs.readFileSync(src, 'utf-8'),
          });
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyEditorAssets()],
  root: '.',
  publicDir: false, // static files served from project root by Vite dev server
  server: {
    host: '0.0.0.0',
    port: 8082,
    open: true,
    // Cache static assets (sprites, data) for 1 hour in the dev server
    headers: {
      'Cache-Control': 'public, max-age=3600',
    },
    warmup: {
      // Pre-transform hot paths so the first page load doesn't stall on module transforms
      clientFiles: [
        './src/main.jsx',
        './src/App.jsx',
        './src/components/GameView.jsx',
        './src/ui/game.js',
        './src/ui/renderer.js',
        './src/ui/actionMenu.js',
        './src/ui/innerMapRenderer.js',
        './src/core/dataLoader.js',
        './src/world/world.js',
        './src/player/player.js',
        './src/player/playerEconomy.js',
      ],
    },
    // Serve static files (data/, assets/, styles.css, editor HTML files)
    fs: {
      allow: ['.'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@core': path.resolve(__dirname, 'src/core'),
      '@world': path.resolve(__dirname, 'src/world'),
      '@player': path.resolve(__dirname, 'src/player'),
      '@systems': path.resolve(__dirname, 'src/systems'),
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@components': path.resolve(__dirname, 'src/components'),
    },
  },
  build: {
    outDir: 'dist-web',
    assetsDir: 'js',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        editor: path.resolve(__dirname, 'editor.html'),
        spriteEditor: path.resolve(__dirname, 'sprite_editor.html'),
        spritesheetEditor: path.resolve(__dirname, 'spritesheet_editor.html'),
        interiorEditor: path.resolve(__dirname, 'interior_editor.html'),
        terrainEditor: path.resolve(__dirname, 'terrain_editor.html'),
        worldEditor: path.resolve(__dirname, 'world_editor.html'),
      },
    },
  },
  // ── Vitest configuration ──
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['src/__tests__/setup.js'],
    include: ['src/__tests__/**/*.test.js'],
    testTimeout: 30000,
    // Most suites load gamedata.json in beforeAll; under a busy CPU that can
    // exceed the 10s default and skip the whole file.
    hookTimeout: 30000,
  },
});
