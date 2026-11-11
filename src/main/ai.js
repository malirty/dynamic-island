// AI providers with streaming: Gemini, DeepSeek, OpenAI (ChatGPT), local Ollama.
// Messages: [{ role: 'user'|'assistant', content: string, files?: [{ name, mime, data(base64) | text }] }]

const TEXT_MIME = /^(text\/|application\/(json|xml|javascript|x-sh|x-python|sql|x-yaml|toml))/;

const PROVIDERS = {
  gemini: { name: 'Gemini', needsKey: true, images: true, pdf: true, audio: true },
  deepseek: { name: 'DeepSeek', needsKey: true, images: false },
  openai: { name: 'ChatGPT', needsKey: true, images: true },
  ollama: { name: 'Ollama (локально)', needsKey: false, images: true },
};

function fileAsText(f) {
  if (f.text != null) return `\n\n--- Файл: ${f.name} ---\n${f.text.slice(0, 120000)}\n--- конец файла ---`;
  return `\n\n[Приложен файл: ${f.name} (${f.mime}), содержимое недоступно этой модели]`;
}

async function* sse(res) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
      else if (line.startsWith('{')) yield line; // ollama-style NDJSON
    }
  }
  if (buf.trim().startsWith('data:')) yield buf.trim().slice(5).trim();
}

async function fail(res) {
  let t = '';
  try { t = await res.text(); } catch {}
  let msg = t;
  try { const j = JSON.parse(t); msg = j.error?.message || j.message || t; } catch {}
  throw new Error(`${res.status}: ${String(msg).slice(0, 300)}`);
}

function openAiMessages(system, messages, allowImages) {
  const out = [{ role: 'system', content: system }];
  for (const m of messages) {
    const files = m.files || [];
    if (!files.length) { out.push({ role: m.role, content: m.content }); continue; }
    const parts = [];
    let text = m.content || '';
    for (const f of files) {
      if (allowImages && f.mime?.startsWith('image/') && f.data) parts.push({ type: 'image_url', image_url: { url: `data:${f.mime};base64,${f.data}` } });
      else text += fileAsText(f);
    }
    parts.unshift({ type: 'text', text: text || 'Что на этом файле?' });
    out.push({ role: m.role, content: allowImages ? parts : text });
  }
  return out;
}

async function* openAiCompatible({ url, key, model, system, messages, images, signal }) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(url, {
    method: 'POST', headers, signal,
    body: JSON.stringify({ model, stream: true, messages: openAiMessages(system, messages, images) }),
  });
  if (!res.ok) await fail(res);
  for await (const d of sse(res)) {
    if (d === '[DONE]') return;
    try {
      const j = JSON.parse(d);
      const delta = j.choices?.[0]?.delta;
      if (delta?.reasoning_content) yield { think: delta.reasoning_content };
      if (delta?.content) yield { text: delta.content };
    } catch {}
  }
}

async function* gemini({ key, model, system, messages, signal }) {
  const contents = messages.map((m) => {
    const parts = [];
    let text = m.content || '';
    for (const f of m.files || []) {
      if (f.data && /^(image|audio|video)\/|application\/pdf/.test(f.mime || '')) parts.push({ inline_data: { mime_type: f.mime, data: f.data } });
      else text += fileAsText(f);
    }
    parts.unshift({ text: text || 'Что в этом файле?' });
    return { role: m.role === 'assistant' ? 'model' : 'user', parts };
  });
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: system }] } }),
  });
  if (!res.ok) await fail(res);
  for await (const d of sse(res)) {
    try {
      const j = JSON.parse(d);
      for (const p of j.candidates?.[0]?.content?.parts || []) {
        if (p.thought && p.text) yield { think: p.text };
        else if (p.text) yield { text: p.text };
      }
    } catch {}
  }
}

module.exports = function createAI({ settings }) {
  const cfg = () => settings.data.ai;
  const running = new Map();

  function stream(provider, model, messages, signal) {
    const c = cfg();
    const system = c.system;
    const key = c.keys[provider];
    if (PROVIDERS[provider]?.needsKey && !key) throw new Error(`Нет ключа для ${PROVIDERS[provider].name}. Добавь его в Настройки → ИИ.`);
    switch (provider) {
      case 'gemini': return gemini({ key, model, system, messages, signal });
      case 'deepseek': return openAiCompatible({ url: 'https://api.deepseek.com/chat/completions', key, model, system, messages, images: false, signal });
      case 'openai': return openAiCompatible({ url: 'https://api.openai.com/v1/chat/completions', key, model, system, messages, images: true, signal });
      case 'ollama': return openAiCompatible({ url: `${c.ollamaUrl.replace(/\/$/, '')}/v1/chat/completions`, key: '', model, system, messages, images: true, signal });
      default: throw new Error('Неизвестный провайдер');
    }
  }

  return {
    PROVIDERS,
    TEXT_MIME,
    // Streams deltas through `send(event, payload)`; returns the full text.
    async chat(reqId, { provider, model, messages }, send) {
      const ctl = new AbortController();
      running.set(reqId, ctl);
      let full = '';
      try {
        const p = provider || cfg().provider;
        const m = model || cfg().models[p];
        for await (const d of stream(p, m, messages, ctl.signal)) {
          if (d.text) full += d.text;
          send('ai-delta', { reqId, ...d });
        }
        send('ai-done', { reqId, text: full });
      } catch (e) {
        if (e.name === 'AbortError') send('ai-done', { reqId, text: full, aborted: true });
        else send('ai-error', { reqId, error: e.message });
      } finally { running.delete(reqId); }
      return full;
    },
    abort(reqId) { running.get(reqId)?.abort(); },

    // One-shot answer (used by the command bar and screenshot tools).
    async ask(prompt, files = []) {
      const p = cfg().provider;
      let out = '';
      for await (const d of stream(p, cfg().models[p], [{ role: 'user', content: prompt, files }])) if (d.text) out += d.text;
      return out;
    },

    async listOllama() {
      try {
        const r = await fetch(`${cfg().ollamaUrl.replace(/\/$/, '')}/api/tags`);
        const j = await r.json();
        return (j.models || []).map((m) => m.name);
      } catch { return []; }
    },

    // Speech to text: Gemini (audio inline) or OpenAI transcription.
    async transcribe(base64, mime) {
      const c = cfg();
      if (c.keys.gemini) {
        let out = '';
        for await (const d of gemini({ key: c.keys.gemini, model: c.models.gemini, system: 'Ты дословно расшифровываешь речь. Верни только текст, без комментариев.', messages: [{ role: 'user', content: 'Расшифруй запись.', files: [{ name: 'voice.webm', mime, data: base64 }] }] })) if (d.text) out += d.text;
        return out.trim();
      }
      if (c.keys.openai) {
        const form = new FormData();
        form.append('file', new Blob([Buffer.from(base64, 'base64')], { type: mime }), 'voice.webm');
        form.append('model', 'whisper-1');
        const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${c.keys.openai}` }, body: form });
        if (!r.ok) await fail(r);
        return (await r.json()).text;
      }
      throw new Error('Для распознавания голоса нужен ключ Gemini или OpenAI');
    },
  };
};

// Free translation endpoint; falls back to AI in the caller if it fails.
module.exports.translate = async function translate(text, to = 'ru') {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${to}&dt=t&q=${encodeURIComponent(text.slice(0, 4500))}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('translate ' + r.status);
  const j = await r.json();
  return { text: j[0].map((x) => x[0]).join(''), from: j[2] };
};
