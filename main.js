const { app, BrowserWindow, screen, desktopCapturer, ipcMain,
  globalShortcut, systemPreferences } = require('electron');
const path = require('path');
const fs = require('fs');
const { ask, warmup } = require('./llm');
const sensors = require('./sensors');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const FILE_NAME = "DON'T OPEN ME";
const EXTRA_FILES = ['I SEE YOU.txt', 'LOOK BEHIND YOU.txt', 'HELP ME.txt'];
const TERM_Y_RATIO = 0.04;   // terminal vertical position (0 = top of the work area)
let overlay, term;

// ---------- Phases ----------
// The interactive phases, in order. After the last one comes the scripted climax.
//  drone / heart : audio levels 0-5
//  idleEvery     : seconds of user silence before the spirit speaks on its own
//  minTurns/minSec : the phase can end once BOTH are reached...
//  maxSec        : ...or when this time runs out, whatever the user does
//  ambientChance : probability per second of a random breath/whisper/glitch
const PHASES = {
  contact:      { drone: 2, heart: 0, idleEvery: 25, minTurns: 1, minSec: 60,  maxSec: 120, ambientChance: 0.02 },
  conversation: { drone: 3, heart: 2, idleEvery: 20, minTurns: 3, minSec: 110, maxSec: 190, ambientChance: 0.05 },
  intrusion:    { drone: 4, heart: 4, idleEvery: 14, minTurns: 2, minSec: 90,  maxSec: 150, ambientChance: 0.08 }
};
const ORDER = ['contact', 'conversation', 'intrusion'];

// ---------- Spirit state ----------
const memory = [];          // what the spirit said/did and what the user did
let phase = 'omen';         // omen -> contact -> conversation -> intrusion -> climax -> end
let phaseStart = Date.now();
let phaseTurns = 0;         // user-triggered turns in the current phase
let lastActivity = Date.now();
let llmReady = false;
let extraSpawned = 0;
let fileCount = 0;          // fake files currently on screen
let greeted = false;
let closedReactionDone = false;

// All spirit actions run one at a time through this queue
let turnQueue = Promise.resolve();
let busy = 0;               // jobs queued or running
function enqueue(job) {
  busy++;
  turnQueue = turnQueue
      .then(job)
      .catch(e => console.error('[job] error', e))
      .then(() => { busy--; });
}

// ---------- Windows ----------
function createOverlay() {
  const { bounds } = screen.getPrimaryDisplay();
  overlay = new BrowserWindow({
    ...bounds,
    transparent: true, frame: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      autoplayPolicy: 'no-user-gesture-required'   // audio must start without a click
    }
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
    x: wa.x + Math.round(wa.width * 0.3), y: wa.y + Math.round(wa.height * TERM_Y_RATIO),
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

// The overlay plays glitch + thud by itself on every shake
async function shake(intensity = 6, duration = 400) {
  const img = await grabScreen();
  overlay.webContents.send('shake', { img, intensity, duration });
  await sleep(duration + 100);
}

// Send a sound command to the overlay, e.g. sound('heartbeat', { level: 2 })
function sound(name, opts = {}) {
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send('sound', { sound: name, ...opts });
}

// prompt:false = the terminal does not show the input line afterwards (endings, aftermath)
async function say(lines, { prompt = true } = {}) {
  sound('whisper');
  const t = await openTerminal();
  t.webContents.send('say', { lines, prompt });
  await sleep(lines.join('').length * 90 + lines.length * 900);
}

// File bookkeeping, so we always know how many fake files are on screen
function spawnFile(name) {
  fileCount++;
  overlay.webContents.send('spawn-file', { name, icon: '📄' });
}
function removeFile() {
  if (fileCount <= 0) return;
  fileCount--;
  overlay.webContents.send('remove-file');
}

// Random background sound, so the room feels alive even when nobody is typing
function ambient() {
  const pick = ['breath', 'whisper', 'glitch'][Math.floor(Math.random() * 3)];
  sound(pick, pick === 'glitch' ? { intensity: 2, duration: 200 } : {});
}

// ---------- The spirit's brain ----------
async function perform(action) {
  if (action === 'shake') await shake(8, 450);
  else if (action === 'spawn_file' && extraSpawned < EXTRA_FILES.length) {
    spawnFile(EXTRA_FILES[extraSpawned++]);
    await sleep(600);
  } else if (action === 'remove_file' && fileCount > 1) {   // never remove the original file
    removeFile();
    extraSpawned = Math.max(0, extraSpawned - 1);           // it can come back later
    await sleep(700);
  }
}

async function spiritTurn(event) {
  memory.push('event: ' + event);

  const r = await ask(
      { phase, event, facts: sensors.read(), memory },
      { timeoutMs: llmReady ? 8000 : 20000 }
  );
  console.log(`[spirit] phase=${phase} source=${r.source}`, r);

  memory.push(`you said: "${r.say}"` + (r.action !== 'none' ? ` (and you did: ${r.action})` : ''));
  await perform(r.action);
  await say([r.say]);
  lastActivity = Date.now();
}

// ---------- Phase machine ----------
async function enterPhase(name, dramatic = true) {
  phase = name;
  phaseTurns = 0;
  const p = PHASES[name];
  console.log(`[phase] -> ${name}`);
  if (dramatic) {
    sound('silence', { ms: 1800 });      // the room goes quiet...
    await sleep(1900);
    await shake(5 + p.drone, 350);       // ...then a hit, harder at each phase
  }
  sound('drone', { level: p.drone, fade: 2 });
  sound('heartbeat', { level: p.heart });
  phaseStart = Date.now();
}

async function nextPhase() {
  const i = ORDER.indexOf(phase);
  if (i === -1) return;                  // omen / climax / end: not ours to advance
  if (i === ORDER.length - 1) return climax();
  await enterPhase(ORDER[i + 1]);
  await spiritTurn('you are growing stronger. speak to the user first, unprompted.');
}

// Runs every second during the interactive phases
function tick() {
  const p = PHASES[phase];
  if (!p) return;                        // omen, climax and end are driven by the director
  if (busy === 0 && Math.random() < p.ambientChance) ambient();
  if (busy > 0) return;                  // the spirit is still speaking or acting

  const now = Date.now();
  const inPhase = (now - phaseStart) / 1000;
  const idle = (now - lastActivity) / 1000;
  const ready = (phaseTurns >= p.minTurns && inPhase >= p.minSec) || inPhase >= p.maxSec;

  if (ready) enqueue(nextPhase);
  else if (idle >= p.idleEvery) {
    enqueue(() => spiritTurn(`the user has been silent for ${Math.round(idle)} seconds`));
  }
}

// ---------- Climax and ending ----------
const ENDING_FILE = () => path.join(app.getPath('userData'), 'ending.json');

function saveEnding(lastLine) {
  try { fs.writeFileSync(ENDING_FILE(), JSON.stringify({ at: Date.now(), lastLine })); }
  catch (e) { console.warn('[ending] could not save marker:', e.message); }
}

// Read and delete the marker left by a previous ending (null if there is none)
function takeEnding() {
  try {
    const data = JSON.parse(fs.readFileSync(ENDING_FILE(), 'utf8'));
    fs.unlinkSync(ENDING_FILE());
    return data;
  } catch { return null; }
}

async function climax() {
  phase = 'climax';
  console.log('[phase] -> climax');
  memory.push('the final moment begins');

  // start thinking about the last words now: the model has time while the chaos plays
  const finalLine = ask(
      { phase: 'climax',
        event: 'this is the end. you are leaving this machine for good. say your last words to the user.',
        facts: sensors.read(), memory },
      { timeoutMs: llmReady ? 8000 : 20000 }
  );

  sound('silence', { ms: 2500 });        // the calm before
  await sleep(2700);
  sound('drone', { level: 5, fade: 0.5 });
  sound('heartbeat', { level: 5 });

  // escalating shakes, gaps getting shorter
  const gaps = [600, 450, 300, 200, 100];
  for (let i = 0; i < gaps.length; i++) {
    await shake(9 + i * 2, 350);
    if (i % 2 === 1) sound('whisper');
    await sleep(gaps[i]);
  }

  // everything on the desktop disappears, one by one
  // (600 ms apart: the overlay removes the LAST file, and its shake animation lasts 500 ms)
  while (fileCount > 0) { removeFile(); await sleep(600); }
  await sleep(500);

  // last hit, then total silence cuts its tail
  const lastHit = shake(18, 700);
  await sleep(500);
  sound('heartbeat', { level: 0 });
  sound('drone', { level: 0, fade: 0.05 });
  sound('silence', { restore: false });
  await lastHit;

  // empty desktop, no sound... then the last words appear on their own
  await sleep(2500);
  const r = await finalLine;
  console.log('[spirit] final line', r);
  memory.push(`your last words were: "${r.say}"`);
  await say([r.say], { prompt: false });

  await sleep(5000);
  if (term && !term.isDestroyed()) term.close();
  phase = 'end';

  await sleep(10000);                    // ten seconds of empty silence
  saveEnding(r.say);
  app.quit();
}

// ---------- Director ----------
function onFileOpened(name) {
  // Later opens: the spirit reacts to WHICH file was opened
  if (greeted) {
    if (PHASES[phase]) {
      phaseTurns++;
      lastActivity = Date.now();
      enqueue(() => spiritTurn(`the user double-clicked the file "${name}"`));
    }
    return;
  }
  greeted = true;

  enqueue(async () => {
    phase = 'contact';                   // from now on, typed messages are accepted (and queued)
    const user = sensors.read().username;
    const t = await openTerminal();

    // The key trick: if the user closes the terminal, the spirit notices
    if (!closedReactionDone) {
      closedReactionDone = true;
      t.once('closed', () => {
        setTimeout(() => enqueue(async () => {
          if (!PHASES[phase]) return;    // the ending has begun: no more tricks
          sound('silence', { ms: 2500 });
          await sleep(2600);
          await shake(10, 500);
          memory.push('the user closed the terminal; you asked: why did you close it?');
          await say(['why did you close it?']);
          lastActivity = Date.now();
        }), 15000);
      });
    }

    await say(['...', `Hi, ${user}.`, "I've been waiting for someone for a while..."]);
    memory.push('you greeted the user by name and said you had been waiting for someone');
    await enterPhase('contact', false);
    lastActivity = Date.now();
  });
}

// Shown at the start of a run that follows a completed ending
async function showAftermath() {
  const user = sensors.read().username;
  sound('heartbeat', { level: 1 });
  await sleep(4000);
  await say(['...', `you came back, ${user}.`, 'i never left.'], { prompt: false });
  await sleep(4000);
  if (term && !term.isDestroyed()) term.close();
  sound('heartbeat', { level: 0 });
  await sleep(3000);
}

async function director(aftermath) {
  sound('drone', { level: 1, fade: 4 });                  // barely audible from the start
  if (aftermath) await showAftermath();
  await sleep(5000);  await shake(3, 150);   // omen
  await sleep(9000);  sound('drone', { level: 2, fade: 2 });
  await shake(7, 350);
  await sleep(6000);
  sound('whisper');
  spawnFile(FILE_NAME);

  // if the user ignores the file, nudge them now and then
  while (!greeted) {
    await sleep(35000);
    if (greeted) break;
    sound('whisper');
    await shake(4, 250);
  }
}

// ---------- IPC ----------
ipcMain.on('clickable', (_e, v) => overlay.setIgnoreMouseEvents(!v, { forward: true }));
ipcMain.on('file-opened', (_e, name) => onFileOpened(String(name)));
ipcMain.on('log', (_e, msg) => console.log('[overlay]', msg));
ipcMain.on('user-said', (_e, text) => {
  if (!PHASES[phase]) return;            // ignore input outside the interactive phases
  phaseTurns++;
  lastActivity = Date.now();
  const clean = String(text).slice(0, 200);
  enqueue(() => spiritTurn(`user typed: "${clean}"`));
});

// ---------- Dev only ----------
// Cmd/Ctrl+Shift+T : cycle through the sounds
// Cmd/Ctrl+Shift+N : skip to the next phase (the last skip starts the climax)
const SOUND_TESTS = [
  ['whisper',           'whisper',   {}],
  ['whisper (again)',   'whisper',   {}],
  ['breath',            'breath',    {}],
  ['heartbeat level 1', 'heartbeat', { level: 1 }],
  ['heartbeat level 3', 'heartbeat', { level: 3 }],
  ['heartbeat level 5', 'heartbeat', { level: 5 }],
  ['heartbeat off',     'heartbeat', { level: 0 }],
  ['glitch',            'glitch',    { intensity: 8, duration: 450 }],
  ['thud',              'thud',      { vol: 1 }],
  ['silence 2s',        'silence',   { ms: 2000 }],
  ['drone level 4',     'drone',     { level: 4, fade: 1 }],
  ['drone level 1',     'drone',     { level: 1, fade: 1 }]
];
let testIndex = 0;

// ---------- Start ----------
app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock.hide();
  const aftermath = takeEnding();        // did a previous run end properly?
  createOverlay();
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());   // emergency exit
  if (!app.isPackaged) {
    globalShortcut.register('CommandOrControl+Shift+T', () => {
      const [label, name, opts] = SOUND_TESTS[testIndex++ % SOUND_TESTS.length];
      console.log('[sound test]', label);
      sound(name, opts);
    });
    globalShortcut.register('CommandOrControl+Shift+N', () => {
      if (!PHASES[phase]) { console.log('[dev] cannot skip now, phase =', phase); return; }
      console.log('[dev] skipping to the next phase');
      enqueue(nextPhase);
    });
  }
  warmup().then(ok => { llmReady = ok; });   // load the model while the omens play
  setInterval(tick, 1000);
  overlay.webContents.once('did-finish-load', () => director(aftermath));
});

app.on('will-quit', () => globalShortcut.unregisterAll());