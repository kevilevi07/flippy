#!/usr/bin/env bash
# flippy installer — downloads a prebuilt binary. No Rust required.
#
# Usage:
#   curl -sSL https://flippy.vercel.app/install.sh | bash
#   curl -sSL https://flippy.vercel.app/install.sh | bash -s -- <token>

set -euo pipefail

BASE_URL="${FLIPPY_BASE_URL:-https://flippy.vercel.app}"
BIN_BASE="$BASE_URL/bin"
INSTALL_DIR="$HOME/.flippy/bin"
BIN="$INSTALL_DIR/flippy"

# ----- platform detect -----
is_termux() { [ -n "${PREFIX:-}" ] && echo "$PREFIX" | grep -q "com.termux"; }

OS="$(uname -s 2>/dev/null || echo unknown)"
ARCH="$(uname -m 2>/dev/null || echo unknown)"

case "$OS/$ARCH" in
  Linux/x86_64|Linux/amd64)                ASSET="flippy-linux-x64"   ; PLATFORM="Linux x64" ;;
  Linux/aarch64|Linux/arm64)               ASSET="flippy-linux-arm64" ; PLATFORM="Linux ARM64" ;;
  Darwin/x86_64)                           ASSET="flippy-darwin-x64"  ; PLATFORM="macOS Intel" ;;
  Darwin/arm64)                            ASSET="flippy-darwin-arm64"; PLATFORM="macOS Apple Silicon" ;;
  *)                                       ASSET=""                   ; PLATFORM="$OS/$ARCH" ;;
esac

if is_termux; then
  case "$ARCH" in
    aarch64|arm64)  ASSET="flippy-linux-arm64" ; PLATFORM="Termux ARM64" ;;
    x86_64|amd64)   ASSET="flippy-linux-x64"   ; PLATFORM="Termux x64" ;;
  esac
fi

echo "flippy installer"
echo "  platform    : $PLATFORM"
echo "  install dir : $INSTALL_DIR"

if [ -z "$ASSET" ]; then
  echo >&2
  echo "Error: no prebuilt binary for $OS/$ARCH." >&2
  echo "Contact support via $BASE_URL" >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"

# ----- download -----
URL="$BIN_BASE/$ASSET"
echo
echo "Downloading $URL ..."
if command -v curl >/dev/null 2>&1; then
  curl -fSL --progress-bar "$URL" -o "$BIN"
elif command -v wget >/dev/null 2>&1; then
  wget -q --show-progress -O "$BIN" "$URL"
else
  echo "Error: need curl or wget." >&2
  exit 1
fi
chmod +x "$BIN"
echo "  saved $BIN"

# ----- PATH setup -----
# We write to every shell startup file we know of. On fresh installs (Termux
# especially) these files don't exist yet, so we create them. Login shells on
# Termux read .bash_profile OR .profile (first match); interactive bash reads
# .bashrc; zsh reads .zshenv unconditionally. Covering all four means a new
# terminal always picks up PATH no matter which shell / login mode is used.
PATH_LINE='export PATH="$HOME/.flippy/bin:$PATH"'
ALWAYS_CREATE="$HOME/.bashrc $HOME/.bash_profile $HOME/.profile"
MAYBE_ZSH="$HOME/.zshrc $HOME/.zshenv"

add_path_line() {
  rc="$1"
  if [ ! -f "$rc" ]; then
    touch "$rc" || return 0
  fi
  if ! grep -Fqs "$PATH_LINE" "$rc" 2>/dev/null; then
    printf '\n# flippy\n%s\n' "$PATH_LINE" >> "$rc"
    echo "  added PATH to $rc"
  fi
}

for rc in $ALWAYS_CREATE; do add_path_line "$rc"; done
# Only touch zsh files if the user actually has zsh installed OR a file exists.
if command -v zsh >/dev/null 2>&1 || [ -f "$HOME/.zshrc" ] || [ -f "$HOME/.zshenv" ]; then
  for rc in $MAYBE_ZSH; do add_path_line "$rc"; done
fi

# Make sure .bash_profile actually sources .bashrc on login shells (Termux's
# default), so the PATH we just added is visible in every new terminal.
if ! grep -Fqs 'flippy: source .bashrc' "$HOME/.bash_profile" 2>/dev/null; then
  cat >> "$HOME/.bash_profile" <<'EOF'

# flippy: source .bashrc from login shells (Termux default)
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
EOF
fi

# Make it work in THIS invocation.
export PATH="$INSTALL_DIR:$PATH"
"$BIN" --version || true

# ----- interactive login -----
# Precedence: positional arg > $FLIPPY_TOKEN > interactive prompt.
TOKEN="${1:-${FLIPPY_TOKEN:-}}"
if [ -z "$TOKEN" ] && [ -r /dev/tty ]; then
  echo
  echo "Get your token at $BASE_URL/dashboard  (sign up if you don't have one)."
  printf "Paste your flippy token (or press Enter to skip): "
  IFS= read -r TOKEN < /dev/tty || TOKEN=""
fi
TOKEN="$(printf '%s' "${TOKEN:-}" | tr -d '[:space:]')"
if [ -n "$TOKEN" ]; then
  "$BIN" --server "$BASE_URL" login --token "$TOKEN" || echo "login failed; try: flippy --server $BASE_URL login"
else
  echo "Skipped. Log in later with:"
  echo "  flippy --server $BASE_URL login"
fi

cat <<EOF

Installed.

To use flippy in THIS shell now:
  export PATH="\$HOME/.flippy/bin:\$PATH"

Or open a new terminal. Then:
  flippy http <port> --name <app-name>
EOF
