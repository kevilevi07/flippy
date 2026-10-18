#!/usr/bin/env sh
# Trupx install for Linux / macOS / Termux.
#
#   curl -sSL trupx.vercel.app/install.sh | sh
#   # or with auto-login:
#   curl -sSL trupx.vercel.app/install.sh | sh -s -- <YOUR_TOKEN>

set -eu

SERVER='https://trupx.vercel.app'
INSTALL_DIR="${HOME}/.trupx/bin"
EXE="${INSTALL_DIR}/trupx"
TOKEN="${1:-${TRUPX_TOKEN:-}}"

# Detect platform.
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
    echo "  (A prebuilt binary for ${OS}/${ARCH} isn't published yet.)"
    echo "  Build from source instead:"
    echo "    git clone https://github.com/kevilevi07/trupx.git"
    echo "    cd trupx"
    case "$OS" in
        termux) echo "    pkg install rust clang" ;;
        linux)  echo "    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" ;;
        darwin) echo "    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh" ;;
    esac
    echo "    ./build.sh"
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
    echo "  Added trupx to \$PATH in $RC  (re-source it or open a new shell)."
elif [ ! -f "$RC" ]; then
    echo "$LINE" > "$RC"
fi

export PATH="$INSTALL_DIR:$PATH"

if [ -n "$TOKEN" ]; then
    "$EXE" --server "$SERVER" login --token "$TOKEN"
    echo
    echo "  Logged in. Try:"
    echo "    trupx start myapp"
else
    echo
    echo "  Installed. Log in with:"
    echo "    trupx --server $SERVER login --token <YOUR_TOKEN>"
    echo "  Then start a tunnel:"
    echo "    trupx start myapp"
fi
echo
