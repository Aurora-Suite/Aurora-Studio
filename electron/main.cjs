const { app, BrowserWindow, ipcMain, dialog, protocol, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Readable } = require('stream');
const ff = require('./ffmpeg.cjs');
const { runExport } = require('./export.cjs');

const isDev = !!process.env.MONTAJE_DEV;
// Datos en la carpeta de siempre (conserva el autoguardado tras el cambio de nombre a Aurora Studio).
// MONTAJE_PROFILE: perfil aislado para pruebas.
app.setName('Aurora Studio');
app.setPath('userData', process.env.MONTAJE_PROFILE || path.join(app.getPath('appData'), 'Montaje Studio'));
const isMac = process.platform === 'darwin';

let win;
let currentExport = null;

const tmpDir = path.join(os.tmpdir(), 'montaje-studio');
fs.mkdirSync(tmpDir, { recursive: true });

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, bypassCSP: true },
  },
]);

const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
};

// Sirve archivos locales con soporte de Range para que el vídeo pueda buscar (seek) al instante.
function handleMedia(request) {
  const url = new URL(request.url);
  const filePath = decodeURIComponent(url.pathname.slice(1));
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
  const range = request.headers.get('range');
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = 0;
    let end = stat.size - 1;
    if (m && m[1]) {
      start = parseInt(m[1], 10);
      if (m[2]) end = parseInt(m[2], 10);
    } else if (m && m[2]) {
      start = Math.max(0, stat.size - parseInt(m[2], 10)); // rango sufijo: últimos N bytes
    }
    end = Math.min(end, stat.size - 1);
    const stream = Readable.toWeb(fs.createReadStream(filePath, { start, end }));
    return new Response(stream, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
    status: 200,
    headers: { ...headers, 'Content-Length': String(stat.size) },
  });
}

function createWindow() {
  const opts = {
    width: 1600,
    height: 980,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'Aurora Studio',
    icon: path.join(__dirname, '..', 'build', isMac ? 'icon.png' : 'icon.ico'),
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };
  if (isMac) {
    Object.assign(opts, { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 }, vibrancy: 'under-window', visualEffectState: 'active' });
  } else {
    Object.assign(opts, {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#00000000', symbolColor: '#e8e8ed', height: 44 },
      backgroundMaterial: 'mica',
    });
  }
  win = new BrowserWindow(opts);
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  if (isDev) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

ipcMain.handle('app:info', () => ({ platform: process.platform, version: app.getVersion() }));

ipcMain.handle(
  'media:open',
  async () => {
    const r = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Multimedia', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
      ],
    });
    return r.canceled ? [] : r.filePaths;
  }
);

ipcMain.handle('media:probe', async (_e, filePath) => ff.probe(filePath));
ipcMain.handle('media:thumb', async (_e, filePath, t) => ff.thumbnail(filePath, t, tmpDir));
ipcMain.handle('media:peaks', async (_e, filePath) => ff.peaks(filePath));
ipcMain.handle('encoders:detect', async () => ff.detectEncoders());
ipcMain.handle('media:frame', async (_e, filePath, t) => ff.frame(filePath, t, tmpDir));
ipcMain.handle('file:readText', async (_e, exts) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: exts.join(', ').toUpperCase(), extensions: exts }] });
  if (r.canceled) return null;
  return { name: path.basename(r.filePaths[0]), text: fs.readFileSync(r.filePaths[0], 'utf8') };
});

ipcMain.handle(
  'project:save',
  async (_e, { data, filePath }) => {
    let target = filePath;
    if (!target) {
      const r = await dialog.showSaveDialog(win, { defaultPath: 'Proyecto.aurora', filters: [{ name: 'Proyecto Aurora Studio', extensions: ['aurora'] }] });
      if (r.canceled) return null;
      target = r.filePath;
    }
    fs.writeFileSync(target, JSON.stringify(data));
    return target;
  }
);

ipcMain.handle(
  'project:open',
  async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Proyecto Aurora Studio', extensions: ['aurora', 'vela', 'montaje'] }] });
    if (r.canceled) return null;
    return { filePath: r.filePaths[0], data: JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')) };
  }
);

const autosavePath = () => path.join(app.getPath('userData'), 'autosave.json');
ipcMain.handle('project:autosave', async (_e, data) => fs.writeFileSync(autosavePath(), JSON.stringify(data)));
ipcMain.handle(
  'project:restore',
  async () => {
    try {
      return JSON.parse(fs.readFileSync(autosavePath(), 'utf8'));
    } catch {
      return null;
    }
  }
);

ipcMain.handle(
  'export:pickPath',
  async (_e, ext) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: `Aurora Studio.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    return r.canceled ? null : r.filePath;
  }
);

ipcMain.handle(
  'export:start',
  async (event, job) => {
    if (currentExport) throw new Error('Ya hay una exportación en curso');
    const send = (p) => !event.sender.isDestroyed() && event.sender.send('export:progress', p);
    currentExport = runExport(job, tmpDir, send);
    try {
      await currentExport.done;
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    } finally {
      currentExport = null;
    }
  }
);

ipcMain.handle('export:cancel', () => {
  if (currentExport) currentExport.cancel();
  return true;
});

ipcMain.handle('shell:reveal', async (_e, p) => shell.showItemInFolder(p));

app.whenReady().then(() => {
  protocol.handle('media', handleMedia);
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
