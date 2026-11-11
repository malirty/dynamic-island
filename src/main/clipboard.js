// Clipboard history: watches the Windows clipboard sequence number (from the
// helper's foreground poll), stores text / images / files with their source app.
const { clipboard, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_ITEMS = 400;

module.exports = function createClipboard({ store, dataDir, emit }) {
  const imgDir = path.join(dataDir, 'clips');
  fs.mkdirSync(imgDir, { recursive: true });
  let lastSeq = null;
  let ignoreUntil = 0;
  const items = () => store.data.items;

  function publish() { emit('clips', items()); }

  function add(item) {
    const list = items();
    const dupIdx = list.findIndex((x) => x.type === item.type && x.hash === item.hash);
    if (dupIdx >= 0) {
      const old = list.splice(dupIdx, 1)[0];
      item.pinned = old.pinned;
      if (old.file && old.file !== item.file) item.file = old.file;
    }
    item.id = item.id || crypto.randomUUID();
    list.unshift(item);
    // trim unpinned overflow
    let unpinned = 0;
    for (let i = 0; i < list.length; i++) {
      if (list[i].pinned) continue;
      if (++unpinned > MAX_ITEMS) {
        const [gone] = list.splice(i--, 1);
        if (gone.file) fs.rm(gone.file, () => {});
      }
    }
    store.save();
    publish();
    return item;
  }

  function sourceOf(fg) {
    if (!fg) return null;
    return { app: fg.app || fg.process, process: fg.process, title: fg.title };
  }

  function capture(fg) {
    const formats = clipboard.availableFormats();
    // Password managers mark secrets with this format: never store them.
    if (formats.some((f) => /ExcludeClipboardContentFromMonitorProcessing|CanIncludeInClipboardHistory/i.test(f))) return;
    const src = sourceOf(fg);
    const ts = Date.now();

    const fileBuf = (() => { try { return clipboard.readBuffer('FileNameW'); } catch { return null; } })();
    if (fileBuf && fileBuf.length > 2) {
      const p = fileBuf.toString('ucs2').replace(/\0+$/, '');
      if (p) return add({ type: 'file', text: p, name: path.basename(p), hash: 'f:' + p, source: src, ts });
    }

    const img = clipboard.readImage();
    const text = clipboard.readText();
    if (!img.isEmpty() && !text) {
      const size = img.getSize();
      const thumb = img.resize({ width: 24 });
      const hash = 'i:' + crypto.createHash('md5').update(thumb.toBitmap()).digest('hex') + size.width + 'x' + size.height;
      const file = path.join(imgDir, `${ts}.png`);
      fs.writeFileSync(file, img.toPNG());
      return add({ type: 'image', file, w: size.width, h: size.height, hash, source: src, ts });
    }
    if (text && text.trim()) {
      const hash = 't:' + crypto.createHash('md5').update(text).digest('hex');
      const isColor = /^#?[0-9a-f]{6}$/i.test(text.trim());
      const isUrl = /^https?:\/\/\S+$/i.test(text.trim());
      return add({ type: 'text', text: text.slice(0, 200000), kind: isColor ? 'color' : isUrl ? 'url' : 'text', hash, source: src, ts });
    }
  }

  return {
    onSeq(seq, fg) {
      if (lastSeq === null) { lastSeq = seq; return; }
      if (seq === lastSeq) return;
      lastSeq = seq;
      if (Date.now() < ignoreUntil) return;
      setTimeout(() => { try { capture(fg); } catch (e) { console.warn('clip', e.message); } }, 60);
    },
    list: () => items(),
    // Put an entry back on the clipboard (no new history entry).
    restore(id) {
      const it = items().find((x) => x.id === id);
      if (!it) return false;
      ignoreUntil = Date.now() + 1200;
      if (it.type === 'image') clipboard.writeImage(nativeImage.createFromPath(it.file));
      else clipboard.writeText(it.text);
      it.ts = Date.now();
      store.save();
      return true;
    },
    writeText(text, src) {
      clipboard.writeText(text);
      ignoreUntil = Date.now() + 1200;
      return add({ type: 'text', text, kind: 'text', hash: 't:' + crypto.createHash('md5').update(text).digest('hex'), source: src || { app: 'Island' }, ts: Date.now() });
    },
    writeImage(image, src) {
      clipboard.writeImage(image);
      ignoreUntil = Date.now() + 1200;
      const ts = Date.now();
      const file = path.join(imgDir, `${ts}.png`);
      fs.writeFileSync(file, image.toPNG());
      const size = image.getSize();
      return add({ type: 'image', file, w: size.width, h: size.height, hash: 'i:' + ts, source: src || { app: 'Island' }, ts });
    },
    pin(id, on) {
      const it = items().find((x) => x.id === id);
      if (it) { it.pinned = on; store.save(); publish(); }
    },
    remove(id) {
      const list = items();
      const i = list.findIndex((x) => x.id === id);
      if (i >= 0) {
        const [gone] = list.splice(i, 1);
        if (gone.file) fs.rm(gone.file, () => {});
        store.save(); publish();
      }
    },
    clear() {
      const keep = items().filter((x) => x.pinned);
      for (const x of items()) if (!x.pinned && x.file) fs.rm(x.file, () => {});
      store.data.items = keep; store.save(); publish();
    },
  };
};
