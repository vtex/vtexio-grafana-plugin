package plugin

import "time"

// requestTimeout matches API_REQUEST_TIMEOUT_MS in the frontend client.
const requestTimeout = 30 * time.Second

const (
	headerAppKey = "X-VTEX-API-AppKey"
	//nolint:gosec // header name, not a credential
	headerAppToken = "X-VTEX-API-AppToken"
	// headerFromAlert tells read-api this query backs an alert evaluation, so it can
	// account for scheduled traffic separately from interactive dashboard use.
	headerFromAlert = "X-Grafana-From-Alert"
)
