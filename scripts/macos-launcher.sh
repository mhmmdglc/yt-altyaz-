#!/bin/sh
# Starts YT Altyazı in the background (if it is not running yet) and opens it in your browser.
# Used by the double-click app built with scripts/create-macos-app.sh. Optional: BROWSER_APP="Google Chrome", PORT=3000.
cd "$(dirname "$0")/.." || exit 1

# Apps started from Finder have a minimal PATH: add Homebrew and nvm so that `node` is found
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "Node.js was not found" message "Install Node.js 20 or newer from https://nodejs.org and try again."'
  exit 1
fi

URL="http://localhost:${PORT:-3000}"
if ! curl -fs -o /dev/null "$URL/api/settings"; then
  mkdir -p work
  nohup node server.js > work/server.log 2>&1 &
  for _ in $(seq 1 30); do
    curl -fs -o /dev/null "$URL/api/settings" && break
    sleep 0.5
  done
fi

if [ -n "$BROWSER_APP" ]; then open -a "$BROWSER_APP" "$URL"; else open "$URL"; fi
