#!/usr/bin/env sh
# Flippy build for Linux / macOS / Termux
set -eu
cd "$(dirname "$0")"

if ! command -v cargo >/dev/null 2>&1; then
    if [ -x "$HOME/.cargo/bin/cargo" ]; then
        export PATH="$HOME/.cargo/bin:$PATH"
    else
        echo "ERROR: cargo not found."
        case "$(uname -s)" in
            Linux*)
                if [ -n "${TERMUX_VERSION:-}" ] || [ -d /data/data/com.termux ]; then
                    echo "On Termux, run: pkg install rust clang"
                else
                    echo "Install Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
                fi
                ;;
            Darwin*)
                echo "Install Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
                ;;
        esac
        exit 1
    fi
fi

echo "[flippy] building release..."
( cd terminal && cargo build --release )

mkdir -p dist
cp -f terminal/target/release/flippy dist/flippy
chmod +x dist/flippy

size="$(wc -c < dist/flippy | tr -d ' ')"
echo
echo "[flippy] build complete."
echo "        output: $(pwd)/dist/flippy  ($size bytes)"
echo
echo "Run:"
echo "    ./dist/flippy"
echo "    ./dist/flippy --tunnel"
echo
