#!/usr/bin/env bash
#
# Builds a clean .zip for Chrome Web Store submission.
# Usage: ./package.sh
#
set -euo pipefail

EXTENSION_NAME="rails-credentials-helper"

VERSION=$(awk -F'"' '/"version"/{print $4; exit}' manifest.json)

OUT_DIR="dist"
ZIP_FILE="${OUT_DIR}/${EXTENSION_NAME}-${VERSION}.zip"

FILES=(
  manifest.json
  background.js
  content.js
  content.css
  decrypt.js
  popup.html
  popup.js
  popup.css
  icons/icon16.png
  icons/icon48.png
  icons/icon128.png
)

echo "Packaging ${EXTENSION_NAME} v${VERSION}..."

for f in "${FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: Missing file: $f" >&2
    exit 1
  fi
done

mkdir -p "$OUT_DIR"
rm -f "$ZIP_FILE"

zip -9 "$ZIP_FILE" "${FILES[@]}"

echo ""
echo "Created: $ZIP_FILE"
echo "Size:    $(du -h "$ZIP_FILE" | cut -f1)"
echo ""
echo "Next steps:"
echo "  1. Go to https://chrome.google.com/webstore/devconsole"
echo "  2. Click 'New Item' (or update existing)"
echo "  3. Upload ${ZIP_FILE}"
echo "  4. Fill in the store listing (description, screenshots, privacy policy URL)"
echo "  5. Submit for review"
