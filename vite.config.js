import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Tiny plugin to copy editor-modstore.js into the build output
function copyEditorModstore() {
  return {
    name: 'copy-editor-modstore',
    generateBundle() {
      const src = path.resolve(__dirname, 'editor-modstore.js');
      if (fs.existsSync(src)) {
        this.emitFile({
          type: 'asset',
          fileName: 'editor-modstore.js',
          source: fs.readFileSync(src, 'utf-8'),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyEditorModstore()],
  root: '.',
  publicDir: false, // static files served from project root by Vite dev server
  server: {
    port: 8081,
    open: true,
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
  },
});
