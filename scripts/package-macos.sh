#!/bin/sh
# Builds a self-contained "YT Altyazı.app" and a .dmg for Apple Silicon Macs (macOS 13 or newer).
#   npm run package:mac
# Everything is bundled: Node.js, yt-dlp, ffmpeg, whisper.cpp, llama.cpp and the models. Nothing is installed on the target Mac.
#
# Needs: Xcode command line tools (clang, make), Python 3 (for CMake in a throw-away venv), npm, internet access for the
# first run. Sources and builds are kept in .cache/package, so a second run only assembles the app again (about a minute).
#
# Options (environment variables):
#   MIN_MACOS=13.0                        oldest macOS the build supports
#   WHISPER_MODEL_FILE=models/ggml-medium.en.bin
#   TRANSLATOR_DIR=~/models/HY-MT1.5-1.8B  folder with the HY-MT gguf (set NO_TRANSLATOR=1 to leave it out)
#   JOBS=8                                 parallel compile jobs
#
# The app is signed ad hoc only (no Apple Developer ID), so macOS asks for a one-time approval on the first launch;
# the dmg contains a short note about it. If you share the dmg publicly you also redistribute the bundled software and
# models: see THIRD_PARTY_NOTICES.md (the HY-MT license excludes the EU, the UK and South Korea).
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
CACHE="$ROOT/.cache/package"
OUT="$ROOT/dist"
MIN_MACOS="${MIN_MACOS:-13.0}"
JOBS="${JOBS:-$(sysctl -n hw.ncpu)}"
WHISPER_VERSION="v1.9.1"
LLAMA_TAG="b10050"
FFMPEG_VERSION="8.1.2"
VERSION="$(node -p "require('$ROOT/package.json').version")"
NAME="YT Altyazı"
WHISPER_MODEL_FILE="${WHISPER_MODEL_FILE:-$ROOT/models/ggml-medium.en.bin}"
TRANSLATOR_DIR="${TRANSLATOR_DIR:-$HOME/models/HY-MT1.5-1.8B}"

[ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ] || { echo "This script builds the Apple Silicon app and must run on an Apple Silicon Mac." >&2; exit 1; }
[ -f "$WHISPER_MODEL_FILE" ] || { echo "Whisper model not found: $WHISPER_MODEL_FILE (run: npm run setup)" >&2; exit 1; }
if [ -z "${NO_TRANSLATOR:-}" ]; then
  ls "$TRANSLATOR_DIR"/*.gguf >/dev/null 2>&1 || { echo "Translation model not found in $TRANSLATOR_DIR (set NO_TRANSLATOR=1 to leave it out)" >&2; exit 1; }
fi

step() { printf '\n==> %s\n' "$*"; }
mkdir -p "$CACHE" "$OUT"
export GIT_CEILING_DIRECTORIES="$ROOT/.cache" # the sources are not part of this repository: keep llama.cpp from reading its git hash

fetch() { # url file
  [ -s "$CACHE/$2" ] || { echo "downloading $2"; curl -fL -sS --retry 3 -o "$CACHE/$2.part" "$1" && mv "$CACHE/$2.part" "$CACHE/$2"; }
}
unpack() { # archive dir
  [ -d "$CACHE/$2" ] || { mkdir -p "$CACHE/$2.tmp" && tar -xf "$CACHE/$1" -C "$CACHE/$2.tmp" --strip-components=1 && mv "$CACHE/$2.tmp" "$CACHE/$2"; }
}

step "Downloading sources"
fetch "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/$WHISPER_VERSION.tar.gz" "whisper-$WHISPER_VERSION.tar.gz"
fetch "https://github.com/ggml-org/llama.cpp/archive/refs/tags/$LLAMA_TAG.tar.gz" "llama-$LLAMA_TAG.tar.gz"
fetch "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz" "ffmpeg-$FFMPEG_VERSION.tar.xz"
fetch "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos" "yt-dlp_macos"
fetch "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS" "yt-dlp-SHA2-256SUMS"
WANT="$(grep -E ' yt-dlp_macos$' "$CACHE/yt-dlp-SHA2-256SUMS" | cut -d' ' -f1)"
HAVE="$(shasum -a 256 "$CACHE/yt-dlp_macos" | cut -d' ' -f1)"
[ -n "$WANT" ] && [ "$WANT" = "$HAVE" ] || { echo "yt-dlp_macos does not match its published SHA-256: $HAVE" >&2; rm -f "$CACHE/yt-dlp_macos" "$CACHE/yt-dlp-SHA2-256SUMS"; exit 1; }
unpack "whisper-$WHISPER_VERSION.tar.gz" whisper
unpack "llama-$LLAMA_TAG.tar.gz" llama
unpack "ffmpeg-$FFMPEG_VERSION.tar.xz" ffmpeg

if [ ! -x "$CACHE/venv/bin/cmake" ]; then
  step "CMake (in $CACHE/venv, not installed on your system)"
  python3 -m venv "$CACHE/venv"
  "$CACHE/venv/bin/pip" install --quiet cmake
fi
CMAKE="$CACHE/venv/bin/cmake"

# Static, Metal-embedded builds for any M1 or newer chip; never pick up Homebrew libraries
cmake_common="-DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_DEPLOYMENT_TARGET=$MIN_MACOS -DCMAKE_OSX_ARCHITECTURES=arm64 \
  -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON \
  -DCMAKE_IGNORE_PREFIX_PATH=/opt/homebrew;/usr/local"

if [ ! -x "$CACHE/bin/whisper-cli" ]; then
  step "Building whisper.cpp $WHISPER_VERSION"
  # shellcheck disable=SC2086
  "$CMAKE" -S "$CACHE/whisper" -B "$CACHE/build-whisper" $cmake_common -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF -DWHISPER_SDL2=OFF >"$CACHE/whisper-configure.log" 2>&1
  "$CMAKE" --build "$CACHE/build-whisper" --target whisper-cli -j "$JOBS" >"$CACHE/whisper-build.log" 2>&1
  mkdir -p "$CACHE/bin"; cp "$CACHE/build-whisper/bin/whisper-cli" "$CACHE/bin/"
fi

if [ ! -x "$CACHE/bin/llama-server" ]; then
  step "Building llama.cpp $LLAMA_TAG (llama-server)"
  # shellcheck disable=SC2086
  "$CMAKE" -S "$CACHE/llama" -B "$CACHE/build-llama" $cmake_common -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=ON \
    -DLLAMA_CURL=OFF -DLLAMA_OPENSSL=OFF >"$CACHE/llama-configure.log" 2>&1
  "$CMAKE" --build "$CACHE/build-llama" --target llama-server -j "$JOBS" >"$CACHE/llama-build.log" 2>&1
  mkdir -p "$CACHE/bin"; cp "$CACHE/build-llama/bin/llama-server" "$CACHE/bin/"
fi

if [ ! -x "$CACHE/bin/ffmpeg" ]; then
  step "Building ffmpeg $FFMPEG_VERSION (audio only: what this app needs)"
  rm -rf "$CACHE/build-ffmpeg"; mkdir -p "$CACHE/build-ffmpeg"
  (cd "$CACHE/build-ffmpeg" && PKG_CONFIG_PATH= "$CACHE/ffmpeg/configure" --cc=clang --arch=arm64 --disable-autodetect --enable-zlib \
    --disable-doc --disable-ffplay --disable-network --enable-static --disable-shared \
    --extra-cflags="-mmacosx-version-min=$MIN_MACOS" --extra-ldflags="-mmacosx-version-min=$MIN_MACOS" >"$CACHE/ffmpeg-configure.log" 2>&1 \
    && make -j "$JOBS" >"$CACHE/ffmpeg-build.log" 2>&1)
  mkdir -p "$CACHE/bin"; cp "$CACHE/build-ffmpeg/ffmpeg" "$CACHE/build-ffmpeg/ffprobe" "$CACHE/bin/"
fi

step "Checking the binaries (no Homebrew libraries, built for macOS $MIN_MACOS or newer)"
cp "$CACHE/yt-dlp_macos" "$CACHE/bin/yt-dlp"; chmod +x "$CACHE/bin/yt-dlp"
NODE_BIN="$(command -v node)"
bad=0
for b in whisper-cli llama-server ffmpeg ffprobe; do
  if otool -L "$CACHE/bin/$b" | tail -n +2 | grep -qE '/opt/homebrew|/usr/local|@rpath'; then echo "✗ $b links to a library outside macOS:"; otool -L "$CACHE/bin/$b" | grep -E '/opt/homebrew|/usr/local|@rpath'; bad=1; fi
  minos="$(otool -l "$CACHE/bin/$b" | awk '/LC_BUILD_VERSION/{f=1} f&&/minos/{print $2; exit}')"
  echo "  $b: macOS $minos+"
  [ "${minos%%.*}" -le "${MIN_MACOS%%.*}" ] || { echo "✗ $b needs macOS $minos"; bad=1; }
done
for b in "$NODE_BIN" "$CACHE/bin/yt-dlp"; do
  minos="$(otool -l "$b" | awk '/LC_BUILD_VERSION/{f=1} f&&/minos/{print $2; exit}')"
  echo "  $(basename "$b"): macOS ${minos:-?}+"
  [ -z "$minos" ] || [ "${minos%%.*}" -le "${MIN_MACOS%%.*}" ] || { echo "✗ $b needs macOS $minos"; bad=1; }
done
[ "$bad" = 0 ] || exit 1
for b in whisper-cli llama-server ffmpeg ffprobe; do codesign --force --sign - "$CACHE/bin/$b" >/dev/null 2>&1; done

step "Assembling $NAME.app"
APP="$OUT/$NAME.app"
rm -rf "$APP"
APPLESCRIPT="$CACHE/launcher.applescript"
cat > "$APPLESCRIPT" <<'EOF'
-- Stay-open applet: starts the app in the background, opens the browser, and stops the server when you quit it (⌘Q).
on launcher()
	return (POSIX path of (path to me)) & "Contents/Resources/yt/launch.sh"
end launcher

on launchApp()
	try
		do shell script (quoted form of my launcher()) & " start >/dev/null 2>&1"
	on error msg
		display alert "YT Altyazı" message msg
	end try
end launchApp

on run
	my launchApp()
end run

on reopen
	my launchApp()
end reopen

on idle
	return 60
end idle

on quit
	try
		do shell script (quoted form of my launcher()) & " stop >/dev/null 2>&1"
	end try
	continue quit
end quit
EOF
osacompile -s -o "$APP" "$APPLESCRIPT"
YT="$APP/Contents/Resources/yt"
mkdir -p "$YT/app" "$YT/bin" "$YT/models" "$YT/licenses"

# The program: only what runs (no tests or docs); express comes from the lock file
for f in "$ROOT"/*.js; do cp "$f" "$YT/app/"; done
cp -R "$ROOT/public" "$YT/app/public"
cp "$ROOT/package.json" "$ROOT/package-lock.json" "$YT/app/"
(cd "$YT/app" && npm ci --omit=dev --ignore-scripts --silent >/dev/null 2>&1)

cp "$NODE_BIN" "$YT/bin/node"
cp "$CACHE/bin/"* "$YT/bin/"
cp "$WHISPER_MODEL_FILE" "$YT/models/"
if [ -z "${NO_TRANSLATOR:-}" ]; then
  mkdir -p "$YT/models/HY-MT1.5-1.8B"
  cp "$TRANSLATOR_DIR"/*.gguf "$YT/models/HY-MT1.5-1.8B/"
  for f in License.txt README.md; do [ -f "$TRANSLATOR_DIR/$f" ] && cp "$TRANSLATOR_DIR/$f" "$YT/models/HY-MT1.5-1.8B/"; done
fi
cp "$ROOT/LICENSE" "$YT/licenses/YT-Altyazi-LICENSE.txt"
cp "$ROOT/THIRD_PARTY_NOTICES.md" "$YT/licenses/"
cp "$CACHE/whisper/LICENSE" "$YT/licenses/whisper.cpp-LICENSE.txt"
cp "$CACHE/llama/LICENSE" "$YT/licenses/llama.cpp-LICENSE.txt"
cp "$CACHE/ffmpeg/COPYING.LGPLv2.1" "$YT/licenses/ffmpeg-COPYING.LGPLv2.1.txt"
echo "ffmpeg $FFMPEG_VERSION, built from the source at https://ffmpeg.org/releases/ with --disable-autodetect (LGPL, no GPL parts)." > "$YT/licenses/ffmpeg-NOTE.txt"

cat > "$YT/launch.sh" <<'EOF'
#!/bin/sh
# start: run the server in the background (if it is not running yet) and open the browser · stop: quit the server
HERE="$(cd "$(dirname "$0")" && pwd)"
SUPPORT="$HOME/Library/Application Support/YT Altyazı"
STATE="$SUPPORT/state"
PORT="${PORT:-3000}"
URL="http://localhost:$PORT"
mkdir -p "$SUPPORT/data" "$SUPPORT/work" "$STATE"

export PATH="$HERE/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export DATA_DIR="$SUPPORT/data" WORK_DIR="$SUPPORT/work" MODELS_DIR="$HERE/models"
export HYMT_MODEL_DIR="$HERE/models/HY-MT1.5-1.8B" HYMT_STATE_DIR="$STATE/hy-mt"
export DOTENV_PATH="$SUPPORT/.env" PORT

up() { curl -fs -o /dev/null --max-time 2 "$URL/api/settings"; }

case "${1:-start}" in
  stop)
    for f in "$STATE/server.pid" "$STATE/hy-mt/server.pid"; do
      [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null
      rm -f "$f"
    done
    ;;
  start)
    if ! up; then
      cd "$HERE/app" || exit 1
      nohup "$HERE/bin/node" server.js >"$SUPPORT/work/server.log" 2>&1 &
      echo $! > "$STATE/server.pid"
      for _ in $(seq 1 40); do up && break; sleep 0.5; done
    fi
    if up; then open "$URL"; else
      osascript -e 'display alert "YT Altyazı could not start" message "See ~/Library/Application Support/YT Altyazı/work/server.log"'
    fi
    ;;
esac
EOF
chmod +x "$YT/launch.sh"

step "Signing (ad hoc)"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1
codesign --verify --deep "$APP" && echo "✓ signature is consistent"

step "Building the disk image"
STAGE="$CACHE/dmg-stage"
rm -rf "$STAGE"; mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
cat > "$STAGE/Önce oku.txt" <<'EOF'
YT Altyazı: kurulum

1. "YT Altyazı" uygulamasını yanındaki "Applications" klasörüne sürükle.
2. Applications'tan "YT Altyazı"ya çift tıkla. Tarayıcıda uygulama açılır (ilk açılış biraz sürer).
3. İlk açılışta Mac "geliştiricisi doğrulanamadı" diyebilir. Bu uygulama Apple'ın ücretli geliştirici
   imzasıyla imzalı değil, ama içinde zararlı bir şey yok. Bir kereliğine izin ver:
   • "Bitti"/"Tamam"a bas, sonra Apple menüsü → Sistem Ayarları → Gizlilik ve Güvenlik'e git,
     aşağıda "YT Altyazı engellendi" yanındaki "Yine de Aç"a bas ve şifreni/Touch ID'ni gir.
   • Ya da Terminal'e şunu yazıp Enter'a bas, sonra uygulamayı yine aç:
       xattr -dr com.apple.quarantine "/Applications/YT Altyazı.app"
4. Uygulamayı kapatmak için Dock'taki simgesine sağ tıkla → Çık (ya da ⌘Q). Kapatmazsan arka planda çalışır.

Gereken: Apple Silicon (M1 ve sonrası) bir Mac, macOS 13 (Ventura) ya da daha yenisi.
Videolar ve çalışmalar şurada saklanır: ~/Library/Application Support/YT Altyazı
Yapay zekâ özellikleri için (isteğe bağlı) uygulamanın Ayarlar bölümüne Gemini ya da DeepSeek anahtarı yapıştırılır.
EOF
DMG="$OUT/YT-Altyazi-$VERSION-macos-arm64.dmg"
rm -f "$DMG"
hdiutil create -quiet -volname "$NAME" -srcfolder "$STAGE" -format UDZO -imagekey zlib-level=1 -ov "$DMG"
rm -rf "$STAGE"
echo; du -sh "$APP" "$DMG"; echo "Done: $DMG"
