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

// productionBaseURLTemplate is the read-api base URL for a tenant when no local
// override is configured. %s is replaced with the URL-escaped tenant name.
const productionBaseURLTemplate = "https://%s.vtexcommercebeta.com.br/api/extensions/observability"

const (
	// maxHealthCheckBodySize bounds the reachability probe's response read: it only
	// needs to observe the status code, never the body.
	maxHealthCheckBodySize = 1 << 20 // 1MB

	// maxQueryResponseBodySize bounds a query response read: large enough for any
	// real read-api payload, small enough that a runaway response cannot exhaust the
	// Grafana process.
	maxQueryResponseBodySize = 64 << 20 // 64MB
)
