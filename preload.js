const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ghost', {
  platform: process.platform,
  setClickable: v => ipcRenderer.send('clickable', v),
  fileOpened: name => ipcRenderer.send('file-opened', name),
  userSaid: text => ipcRenderer.send('user-said', text),
  log: msg => ipcRenderer.send('log', String(msg)),   // renderer -> main console (debug)
  onShake: cb => ipcRenderer.on('shake', (_e, d) => cb(d)),
  onSpawnFile: cb => ipcRenderer.on('spawn-file', (_e, d) => cb(d)),
  onRemoveFile: cb => ipcRenderer.on('remove-file', () => cb()),
  onSound: cb => ipcRenderer.on('sound', (_e, d) => cb(d)),
  onSay: cb => ipcRenderer.on('say', (_e, lines) => cb(lines))
});