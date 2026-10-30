const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ghost', {
  platform: process.platform,
  setClickable: v => ipcRenderer.send('clickable', v),
  fileOpened: name => ipcRenderer.send('file-opened', name),
  userSaid: text => ipcRenderer.send('user-said', text),
  errorDismissed: byUser => ipcRenderer.send('error-dismissed', !!byUser),
  log: msg => ipcRenderer.send('log', String(msg)),   // renderer -> main console (debug)
  // startup warning window
  getStatus: () => ipcRenderer.invoke('get-status'),
  begin: () => ipcRenderer.send('begin'),
  quitApp: () => ipcRenderer.send('quit-app'),
  // main -> renderer events
  onShake: cb => ipcRenderer.on('shake', (_e, d) => cb(d)),
  onSpawnFile: cb => ipcRenderer.on('spawn-file', (_e, d) => cb(d)),
  onRemoveFile: cb => ipcRenderer.on('remove-file', (_e, d) => cb(d)),
  onMoveFile: cb => ipcRenderer.on('move-file', (_e, d) => cb(d)),
  onFakeError: cb => ipcRenderer.on('fake-error', (_e, d) => cb(d)),
  onSound: cb => ipcRenderer.on('sound', (_e, d) => cb(d)),
  onSay: cb => ipcRenderer.on('say', (_e, lines) => cb(lines))
});