const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ghost', {
  platform: process.platform,
  setClickable: v => ipcRenderer.send('clickable', v),
  fileOpened: name => ipcRenderer.send('file-opened', name),
  onShake: cb => ipcRenderer.on('shake', (_e, d) => cb(d)),
  onSpawnFile: cb => ipcRenderer.on('spawn-file', (_e, d) => cb(d)),
  onSay: cb => ipcRenderer.on('say', (_e, lines) => cb(lines))
});
