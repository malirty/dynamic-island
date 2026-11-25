// The phone over a USB cable. Plug it in (Android: choose "File transfer" in the USB notice,
// iPhone: tap "Trust") and the island notices it, offers to bring over the new photos and videos,
// and can send files to the phone. Everything goes through Windows' own device support, as in Explorer.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = function createPhone({ helper, state, picturesDir, emit, notify, log }) {
  let devices = [], timer = null, primed = false;
  const jobs = new Map(); // device name -> running job

  const known = (name) => {
    const dir = path.join(state.dir || os.tmpdir(), 'phone');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, name.replace(/[^\w.-]+/g, '_') + '.txt');
  };
  const destOf = (name) => path.join(picturesDir(), 'Island', name.replace(/[\\/:*?"<>|]/g, '_'));
  const isApple = (name) => /iphone|ipad|apple/i.test(name || '');
  const publish = () => emit('phone-usb', devices.map((d) => ({ ...d, apple: isApple(d.name), busy: jobs.get(d.name)?.kind || null })));

  async function scan() {
    let list;
    try { list = helper.arr(await helper.slow('portables', {}, 8000)).filter((d) => d && d.name); } catch { return; }
    const names = new Set(list.map((d) => d.name));
    const fresh = list.filter((d) => !devices.some((x) => x.name === d.name));
    const gone = devices.filter((d) => !names.has(d.name));
    devices = list.map((d) => ({ name: d.name, path: d.path, apple: isApple(d.name) }));
    if (fresh.length || gone.length) publish();
    if (!primed) { primed = true; return; } // phones already plugged in at start: no pop-up
    for (const d of fresh) { log?.(`phone: connected ${d.name}`); emit('phone-connected', { name: d.name }); }
    for (const d of gone) { log?.(`phone: disconnected ${d.name}`); emit('phone-disconnected', { name: d.name }); }
  }

  // one PowerShell run per job, its JSON lines tell how it goes
  function run(kind, name, args, onLine) {
    if (jobs.has(name)) return Promise.reject(new Error('busy'));
    return new Promise((resolve, reject) => {
      const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'phone-usb.ps1'), '-Mode', kind, '-Device', name, ...args], { windowsHide: true });
      jobs.set(name, { kind, p }); publish();
      let buf = '', last = null;
      p.stdout.on('data', (d) => {
        buf += d.toString('utf8');
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          try { last = JSON.parse(line); onLine(last); if (last.total !== undefined || last.done !== undefined || last.error || last.failed) log?.(`phone ${kind}: ${last.error ? 'error ' + last.error : last.failed ? 'a file did not arrive' : last.done !== undefined ? 'done ' + last.done : `${last.total} files, ${Math.round((last.bytes || 0) / 1048576)} MB`}`); } catch {}
        }
      });
      p.stderr.on('data', (d) => log?.('phone ps: ' + d.toString().slice(0, 300)));
      p.on('close', (code) => { jobs.delete(name); publish(); code === 0 ? resolve(last) : reject(new Error(last?.error || 'failed')); });
    });
  }

  // bring the new photos and videos over to Pictures\Island\<phone>
  async function importPhotos(name) {
    const dest = destOf(name);
    const started = Date.now();
    let total = 0, bytes = 0, done = 0, doneBytes = 0, count = 0;
    const progress = () => emit('phone-uploads', total ? [{ name: `Фото с ${name}`, size: doneBytes, total: bytes || 0, speed: doneBytes / Math.max(1, (Date.now() - started) / 1000), started, phone: true, count: `${done} из ${total}` }] : []);
    try {
      await run('import', name, ['-Dest', dest, '-Known', known(name)], (m) => {
        if (m.total !== undefined) { total = m.total; bytes = m.bytes || 0; if (!total) notify({ kind: 'phone', icon: '📱', app: name, title: 'Новых фото нет', body: m.all ? `Все ${m.all} уже перенесены` : 'На телефоне нет фото и видео' }); }
        if (m.file) { done = m.i; doneBytes += m.size || 0; if (!m.failed && !m.skip) count++; }
        progress();
      });
    } catch (e) {
      log?.(`phone import failed: ${e.message}`);
      emit('phone-uploads', []);
      const apple = isApple(name);
      const why = { nodevice: 'Телефон отключился', locked: 'Разблокируй телефон и разреши доступ к файлам', nodcim: apple ? 'iPhone не открыл фото' : 'Телефон не открыл фото', busy: 'Уже переношу' }[e.message] || 'Не получилось';
      const how = apple
        ? 'Разблокируй iPhone и нажми «Доверять этому компьютеру». Если уже нажимал — отключи кабель и подключи снова, не блокируя экран.'
        : 'В уведомлении «USB» на телефоне выбери «Передача файлов».';
      notify({ kind: 'phone', icon: '📱', app: name, title: why, body: ['locked', 'nodcim'].includes(e.message) ? how : '', sticky: true });
      return;
    }
    emit('phone-uploads', []);
    if (count) emit('download-done', { name: `${count} ${count % 10 === 1 && count % 100 !== 11 ? 'файл' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20) ? 'файла' : 'файлов'} с ${name}`, path: dest, folder: true, size: doneBytes, took: Date.now() - started, avg: doneBytes / Math.max(1, (Date.now() - started) / 1000), from: 'phone' });
  }

  // send files from the computer to the phone's Download folder
  async function sendFiles(name, files) {
    if (isApple(name)) { notify({ kind: 'phone', icon: '📱', app: name, title: 'На iPhone по кабелю файлы не отправить', body: 'iPhone даёт компьютеру только забирать фото и видео. Отправить на него можно через Telegram или облако.' }); return; }
    files = (files || []).filter((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } });
    if (!files.length) return;
    const list = path.join(os.tmpdir(), `island-send-${Date.now()}.txt`);
    fs.writeFileSync(list, files.join('\r\n'), 'utf8');
    const started = Date.now();
    let total = 0, bytes = 0, doneBytes = 0, ok = 0, to = '';
    try {
      await run('send', name, ['-List', list], (m) => {
        if (m.total !== undefined) { total = m.total; bytes = m.bytes; to = m.to || ''; }
        if (m.file) { doneBytes += m.size || 0; if (!m.failed) ok++; }
        emit('phone-uploads', [{ name: `На ${name}`, size: doneBytes, total: bytes, speed: doneBytes / Math.max(1, (Date.now() - started) / 1000), started, phone: true }]);
      });
      notify({ kind: 'phone', icon: '📱', app: name, title: ok === total ? `Отправлено на телефон: ${ok}` : `Отправлено ${ok} из ${total}`, body: to ? `Папка «${to}» на телефоне` : '' });
    } catch (e) {
      notify({ kind: 'phone', icon: '📱', app: name, title: 'Не получилось отправить', body: e.message === 'locked' ? 'Разблокируй телефон и разреши доступ к файлам' : '' });
    } finally { emit('phone-uploads', []); fs.rm(list, { force: true }, () => {}); }
  }

  // An iPhone takes no files over the cable, but the island is signed in to your Telegram:
  // files go to Saved Messages in original quality and are on the phone a second later.
  async function sendViaTelegram(files, sendOne) {
    files = (files || []).filter((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } });
    if (!files.length) return;
    const started = Date.now();
    const total = files.reduce((a, f) => a + fs.statSync(f).size, 0);
    let done = 0, ok = 0;
    const show = () => emit('phone-uploads', [{ name: 'На телефон через Telegram', size: done, total, speed: done / Math.max(1, (Date.now() - started) / 1000), started, phone: true, count: `${ok} из ${files.length}` }]);
    show();
    for (const f of files) {
      try { await sendOne(f); ok++; } catch (e) { log?.(`phone tg send failed: ${e.message}`); }
      done += fs.statSync(f).size; show();
    }
    emit('phone-uploads', []);
    log?.(`phone tg send: ${ok} of ${files.length}`);
    notify({ kind: 'phone', icon: '📱', app: 'Telegram · Избранное', title: ok === files.length ? `Отправлено на телефон: ${ok}` : `Отправлено ${ok} из ${files.length}`, body: 'Открой «Избранное» в Telegram на телефоне — там же можно сохранить в Фото или Файлы' });
  }

  return {
    sendViaTelegram,
    start() { if (!timer) { scan(); timer = setInterval(scan, 3000); } },
    stop() { clearInterval(timer); timer = null; },
    list: () => devices.map((d) => ({ ...d, busy: jobs.get(d.name)?.kind || null })),
    importPhotos, sendFiles,
    open(name) { const d = devices.find((x) => x.name === name); if (d) spawn('explorer.exe', [d.path], { detached: true, stdio: 'ignore' }).unref(); },
    // the newest files brought over from this phone (for the tab's photo strip)
    recent(name, n = 18) {
      const dir = destOf(name || '');
      let list = [];
      try { list = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png|gif|webp|heic|heif|mp4|mov|m4v)$/i.test(f)).map((f) => { const p = path.join(dir, f); const st = fs.statSync(p); return { name: f, path: p, t: st.mtimeMs, size: st.size, video: /\.(mp4|mov|m4v)$/i.test(f) }; }); } catch {}
      return list.sort((a, b) => b.t - a.t).slice(0, n);
    },
    folder(name) { const d = destOf(name || ''); fs.mkdirSync(d, { recursive: true }); return d; },
  };
};
