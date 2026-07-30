#!/usr/bin/env bash
# Install the latest signed macOS release of Margin.
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

cleanup() {
  if [[ -n "$MOUNT_DIR" ]] && mount | grep -Fq "on ${MOUNT_DIR} "; then hdiutil detach "$MOUNT_DIR" -quiet || true; fi
  if [[ "$INSTALLED" -ne 1 && "$HAD_EXISTING" -eq 1 && -e "$BACKUP" ]]; then
    run_as_admin rm -rf "$TARGET" || true
    run_as_admin mv "$BACKUP" "$TARGET" || true
  fi
  [[ -n "$TEMP_DIR" ]] && rm -rf "$TEMP_DIR"
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
DOWNLOAD_URL="$(printf '%s' "$RELEASE_JSON" | grep -Eo '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]+"' | cut -d '"' -f 4 | grep -E "_${ARCHITECTURE}\\.dmg$" | head -n 1 || true)"
[[ -n "$DOWNLOAD_URL" ]] || fail "the release has no ${ARCHITECTURE} macOS .dmg asset"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/margin.XXXXXX")"
MOUNT_DIR="${TEMP_DIR}/mount"
DISK_IMAGE="${TEMP_DIR}/Margin.dmg"
mkdir "$MOUNT_DIR"
printf 'Downloading Margin…\n'
curl --fail --silent --show-error --location "$DOWNLOAD_URL" --output "$DISK_IMAGE"
hdiutil attach "$DISK_IMAGE" -nobrowse -readonly -mountpoint "$MOUNT_DIR" -quiet
APP_BUNDLE="$(find "$MOUNT_DIR" -maxdepth 1 -type d -name '*.app' -print -quit)"
[[ -n "$APP_BUNDLE" ]] || fail "the downloaded disk image does not contain an app"

if [[ "${MARGIN_ALLOW_UNSIGNED:-0}" != "1" ]]; then
  codesign --verify --deep --strict "$APP_BUNDLE" >/dev/null 2>&1 || fail "the release is not code-signed; refusing to install it"
fi

run_as_admin mkdir -p "$INSTALL_DIR"
if [[ -e "$TARGET" ]]; then
  run_as_admin rm -rf "$BACKUP"
  run_as_admin mv "$TARGET" "$BACKUP"
  HAD_EXISTING=1
fi
run_as_admin ditto "$APP_BUNDLE" "$TARGET"
INSTALLED=1
if [[ "$HAD_EXISTING" -eq 1 ]]; then run_as_admin rm -rf "$BACKUP"; fi

printf 'Installed %s in %s\n' "$APP_NAME" "$INSTALL_DIR"
printf 'Open it from Applications, then choose your notes folder.\n'
