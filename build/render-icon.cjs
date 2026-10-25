// Genera el logo de Aurora Studio: build/icon.svg, src/assets/logo.svg, icon.png (1024), icon.ico
// multitamaño (16–256, cada tamaño rasterizado desde el vector; los pequeños con trazos más gruesos)
// y los PNG del icono de macOS en build/icon-mac/ (plantilla de Apple, ver macIcon()).
// Uso: npx electron build/render-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// Marca de Aurora: A geométrica maciza en blanco sobre un degradado de aurora boreal
// (verde, cian, violeta y magenta sobre azul noche). Pocas formas: se lee a 16 px y en escala de grises.
function letterA({ shift, apex, half, base, cbTop, cbBot }) {
  const sl = -half / (base - apex); // dx/dy de la pata izquierda
  const xi = (y) => 512 - half + shift + (y - base) * sl;
  const ya = base + (half - shift) / sl; // vértice de la contraforma
  const f = (n) => n.toFixed(1);
  return `M512 ${apex}L${512 + half} ${base}L${512 + half - shift} ${base}L${f(1024 - xi(cbBot))} ${cbBot}L${f(xi(cbBot))} ${cbBot}` +
    `L${512 - half + shift} ${base}L${512 - half} ${base}Z` +
    `M512 ${f(ya)}L${f(1024 - xi(cbTop))} ${cbTop}L${f(xi(cbTop))} ${cbTop}Z`;
}

const insetOf = (small) => (small ? 24 : 64);

function svg({ small = false } = {}) {
  const inset = insetOf(small);
  // Rectángulo de esquinas continuas (estilo macOS / Windows 11): cada esquina con dos cúbicas.
  const a = inset, b = 1024 - inset, R = (b - a) * 0.235, t = R * 0.28;
  const squircle = [
    `M${a + R} ${a}H${b - R}C${b - t} ${a} ${b} ${a + t} ${b} ${a + R}`,
    `V${b - R}C${b} ${b - t} ${b - t} ${b} ${b - R} ${b}`,
    `H${a + R}C${a + t} ${b} ${a} ${b - t} ${a} ${b - R}`,
    `V${a + R}C${a} ${a + t} ${a + t} ${a} ${a + R} ${a}Z`,
  ].join('');
  const A = small
    ? letterA({ shift: 136, apex: 196, half: 316, base: 818, cbTop: 568, cbBot: 672 })
    : letterA({ shift: 104, apex: 216, half: 276, base: 780, cbTop: 550, cbBot: 640 });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <clipPath id="clip"><path d="${squircle}"/></clipPath>
    <filter id="mesh" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="120"/></filter>
    <filter id="lift" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="28" flood-color="#06081A" flood-opacity="${small ? 0.2 : 0.35}"/>
    </filter>
    <linearGradient id="edge" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.4"/>
      <stop offset="0.35" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <g clip-path="url(#clip)">
    <rect width="1024" height="1024" fill="#0A1033"/>
    <g filter="url(#mesh)">
      <ellipse cx="160" cy="900" rx="420" ry="300" fill="#12F0A0"/>
      <ellipse cx="520" cy="620" rx="260" ry="360" fill="#10C6E6" transform="rotate(-30 520 620)"/>
      <circle cx="900" cy="180" r="380" fill="#8A4BFF"/>
      <circle cx="980" cy="820" r="240" fill="#D04DE8"/>
      <circle cx="300" cy="120" r="200" fill="#2E4BFF"/>
    </g>
  </g>${small ? '' : `
  <path d="${squircle}" fill="none" stroke="url(#edge)" stroke-width="5"/>`}
  <path d="${A}" fill="#FFFFFF" fill-rule="evenodd" stroke="#FFFFFF" stroke-width="22" stroke-linejoin="round" filter="url(#lift)"/>
</svg>
`;
}

// Icono de macOS según la plantilla de Apple (Big Sur y posteriores): lienzo de 1024 con la forma
// redondeada de 824 px centrada, 100 px de margen transparente y sombra suave. En el Dock y el Finder
// el margen deja ver el fondo claro u oscuro del sistema, como el resto de apps de Mac.
function macIcon(src, small) {
  const inset = insetOf(small);
  const k = 824 / (1024 - inset * 2);
  const off = 100 - inset * k;
  const inner = src.slice(src.indexOf('>', src.indexOf('<svg')) + 1, src.lastIndexOf('</svg>'));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <filter id="drop" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000000" flood-opacity="0.3"/>
    </filter>
  </defs>
  <g filter="url(#drop)"><g transform="translate(${off.toFixed(2)} ${off.toFixed(2)}) scale(${k.toFixed(6)})">${inner}</g></g>
</svg>
`;
}

// ICO con entradas PNG (Windows Vista+): cada tamaño se ve nítido en escritorio, barra de tareas y explorador.
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e);
    head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt16LE(1, e + 4);
    head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8);
    head.writeUInt32LE(off, e + 12);
    off += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const big = svg();
  const small = svg({ small: true });
  fs.writeFileSync(path.join(__dirname, 'icon.svg'), big);
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'assets', 'logo.svg'), big);
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');
  // El SVG se dibuja directamente al tamaño final: sin reescalados de mapa de bits.
  const raster = (src, size) =>
    win.webContents.executeJavaScript(`new Promise((ok) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = ${size};
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(img, 0, 0, ${size}, ${size});
        ok(c.toDataURL('image/png'));
      };
      img.src = 'data:image/svg+xml;base64,${Buffer.from(src).toString('base64')}';
    })`).then((u) => Buffer.from(u.split(',')[1], 'base64'));

  fs.writeFileSync(path.join(__dirname, 'icon.png'), await raster(big, 1024));
  const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
  const pngs = [];
  for (const size of sizes) pngs.push({ size, data: await raster(size <= 48 ? small : big, size) });
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), ico(pngs));
  for (const f of ['icon-256.png', 'icon-512.png']) fs.rmSync(path.join(__dirname, f), { force: true });

  const macDir = path.join(__dirname, 'icon-mac');
  fs.mkdirSync(macDir, { recursive: true });
  const macBig = macIcon(big, false);
  const macSmall = macIcon(small, true);
  fs.writeFileSync(path.join(__dirname, 'icon-mac.svg'), macBig);
  for (const size of [16, 32, 64, 128, 256, 512, 1024]) fs.writeFileSync(path.join(macDir, `${size}.png`), await raster(size <= 32 ? macSmall : macBig, size));
  fs.copyFileSync(path.join(macDir, '1024.png'), path.join(__dirname, 'icon-mac.png'));
  app.quit();
});
