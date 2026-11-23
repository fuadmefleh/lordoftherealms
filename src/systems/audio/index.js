// ============================================
// AudioManager — assembled from ./audio/*.js
// ============================================
import { AudioManager } from './core.js';
import './scenes.js';
import './sfx.js';
import './controls.js';
import './interior.js';

// Global singleton — created only after every group module has Object.assign'd
// its methods onto AudioManager.prototype above.
export const audioManager = new AudioManager();

export { AudioManager };
