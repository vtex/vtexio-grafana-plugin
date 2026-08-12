package plugin

import (
	"bytes"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// parseBaseURL resolves the read-api base URL for a client: apiURL when set (used to
// point the backend at a locally running read-api during development, mirroring the
// frontend's local/remote proxy prefixes), otherwise the production URL for tenant.
func parseBaseURL(tenant, apiURL string) string {
	base := strings.TrimRight(strings.TrimSpace(apiURL), "/")
	if base != "" {
		return base
	}
	return fmt.Sprintf(productionBaseURLTemplate, url.PathEscape(tenant))
}

// statusError maps an HTTP status to an error whose text is safe to show a user: it
// describes the failure without echoing the request, which carries the credentials.
// The response body is read-api's own, never the request, so it is safe to preview
// for statuses whose meaning we don't already have a canned message for.
func statusError(status int, body []byte) error {
	switch {
	case status >= 200 && status < 300:
		return nil
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return fmt.Errorf("authentication failed (HTTP %d): check the App Key and App Token configured on this data source", status)
	case status == http.StatusTooManyRequests:
		return fmt.Errorf("quota or rate limit exceeded (HTTP %d) for this tenant", status)
	default:
		return fmt.Errorf("the VTEX Observability API returned HTTP %d: %s", status, previewBody(body))
	}
}

// previewBody trims and bounds a response body for inclusion in an error message.
func previewBody(body []byte) string {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) > maxStatusErrorBodyPreview {
		trimmed = trimmed[:maxStatusErrorBodyPreview]
	}
	return string(trimmed)
}
