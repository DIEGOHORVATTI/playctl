# playctl

Google Play Console from the terminal. Logs in with a service account JSON and talks to the Android Publisher API, so releases can be checked and promoted without opening the console.

## Install

```sh
git clone https://github.com/DIEGOHORVATTI/playctl.git
cd playctl && bun install && bun link
```

## Usage

```sh
playctl status --package com.example.app
playctl promote 18 --package com.example.app
playctl promote 19 --from internal --to production --package com.example.app
playctl upload app-release.aab --track internal --status draft --name 1.0.0 --notes play/whatsnew
playctl details --email you@example.com --website https://example.com
playctl datasafety data-safety.csv
```

`upload` sends an AAB and releases it on a track in a single edit; `--notes` reads `whatsnew-<language>` files. An app that was never published only accepts `--status draft`. `details` sets the contact info shown on the store page. `datasafety` writes the Data safety form from the CSV that Play Console exports.

```sh
playctl images store/listing.json
```

`promote` copies the release (name and release notes) from one track to another and publishes it complete. Every call opens a Play edit and either commits it (`promote`) or discards it (`status`), so a failed run never leaves a half-made change.

## Configuration

| Setting | Flag | Environment | `.playctl.json` |
| --- | --- | --- | --- |
| Application id | `--package` | `PLAY_PACKAGE_NAME` | `packageName` |
| Service account key | `--key` | `PLAY_KEY_FILE` | `keyFile` |

The key defaults to `~/.config/playctl/key.json`. Keep it out of the repository.

A `.playctl.json` in the project root saves the flags:

```json
{ "packageName": "com.example.app", "keyFile": "~/.config/playctl/key.json" }
```

The service account needs access to the app in Play Console (Users and permissions), including "Release apps to production" for `promote --to production`.
