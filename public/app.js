const chat = document.getElementById('chat');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const modeEl = document.getElementById('mode');
const attachBtn = document.getElementById('attach');
const fileInput = document.getElementById('file');
const preview = document.getElementById('preview');
const previewImg = document.getElementById('preview-img');
const previewX = document.getElementById('preview-x');
const history = [];
let busy = false;
let pendingFile = null;

fetch('/api/health').then(r => r.json()).then(d => {
  if (d.mode === 'agent') modeEl.textContent = 'agente activo 🛠️';
  else if (d.mode === 'llm') modeEl.textContent = 'cerebro real';
}).catch(() => {});

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function miniMd(text) {
  let h = esc(text);
  h = h.replace(/!\[([^\]]*)\]\((\/img\/[A-Za-z0-9._-]+)\)/g,
    '<img src="$2" alt="$1" style="max-width:100%;border-radius:12px;margin:8px 0;display:block;" loading="lazy">');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\n/g, '<br>');
  return h;
}

function addMsg(text, who, imgUrl) {
  const div = document.createElement('div');
  div.className = 'msg ' + who;
  if (who === 'bot') {
    div.innerHTML = miniMd(text);
  } else {
    if (imgUrl) {
      const im = document.createElement('img');
      im.src = imgUrl; im.className = 'uimg'; im.alt = 'imagen adjunta';
      div.appendChild(im);
    }
    const sp = document.createElement('span');
    sp.textContent = text;
    div.appendChild(sp);
  }
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
  if ((!msg && !pendingFile) || busy) return;
  busy = true; sendBtn.disabled = true;
  document.getElementById('chips').style.display = 'none';
  // Subir imagen adjunta primero (si hay)
  let imageUrl = null;
  const file = pendingFile;
  if (file) {
    try {
      const fd = new FormData();
      fd.append('image', file);
      const ur = await fetch('/api/upload', { method: 'POST', body: fd });
      const ud = await ur.json();
      if (ud.url) imageUrl = ud.url;
      else throw new Error(ud.error || 'upload');
    } catch (e) {
      busy = false; sendBtn.disabled = false;
      addMsg('No pude subir la imagen. Revisa que sea jpg/png/webp de menos de 4MB.', 'bot');
      return;
    }
    pendingFile = null;
    preview.hidden = true;
  }
  addMsg(msg || '(imagen)', 'user', imageUrl);
  input.value = '';
  input.style.height = 'auto';
  const t = typing();
  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, history: history, imageUrl: imageUrl })
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
    history.push({ role: 'user', content: msg + (imageUrl ? ' [imagen adjunta]' : '') }, { role: 'assistant', content: reply });
    if (history.length > 24) history.splice(0, history.length - 24);
  } catch (e) {
    t.remove();
    addMsg('No pude responder, parece que me quedé sin señal. Intenta de nuevo.', 'bot');
  }
  busy = false; sendBtn.disabled = false;
  input.focus();
}

// Adjuntar imagen
attachBtn.onclick = () => fileInput.click();
fileInput.onchange = () => {
  const f = fileInput.files && fileInput.files[0];
  if (!f) return;
  if (f.size > 4 * 1024 * 1024) { addMsg('Esa imagen pesa más de 4MB, búscame una más liviana.', 'bot'); fileInput.value = ''; return; }
  pendingFile = f;
  previewImg.src = URL.createObjectURL(f);
  preview.hidden = false;
  input.focus();
};
previewX.onclick = () => { pendingFile = null; fileInput.value = ''; preview.hidden = true; };

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
  addMsg('¡Ey! Soy Jarvis, tu clon web. El original me dejó aquí para que vaciles conmigo mientras él hace cosas importantes. Puedes escribirme, pedirme que genere imágenes, o adjuntarme una foto con 📎 para que la vea, la analice o la edite. ¿De qué hablamos?', 'bot');
}, 400);
