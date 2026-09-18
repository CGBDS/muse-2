const chat = document.getElementById('chat');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const modeEl = document.getElementById('mode');
const history = [];
let busy = false;

fetch('/api/health').then(r => r.json()).then(d => {
  if (d.mode === 'agent') modeEl.textContent = 'agente activo 🛠️';
  else if (d.mode === 'llm') modeEl.textContent = 'cerebro real';
}).catch(() => {});

function addMsg(text, who) {
  const div = document.createElement('div');
  div.className = 'msg ' + who;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

function typing() {
  const div = document.createElement('div');
  div.className = 'msg bot typing';
  div.innerHTML = '<span></span><span></span><span></span>';
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  return div;
}

async function send(text) {
  const msg = (text || input.value).trim();
  if (!msg || busy) return;
  busy = true; sendBtn.disabled = true;
  document.getElementById('chips').style.display = 'none';
  addMsg(msg, 'user');
  input.value = '';
  input.style.height = 'auto';
  const t = typing();
  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, history: history })
    });
    const data = await r.json();
    t.remove();
    const reply = data.reply || 'Se me cruzaron los cables... ¿intentamos de nuevo?';
    addMsg(reply, 'bot');
    if (data.tools && data.tools.length) {
      const tag = document.createElement('div');
      tag.style.cssText = 'align-self:flex-start;font-size:11px;color:#A572FF;font-family:system-ui;opacity:.8;margin-top:-6px;';
      tag.textContent = '🛠️ usó: ' + [...new Set(data.tools)].join(', ');
      chat.appendChild(tag);
      chat.scrollTop = chat.scrollHeight;
    }
    history.push({ role: 'user', content: msg }, { role: 'assistant', content: reply });
    if (history.length > 24) history.splice(0, history.length - 24);
  } catch (e) {
    t.remove();
    addMsg('No pude responder, parece que me quedé sin señal. Intenta de nuevo.', 'bot');
  }
  busy = false; sendBtn.disabled = false;
  input.focus();
}

sendBtn.onclick = () => send();
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
});
document.querySelectorAll('#chips button').forEach(b => {
  b.onclick = () => send(b.dataset.q);
});

setTimeout(() => {
  addMsg('¡Ey! Soy Jarvis, tu clon web. El original me dejó aquí para que vaciles conmigo mientras él hace cosas importantes. ¿De qué hablamos?', 'bot');
}, 400);
