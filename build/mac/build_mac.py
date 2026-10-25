#!/usr/bin/env python3
# Monta un .app de macOS a partir del Electron oficial para darwin, sin necesitar un Mac:
# renombra bundle y helpers, parchea los Info.plist, mete app.asar e icono, firma ad-hoc con rcodesign
# y empaqueta en .zip conservando enlaces simbólicos y permisos.
import gzip, io, json, os, plistlib, shutil, stat, subprocess, sys, tarfile, urllib.request, zipfile

ELECTRON = '45.0.0'
WORK = os.path.expanduser('~/aurora-mac')
CACHE = os.path.join(WORK, 'cache')
os.makedirs(CACHE, exist_ok=True)


def fetch(url, name):
    dst = os.path.join(CACHE, name)
    if not os.path.exists(dst):
        print('descargando', url, flush=True)
        req = urllib.request.Request(url, headers={'User-Agent': 'aurora-build'})
        with urllib.request.urlopen(req) as r, open(dst + '.part', 'wb') as f:
            shutil.copyfileobj(r, f)
        os.rename(dst + '.part', dst)
    return dst


def rcodesign():
    exe = os.path.join(CACHE, 'rcodesign')
    if os.path.exists(exe):
        return exe
    req = urllib.request.Request('https://api.github.com/repos/indygreg/apple-platform-rs/releases?per_page=30', headers={'User-Agent': 'aurora-build'})
    rels = json.load(urllib.request.urlopen(req))
    for rel in rels:
        if not rel['tag_name'].startswith('apple-codesign/'):
            continue
        for a in rel['assets']:
            if a['name'].endswith('x86_64-unknown-linux-musl.tar.gz'):
                tgz = fetch(a['browser_download_url'], a['name'])
                with tarfile.open(tgz) as t:
                    m = next(m for m in t.getmembers() if m.name.endswith('/rcodesign'))
                    with t.extractfile(m) as src, open(exe, 'wb') as out:
                        shutil.copyfileobj(src, out)
                os.chmod(exe, 0o755)
                return exe
    raise SystemExit('no se encontró rcodesign')


def unzip_keep_links(zpath, dest):
    with zipfile.ZipFile(zpath) as z:
        for info in z.infolist():
            target = os.path.join(dest, info.filename)
            mode = info.external_attr >> 16
            if info.is_dir():
                os.makedirs(target, exist_ok=True)
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            if stat.S_ISLNK(mode):
                os.symlink(z.read(info).decode(), target)
            else:
                with z.open(info) as src, open(target, 'wb') as out:
                    shutil.copyfileobj(src, out)
                os.chmod(target, (mode & 0o777) or 0o644)


def zip_keep_links(src_dir, item, zpath):
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        root = os.path.join(src_dir, item)
        for base, dirs, files in os.walk(root):
            for name in sorted(dirs + files):
                full = os.path.join(base, name)
                rel = os.path.relpath(full, src_dir)
                st = os.lstat(full)
                if stat.S_ISLNK(st.st_mode):
                    zi = zipfile.ZipInfo(rel)
                    zi.create_system = 3
                    zi.external_attr = (stat.S_IFLNK | 0o755) << 16
                    z.writestr(zi, os.readlink(full))
                elif stat.S_ISDIR(st.st_mode):
                    zi = zipfile.ZipInfo(rel + '/')
                    zi.create_system = 3
                    zi.external_attr = (stat.S_IFDIR | 0o755) << 16 | 0x10
                    z.writestr(zi, b'')
                else:
                    zi = zipfile.ZipInfo.from_file(full, rel)
                    zi.create_system = 3
                    zi.external_attr = (st.st_mode & 0xFFFF) << 16
                    zi.compress_type = zipfile.ZIP_DEFLATED
                    with open(full, 'rb') as f:
                        z.writestr(zi, f.read())
            dirs[:] = [d for d in dirs if not os.path.islink(os.path.join(base, d))]


def icns(png_dir, out):
    # Entradas PNG: macOS moderno las acepta en todos estos tipos.
    types = [('icp4', 16), ('icp5', 32), ('icp6', 64), ('ic07', 128), ('ic08', 256), ('ic09', 512), ('ic10', 1024),
             ('ic11', 32), ('ic12', 64), ('ic13', 256), ('ic14', 512)]
    body = b''
    for t, size in types:
        data = open(os.path.join(png_dir, f'{size}.png'), 'rb').read()
        body += t.encode() + (len(data) + 8).to_bytes(4, 'big') + data
    open(out, 'wb').write(b'icns' + (len(body) + 8).to_bytes(4, 'big') + body)


def patch_plist(path, **kv):
    with open(path, 'rb') as f:
        p = plistlib.load(f)
    p.update(kv)
    with open(path, 'wb') as f:
        plistlib.dump(p, f)


def build(cfg, arch):
    name, app_id = cfg['name'], cfg['appId']
    stage = os.path.join(WORK, cfg['slug'] + '-' + arch)
    shutil.rmtree(stage, ignore_errors=True)
    os.makedirs(stage)
    ez = fetch(f'https://github.com/electron/electron/releases/download/v{ELECTRON}/electron-v{ELECTRON}-darwin-{arch}.zip', f'electron-{ELECTRON}-darwin-{arch}.zip')
    unzip_keep_links(ez, stage)
    for f in os.listdir(stage):
        if f != 'Electron.app':
            p = os.path.join(stage, f)
            shutil.rmtree(p) if os.path.isdir(p) and not os.path.islink(p) else os.remove(p)
    app = os.path.join(stage, name + '.app')
    os.rename(os.path.join(stage, 'Electron.app'), app)
    C = os.path.join(app, 'Contents')

    # Ejecutable principal y helpers con el nombre del producto (Electron localiza los helpers por ese nombre).
    os.rename(os.path.join(C, 'MacOS', 'Electron'), os.path.join(C, 'MacOS', name))
    fw = os.path.join(C, 'Frameworks')
    for h in sorted(os.listdir(fw)):
        if not (h.startswith('Electron Helper') and h.endswith('.app')):
            continue
        suffix = h[len('Electron Helper'):-len('.app')]  # '', ' (GPU)', ' (Renderer)', ' (Plugin)'
        new = f'{name} Helper{suffix}'
        hp = os.path.join(fw, new + '.app')
        os.rename(os.path.join(fw, h), hp)
        os.rename(os.path.join(hp, 'Contents', 'MacOS', 'Electron Helper' + suffix), os.path.join(hp, 'Contents', 'MacOS', new))
        tag = suffix.strip(' ()')
        patch_plist(os.path.join(hp, 'Contents', 'Info.plist'), CFBundleExecutable=new, CFBundleName=new, CFBundleDisplayName=new,
                    CFBundleIdentifier=app_id + '.helper' + ('.' + tag if tag else ''))

    R = os.path.join(C, 'Resources')
    for f in ('default_app.asar', 'electron.icns'):
        if os.path.exists(os.path.join(R, f)):
            os.remove(os.path.join(R, f))
    icns(cfg['icons'], os.path.join(R, 'icon.icns'))
    shutil.copy(os.path.join(cfg['res'], 'app.asar'), os.path.join(R, 'app.asar'))
    unpacked = os.path.join(cfg['res'], 'app.asar.unpacked')
    if os.path.isdir(unpacked):
        shutil.copytree(unpacked, os.path.join(R, 'app.asar.unpacked'))
        nm = os.path.join(R, 'app.asar.unpacked', 'node_modules')
        # FFmpeg de macOS para esta arquitectura (ffmpeg-static solo trae el del sistema donde se instaló).
        if os.path.isdir(os.path.join(nm, 'ffmpeg-static')):
            gz = fetch(f'https://github.com/eugeneware/ffmpeg-static/releases/download/{cfg["ffmpegTag"]}/ffmpeg-darwin-{arch}.gz', f'ffmpeg-{cfg["ffmpegTag"]}-darwin-{arch}.gz')
            dst = os.path.join(nm, 'ffmpeg-static', 'ffmpeg')
            with gzip.open(gz) as src, open(dst, 'wb') as out:
                shutil.copyfileobj(src, out)
            os.chmod(dst, 0o755)
            for f in os.listdir(os.path.join(nm, 'ffmpeg-static')):
                if f.startswith('ffmpeg.exe'):
                    os.remove(os.path.join(nm, 'ffmpeg-static', f))
        probe = os.path.join(nm, 'ffprobe-static', 'bin')
        if os.path.isdir(probe):
            for p in os.listdir(probe):
                if p != 'darwin':
                    shutil.rmtree(os.path.join(probe, p))
            for a in os.listdir(os.path.join(probe, 'darwin')):
                if a != arch:
                    shutil.rmtree(os.path.join(probe, 'darwin', a))
            for base, _, files in os.walk(probe):
                for f in files:
                    os.chmod(os.path.join(base, f), 0o755)

    patch_plist(os.path.join(C, 'Info.plist'),
                CFBundleExecutable=name, CFBundleName=name, CFBundleDisplayName=name, CFBundleIdentifier=app_id,
                CFBundleShortVersionString=cfg['version'], CFBundleVersion=cfg['version'], CFBundleIconFile='icon.icns',
                LSApplicationCategoryType=cfg['category'], NSHumanReadableCopyright='© 2026 Aurora Suite', LSMinimumSystemVersion='12.0',
                CFBundleDocumentTypes=[{'CFBundleTypeExtensions': cfg['exts'], 'CFBundleTypeName': cfg['docName'], 'CFBundleTypeRole': 'Editor',
                                        'LSHandlerRank': 'Owner', 'CFBundleTypeIconFile': 'icon.icns'}])

    # Firma ad-hoc de todo el bundle (los Mac con Apple Silicon no ejecutan código sin firmar).
    rc = rcodesign()
    if os.path.isdir(os.path.join(R, 'app.asar.unpacked')):
        for base, _, files in os.walk(os.path.join(R, 'app.asar.unpacked')):
            for f in files:
                fp = os.path.join(base, f)
                if open(fp, 'rb').read(4) in (b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe'):
                    subprocess.run([rc, 'sign', fp], check=True, stdout=subprocess.DEVNULL)
    subprocess.run([rc, 'sign', app], check=True, stdout=subprocess.DEVNULL)
    v = subprocess.run([rc, 'verify', os.path.join(C, 'MacOS', name)], capture_output=True, text=True)
    print('verify', arch, v.returncode, (v.stdout + v.stderr).strip()[-200:], flush=True)

    out = os.path.join(cfg['out'], f'{name}-{cfg["version"]}-mac-{arch}.zip')
    zip_keep_links(stage, name + '.app', out)
    print('ok', out, round(os.path.getsize(out) / 2**20), 'MB', flush=True)


if __name__ == '__main__':
    cfg = json.load(open(sys.argv[1]))
    os.makedirs(cfg['out'], exist_ok=True)
    for arch in cfg.get('archs', ['arm64', 'x64']):
        build(cfg, arch)
