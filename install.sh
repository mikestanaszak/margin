#!/usr/bin/env bash
# Install the latest checksummed macOS release of Margin.
# Usage: curl -fsSL https://raw.githubusercontent.com/mikestanaszak/margin/main/install.sh | bash
set -euo pipefail

REPOSITORY="${MARGIN_REPOSITORY:-mikestanaszak/margin}"
VERSION="${MARGIN_VERSION:-latest}"
INSTALL_DIR="${MARGIN_INSTALL_DIR:-/Applications}"
APP_NAME="Margin.app"
TEMP_DIR=""
MOUNT_DIR=""
TARGET="${INSTALL_DIR}/${APP_NAME}"
BACKUP="${TARGET}.previous"
HAD_EXISTING=0
INSTALLED=0

fail() { printf 'Margin installer: %s\n' "$*" >&2; exit 1; }
run_as_admin() { if [[ -w "$INSTALL_DIR" ]]; then "$@"; else sudo "$@"; fi; }
quiet_remove() { run_as_admin rm -rf "$1" >/dev/null 2>&1; }
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
  if [[ -n "$MOUNT_DIR" ]] && mount | grep -Fq "on ${MOUNT_DIR} "; then hdiutil detach "$MOUNT_DIR" -quiet >/dev/null 2>&1 || true; fi
  if [[ "$INSTALLED" -ne 1 && "$HAD_EXISTING" -eq 1 && -e "$BACKUP" ]]; then
    quiet_remove "$TARGET" || true
    run_as_admin mv "$BACKUP" "$TARGET" >/dev/null 2>&1 || true
  fi
  [[ -n "$TEMP_DIR" ]] && rm -rf "$TEMP_DIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT

[[ "$(uname -s)" == "Darwin" ]] || fail "this installer supports macOS only"
case "$(uname -m)" in
  arm64) ARCHITECTURE="aarch64" ;;
  x86_64) fail "Intel Macs are not currently supported by the Margin installer" ;;
  *) fail "unsupported Mac architecture: $(uname -m)" ;;
esac

if [[ "$VERSION" == "latest" ]]; then RELEASE_ENDPOINT="https://api.github.com/repos/${REPOSITORY}/releases/latest"; else RELEASE_ENDPOINT="https://api.github.com/repos/${REPOSITORY}/releases/tags/v${VERSION}"; fi
RELEASE_JSON="$(curl --fail --silent --show-error --location -H 'Accept: application/vnd.github+json' "$RELEASE_ENDPOINT")" || fail "could not find the requested GitHub release"
TAG_NAME="$(printf '%s' "$RELEASE_JSON" | grep -Eo '"tag_name"[[:space:]]*:[[:space:]]*"[^"]+"' | cut -d '"' -f 4)"
[[ "$TAG_NAME" =~ ^v?([0-9]+\.[0-9]+\.[0-9]+)$ ]] || fail "the release tag does not contain a supported Margin version"
RELEASE_VERSION="${BASH_REMATCH[1]}"
ARTIFACT_NAME="Margin_${RELEASE_VERSION}_${ARCHITECTURE}.dmg"
ASSET_URLS="$(printf '%s' "$RELEASE_JSON" | grep -Eo '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]+"' | cut -d '"' -f 4)"
DOWNLOAD_URL="$(printf '%s\n' "$ASSET_URLS" | awk -v suffix="/${ARTIFACT_NAME}" 'length($0) >= length(suffix) && substr($0, length($0) - length(suffix) + 1) == suffix')"
DOWNLOAD_COUNT="$(printf '%s\n' "$DOWNLOAD_URL" | awk 'NF { count += 1 } END { print count + 0 }')"
[[ "$DOWNLOAD_COUNT" -eq 1 ]] || fail "the release must contain exactly one ${ARTIFACT_NAME} asset"
CHECKSUM_URL="$(printf '%s\n' "$ASSET_URLS" | awk -v suffix="/SHA256SUMS" 'length($0) >= length(suffix) && substr($0, length($0) - length(suffix) + 1) == suffix')"
CHECKSUM_COUNT="$(printf '%s\n' "$CHECKSUM_URL" | awk 'NF { count += 1 } END { print count + 0 }')"
[[ "$CHECKSUM_COUNT" -eq 1 ]] || fail "the release must contain exactly one SHA-256 checksum manifest"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/margin.XXXXXX")"
MOUNT_DIR="${TEMP_DIR}/mount"
DISK_IMAGE="${TEMP_DIR}/Margin.dmg"
CHECKSUM_FILE="${TEMP_DIR}/SHA256SUMS"
mkdir "$MOUNT_DIR"
printf 'Downloading Margin…\n'
curl --fail --silent --show-error --location "$DOWNLOAD_URL" --output "$DISK_IMAGE"
curl --fail --silent --show-error --location "$CHECKSUM_URL" --output "$CHECKSUM_FILE"
EXPECTED_HASH="$(expected_checksum "$ARTIFACT_NAME" "$CHECKSUM_FILE")" || fail "the release checksum manifest is malformed or missing ${ARTIFACT_NAME}"
ACTUAL_HASH="$(shasum -a 256 "$DISK_IMAGE" | awk '{print $1}')"
[[ "$ACTUAL_HASH" == "$EXPECTED_HASH" ]] || fail "the macOS disk image failed SHA-256 verification"
hdiutil attach "$DISK_IMAGE" -nobrowse -readonly -mountpoint "$MOUNT_DIR" -quiet
APP_BUNDLE="$(find "$MOUNT_DIR" -maxdepth 1 -type d -name '*.app' -print -quit)"
[[ -n "$APP_BUNDLE" ]] || fail "the downloaded disk image does not contain an app"

if [[ "${MARGIN_ALLOW_UNSIGNED:-0}" != "1" ]]; then
  codesign --verify --deep --strict "$APP_BUNDLE" >/dev/null 2>&1 || fail "the release is not code-signed; refusing to install it"
fi

run_as_admin mkdir -p "$INSTALL_DIR"
if [[ -e "$TARGET" ]]; then
  quiet_remove "$BACKUP" || fail "could not prepare the existing installation"
  run_as_admin mv "$TARGET" "$BACKUP"
  HAD_EXISTING=1
fi
run_as_admin ditto "$APP_BUNDLE" "$TARGET"
INSTALLED=1
if [[ "$HAD_EXISTING" -eq 1 ]]; then quiet_remove "$BACKUP" || fail "installed Margin but could not remove the previous backup"; fi

printf 'Installed %s in %s\n' "$APP_NAME" "$INSTALL_DIR"
printf 'Open it from Applications, then choose your notes folder.\n'
