#!/bin/sh
# Builds a double-click macOS app that starts YT Altyazı and opens it in your browser.
#   scripts/create-macos-app.sh [--browser "Google Chrome"] [--dest ~/Desktop] [--name "YT Altyazı"]
# The app points at this folder: if you move the project, run this script again.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
NAME="YT Altyazı"; DEST="$HOME/Desktop"; BROWSER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --browser) BROWSER="$2"; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
chmod +x "$HERE/macos-launcher.sh"
SCRIPT="$(mktemp -t ytaltyazi).applescript"
ENVPREFIX=""
[ -n "$BROWSER" ] && ENVPREFIX="BROWSER_APP='$BROWSER' "
printf 'do shell script "%s'"'"'%s/macos-launcher.sh'"'"' >/dev/null 2>&1 &"\n' "$ENVPREFIX" "$HERE" > "$SCRIPT"
osacompile -o "$DEST/$NAME.app" "$SCRIPT"
rm -f "$SCRIPT"
echo "Created: $DEST/$NAME.app"
