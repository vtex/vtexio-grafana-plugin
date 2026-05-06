# VTEX IO :: O11y Plugin Grafana Setup (Closed Beta)

| Attribute | Details |
| --- | --- |
| Created | Jan 23, 2026 |
| Status | Closed Beta |
| Updated | Feb 6, 2026 |
| Current Version | 1.0.0 |
| Maintainer | VTEX Apps Team |

## Context

The VTEX IO Grafana Datasource plugin is currently in Closed Beta and distributed manually via a zip file. Because it is unsigned, specific installation steps are required for Grafana to recognize and load it correctly.

## Overview

- **Plugin Name:** VTEX IO
- **Plugin ID:** `vtexio-grafana-plugin`
- **Type:** Datasource
- **Version:** 0.2.0-beta.0
- **Download Link:** VTEX IO Grafana Datasource Zip

## Manual Installation Guide

### Step 1: Download and Extract

1. Download the plugin zip file from the provided link.
2. Locate your Grafana plugins directory based on your OS:
   - **Linux:** `/var/lib/grafana/plugins`
   - **macOS (Intel):** `/usr/local/var/lib/grafana/plugins`
   - **macOS (Apple Silicon):** `/opt/homebrew/var/lib/grafana/plugins`
   - **Windows:** `C:\Program Files\GrafanaLabs\grafana\data\plugins`
   - **Docker:** `/var/lib/grafana/plugins`
3. Extract the zip file into this directory.

> **Important:** Ensure the folder is named `vtexio-grafana-plugin`.
>
> **Verification:** A `plugin.json` file must exist at the root of this folder.

### Step 2: Allow Unsigned Plugins

Grafana blocks unsigned plugins by default; you must authorize it in your configuration:

1. Open your `grafana.ini` (or `custom.ini` for Windows).
2. Find the `[plugins]` section.
3. Add the plugin ID to the `allow_loading_unsigned_plugins` setting:

```ini
[plugins]
allow_loading_unsigned_plugins = vtexio-grafana-plugin
```

For Docker: Add the environment variable `-e "GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=vtexio-grafana-plugin"` to your command or `docker-compose.yml`.

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

Unzip the plugin on your host machine. Ensure the structure is `vtexio-grafana-plugin/plugin.json`.

### Step 2: Run/Compose Example

**Docker Run:**

```bash
docker run -d \
  --name grafana \
  -p 3000:3000 \
  -v $(pwd)/vtexio-grafana-plugin:/var/lib/grafana/plugins/vtexio-grafana-plugin \
  -e GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=vtexio-grafana-plugin \
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
      - ./vtexio-grafana-plugin:/var/lib/grafana/plugins/vtexio-grafana-plugin
    environment:
      - GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=vtexio-grafana-plugin
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
