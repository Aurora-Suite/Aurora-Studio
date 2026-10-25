# Aurora Studio

Editor de vídeo privado de escritorio para Windows y macOS.

## Usar en desarrollo

```bash
npm install
npx install-electron     # descarga Electron si no se descargó al instalar
npm run dev              # Vite + Electron con recarga en caliente
npm start                # compila y abre la versión de producción
```

## Generar instaladores

- **Windows** (en Windows): `npm run dist:win` → `release/Aurora Studio Setup x.y.z.exe` y versión portable.
- **macOS** (en un Mac): `npm install && npm run dist:mac` → `release/Aurora Studio-x.y.z-arm64.dmg` y `-x64.dmg`.
  El binario de FFmpeg es específico de cada plataforma, por eso el `.dmg` debe generarse en un Mac.
  Sin firma de Apple, la primera vez: clic derecho sobre la app → Abrir.

## Logo

`npx electron build/render-icon.cjs` regenera `icon.svg`, `src/assets/logo.svg`, `icon.png` (1024, macOS) e `icon.ico`
(16–256 px, cada tamaño rasterizado desde el vector; ≤48 px usa una variante de trazo grueso).

## Notas técnicas

- La vista previa es un compositor WebGL2 (GPU). El color de cada clip se "hornea" en una LUT 3D que usan
  por igual la vista previa y el render (`lut3d` de FFmpeg), y las transiciones replican `vf_xfade.c`.
- El render compone a la resolución de salida (720p–8K) y codifica con la GPU detectada
  (NVENC, Quick Sync, AMF o VideoToolbox) o por CPU. Si hay un FFmpeg más reciente en el sistema, se usa ese.
- Los datos (autoguardado) están en `%APPDATA%/Montaje Studio` (Windows) o `~/Library/Application Support/Montaje Studio` (macOS).
- `MONTAJE_PROFILE=<carpeta>` abre la app con un perfil aislado (útil para pruebas).

## Licencia

[MIT](LICENSE) © 2026 Aurora Suite.
