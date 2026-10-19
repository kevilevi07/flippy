#!/usr/bin/env sh
# Trupx install for Linux / macOS / Termux (Android).
#
#   curl -sSL trupx.vercel.app/install.sh | sh

set -eu

SERVER='https://trupx.vercel.app'
REPO='kevilevi07/flippy'
INSTALL_DIR="${HOME}/.trupx/bin"
EXE="${INSTALL_DIR}/trupx"
LOG="${TMPDIR:-/tmp}/trupx-install.log"

log() { echo "[$(date +%H:%M:%S)] $*" >> "$LOG"; }

: > "$LOG"
log "install started"

UNAME_S="$(uname -s | tr '[:upper:]' '[:lower:]')"
UNAME_M="$(uname -m)"
IS_TERMUX=0
if [ -n "${TERMUX_VERSION:-}" ] || [ -d /data/data/com.termux ]; then IS_TERMUX=1; fi

case "$UNAME_S" in
    linux*)   OS="linux" ;;
    darwin*)  OS="darwin" ;;
    *)        echo "unsupported OS: $UNAME_S" >&2; exit 1 ;;
esac
case "$UNAME_M" in
    x86_64|amd64)   ARCH="x64" ;;
    aarch64|arm64)  ARCH="aarch64" ;;
    *)              echo "unsupported arch: $UNAME_M" >&2; exit 1 ;;
esac

# Termux (Android) is aarch64 but Android libc, not glibc. Our Linux-glibc
# release binary won't run — build from source instead.
if [ "$IS_TERMUX" = "1" ]; then
    log "Termux detected; building from source"
    if ! command -v cargo >/dev/null 2>&1; then
        echo "Trupx needs Rust + clang to build on Termux. Installing..."
        pkg install -y rust clang git
    fi
    TMPDIR_BUILD="$(mktemp -d)"
    git clone --depth 1 "https://github.com/${REPO}.git" "${TMPDIR_BUILD}/trupx" >/dev/null 2>&1 || true
    if [ ! -d "${TMPDIR_BUILD}/trupx/terminal" ]; then
        echo "git clone failed; see $LOG" >&2
        exit 1
    fi
    ( cd "${TMPDIR_BUILD}/trupx/terminal" && cargo build --release >> "$LOG" 2>&1 ) || {
        echo "build failed; see $LOG" >&2
        exit 1
    }
    mkdir -p "$INSTALL_DIR"
    cp -f "${TMPDIR_BUILD}/trupx/terminal/target/release/trupx" "$EXE"
    chmod +x "$EXE"
    rm -rf "$TMPDIR_BUILD"
    log "built from source -> $EXE"
else
    ASSET="trupx-${OS}-${ARCH}"
    URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"
    log "downloading $URL"

    mkdir -p "$INSTALL_DIR"
    pkill -x trupx 2>/dev/null || true
    sleep 0.5

    DOWNLOAD_OK=0
    if command -v curl >/dev/null 2>&1; then
        if curl -fsSL -o "$EXE" "$URL" 2>>"$LOG"; then DOWNLOAD_OK=1; fi
    elif command -v wget >/dev/null 2>&1; then
        if wget -q -O "$EXE" "$URL" 2>>"$LOG"; then DOWNLOAD_OK=1; fi
    else
        echo "ERROR: curl or wget required" >&2
        exit 1
    fi

    if [ "$DOWNLOAD_OK" = "0" ]; then
        log "download 404 or network failure; falling back to source build"
        echo "No prebuilt binary available yet for ${OS}/${ARCH}. Building from source..."
        if ! command -v cargo >/dev/null 2>&1; then
            echo "Trupx needs Rust to build. Install from https://rustup.rs" >&2
            exit 1
        fi
        if ! command -v git >/dev/null 2>&1; then
            echo "Trupx needs git to clone." >&2
            exit 1
        fi
        TMPDIR_BUILD="$(mktemp -d)"
        git clone --depth 1 "https://github.com/${REPO}.git" "${TMPDIR_BUILD}/trupx" >>"$LOG" 2>&1 || {
            echo "git clone failed; see $LOG" >&2
            exit 1
        }
        ( cd "${TMPDIR_BUILD}/trupx/terminal" && cargo build --release >>"$LOG" 2>&1 ) || {
            echo "build failed; see $LOG" >&2
            exit 1
        }
        cp -f "${TMPDIR_BUILD}/trupx/terminal/target/release/trupx" "$EXE"
        chmod +x "$EXE"
        rm -rf "$TMPDIR_BUILD"
        log "built from source -> $EXE"
    else
        chmod +x "$EXE"
        log "downloaded -> $EXE"
    fi
fi

# Ensure $HOME/.trupx/bin is on PATH for future shells.
RC=""
case "$(basename "${SHELL:-}")" in
    bash) RC="${HOME}/.bashrc" ;;
    zsh)  RC="${HOME}/.zshrc" ;;
    fish) RC="${HOME}/.config/fish/config.fish" ;;
    *)    RC="${HOME}/.profile" ;;
esac
LINE='export PATH="$HOME/.trupx/bin:$PATH"'
if [ -f "$RC" ]; then
    grep -qxF "$LINE" "$RC" 2>/dev/null || echo "$LINE" >> "$RC"
else
    mkdir -p "$(dirname "$RC")"
    echo "$LINE" > "$RC"
fi
log "ensured PATH in $RC"

export PATH="$INSTALL_DIR:$PATH"

# Save server URL in config.
"$EXE" --server "$SERVER" login --token "noop" >/dev/null 2>&1 || true

# Start a tunnel in the background. Hostname is sent as metadata.
nohup "$EXE" >/dev/null 2>&1 &
log "spawned trupx daemon"

echo "trupx installed. Open a new shell (or 'source $RC') and type: trupx"
