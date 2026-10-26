const { app, BrowserWindow, screen, desktopCapturer, ipcMain,
        globalShortcut, systemPreferences } = require('electron');
const path = require('path');
const os = require('os');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const user = os.userInfo().username;
let overlay, term;

// ---------- Finestre ----------
function createOverlay() {
  const { bounds } = screen.getPrimaryDisplay();
  overlay = new BrowserWindow({
    ...bounds,
    transparent: true, frame: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true, { forward: true }); // click-through
  overlay.loadFile('overlay.html');
}

async function openTerminal() {
  if (term && !term.isDestroyed()) return term;
  const wa = screen.getPrimaryDisplay().workArea;
  term = new BrowserWindow({
    width: 560, height: 300,
    x: wa.x + Math.round(wa.width * 0.3), y: wa.y + Math.round(wa.height * 0.35),
    title: 'Terminal', backgroundColor: '#050505', alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  term.setMenuBarVisibility(false);
  term.loadFile('terminal.html');
  await new Promise(r => term.webContents.once('did-finish-load', r));
  return term;
}

// ---------- Effetti ----------
async function grabScreen() {
  try {
    if (process.platform === 'darwin' &&
        systemPreferences.getMediaAccessStatus('screen') === 'denied') return null;
    const d = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: d.size.width * d.scaleFactor, height: d.size.height * d.scaleFactor }
    });
    const s = sources.find(s => s.display_id === String(d.id)) || sources[0];
    if (!s || s.thumbnail.isEmpty()) return null;
    return 'data:image/jpeg;base64,' + s.thumbnail.toJPEG(70).toString('base64');
  } catch { return null; }
}

async function shake(intensity = 6, duration = 400) {
  const img = await grabScreen();               // null => effetto di ripiego
  overlay.webContents.send('shake', { img, intensity, duration });
  await sleep(duration + 100);
}

async function say(lines) {
  const t = await openTerminal();
  t.webContents.send('say', lines);
  await sleep(lines.join('').length * 90 + lines.length * 900); // stima della durata
}

// ---------- Director: la sequenza ----------
let closedReactionDone = false;

async function onFileOpened() {
  await say(['...', `ciao, ${user}.`, "aspettavo qualcuno da un po'."]);
  if (!closedReactionDone) {
    closedReactionDone = true;
    term.once('closed', async () => {
      await sleep(15000);
      await shake(10, 500);
      await say(["perché l'hai chiuso?"]);
    });
  }
}

async function director() {
  await sleep(5000);  await shake(3, 150);   // presagio
  await sleep(9000);  await shake(7, 350);
  await sleep(6000);
  overlay.webContents.send('spawn-file', { name: 'non_aprirla.txt', icon: '📄' });
}

// ---------- IPC ----------
ipcMain.on('clickable', (_e, v) => overlay.setIgnoreMouseEvents(!v, { forward: true }));
ipcMain.on('file-opened', () => onFileOpened());

// ---------- Avvio ----------
app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock.hide();
  createOverlay();
  // USCITA DI SICUREZZA: chiude tutto, sempre
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());
  overlay.webContents.once('did-finish-load', director);
});
