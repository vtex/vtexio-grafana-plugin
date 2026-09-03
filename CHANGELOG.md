# Changelog

All notable changes to the VTEX IO Grafana Datasource (`vtex-grafana-datasource`) are documented in this file.

## Unreleased

### Changed

- Plugin ID renamed from `vtexio-grafana-datasource` to `vtex-grafana-datasource` (Grafana Cloud org slug `vtex`). Backend executable is now `gpx_vtex_grafana_datasource`. Existing closed-beta installs must remove the old plugin folder and re-add the data source; Grafana does not migrate the ID automatically.

### Fixed

- Pin `google.golang.org/grpc` to `v1.83.1` (CVE-2026-84304) and `browserslist` to `4.28.7` (CVE-2026-73088, CVE-2026-73089) so the Grafana plugin-validator OSV scan stays clean.

## 0.3.0-beta.0 (2026-08-14)

### Added

- Backend plugin (`gpx_vtexio_grafana_datasource`) so Grafana can evaluate **alert rules** server-side, in addition to dashboard queries.
- Closed-beta setup guide for manual zip install (`docs/PLUGIN_SETUP_CLOSED_BETA.md`).
- Release workflow now builds backend binaries and verifies the plugin signature before attaching the zip.

### Fixed

- Nightly Playwright e2e failures on Grafana Enterprise (`@grafana/e2e-selectors` override).
- Verbose API logging removed from the datasource client.

## 0.2.2-beta.0 (2026-07-31)

### Fixed

- Preserve the base app filter when building observability queries.
- Validate the Account / tenant field (lowercase letters and numbers only).

## 0.2.1-beta.4 (2026-07-27)

### Fixed

- Playwright e2e compatibility with Grafana 13.
- TechDocs README for Backstage.

### Security

- Dependency updates (protobufjs, form-data, qs, ws, and related packages).

## 0.2.1-beta.3 (2026-06-29)

### Added

- Account / tenant field on the datasource config editor (auto-filled from App Key, overridable for cross-account access).

## 0.2.1-beta.0 (2026-05-15)

### Added

- Initial closed-beta Grafana datasource for VTEX IO Observability.
- Metrics queries: request rate per account, request rate per status per account, and latency stats (p50 / p95 / p99) per account and handler.
- Logs queries with app selector and configurable page size.
