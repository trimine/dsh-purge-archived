# dsh-purge-archived

[English](#english) | [中文](#中文)

**Permanently delete archived conversations in DeepSeek Harness — the stored log, the projection cache, the archive mark, and the workspace membership.**

DeepSeek Harness deliberately ships no Session deletion: `@deepseek-ai/dsh-session-persistence-jsonl` documents that "logs accumulate under `root` until removed externally; the seam has no deletion API", and `@deepseek-ai/dsh-client-ui-workspace` lists "No Session deletion" as a known limitation. Archiving only sets a mark; the log stays on disk forever. This plugin adds exactly that one missing operation.

## Features

- **Delete permanently…** — a red row at the end of an archived Session's `...` menu, with a confirmation dialog.
- **Clean up archived chats** — a first-class sidebar panel (beside Plugins and Automation tasks) listing every archived conversation with its size, last activity, and title.
- **Bulk delete** — select any rows, or delete everything in one go.
- **Dangling-entry cleanup** — conversations whose log files were already deleted by hand still leave an archive mark and workspace membership behind. They are listed as **No log** and can be cleaned in one click.
- Bilingual UI (English / 简体中文), theme-token styling, keyboard-accessible dialog.

## What one purge removes

| Artifact | Path |
| --- | --- |
| Stored log generation(s) | `<DSH_HOME>/sessions/<project>/<sessionId>/` |
| Projection-cache checkpoint | `<DSH_HOME>/storages/session_projcache/sessions/<sessionId>.json` |
| Archive mark | the registry's durable archive set |
| Workspace membership | every Workspace's `sessionIds` |

Connected Clients drop the row immediately through the ordinary `api-session/removed` notification.

**Safety.** Only two kinds of entry are accepted: an id in the durable archive set, or an id with no stored log and no live Session (pure registry residue). An ordinary, still-stored, unarchived conversation is always refused. The HTTP routes accept only a same-origin, JSON-bodied `POST`.

## Install

### From the Plugins page

Sidebar **Plugins** → **Add plugin** → type `dsh-purge-archived` → **Install**.

### With the `dsh` CLI

```sh
dsh plugin --profile desktop add dsh-purge-archived
```

### From a local checkout

```sh
dsh plugin --profile desktop add /absolute/path/to/dsh-purge-archived
```

or point the plugin manager at the directory. A local directory install links the checkout, so the folder must stay in place.

After installing a *new version* of an already-installed plugin, restart DeepSeek Harness once so the Host half loads the fresh module, then refresh the page.

## Use

1. **Single conversation** — set the sidebar's view options to **All conversations** or **Archived only** so archived rows are visible, then open a row's `...` menu and pick **Delete permanently…**.
2. **Bulk** — click **Clean up archived chats** in the sidebar's panel list, select rows (or **Select all**), then **Delete selected**.
3. **Dangling entries** — the same page lists entries marked **No log**; **Clean up all N invalid entries** removes just those.

## Compatibility

Verified against DeepSeek Harness `0.2.1-rc.5` (V4 session-log generation, Windows desktop). The deletion path is format-agnostic: it removes the whole Session directory instead of naming a log file, so later log generations keep working.

Requires the `@deepseek-ai/dsh-client-ui-workspace` client package (part of the standard Web/Desktop composition) and the Workspace registry on the Host.

## Develop

Plain JavaScript, no build step. `index.js` is the Host half (Cordis plugin), `client.js` is the browser module (`window.__ModuleLoader__`), `cordis.patch.yml` inserts the row, `locale/*.json` carries the Plugin Manager metadata.

`index.js` exports `removeSessionArtifacts()` — the filesystem layer — so it can be exercised against a temporary DSH home without a running Host.

## Publish checklist

The manifest still carries `OWNER` placeholders in `author`, `repository`, `homepage`, `bugs`, and in `LICENSE`. Replace them, then:

```sh
# 1. rename if you want your own scope (also update client.js `id:` and cordis.patch.yml `name:`)
npm pkg set name=@you/dsh-purge-archived

# 2. publish
npm publish --access public
```

A published package installs by name in the Add-plugin wizard. For a marketplace listing, submit the repository to the community plugin index your deployment points at (the `plugin-market` row's `indexes` config).

## License

MIT
