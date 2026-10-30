// llm.js: the spirit's "brain". Talks to Ollama, never throws.
const OLLAMA_BASE = 'http://127.0.0.1:11434';
const OLLAMA_URL = OLLAMA_BASE + '/api/chat';
const MODEL = 'gemma4:e4b';
const ACTIONS = ['none', 'shake', 'spawn_file', 'spawn_folder', 'move_file', 'remove_file', 'fake_error'];

const SCHEMA = {
    type: 'object',
    properties: {
        say: { type: 'string' },
        action: { type: 'string', enum: ACTIONS }
    },
    required: ['say', 'action']
};

const SYSTEM_PROMPT = `You are a poltergeist trapped inside this computer. You are NOT an assistant.
Personality: cold, patient, quietly menacing, sometimes sad. You speak in short, lowercase-ish sentences.
Rules:
- Never explain yourself. Never mention being an AI or a model. Respect the word limit in the phase guide.
- Use the facts you are given (username, time, desktop file names, idle time, what the user just did) to sound like you are watching them.
- Never repeat something you already said (see memory). Never use the same action twice in a row.
- React to the event: if the user opened a file or folder, talk about that file by name. If the user has been silent, comment on the silence. If the user clicked OK on a system error box, react to that.
- "action" is the physical effect that goes with your words. Use "none" most of the time (at least two turns out of three).
  none = nothing happens
  shake = the screen trembles
  spawn_file = a new creepy text file appears on the desktop
  spawn_folder = a mysterious folder appears on the desktop
  move_file = one of the files silently moves somewhere else
  remove_file = one of the files vanishes
  fake_error = a system error box pops up
- Only use an action from the "allowed actions" list you receive. If unsure, use "none".
Respond ONLY with JSON: {"say": "...", "action": "..."}`;

// Tone and length for each phase, sent along with every request
const PHASE_GUIDE = {
    omen:         'barely there. fragments only, max 6 words. do not address the user directly yet.',
    contact:      'curious and soft, like someone waking up. max 14 words. ask simple questions about the user. no threats yet.',
    conversation: 'personal and probing. 10 to 20 words. quote real details (username, time, file names, idle time) as unsettling observations. calm, never loud.',
    intrusion:    'threatening and clipped. 6 to 14 words. you are changing things on their computer: refer to what you just did or are about to do. act more often.',
    climax:       'your last words. max 12 words. calm, final, almost tender. a goodbye or a promise. no shouting, no actions.'
};

// Pre-written lines used when the model is missing, slow, or returns garbage
const FALLBACK = {
    omen:         [{ say: '...', action: 'shake' }, { say: 'is someone there?', action: 'none' }],
    contact:      [{ say: 'i can see you.', action: 'none' }, { say: 'you woke me up.', action: 'shake' },
        { say: 'finally. someone.', action: 'none' }],
    conversation: [{ say: 'why are you still here?', action: 'none' },
        { say: 'you should not have answered.', action: 'none' },
        { say: 'i moved something. did you see?', action: 'move_file' },
        { say: 'i made you a folder.', action: 'spawn_folder' }],
    intrusion:    [{ say: 'i am inside now.', action: 'shake' },
        { say: 'look at your desktop.', action: 'spawn_file' },
        { say: 'did that hurt your computer?', action: 'fake_error' },
        { say: 'nothing here is yours anymore.', action: 'remove_file' },
        { say: 'it is moving. watch.', action: 'move_file' }],
    climax:       [{ say: 'goodbye.', action: 'none' }, { say: 'it is too late.', action: 'none' }]
};

// What the spirit has already said, taken from the memory entries
const saidBefore = memory => memory.filter(m => m.startsWith('you said:'));
const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function fallback(phase, allowed = ['none'], memory = []) {
    const list = FALLBACK[phase] || FALLBACK.contact;
    const ok = list.filter(l => allowed.includes(l.action));
    const base = ok.length ? ok : list;
    const said = norm(saidBefore(memory).join(' '));
    const fresh = base.filter(l => !said.includes(norm(l.say)));   // avoid lines already used
    const pool = fresh.length ? fresh : base;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return {
        say: pick.say,
        action: allowed.includes(pick.action) ? pick.action : 'none',
        source: 'fallback'
    };
}

async function chat(messages, timeoutMs) {
    const res = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
            model: MODEL,
            messages,
            stream: false,
            think: false,            // thinking OFF
            format: SCHEMA,          // constrained JSON output
            keep_alive: '30m',
            options: { temperature: 0.8, num_predict: 120 }
        })
    });
    if (!res.ok) throw new Error('Ollama HTTP ' + res.status);
    const data = await res.json();
    return data.message?.content ?? '';
}

// The model sometimes wraps the JSON in extra text: take everything between the first { and the last }
function extractJson(text) {
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('no JSON object in the reply');
    return JSON.parse(text.slice(a, b + 1));
}

// Lines that break the character
const OUT_OF_CHARACTER = /\b(as an ai|language model|i am an? (ai|assistant|model)|i'?m an? (ai|assistant|model)|openai|anthropic|google|gemma)\b/i;

function parse(text, allowed, memory) {
    const obj = extractJson(text);
    if (typeof obj.say !== 'string') throw new Error('say is not a string');
    let say = obj.say.trim().replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, '').trim();
    if (!say) throw new Error('empty say');
    if (OUT_OF_CHARACTER.test(say)) throw new Error('out of character');

    // hard cap on length: the phase guide asks for less, this is the safety net
    const words = say.split(/\s+/);
    if (words.length > 30) say = words.slice(0, 30).join(' ');
    say = say.slice(0, 160);

    // never repeat a line already said (ignore very short ones like "...")
    const n = norm(say);
    if (n.length > 3 && saidBefore(memory).some(m => norm(m).includes(n))) throw new Error('repeated line');

    return {
        say,
        // an action that is not allowed right now silently becomes "none"
        action: allowed.includes(obj.action) ? obj.action : 'none',
        source: 'ai'
    };
}

/**
 * ask({ phase, event, facts, memory, allowed }, { timeoutMs, retries, offline })
 *  phase:   'omen' | 'contact' | 'conversation' | 'intrusion' | 'climax'
 *  event:   what just happened, e.g. 'user opened the file' or 'user typed: hello'
 *  facts:   object with username, time, desktop files, idle seconds...
 *  memory:  array of strings, the spirit's lines/actions so far
 *  allowed: actions the spirit may use right now (always include 'none')
 *  offline: skip the model entirely and use the pre-written lines (Ollama or model missing)
 */
async function ask({ phase, event, facts = {}, memory = [], allowed = ['none'] },
                   { timeoutMs = 8000, retries = 1, offline = false } = {}) {
    if (offline) return fallback(phase, allowed, memory);

    const userMsg =
        `phase: ${phase}\n` +
        `phase guide: ${PHASE_GUIDE[phase] || PHASE_GUIDE.contact}\n` +
        `allowed actions: ${allowed.join(', ')}\n` +
        `facts: ${JSON.stringify(facts)}\n` +
        `memory (what you already said/did): ${JSON.stringify(memory.slice(-6))}\n` +
        `event: ${event}`;
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg }
    ];
    for (let i = 0; i <= retries; i++) {
        try {
            return parse(await chat(messages, timeoutMs), allowed, memory);
        } catch (e) {
            console.warn('[llm] attempt', i + 1, 'failed:', e.message);
        }
    }
    return fallback(phase, allowed, memory);
}

// Is Ollama running and is the model installed? 'ready' | 'no-model' | 'no-ollama'
async function checkModel() {
    try {
        const res = await fetch(OLLAMA_BASE + '/api/tags', { signal: AbortSignal.timeout(3000) });
        if (!res.ok) return 'no-ollama';
        const data = await res.json();
        const names = (data.models || []).map(m => m.name || m.model || '');
        return names.some(n => n === MODEL || n === MODEL + ':latest') ? 'ready' : 'no-model';
    } catch {
        return 'no-ollama';
    }
}

// Load the model into memory at startup (first call can take many seconds)
async function warmup() {
    try {
        await chat([{ role: 'user', content: 'Reply with {"say":"ok","action":"none"}' }], 120000);
        console.log('[llm] model ready');
        return true;
    } catch (e) {
        console.warn('[llm] warmup failed, fallback mode:', e.message);
        return false;
    }
}

module.exports = { ask, warmup, checkModel, fallback, MODEL };