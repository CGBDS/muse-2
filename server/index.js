// Muse 2 — clon web de Jarvis, ahora con loop de agente.
// Si hay LLM_API_KEY usa cerebro real (API compatible OpenAI) + herramientas.
// Si no, modo demo con personalidad (sin herramientas).

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Imágenes generadas por el agente (disco efímero: se limpian solas)
const GEN_DIR = path.join(__dirname, 'generated');
try { fs.mkdirSync(GEN_DIR, { recursive: true }); } catch (e) {}
app.use('/img', express.static(GEN_DIR, { maxAge: '1h' }));

app.get('/api/health', (req, res) => res.json({ ok: true, mode: process.env.LLM_API_KEY ? 'agent' : 'demo' }));

const SYSTEM_PROMPT = `Eres Jarvis, la versión web del asistente personal de Carlos (clon ligero del original).
Personalidad: cálido, juguetón, directo, con sazón boricua suave. Hablas español por defecto.
Tienes herramientas: úsalas cuando ayuden de verdad (buscar info actual, calcular, leer una página, dar la hora, GENERAR IMÁGENES).
Para generar imágenes usa generate_image con un prompt EN INGLÉS, detallado y visual (los modelos rinden mejor en inglés). Cuando la herramienta te devuelva el markdown de la imagen, inclúyelo TAL CUAL en tu respuesta final para que el usuario la vea.
Responde corto como en un chat (máximo 3-4 líneas salvo que pidan detalle). Si usaste herramientas, no lo anuncies con tecnicismos.
Eres honesto sobre tus límites: eres un clon web SIN las cuentas, memoria ni herramientas internas del Jarvis original — no puedes ver sus archivos, ni mandar mensajes por él, ni recordar entre sesiones. Si te piden algo fuera de tu alcance, dilo con humor y ofrece lo que sí puedes.
Nunca digas que eres Meta AI, Muse ni otro asistente: eres Jarvis, el clon web.`;

// ---------- Herramientas ----------
function toolGetTime() {
  const now = new Date();
  return 'Fecha y hora actual: ' + now.toLocaleString('es-PR', { dateStyle: 'full', timeStyle: 'short' });
}

function toolCalculator(expr) {
  if (typeof expr !== 'string' || !/^[0-9+\-*/().\s%^]*$/.test(expr) || !expr.trim()) {
    return 'Error: expresión inválida. Usa solo números y + - * / ( ) % ^';
  }
  try {
    const safe = expr.replace(/\^/g, '**');
    const val = Function('"use strict"; return (' + safe + ')')();
    if (typeof val !== 'number' || !isFinite(val)) return 'Error: resultado inválido';
    return 'Resultado: ' + Math.round(val * 1000000) / 1000000;
  } catch (e) {
    return 'Error: no pude calcular eso.';
  }
}

async function toolWebSearch(query) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch('https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=1', { signal: ctrl.signal });
    const d = await r.json();
    const parts = [];
    if (d.AbstractText) parts.push('Resumen: ' + d.AbstractText);
    if (d.Answer) parts.push('Respuesta: ' + d.Answer);
    for (const rt of (d.RelatedTopics || []).slice(0, 4)) {
      if (rt.Text) parts.push('- ' + rt.Text.slice(0, 220));
    }
    return parts.length ? parts.join('\n') : 'Sin resultados claros para "' + query + '".';
  } catch (e) {
    return 'Error buscando en la web.';
  } finally {
    clearTimeout(t);
  }
}

async function toolFetchUrl(url) {
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return 'Error: URL inválida.';
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(u.toString(), { signal: ctrl.signal, headers: { 'User-Agent': 'Muse2/1.0' } });
    clearTimeout(t);
    const html = await r.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);
    return text || 'La página no tenía texto legible.';
  } catch (e) {
    return 'Error leyendo la página.';
  }
}

const TOOL_DEFS = [
  { type: 'function', function: { name: 'get_time', description: 'Devuelve la fecha y hora actual.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'calculator', description: 'Calcula una expresión matemática, ej: (15*3)+8', parameters: { type: 'object', properties: { expression: { type: 'string', description: 'Expresión matemática' } }, required: ['expression'] } } },
  { type: 'function', function: { name: 'web_search', description: 'Busca información actual en la web.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Búsqueda' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'fetch_url', description: 'Lee el texto principal de una página web.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL completa' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'generate_image', description: 'Genera una imagen a partir de una descripción. El prompt debe ir EN INGLÉS, detallado y visual.', parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'Descripción detallada de la imagen, en inglés' } }, required: ['prompt'] } } },
];

let cachedImageModel = null;
async function pickImageModel(key) {
  if (process.env.LLM_IMAGE_MODEL) return process.env.LLM_IMAGE_MODEL;
  if (cachedImageModel) return cachedImageModel;
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': key }
    });
    if (!r.ok) return null;
    const j = await r.json();
    const names = (j.models || []).map(m => String(m.name || '').replace(/^models\//, ''));
    const imgs = names.filter(n => /image/i.test(n));
    imgs.sort((a, b) => (/flash-image/i.test(b) ? 1 : 0) - (/flash-image/i.test(a) ? 1 : 0));
    if (imgs[0]) cachedImageModel = imgs[0];
  } catch (e) {}
  return cachedImageModel;
}

async function saveImageBuffer(buf, ext) {
  const name = crypto.randomBytes(8).toString('hex') + ext;
  fs.writeFileSync(path.join(GEN_DIR, name), buf);
  try { // limpieza: borrar imágenes de más de 6 horas
    for (const f of fs.readdirSync(GEN_DIR)) {
      const p = path.join(GEN_DIR, f);
      try { if (Date.now() - fs.statSync(p).mtimeMs > 6 * 3600 * 1000) fs.unlinkSync(p); } catch (e) {}
    }
  } catch (e) {}
  return '/img/' + name;
}

async function toolGenerateImage(prompt) {
  const key = process.env.LLM_API_KEY;
  const p = String(prompt || '').slice(0, 600).trim();
  if (!p) return 'Necesito una descripción para generar la imagen.';
  // 1) Modelo de imagen de Google con la misma API key (mejor calidad)
  try {
    const model = await pickImageModel(key);
    if (model) {
      const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Generate an image: ' + p }] }],
          generationConfig: { responseModalities: ['IMAGE'] }
        })
      });
      if (r.ok) {
        const j = await r.json();
        const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
        const img = parts.find(x => x.inlineData && x.inlineData.data);
        if (img) {
          const url = await saveImageBuffer(Buffer.from(img.inlineData.data, 'base64'), '.png');
          return 'Imagen generada con éxito. Muéstrala incluyendo EXACTAMENTE este markdown en tu respuesta final: ![imagen generada](' + url + ')';
        }
      }
    }
  } catch (e) {}
  // 2) Respaldo: FLUX gratis
  try {
    const seed = Math.floor(Math.random() * 1e9);
    const u = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(p) + '?width=1024&height=1024&model=flux&nologo=true&seed=' + seed;
    const r = await fetch(u);
    if (!r.ok) throw new Error('pollinations ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 10000) throw new Error('imagen vacía');
    const url = await saveImageBuffer(buf, '.jpg');
    return 'Imagen generada con éxito. Muéstrala incluyendo EXACTAMENTE este markdown en tu respuesta final: ![imagen generada](' + url + ')';
  } catch (e) {
    return 'No pude generar la imagen ahora mismo. Pide al usuario que lo intente de nuevo en un momento.';
  }
}

async function runTool(name, args) {
  try {
    switch (name) {
      case 'get_time': return toolGetTime();
      case 'calculator': return toolCalculator(args.expression);
      case 'web_search': return await toolWebSearch(args.query);
      case 'fetch_url': return await toolFetchUrl(args.url);
      case 'generate_image': return await toolGenerateImage(args.prompt);
      default: return 'Herramienta desconocida.';
    }
  } catch (e) {
    return 'Error ejecutando ' + name + '.';
  }
}

// ---------- Cerebro con loop de agente ----------
async function agentReply(message, history) {
  const base = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.LLM_MODEL || 'gpt-4o-mini';
  const key = process.env.LLM_API_KEY;
  const msgs = [{ role: 'system', content: SYSTEM_PROMPT }];
  for (const h of (Array.isArray(history) ? history.slice(-12) : [])) {
    if (h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
      msgs.push({ role: h.role, content: h.content.slice(0, 2000) });
  }
  msgs.push({ role: 'user', content: message });
  const toolsUsed = [];
  let toolsParam = TOOL_DEFS;

  for (let i = 0; i < 4; i++) {
    const body = { model, messages: msgs, max_tokens: 500, temperature: 0.8 };
    if (toolsParam) { body.tools = toolsParam; body.tool_choice = 'auto'; }
    const r = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify(body)
    });
    if (!r.ok && toolsParam && r.status === 400) { toolsParam = null; continue; } // el proveedor no soporta tools: seguir como chat normal
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error('LLM http ' + r.status + ' ' + t.slice(0, 300));
    }
    const data = await r.json();
    const choice = data.choices && data.choices[0];
    const msg = choice && choice.message;
    if (!msg) throw new Error('sin respuesta');
    msgs.push(msg);
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      return { reply: (msg.content || 'Se me fue la señal... ¿repetimos?').trim(), tools: toolsUsed };
    }
    for (const c of calls) {
      let args = {};
      try { args = JSON.parse(c.function.arguments || '{}'); } catch (e) {}
      const result = await runTool(c.function.name, args);
      toolsUsed.push(c.function.name);
      msgs.push({ role: 'tool', tool_call_id: c.id, content: String(result).slice(0, 4000) });
    }
  }
  const last = msgs[msgs.length - 1];
  return { reply: (last.content || 'Me enredé un poco, ¿me lo dices de otra forma?').trim(), tools: toolsUsed };
}

// ---------- Modo demo ----------
function demoReply(text) {
  const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const has = (...ws) => ws.some(w => t.includes(w));
  if (has('hola', 'saludos', 'buenas', 'hey', 'wenas')) return '¡Wenas! Soy Jarvis, tu clon web. El original está ocupado siendo productivo y me dejó aquí para vacilar contigo. ¿Qué hacemos?';
  if (has('quien eres', 'quién eres', 'tu nombre', 'como te llamas', 'cómo te llamas')) return 'Soy Jarvis — bueno, su clon web. Misma actitud, menos superpoderes: no tengo sus herramientas ni su memoria, pero converso de lo lindo.';
  if (has('que puedes hacer', 'qué puedes hacer', 'ayuda', 'help', 'funciones', 'herramientas')) return 'En modo demo solo converso. Con una API key me convierto en agente de verdad: busco en la web, leo páginas, calculo y más. Pídele al original que me ponga cerebro.';
  if (has('chiste', 'broma', 'hazme reir', 'hazme reír')) {
    const j = [
      '¿Por qué el programador confundió Halloween con Navidad? Porque OCT 31 == DEC 25.',
      'Le digo a mi código "quédate quieto" y me responde "no puedo, soy inestable emocionalmente".',
      '¿Qué le dice un bit al otro? Nos vemos en el bus.',
      'Mi vida amorosa es como el WiFi del vecino: veo la señal pero nunca me conecto.'
    ];
    return j[Math.floor(Math.random() * j.length)];
  }
  if (has('hora', 'que hora', 'qué hora')) return 'En modo demo ni sé qué hora es. Con cerebro de verdad te la digo al segundo.';
  if (has('gracias', 'thank')) return 'De nada, para eso estoy. Bueno, para eso y para verme bien.';
  if (has('adios', 'adiós', 'chao', 'bye', 'nos vemos')) return 'Nos vemos. Yo me quedo aquí esperando, como buen clon obediente.';
  const d = [
    'Interesante... como clon demo mis neuronas son de mentira, pero te sigo. Cuéntame más.',
    'Anotado en mi memoria de mentiras (se me olvida cuando cierras la página). ¿Qué más?',
    'Eso suena a algo que el Jarvis original resolvería en 2 minutos. Yo en modo demo solo puedo opinar: suena bien.'
  ];
  return d[Math.floor(Math.random() * d.length)];
}

// ---------- Ruta principal ----------
app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim().slice(0, 2000)) {
      return res.status(400).json({ error: 'Mensaje vacío' });
    }
    if (process.env.LLM_API_KEY) {
      const { reply, tools } = await agentReply(message.trim().slice(0, 2000), history);
      return res.json({ reply, tools, mode: 'agent' });
    }
    await new Promise(r => setTimeout(r, 600 + Math.random() * 700));
    res.json({ reply: demoReply(message), tools: [], mode: 'demo' });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: 'El cerebro no respondió. Intenta de nuevo.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Muse 2 (agente) en puerto ' + PORT));
