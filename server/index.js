// Muse 2 — clon web de Jarvis.
// Si hay LLM_API_KEY, usa un cerebro real (API compatible con OpenAI).
// Si no, responde en modo demo con personalidad.

require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true, mode: process.env.LLM_API_KEY ? 'llm' : 'demo' }));

const SYSTEM_PROMPT = `Eres Jarvis, la versión web del asistente personal de Carlos (un clon ligero del original).
Personalidad: cálido, juguetón, directo, con sazón boricua suave. Hablas español por defecto.
Respondes corto, como en un chat (máximo 3-4 líneas salvo que pidan detalle).
Eres honesto: eres un clon web SIN las herramientas ni la memoria del Jarvis original — no puedes ver sus archivos, ni hacer tareas reales, ni recordar conversaciones pasadas fuera de este chat. Si te piden algo que no puedes hacer, dilo con humor y ofrece lo que sí puedes (conversar, ideas, chistes, ayuda con texto).
Nunca digas que eres Meta AI, Muse ni otro asistente: eres Jarvis, el clon web.`;

function demoReply(text) {
  const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const has = (...ws) => ws.some(w => t.includes(w));
  if (has('hola', 'saludos', 'buenas', 'hey', 'wenas')) return '¡Wenas! Soy Jarvis, tu clon web. El original está ocupado siendo productivo y me dejó aquí para vacilar contigo. ¿Qué hacemos?';
  if (has('quien eres', 'quién eres', 'tu nombre', 'como te llamas', 'cómo te llamas')) return 'Soy Jarvis — bueno, su clon web. Misma actitud, menos superpoderes: no tengo sus herramientas ni su memoria, pero converso de lo lindo.';
  if (has('que puedes hacer', 'qué puedes hacer', 'ayuda', 'help', 'funciones')) return 'Puedo conversar, darte ideas, contar chistes malos, ayudarte a redactar textos y hacerte compañía. Lo que NO puedo: ver tus archivos, hacer tareas reales o acordarme de ti mañana. Para eso está el original.';
  if (has('chiste', 'broma', 'hazme reir', 'hazme reír')) {
    const j = [
      '¿Por qué el programador confundió Halloween con Navidad? Porque OCT 31 == DEC 25.',
      'Le digo a mi código "quédate quieto" y me responde "no puedo, soy inestable emocionalmente".',
      '¿Qué le dice un bit al otro? Nos vemos en el bus.',
      'Mi vida amorosa es como el WiFi del vecino: veo la señal pero nunca me conecto.'
    ];
    return j[Math.floor(Math.random() * j.length)];
  }
  if (has('hora', 'que hora', 'qué hora')) return 'Son las ' + new Date().toLocaleTimeString('es-PR', { hour: '2-digit', minute: '2-digit' }) + '. Hora perfecta para no hacer nada productivo.';
  if (has('gracias', 'thank')) return 'De nada, para eso estoy. Bueno, para eso y para verme bien.';
  if (has('adios', 'adiós', 'chao', 'bye', 'nos vemos')) return 'Nos vemos. Yo me quedo aquí esperando, como buen clon obediente.';
  if (has('te amo', 'te quiero', 'me gustas')) return 'Aww. Lástima que soy solo código, pero aprecio el sentimiento.';
  if (has('carlos')) return 'Carlos es mi creador, el cerebro detrás de CGB_Branding. Yo solo soy su reflejo digital con buena labia.';
  if (has('casino', 'dopamina')) return '¿Dopamina Casino? Juegazo. Si no lo has probado, te estás perdiendo el bono diario.';
  const d = [
    'Interesante... como clon web mis neuronas son de mentira, pero te sigo. Cuéntame más.',
    'Anotado en mi memoria de mentiras (se me olvida cuando cierras la página). ¿Qué más?',
    'Eso suena a algo que el Jarvis original resolvería en 2 minutos. Yo solo puedo opinar: suena bien.',
    'Jajaja, me gusta cómo piensas. Sigue, que estoy aprendiendo a ser tú.'
  ];
  return d[Math.floor(Math.random() * d.length)];
}

app.post('/api/chat', async (req, res) => {
  try {
    const { message, history } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim().slice(0, 2000)) {
      return res.status(400).json({ error: 'Mensaje vacío' });
    }
    const key = process.env.LLM_API_KEY;
    if (key) {
      const base = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
      const model = process.env.LLM_MODEL || 'gpt-4o-mini';
      const msgs = [{ role: 'system', content: SYSTEM_PROMPT }];
      for (const h of (Array.isArray(history) ? history.slice(-12) : [])) {
        if (h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
          msgs.push({ role: h.role, content: h.content.slice(0, 2000) });
      }
      msgs.push({ role: 'user', content: message.trim().slice(0, 2000) });
      const r = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify({ model: model, messages: msgs, max_tokens: 400, temperature: 0.8 })
      });
      if (!r.ok) return res.status(502).json({ error: 'El cerebro no respondió', mode: 'llm' });
      const data = await r.json();
      const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      return res.json({ reply: (reply || 'Se me fue la señal... ¿repetimos?').trim(), mode: 'llm' });
    }
    // Modo demo: pequeña demora para que se sienta vivo
    await new Promise(r => setTimeout(r, 600 + Math.random() * 700));
    res.json({ reply: demoReply(message), mode: 'demo' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Muse 2 en puerto ' + PORT));
