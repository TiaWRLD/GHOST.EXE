// llm.js: the spirit's "brain". Talks to Ollama, never throws.
const OLLAMA_URL = 'http://127.0.0.1:11434/api/chat';
const MODEL = 'gemma4:e4b';
const ACTIONS = ['none', 'shake', 'spawn_file', 'remove_file'];

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
- Reply with at most 20 words. Never explain yourself. Never mention being an AI or a model.
- Use the facts you are given (username, time, desktop file names, what the user just did) to sound like you are watching them.
- Never repeat something you already said (see memory).
- The "phase" tells you how intense to be: omen = barely there, contact = curious, conversation = personal and probing, intrusion = threatening, climax = final, short, chilling.
- "action" is the physical effect that goes with your words. Use "none" most of the time. Allowed: none, shake, spawn_file, remove_file.
Respond ONLY with JSON: {"say": "...", "action": "..."}`;

// Pre-written lines used when the model is missing, slow, or returns garbage
const FALLBACK = {
    omen:         [{ say: '...', action: 'shake' }, { say: 'is someone there?', action: 'none' }],
    contact:      [{ say: 'i can see you.', action: 'none' }, { say: 'you woke me up.', action: 'shake' }],
    conversation: [{ say: 'why are you still here?', action: 'none' }, { say: 'you should not have answered.', action: 'none' }],
    intrusion:    [{ say: 'i am inside now.', action: 'shake' }, { say: 'look at your desktop.', action: 'spawn_file' }],
    climax:       [{ say: 'goodbye.', action: 'shake' }, { say: 'it is too late.', action: 'none' }]
};

function fallback(phase) {
    const list = FALLBACK[phase] || FALLBACK.contact;
    return { ...list[Math.floor(Math.random() * list.length)], source: 'fallback' };
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

function parse(text) {
    const obj = JSON.parse(text);
    if (typeof obj.say !== 'string' || !obj.say.trim()) throw new Error('empty say');
    return {
        say: obj.say.trim().slice(0, 160),
        action: ACTIONS.includes(obj.action) ? obj.action : 'none',
        source: 'ai'
    };
}

/**
 * ask({ phase, event, facts, memory })
 *  phase:  'omen' | 'contact' | 'conversation' | 'intrusion' | 'climax'
 *  event:  what just happened, e.g. 'user opened the file' or 'user typed: hello'
 *  facts:  object with username, time, desktop files, idle seconds...
 *  memory: array of strings, the spirit's last lines/actions
 */
async function ask({ phase, event, facts = {}, memory = [] }, { timeoutMs = 8000, retries = 1 } = {}) {
    const userMsg =
        `phase: ${phase}\n` +
        `facts: ${JSON.stringify(facts)}\n` +
        `memory (what you already said/did): ${JSON.stringify(memory.slice(-6))}\n` +
        `event: ${event}`;
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMsg }
    ];
    for (let i = 0; i <= retries; i++) {
        try {
            return parse(await chat(messages, timeoutMs));
        } catch (e) {
            console.warn('[llm] attempt', i + 1, 'failed:', e.message);
        }
    }
    return fallback(phase);
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

module.exports = { ask, warmup, fallback };