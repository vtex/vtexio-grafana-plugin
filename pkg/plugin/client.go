package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Client talks to the VTEX Observability read-api directly, without the Grafana data
// source proxy — the proxy only exists for browser-originated requests, and the
// alerting engine has no browser.
//
// Credentials never appear in a URL, a log line, or an error returned from here.
type Client struct {
	baseURL string
	tenant  string
	appKey  string
	// appToken is write-only from this struct's perspective: it goes into a request
	// header and is never read back out.
	appToken string
	http     *http.Client
}

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

// NewClient builds a read-api client for one data source instance.
//
// apiURL overrides the API base, mirroring the frontend's local/remote proxy prefixes:
// the frontend can point at a local read-api through the Grafana proxy, and without an
// override the backend could only ever reach production. Leave it empty for production.
func NewClient(tenant, appKey, appToken, apiURL string) *Client {
	base := strings.TrimRight(strings.TrimSpace(apiURL), "/")
	if base == "" {
		base = fmt.Sprintf("https://%s.vtexcommercebeta.com.br/api/extensions/observability", url.PathEscape(tenant))
	}

	return &Client{
		baseURL:  base,
		tenant:   tenant,
		appKey:   appKey,
		appToken: appToken,
		http:     &http.Client{Timeout: requestTimeout},
	}
}

// IsConfigured reports whether both credentials and a tenant are present. Callers
// should check this before querying so the failure is a clear message rather than a
// 401 from read-api.
func (c *Client) IsConfigured() bool {
	return strings.TrimSpace(c.tenant) != "" &&
		strings.TrimSpace(c.appKey) != "" &&
		strings.TrimSpace(c.appToken) != ""
}

// QueryMetrics posts a metrics query and decodes the DataFrame-shaped response.
func (c *Client) QueryMetrics(ctx context.Context, body O11yQueryRequest, fromAlert bool) (*O11yQueryResponse, error) {
	return c.post(ctx, fmt.Sprintf("%s/metrics/%s/query", c.baseURL, url.PathEscape(c.tenant)), body, fromAlert)
}

// QueryLogs posts a logs query and decodes the DataFrame-shaped response.
func (c *Client) QueryLogs(ctx context.Context, body O11yQueryRequest, fromAlert bool) (*O11yQueryResponse, error) {
	return c.post(ctx, fmt.Sprintf("%s/logs/%s/query", c.baseURL, url.PathEscape(c.tenant)), body, fromAlert)
}

// FetchLogsFields is a cheap reachability probe used by the health check.
func (c *Client) FetchLogsFields(ctx context.Context) error {
	endpoint := fmt.Sprintf("%s/logs/%s/fields", c.baseURL, url.PathEscape(c.tenant))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return fmt.Errorf("building request: %w", err)
	}
	c.setHeaders(req, false)

	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("reaching the VTEX Observability API: %w", err)
	}
	defer func() { _ = res.Body.Close() }()

	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 1<<20))
	return statusError(res.StatusCode)
}

func (c *Client) post(ctx context.Context, endpoint string, body O11yQueryRequest, fromAlert bool) (*O11yQueryResponse, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("encoding request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("building request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	c.setHeaders(req, fromAlert)

	res, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("reaching the VTEX Observability API: %w", err)
	}
	defer func() { _ = res.Body.Close() }()

	// Bound the read: a runaway response should not exhaust the Grafana process.
	raw, err := io.ReadAll(io.LimitReader(res.Body, 64<<20))
	if err != nil {
		return nil, fmt.Errorf("reading response: %w", err)
	}

	if err := statusError(res.StatusCode); err != nil {
		return nil, err
	}

	var decoded O11yQueryResponse
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, fmt.Errorf("decoding response: %w", err)
	}
	return &decoded, nil
}

// setHeaders attaches auth and, when this query backs an alert rule, the marker
// read-api uses to attribute scheduled traffic.
func (c *Client) setHeaders(req *http.Request, fromAlert bool) {
	req.Header.Set(headerAppKey, c.appKey)
	req.Header.Set(headerAppToken, c.appToken)
	if fromAlert {
		req.Header.Set(headerFromAlert, "true")
	}
}

// statusError maps an HTTP status to an error whose text is safe to show a user: it
// describes the failure without echoing the request, which carries the credentials.
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
