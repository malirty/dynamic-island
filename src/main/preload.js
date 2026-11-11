const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('island', {
  invoke: (ch, ...args) => ipcRenderer.invoke(ch, ...args),
  send: (ch, ...args) => ipcRenderer.send(ch, ...args),
  on: (ch, fn) => {
    const h = (_e, payload) => fn(payload);
    ipcRenderer.on(ch, h);
    return () => ipcRenderer.removeListener(ch, h);
  },
  // Absolute path of a dropped File (Electron 32+ removed File.path).
  pathOf: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
});
