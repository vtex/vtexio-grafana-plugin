package plugin

import (
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
// never echoes the response body. read-api is not a trusted boundary for this — we
// cannot guarantee an error response never reflects request data back — so, unlike
// the rest of this client's error wrapping, this one only ever reports the status.
func statusError(status int) error {
	switch {
	case status >= 200 && status < 300:
		return nil
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return fmt.Errorf("authentication failed (HTTP %d): check the App Key and App Token configured on this data source", status)
	case status == http.StatusTooManyRequests:
		return fmt.Errorf("quota or rate limit exceeded (HTTP %d) for this tenant", status)
	default:
		return fmt.Errorf("the VTEX Observability API returned HTTP %d", status)
	}
}
