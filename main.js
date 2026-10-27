const { app, BrowserWindow, screen, desktopCapturer, ipcMain,
  globalShortcut, systemPreferences } = require('electron');
const path = require('path');
const { ask, warmup } = require('./llm');
const sensors = require('./sensors');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const FILE_NAME = "DON'T OPEN ME";
const EXTRA_FILES = ['I SEE YOU.txt', 'LOOK BEHIND YOU.txt', 'HELP ME.txt'];
let overlay, term;

// ---------- Spirit state ----------
const memory = [];          // what the spirit said/did and what the user did
let turns = 0;
let phase = 'contact';
let llmReady = false;
let extraSpawned = 0;
let greeted = false;
let closedReactionDone = false;
let turnQueue = Promise.resolve();

// ---------- Windows ----------
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
  overlay.setIgnoreMouseEvents(true, { forward: true });
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

// ---------- Effects ----------
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
  const img = await grabScreen();
  overlay.webContents.send('shake', { img, intensity, duration });
  await sleep(duration + 100);
}

async function say(lines) {
  const t = await openTerminal();
  t.webContents.send('say', lines);
  await sleep(lines.join('').length * 90 + lines.length * 900);
}

// ---------- The spirit's brain ----------
async function perform(action) {
  if (action === 'shake') await shake(8, 450);
  else if (action === 'spawn_file' && extraSpawned < EXTRA_FILES.length) {
    overlay.webContents.send('spawn-file', { name: EXTRA_FILES[extraSpawned++], icon: '📄' });
    await sleep(600);
  } else if (action === 'remove_file') {
    overlay.webContents.send('remove-file');
    await sleep(700);
  }
}

async function spiritTurn(event) {
  turns++;
  phase = turns < 2 ? 'contact' : turns < 5 ? 'conversation' : 'intrusion';
  memory.push('event: ' + event);

  const r = await ask(
      { phase, event, facts: sensors.read(), memory },
      { timeoutMs: llmReady ? 8000 : 20000 }
  );
  console.log(`[spirit] phase=${phase} source=${r.source}`, r);

  memory.push(`you said: "${r.say}"` + (r.action !== 'none' ? ` (and you did: ${r.action})` : ''));
  await perform(r.action);
  await say([r.say]);
}

// ---------- Director ----------
async function onFileOpened() {
  const user = sensors.read().username;
  if (greeted) { await openTerminal(); return; }
  greeted = true;

  await say(['...', `Hi, ${user}.`, "I've been waiting for someone for a while..."]);
  memory.push('you greeted the user by name and said you had been waiting for someone');

  if (!closedReactionDone) {
    closedReactionDone = true;
    term.once('closed', async () => {
      await sleep(15000);
      await shake(10, 500);
      memory.push('the user closed the terminal; you asked: why did you close it?');
      await say(['why did you close it?']);
    });
  }
}

async function director() {
  await sleep(5000);  await shake(3, 150);   // omen
  await sleep(9000);  await shake(7, 350);
  await sleep(6000);
  overlay.webContents.send('spawn-file', { name: FILE_NAME, icon: '📄' });
}

// ---------- IPC ----------
ipcMain.on('clickable', (_e, v) => overlay.setIgnoreMouseEvents(!v, { forward: true }));
ipcMain.on('file-opened', () => onFileOpened());
ipcMain.on('user-said', (_e, text) => {
  // queue messages so each one gets an answer, in order
  turnQueue = turnQueue
      .then(() => spiritTurn(`user typed: "${String(text).slice(0, 200)}"`))
      .catch(e => console.error('[turn] error', e));
});

// ---------- Start ----------
app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock.hide();
  createOverlay();
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());   // emergency exit
  warmup().then(ok => { llmReady = ok; });   // load the model while the omens play
  overlay.webContents.once('did-finish-load', director);
});