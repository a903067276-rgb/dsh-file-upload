# dsh-file-upload ⬆️

[English](README.md) | [简体中文](README.zh-CN.md)

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

**One upload button + drag-and-drop files straight into the conversation** — a plugin for DeepSeek Harness (`dsh`) web.

*Unofficial project: independently developed and maintained by a community member, not an official DeepSeek product.*

## Screenshot

![dsh-file-upload in action](assets/screenshot.png)

The upload icon button in the composer tool row (official DSH design tokens, follows dark/light theme); either the file's path is inserted into the input box, or — for supported images — the image lands in the official attachment rail (auto `file_id` reuse).

## Features

| Action | Effect |
|---|---|
| Click upload icon | System file picker (multi-select) → smart routing → attachment rail and/or path text |
| Drag a file into the window | Images & any file type are taken over (no "unsupported" toast) → smart routing |
| **Image** (PNG/JPEG/WebP/GIF) | ① archived to the **attachment directory** (by-day folders) ② added to the **official draft attachment rail** → sent with automatic DeepSeek Files API `file_id` (same image reuses the id; 7-day expiry auto-reuploads) |
| **Any other file** | Archived to the library's `files/` subfolder, `[上传文件] <path>` text goes into the draft |
| Model without image support | Image falls back to archive + path text (never sent as an image block, no 400) |

- Single-file limit: **64 MB** (DeepSeek Files API hard limit; the local attachment store defaults to 20 MB — see *Large images* below)
- Everything lands in the **attachment library**: `~/Documents/DSH/Attachments/images/<YYYY-MM-DD>/` (images) or `.../files/<YYYY-MM-DD>/` (other files) — configurable in Settings
- Button shows busy state while uploading; failures surface as Chinese notices

## Settings card

![Settings card](assets/settings.png)

- **Attachment directory** (`~/Documents/DSH/Attachments` default, `~` supported) — only used for image archives
- **Images via official attachment** (default on) — off = images follow the old path-text logic
- **Archive images to the attachment directory** (default on) — off = official attachment only (saves disk; if the official channel is unavailable, the image is still force-archived)
- Read-only display: current image size limit from the host

## Large images (20–64 MB)

DeepSeek accepts up to **64 MB per image**. DSH's local attachment store defaults to **20 MB**; images above that (and ≤64 MB) are archived + path-text referenced (the model can still read them via `read_image`, which follows the same store limit).

To let large images through the official attachment path too, add this to `~/.dsh/profiles/web/cordis.patch.yml` and restart `dsh web`:

```yaml
- id: attachment-local
  config:
    maxImageBytes: 67108864   # 20 MiB → 64 MiB (DeepSeek hard limit)
```

Note: the whole config row is replaced, so keep every key you need; re-check against the DSH version after upgrades. The model always sees the harness-normalized version (≤2048px / ≤4 MiB, ≤384 tokens per image) regardless of the original size.

## Install

Official bundle install (one line):

```sh
dsh plugin --profile web add "github:a903067276-rgb/dsh-file-upload#main"
```

Restart `dsh web` (bundle layers are composed at startup). Requires pnpm on PATH (`dsh plugin` forwards to pnpm).

Manual mount (fallback): see [docs/install.md](docs/install.md) — symlink into `~/.dsh/profiles/web/node_modules/` plus a **single entry** in `~/.dsh/cordis.patch.yml` (a double entry makes the plugin apply twice and crash on duplicate route registration), then restart.

## Usage

1. Click the upload icon and pick files (multi-select), or drag files anywhere into the window.
2. **Images** (when the current model accepts images): archived to the attachment directory *and* shown in the official attachment rail — send, and the model sees the image (DeepSeek Files API `file_id`, auto-reused).
3. **Images when the model does not accept images** (or you turned the official path off): archived to `images/`, then `[上传文件] <absolute path>` lines go into the draft — `[上传文件] /path/to/Attachments/images/xxx.png` — and your existing draft text is kept.
4. **Other files**: archived to `files/`, path text goes into the draft. Press send; the model reads the file by path.

## Platform support

| Platform | Status |
|---|---|
| macOS | ✅ fully tested (development environment) |
| Linux | ✅ expected to work (pure Node implementation), untested |
| Windows | ⚠️ expected to work (pure Node implementation, Windows-safe filename sanitization, platform separator paths), untested |

## Requirements

- DSH web >= 0.1.0-rc.7 (run with `dsh web`)
- **Version compatibility**:

| Your DSH version | Install this | Note |
|---|---|---|
| 0.1.1-rc.1 and newer | `main` (v0.1.4+) | Full features (including the official image rail) |
| 0.1.0-rc.7 – 0.1.0-rc.8 | `main` (v0.1.4+) | Works fine; the official image rail auto-degrades to path text unless the session model accepts images |
| 0.1.0-rc.6 and older | `v0.1.2` — `dsh plugin add github:a903067276-rgb/dsh-file-upload#v0.1.2` | Last release without the settings card (the card uses the rc.7+ keyed slot contract) |

- No extra shell needed: the host half is pure Node (`node:fs`), no system commands required on any platform.

## How it works

- **Host** (`lib/index.js`): `POST /api/file-upload/save` — validates the session and size, writes the base64 payload to `<library>/images/<YYYY-MM-DD>/` (`mode=image`) or `<library>/files/<YYYY-MM-DD>/` (`mode=file`) with **pure Node**; `GET/POST /api/file-upload/config` reads/writes the settings (official `settings` service) and exposes the host image limit plus whether the current session's model accepts images (`llm.resolveModel` `inputModalities` — same source the adapter uses).
- **Client** (`lib/client.js`): registers the upload icon in the `conversation.input.left` seat; capture-phase document listener takes over file drags; routing: supported image + official on + model supports + within host limit → archive + `conversation.createDraftImages` + `inputActions.addImages` (the official InputBar's own mechanism) → official attachment rail (no path text); anything else degrades to archive + path text; >64 MB is refused with a notice.
- **Error boundary**: a render crash degrades to a small "⚠ upload component error" chip instead of unmounting the whole composer.

## Notes

- The attachment library only grows; it is **never cleaned automatically** (we don't delete your files) — remove files manually when needed.
- After modifying the plugin, restart `dsh web` for changes to take effect (client-side edits apply on a page refresh; host edits need a restart).

## Why this plugin exists

DSH natively rejects dragged-in images when the current model doesn't support them. This plugin routes images through the **official attachment path** when the model can see them (so they ride the DeepSeek Files API with `file_id` reuse), keeps a **user-accessible archive copy** you can find later, and falls back to plain **path text** otherwise — a plain-text message that passes the model's image check and works with any model or vision plugin (it bypasses DSH's native image rejection because no image block is ever submitted on the fallback path).

## License

[MIT](LICENSE)
