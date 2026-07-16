const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let llamaServer = null;

// ── Optional local llama.cpp server (Spec 2, NPC brain) ──────────────
// Spawns `llama-server` only when the user points at a binary + model via env
// vars; otherwise it is a silent no-op. The game talks to it over localhost and
// degrades gracefully if it is absent, so this is pure convenience.
//   LOTR_LLAMA_SERVER  path to the llama-server executable
//   LOTR_LLAMA_MODEL   path to the .gguf model file
//   LOTR_LLAMA_PORT    port (default 8080)
//   LOTR_LLAMA_ARGS    extra space-separated args
function startLlamaServer() {
    const bin = process.env.LOTR_LLAMA_SERVER;
    const model = process.env.LOTR_LLAMA_MODEL;
    if (!bin || !model) return; // not configured — do nothing
    const port = process.env.LOTR_LLAMA_PORT || '8080';
    const extra = (process.env.LOTR_LLAMA_ARGS || '').split(' ').filter(Boolean);
    const args = ['-m', model, '--port', port, ...extra];
    try {
        llamaServer = spawn(bin, args, { stdio: 'ignore' });
        llamaServer.on('error', (e) => {
            console.warn('[llama] failed to start:', e.message);
            llamaServer = null;
        });
        console.log(`[llama] started ${bin} on port ${port}`);
    } catch (e) {
        console.warn('[llama] spawn error:', e.message);
        llamaServer = null;
    }
}

function stopLlamaServer() {
    if (llamaServer) {
        try { llamaServer.kill(); } catch { /* ignore */ }
        llamaServer = null;
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 700,
        title: 'Lord of the Realms',
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        },
        backgroundColor: '#0a0a1a',
        show: false
    });

    // Remove the default menu bar for a cleaner game experience
    Menu.setApplicationMenu(null);

    // Load the game from dist-web/ (built by Vite)
    mainWindow.loadFile(path.join(__dirname, 'dist-web', 'index.html'));

    // Show window when ready to avoid visual flash
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Start maximized for best game experience
    mainWindow.maximize();

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    startLlamaServer();
    createWindow();
});

app.on('window-all-closed', () => {
    stopLlamaServer();
    app.quit();
});

app.on('before-quit', stopLlamaServer);

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
