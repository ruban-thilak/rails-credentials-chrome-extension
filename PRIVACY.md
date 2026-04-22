# Privacy Policy — Rails Credentials Helper

**Last updated:** April 2025

## Summary

Rails Credentials Helper does **not** collect, transmit, or store any personal data. Everything happens locally in your browser.

## What the extension accesses

| Data | Why | Where it goes |
|------|-----|---------------|
| Master keys you enter in the popup | Used to decrypt `.yml.enc` files client-side via the Web Crypto API | Stored in `chrome.storage.session` (in-memory only). Never written to disk, never sent over the network. Automatically cleared when the browser session ends or all PR tabs are closed. |
| GitHub PR page content | The content script reads `.yml.enc` diff blocks on `github.com/*/pull/*` pages to extract encrypted ciphertext for decryption | Processed entirely in the browser. No data is sent to any external server. |
| GitHub raw file URLs | When the diff DOM does not contain the full file, the extension fetches the raw file from `github.com` using your existing session cookies | Requests go only to `github.com` (same origin). No third-party servers are contacted. |

## What the extension does NOT do

- Does **not** collect analytics or telemetry.
- Does **not** use cookies, tracking pixels, or fingerprinting.
- Does **not** communicate with any server other than `github.com` (for raw file fetches only).
- Does **not** store any data persistently — `chrome.storage.session` is purely in-memory.
- Does **not** read or modify any page content outside of GitHub PR diff views.

## Permissions explained

| Permission | Reason |
|------------|--------|
| `storage` | Required to use `chrome.storage.session` for in-memory key storage. |
| `activeTab` | Grants temporary access to the current tab when the user clicks the extension icon, used to track which tabs have keys for auto-cleanup. |
| Content script on `https://github.com/*/pull/*` | Injects the decrypt button and renders decrypted YAML diffs on GitHub pull request pages only. |

## Third-party services

None. The extension has zero external dependencies and makes no network requests except to `github.com` itself.

## Data retention

All key material is held in `chrome.storage.session` and is automatically erased when:
- The browser is closed, or
- All GitHub PR tabs associated with the keys are closed.

No data is ever persisted to disk.

## Changes to this policy

If this policy changes, the update will be published in this repository alongside the extension update.

## Contact

If you have questions about this privacy policy, please open an issue in the [GitHub repository](https://github.com/your-org/ruby-creds-chrome-ext/issues).
