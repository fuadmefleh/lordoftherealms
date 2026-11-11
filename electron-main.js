const { app, BrowserWindow, Menu, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');

// ── The game's own origin: app://game/ ──────────────────────────────
// The build references /js/…, /data/… and /assets/… from the site root, which
// a file:// page can't resolve, and the in-browser LLM (WebLLM) wants a
// secure, standard origin: its Web Worker, the Cache API that holds the
// downloaded model, and WebGPU. So the window loads from a privileged app://
// scheme that serves dist-web/ first, then the app folder (data/, assets/).
// Saves, settings and the model cache all live under this one origin.
protocol.registerSchemesAsPrivileged([{
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
}]);

function serveApp() {
    const roots = [path.join(__dirname, 'dist-web'), __dirname];
    protocol.handle('app', (request) => {
        let rel;
        try { rel = decodeURIComponent(new URL(request.url).pathname); } catch { rel = '/'; }
        if (!rel || rel === '/') rel = '/index.html';
        for (const root of roots) {
            const file = path.normalize(path.join(root, rel));
            // Never outside the app folder
            if (!file.startsWith(root + path.sep)) continue;
            try {
                if (fs.statSync(file).isFile()) return net.fetch(pathToFileURL(file).toString());
            } catch { /* not in this root */ }
        }
        return new Response('Not found', { status: 404 });
    });
}

// WebGPU (the in-browser LLM) is on by default in Electron's Chromium on
// Windows and macOS; Linux still needs it switched on, over Vulkan.
if (process.platform === 'linux') {
    app.commandLine.appendSwitch('enable-unsafe-webgpu');
    app.commandLine.appendSwitch('enable-features', 'Vulkan');
}

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

    // Load the game from dist-web/ (built by Vite), through the app:// origin above
    mainWindow.loadURL('app://game/index.html');

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
    serveApp();
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
