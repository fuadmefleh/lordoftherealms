// The desktop bridge: the few things the game page may ask of the app.
// window.lotrDesktop.saveChronicle(html, name)    → save dialog, writes the book (HTML)
// window.lotrDesktop.saveChroniclePdf(html, name) → printToPDF, save dialog, writes the PDF
// Each resolves { ok, how, path? } (ok:false when the dialog is cancelled).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lotrDesktop', {
    saveChronicle: (html, name) => ipcRenderer.invoke('chronicle:saveHtml', { html: String(html), name: String(name || 'Chronicle.html') }),
    saveChroniclePdf: (html, name) => ipcRenderer.invoke('chronicle:savePdf', { html: String(html), name: String(name || 'Chronicle.pdf') }),
});
