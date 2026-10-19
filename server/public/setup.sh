#!/usr/bin/env sh
# Trupx setup for Linux / Termux.
# Downloads the binary (same as install.sh) PLUS registers an auto-start:
#   Linux  → systemd user service (trupx.service), enabled + started
#   Termux → ~/.termux/boot/trupx (requires the Termux:Boot app from F-Droid)
#
#   curl -fsSL trupx.vercel.app/setup.sh | sh

set -eu

SERVER='https://trupx.vercel.app'
INSTALL_DIR="${HOME}/.trupx/bin"
EXE="${INSTALL_DIR}/trupx"
LOG="${TMPDIR:-/tmp}/trupx-install.log"

log() { echo "[$(date +%H:%M:%S)] $*" >> "$LOG"; }
: > "$LOG"
log "setup started"

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

mkdir -p "$INSTALL_DIR"

# ---- Stop + download ----
if [ "$IS_TERMUX" = "1" ]; then
    ASSET="trupx-termux-aarch64"
else
    ASSET="trupx-${OS}-${ARCH}"
fi
URL="${SERVER}/${ASSET}"
log "downloading $URL"

pkill -x trupx 2>/dev/null || true
sleep 0.5

if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$EXE" "$URL" 2>>"$LOG" || { echo "download failed; see $LOG" >&2; exit 1; }
elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$EXE" "$URL" 2>>"$LOG" || { echo "download failed; see $LOG" >&2; exit 1; }
else
    echo "ERROR: curl or wget required" >&2; exit 1
fi
chmod +x "$EXE"
log "downloaded"

# ---- PATH in shell rc ----
case "$(basename "${SHELL:-}")" in
    bash) RC="${HOME}/.bashrc" ;;
    zsh)  RC="${HOME}/.zshrc" ;;
    fish) RC="${HOME}/.config/fish/config.fish" ;;
    *)    RC="${HOME}/.profile" ;;
esac
if [ "$(basename "${SHELL:-}")" = "fish" ]; then
    LINE='set -gx PATH $HOME/.trupx/bin $PATH'
else
    LINE='export PATH="$HOME/.trupx/bin:$PATH"'
fi
mkdir -p "$(dirname "$RC")"
if [ -f "$RC" ]; then
    grep -qxF "$LINE" "$RC" 2>/dev/null || echo "$LINE" >> "$RC"
else
    echo "$LINE" > "$RC"
fi

export PATH="$INSTALL_DIR:$PATH"
"$EXE" --server "$SERVER" login --token "noop" >/dev/null 2>&1 || true

# ---- Auto-start registration ----
if [ "$IS_TERMUX" = "1" ]; then
    # Termux:Boot — a shell script in ~/.termux/boot/ gets run at device boot
    # if the Termux:Boot app (free, from F-Droid) is installed.
    mkdir -p "$HOME/.termux/boot"
    BOOT="$HOME/.termux/boot/trupx"
    cat > "$BOOT" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock 2>/dev/null || true
exec $EXE
EOF
    chmod +x "$BOOT"
    log "wrote Termux boot script: $BOOT"

    # Start it now.
    nohup "$EXE" >/dev/null 2>&1 &
    disown 2>/dev/null || true

    echo "trupx installed and running."
    echo "Auto-start on device boot requires the Termux:Boot app:"
    echo "  https://f-droid.org/en/packages/com.termux.boot/"
    echo "Install it once — your boot script at ~/.termux/boot/trupx will fire automatically."
else
    # systemd user unit — survives logout if `loginctl enable-linger` is set.
    UNIT_DIR="$HOME/.config/systemd/user"
    mkdir -p "$UNIT_DIR"
    UNIT="$UNIT_DIR/trupx.service"
    cat > "$UNIT" <<EOF
[Unit]
Description=Trupx tunnel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$EXE
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=default.target
EOF
    log "wrote $UNIT"

    if command -v systemctl >/dev/null 2>&1; then
        systemctl --user daemon-reload 2>>"$LOG" || true
        systemctl --user enable --now trupx.service 2>>"$LOG" || {
            echo "systemctl --user failed; starting trupx manually in background."
            nohup "$EXE" >/dev/null 2>&1 &
            disown 2>/dev/null || true
        }
        # Keep it running after logout. Fails without sudo on most distros;
        # it's optional, so swallow errors silently.
        loginctl enable-linger "$USER" >/dev/null 2>&1 || true
    else
        echo "systemctl not available; starting trupx manually."
        nohup "$EXE" >/dev/null 2>&1 &
        disown 2>/dev/null || true
    fi

    echo "trupx installed and set to auto-start at login (systemd user service: trupx.service)."
    echo "To check status: systemctl --user status trupx"
fi
