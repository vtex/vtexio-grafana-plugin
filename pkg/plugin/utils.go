package plugin

import (
	"fmt"
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
