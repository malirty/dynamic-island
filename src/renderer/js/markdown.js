// Minimal, safe Markdown → HTML for AI answers (input is escaped first).
import { esc } from './core.js';

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" data-ext="1">$1</a>');
}

export function md(src) {
  const parts = String(src || '').split(/```/);
  let out = '';
  parts.forEach((part, i) => {
    if (i % 2) {
      const nl = part.indexOf('\n');
      const code = nl >= 0 ? part.slice(nl + 1) : part;
      out += `<pre><code>${esc(code.replace(/\n$/, ''))}</code></pre>`;
      return;
    }
    const lines = esc(part).split('\n');
    let list = null;
    for (const raw of lines) {
      const line = raw.trimEnd();
      const ul = line.match(/^\s*[-*•]\s+(.*)$/);
      const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (ul || ol) {
        const tag = ul ? 'ul' : 'ol';
        if (list !== tag) { if (list) out += `</${list}>`; out += `<${tag}>`; list = tag; }
        out += `<li>${inline((ul || ol)[1])}</li>`;
        continue;
      }
      if (list) { out += `</${list}>`; list = null; }
      const hd = line.match(/^(#{1,3})\s+(.*)$/);
      if (hd) out += `<h${hd[1].length + 1}>${inline(hd[2])}</h${hd[1].length + 1}>`;
      else if (line.trim()) out += `<p>${inline(line)}</p>`;
    }
    if (list) out += `</${list}>`;
  });
  return out;
}

// open links from AI answers in the browser
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-ext]');
  if (!a) return;
  e.preventDefault();
  window.island.invoke('url:open', a.href);
});
