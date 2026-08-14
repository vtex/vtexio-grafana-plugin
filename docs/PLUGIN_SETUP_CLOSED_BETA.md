# VTEX IO :: O11y Plugin Grafana Setup (Closed Beta)

| Attribute | Details |
| --- | --- |
| Created | Jan 23, 2026 |
| Status | Closed Beta |
| Updated | Aug 14, 2026 |
| Current Version | 0.2.2-beta.0 |
| Maintainer | VTEX Apps Team |

## Context

The VTEX IO Grafana Datasource plugin is currently in Closed Beta and distributed manually via a zip file attached to each [GitHub Release](https://github.com/vtex/vtexio-grafana-plugin/releases). Releases are signed with a private signature scoped to VTEX's official Grafana root URLs (`https://grafana.com`, `https://vtexioapps.grafana.net`, `https://grafana-beta.vtex.com`, and `http://localhost:3000`). If your Grafana instance's configured root URL is not one of these, the signature will not validate and specific installation steps are required for Grafana to load the plugin anyway.

## Overview

- **Plugin Name:** VTEX IO
- **Plugin ID:** `vtexio-grafana-datasource`
- **Type:** Datasource
- **Version:** `0.2.2-beta.0` (latest closed beta release — check the [Releases page](https://github.com/vtex/vtexio-grafana-plugin/releases) for newer versions)
- **Grafana compatibility:** `>=10.4.0`
- **Download Link:** [`vtexio-grafana-datasource-0.2.2-beta.0.zip`](https://github.com/vtex/vtexio-grafana-plugin/releases/download/v0.2.2-beta.0/vtexio-grafana-datasource-0.2.2-beta.0.zip)

## Manual Installation Guide

### Step 1: Download and Extract

1. Download the plugin zip file from the [Releases page](https://github.com/vtex/vtexio-grafana-plugin/releases) (e.g. `vtexio-grafana-datasource-0.2.2-beta.0.zip`).
2. Locate your Grafana plugins directory based on your OS:
   - **Linux:** `/var/lib/grafana/plugins`
   - **macOS (Intel):** `/usr/local/var/lib/grafana/plugins`
   - **macOS (Apple Silicon):** `/opt/homebrew/var/lib/grafana/plugins`
   - **Windows:** `C:\Program Files\GrafanaLabs\grafana\data\plugins`
   - **Docker:** `/var/lib/grafana/plugins`
3. Extract the zip file into this directory.

> **Important:** The zip extracts to a version-suffixed folder (e.g. `vtexio-grafana-datasource-0.2.2-beta.0`). Rename it to `vtexio-grafana-datasource` so the plugin ID and folder name match.
>
> **Verification:** A `plugin.json` file must exist at the root of this folder.

### Step 2: Allow Unsigned Plugins

If your Grafana root URL matches one of the signed URLs listed above (`grafana.com`, `vtexioapps.grafana.net`, `grafana-beta.vtex.com`, or `localhost:3000`), the plugin's signature validates automatically and you can skip this step. For any other root URL, Grafana treats it as unsigned and blocks it by default; you must authorize it in your configuration:

1. Open your `grafana.ini` (or `custom.ini` for Windows).
2. Find the `[plugins]` section.
3. Add the plugin ID to the `allow_loading_unsigned_plugins` setting:

```ini
[plugins]
allow_loading_unsigned_plugins = vtexio-grafana-datasource
```

For Docker: Add the environment variable `-e "GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=vtexio-grafana-datasource"` to your command or `docker-compose.yml`.

### Step 3: Restart Grafana

The plugin will not be detected until the service restarts.

- **macOS:** `brew services restart grafana`
- **Linux:** `sudo systemctl restart grafana-server`
- **Windows:** Restart via `Services.msc`
- **Docker:** `docker restart <container_id_or_name>`

### Step 4: Verify Installation

Log in to Grafana and navigate to **Administration > Plugins**. Search for "VTEX IO" to confirm it appears in the list.

## Docker Installation Guide

For Docker environments, installation is managed via volume mounting and environment variables.

### Step 1: Extract Plugin Locally

Unzip the plugin on your host machine, then rename the extracted folder (originally `vtexio-grafana-datasource-<version>`) to `vtexio-grafana-datasource`. Ensure the structure is `vtexio-grafana-datasource/plugin.json`.

### Step 2: Run/Compose Example

**Docker Run:**

```bash
docker run -d \
  --name grafana \
  -p 3000:3000 \
  -v $(pwd)/vtexio-grafana-datasource:/var/lib/grafana/plugins/vtexio-grafana-datasource \
  -e GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=vtexio-grafana-datasource \
  grafana/grafana:latest
```

**Docker Compose:**

```yaml
version: '3.8'
services:
  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    ports:
      - "3000:3000"
    volumes:
      - ./vtexio-grafana-datasource:/var/lib/grafana/plugins/vtexio-grafana-datasource
    environment:
      - GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=vtexio-grafana-datasource
```

## Configuration & Credentials

### Step 5: Generate VTEX App Key and Token

1. **Navigate:** In VTEX Admin, go to **Account Settings > API Keys**.
2. **Generate:** Under the **Generated** tab, click **+ Generate Key** and provide a label.
3. **Assign Roles:** Click **Add Roles**. Select roles with access to VTEX IO (Read Workspace Apps, Log Access, etc.) and Logs.
4. **Save:** Click **Generate**. Copy the App Key and App Token immediately.

> ⚠️ **Warning:** The App Token is shown only once. Never share it in public channels.

### Step 6: Configure the Datasource

1. In Grafana, navigate to **Connections > Data sources**.
2. Click **Add data source** and search for "VTEX IO".
3. Enter the App Key and App Token.
4. Click **Save & test**. You should see: *"Successfully connected to VTEX Observability Platform."*

## Troubleshooting

| Issue | Potential Cause | Solution |
| --- | --- | --- |
| Plugin not in list | Wrong directory structure | Ensure `plugin.json` is exactly one level below `plugins/` (avoid "double-nesting"). |
| "Signature Verification Failed" | Step 2 was skipped | Double-check that `allow_loading_unsigned_plugins` matches the ID exactly. |
| Permissions Error (Linux/Mac) | Folder ownership | Ensure the `grafana` user has read access: `sudo chown -R grafana:grafana [path]`. |
| Changes not applied | Service didn't restart | Check logs (e.g., `journalctl` or `docker logs`) to verify the config reloaded. |

## Usage Note

This plugin supports querying both **Logs** and **Metrics**. When building a panel, select the **Query Type** and then choose a specific **App name** to begin visualizing data.
