#!/usr/bin/env sh
# Trupx install for Linux / macOS / Termux.
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
        if [ -n "${TERMUX_VERSION:-}" ] || [ -d /data/data/com.termux ]; then
            OS="termux"
        else
            OS="linux"
        fi
        ;;
    darwin*)  OS="darwin" ;;
    *)        echo "unsupported OS: $UNAME_S" >&2; exit 1 ;;
esac
case "$UNAME_M" in
    x86_64|amd64)   ARCH="x64" ;;
    aarch64|arm64)  ARCH="aarch64" ;;
    *)              echo "unsupported arch: $UNAME_M" >&2; exit 1 ;;
esac

ASSET="trupx-${OS}-${ARCH}"
URL="${SERVER}/${ASSET}"

echo
echo "  Installing trupx -> ${EXE}"
echo "  Platform:         ${OS}/${ARCH}"
echo

mkdir -p "$INSTALL_DIR"

# Stop any running trupx so we can overwrite.
if command -v pkill >/dev/null 2>&1; then
    pkill -x trupx 2>/dev/null || true
fi
sleep 1

if command -v curl >/dev/null 2>&1; then
    DL="curl -fsSL -o $EXE $URL"
elif command -v wget >/dev/null 2>&1; then
    DL="wget -q -O $EXE $URL"
else
    echo "ERROR: curl or wget required" >&2
    exit 1
fi

if ! $DL; then
    echo
    echo "  Download failed from $URL"
    echo
    exit 1
fi

chmod +x "$EXE"

# Add to PATH in the user's shell rc.
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

# Save the server URL to the CLI's config so `trupx start` works with no flags.
"$EXE" --server "$SERVER" login --token "noop" >/dev/null 2>&1 || true

echo
echo "  Installed. Starting a tunnel..."
echo

# No subcommand → the daemon defaults the name to the system hostname.
nohup "$EXE" >/dev/null 2>&1 &
sleep 2

# Peek at the log for the assigned public URL.
LOGFILE="${TMPDIR:-/tmp}/trupx.log"
if [ -f "$LOGFILE" ]; then
    READY=$(grep -o 'tunnel READY: \S*' "$LOGFILE" | tail -1 | awk '{print $3}')
    if [ -n "$READY" ]; then
        echo "  Public URL: $READY"
    else
        echo "  Tunnel starting... open $SERVER for the admin dashboard."
    fi
else
    echo "  Tunnel starting... open $SERVER for the admin dashboard."
fi

echo
echo "  Commands:"
echo "    trupx          -> start a tunnel using the system hostname"
echo "    trupx <name>   -> start a tunnel with that name"
echo "    trupx status   -> show daemon + tunnel"
echo "    trupx stop     -> stop the tunnel"
echo
