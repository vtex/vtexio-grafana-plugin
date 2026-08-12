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

// maxStatusErrorBodyPreview bounds how much of an unexpected-status response body
// gets echoed into an error message, so a pathological response can't produce an
// unreadable (or enormous) error.
const maxStatusErrorBodyPreview = 500
