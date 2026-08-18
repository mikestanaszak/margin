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
expected_checksum() {
  awk -v target="$1" '
    {
      sub(/\r$/, "")
      hash = substr($0, 1, 64)
      separator = substr($0, 65, 2)
      name = substr($0, 67)
      if (length(hash) != 64 || hash !~ /^[0-9a-f]+$/ || separator != "  " || name == "" || index(name, "/") || index(name, "\\") || name ~ /[[:cntrl:]]/) invalid = 1
      else if (name == target) { expected = hash; count += 1 }
    }
    END { if (invalid || count != 1) exit 1; print expected }
  ' "$2"
}

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
TAG_NAME="$(printf '%s' "$RELEASE_JSON" | grep -Eo '"tag_name"[[:space:]]*:[[:space:]]*"[^"]+"' | cut -d '"' -f 4)"
[[ "$TAG_NAME" =~ ^v?([0-9]+\.[0-9]+\.[0-9]+)$ ]] || fail "the release tag does not contain a supported Margin version"
RELEASE_VERSION="${BASH_REMATCH[1]}"
ARTIFACT_NAME="Margin_${RELEASE_VERSION}_amd64.AppImage"
ASSET_URLS="$(printf '%s' "$RELEASE_JSON" | grep -Eo '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]+"' | cut -d '"' -f 4)"
DOWNLOAD_URL="$(printf '%s\n' "$ASSET_URLS" | awk -v suffix="/${ARTIFACT_NAME}" 'length($0) >= length(suffix) && substr($0, length($0) - length(suffix) + 1) == suffix')"
DOWNLOAD_COUNT="$(printf '%s\n' "$DOWNLOAD_URL" | awk 'NF { count += 1 } END { print count + 0 }')"
[[ "$DOWNLOAD_COUNT" -eq 1 ]] || fail "the release must contain exactly one ${ARTIFACT_NAME} asset"
CHECKSUM_URL="$(printf '%s\n' "$ASSET_URLS" | awk -v suffix="/SHA256SUMS" 'length($0) >= length(suffix) && substr($0, length($0) - length(suffix) + 1) == suffix')"
CHECKSUM_COUNT="$(printf '%s\n' "$CHECKSUM_URL" | awk 'NF { count += 1 } END { print count + 0 }')"
[[ "$CHECKSUM_COUNT" -eq 1 ]] || fail "the release must contain exactly one SHA-256 checksum manifest"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/margin.XXXXXX")"
printf 'Downloading Margin…\n'
curl --fail --silent --show-error --location "$DOWNLOAD_URL" --output "${TEMP_DIR}/Margin.AppImage"
curl --fail --silent --show-error --location "$CHECKSUM_URL" --output "${TEMP_DIR}/SHA256SUMS"
EXPECTED_HASH="$(expected_checksum "$ARTIFACT_NAME" "${TEMP_DIR}/SHA256SUMS")" || fail "the release checksum manifest is malformed or missing ${ARTIFACT_NAME}"
ACTUAL_HASH="$(sha256sum "${TEMP_DIR}/Margin.AppImage" | awk '{print $1}')"
[[ "$ACTUAL_HASH" == "$EXPECTED_HASH" ]] || fail "the Linux AppImage failed SHA-256 verification"
mkdir -p "$INSTALL_DIR" "$BIN_DIR"
chmod +x "${TEMP_DIR}/Margin.AppImage"
mv "${TEMP_DIR}/Margin.AppImage" "$APP_IMAGE"
ln -sfn "$APP_IMAGE" "$BIN_LINK"

printf 'Installed Margin in %s\n' "$INSTALL_DIR"
printf 'Run "margin" from a terminal, or launch Margin.AppImage from your file manager.\n'
