#!/usr/bin/env bash
# Install the latest x64 Linux AppImage release of Margin for the current user.
# Usage: curl -fsSL https://raw.githubusercontent.com/mikestanaszak/margin/main/install-linux.sh | bash
set -euo pipefail

REPOSITORY="${MARGIN_REPOSITORY:-mikestanaszak/margin}"
VERSION="${MARGIN_VERSION:-latest}"
INSTALL_DIR="${MARGIN_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/Margin}"
BIN_DIR="${MARGIN_BIN_DIR:-$HOME/.local/bin}"
APP_IMAGE="${INSTALL_DIR}/Margin.AppImage"
BIN_LINK="${BIN_DIR}/margin"
TEMP_DIR=""

fail() { printf 'Margin installer: %s\n' "$*" >&2; exit 1; }

cleanup() {
  [[ -n "$TEMP_DIR" ]] && rm -rf "$TEMP_DIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT

[[ "$(uname -s)" == "Linux" ]] || fail "this installer supports Linux only"
[[ "$(uname -m)" == "x86_64" ]] || fail "only x64 Linux releases are currently available"

if [[ "$VERSION" == "latest" ]]; then
  RELEASE_ENDPOINT="https://api.github.com/repos/${REPOSITORY}/releases/latest"
else
  RELEASE_ENDPOINT="https://api.github.com/repos/${REPOSITORY}/releases/tags/v${VERSION}"
fi

RELEASE_JSON="$(curl --fail --silent --show-error --location -H 'Accept: application/vnd.github+json' "$RELEASE_ENDPOINT")" || fail "could not find the requested GitHub release"
DOWNLOAD_URL="$(printf '%s' "$RELEASE_JSON" | grep -Eo '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]+"' | cut -d '"' -f 4 | grep -E '\.AppImage$' | head -n 1 || true)"
[[ -n "$DOWNLOAD_URL" ]] || fail "the release has no x64 Linux AppImage asset"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/margin.XXXXXX")"
mkdir -p "$INSTALL_DIR" "$BIN_DIR"
printf 'Downloading Margin…\n'
curl --fail --silent --show-error --location "$DOWNLOAD_URL" --output "${TEMP_DIR}/Margin.AppImage"
chmod +x "${TEMP_DIR}/Margin.AppImage"
mv "${TEMP_DIR}/Margin.AppImage" "$APP_IMAGE"
ln -sfn "$APP_IMAGE" "$BIN_LINK"

printf 'Installed Margin in %s\n' "$INSTALL_DIR"
printf 'Run "margin" from a terminal, or launch Margin.AppImage from your file manager.\n'
