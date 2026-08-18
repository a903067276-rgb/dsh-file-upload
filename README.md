# dsh-file-upload 📎

[English](README.md) | [简体中文](README.zh-CN.md)

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

**One upload button + drag-and-drop files straight into the conversation** — a DeepSeek
Harness (DSH) web plugin.

Click the **upload icon** button next to the composer (or just drag any file into the window):
the file is saved to the current project's `uploads/` directory and the absolute path is
inserted into the input box as `[上传文件] /path/to/uploads/xxx.png`. Press send and the
model — or any attached vision tool — reads the file by path.

**Vision-plugin agnostic**: the message only carries a local absolute path (plain text), so
it works with dsh-vision's `view_image`, any other model/tool that can read local paths, or
no vision at all. It bypasses DSH's native "the current model does not support images"
rejection because no image block is ever submitted.

## Screenshot

![dsh-file-upload in action](assets/screenshot.png)

The upload icon button in the composer tool row (official DSH design tokens, follows
dark/light theme); the picked file's path (blurred in the
screenshot) is inserted into the input box automatically, ready to send.

## Features

| Action | Effect |
|---|---|
| Click upload icon | System file picker (multi-select) → save → path into the input box |
| Drag a file into the window | Images & any file type are taken over (no "unsupported" toast) → save → path into the input box |
| Send the message | The model / vision tool reads the file by absolute path |
| Switch sessions | Button follows the current session; files land in that session's project `uploads/` |

- Single-file limit: 25 MB (frontend) / 30 MB (backend)
- Filenames keep Chinese/space characters; a timestamp prefix avoids collisions
- Button shows busy state while uploading; failures surface as Chinese notices

## Install

### Official bundle install (recommended)

```sh
dsh plugin --profile web add "github:a903067276-rgb/dsh-file-upload#main"
```

Restart `dsh web`. Requires pnpm on PATH
(`dsh plugin` forwards to pnpm).

### Manual mount (fallback, macOS-tested)

See [docs/install.md](docs/install.md): symlink into `~/.dsh/profiles/web/node_modules/`
plus a **single entry** in `~/.dsh/cordis.patch.yml`, then restart.

## Usage

1. Click the upload icon and pick files, or drag files anywhere into the window.
2. The input box gets `[上传文件] <absolute path>` lines (your existing draft text is kept).
3. Press send; the model calls its vision tool on the path automatically.

## Platform support

| Platform | Status |
|---|---|
| macOS | ✅ fully tested (development environment) |
| Linux | ✅ expected to work (pure Node implementation), untested |
| Windows | ⚠️ expected to work (pure Node implementation, Windows-safe filename sanitization, platform separator paths), untested |

## Requirements

- DSH web (run with `dsh web`)
- No extra shell needed: the host half is pure Node (`node:fs`), no system commands
  required on any platform.

## How it works

- **Host** (`lib/index.js`): one route `POST /api/file-upload/save` — validates the session
  and size, then writes the base64 payload to `<session cwd>/uploads/` with **pure Node**
  (`node:fs`, no system command dependency, cross-platform); the returned path is built via
  `node:path` and follows the platform separator.
- **Client** (`lib/client.js`): registers the upload icon button in the
  `conversation.input.left` seat (visually distinct from the default "+" command button);
  a capture-phase document listener takes over file drags before the official InputBar's
  bubble-phase listener (which would reject images); `FileReader` reads base64, uploads it,
  then the path text is appended to the input draft (`inputActions.setDraft`).
- **Error boundary**: a render crash degrades to a small "⚠ upload component error" chip
  instead of unmounting the whole composer.

## Notes

- The `uploads/` directory only grows; it is **never cleaned automatically** (we don't delete
  your files) — remove files manually when needed.
