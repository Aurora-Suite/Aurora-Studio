# Uso: make_dmg.sh <slug> <Nombre> <arch> <carpeta de salida>
set -e
SLUG="$1"; NAME="$2"; ARCH="$3"; OUT="$4"
T=/root/aurora-mac/tools; HFS=$T/hfs/usr/sbin/mkfs.hfsplus; HP=$T/libdmg-hfsplus/build/hfs/hfsplus; DMG=$T/libdmg-hfsplus/build/dmg/dmg
W=/root/aurora-mac/dmg-$SLUG-$ARCH; rm -rf "$W"; mkdir -p "$W/root"
cp -a "/root/aurora-mac/$SLUG-$ARCH/$NAME.app" "$W/root/"
ln -s /Applications "$W/root/Applications"
# Volumen HFS+ con un 25 % de margen sobre el contenido.
MB=$(( $(du -sm "$W/root" | cut -f1) * 125 / 100 + 20 ))
dd if=/dev/zero of="$W/vol.hfs" bs=1M count=$MB status=none
$HFS -v "$NAME" "$W/vol.hfs" >/dev/null
(cd "$W/root" && $HP "$W/vol.hfs" addall . -s clone_link -m no >/dev/null)
$DMG build "$W/vol.hfs" "$W/out.dmg" -c lzma >/dev/null
# Comprobación: descomprimir el .dmg y extraer el volumen; debe ser idéntico al original (contenido, enlaces y permisos).
$DMG extract "$W/out.dmg" "$W/check.hfs" >/dev/null 2>&1
mkdir -p "$W/check" && (cd "$W/check" && $HP "$W/check.hfs" extractall / . >/dev/null 2>&1)
diff -r --no-dereference "$W/root/$NAME.app" "$W/check/$NAME.app" && echo "contenido idéntico"
(cd "$W/root" && find . -printf '%y %m %p %l\n' | sort) > "$W/a.txt"
(cd "$W/check" && find . -printf '%y %m %p %l\n' | sort) > "$W/b.txt"
diff "$W/a.txt" "$W/b.txt" >/dev/null && echo "permisos y enlaces idénticos ($(grep -c '^l' $W/a.txt) enlaces)" || { echo "DIFERENCIAS:"; diff "$W/a.txt" "$W/b.txt" | head -10; }
DEST="$OUT/$NAME-1.0.0-mac-$ARCH.dmg"
cp "$W/out.dmg" "$DEST"
echo "ok $DEST $(( $(stat -c %s "$DEST") / 1048576 )) MB"
rm -rf "$W"
