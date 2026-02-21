const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

// Handle creating/removing shortcuts on Windows when installing/uninstalling
if (require('electron-squirrel-startup')) {
    app.quit();
}

let mainWindow;

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

    // Load the game
    mainWindow.loadFile('index.html');

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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    app.quit();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
