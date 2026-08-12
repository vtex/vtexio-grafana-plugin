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

// NewClient builds a read-api client for one data source instance.
//
// apiURL overrides the API base, mirroring the frontend's local/remote proxy prefixes:
// the frontend can point at a local read-api through the Grafana proxy, and without an
// override the backend could only ever reach production. Leave it empty for production.
func NewClient(tenant, appKey, appToken, apiURL string) *Client {
	return &Client{
		baseURL:  parseBaseURL(tenant, apiURL),
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
	return c.postQuery(ctx, fmt.Sprintf("%s/metrics/%s/query", c.baseURL, url.PathEscape(c.tenant)), body, fromAlert)
}

// QueryLogs posts a logs query and decodes the DataFrame-shaped response.
func (c *Client) QueryLogs(ctx context.Context, body O11yQueryRequest, fromAlert bool) (*O11yQueryResponse, error) {
	return c.postQuery(ctx, fmt.Sprintf("%s/logs/%s/query", c.baseURL, url.PathEscape(c.tenant)), body, fromAlert)
}

// FetchLogsFields is a cheap reachability probe used by the health check.
func (c *Client) FetchLogsFields(ctx context.Context) error {
	endpoint := fmt.Sprintf("%s/logs/%s/fields", c.baseURL, url.PathEscape(c.tenant))
	_, err := c.do(ctx, http.MethodGet, endpoint, nil, false, maxHealthCheckBodySize)
	return err
}

// postQuery marshals body, executes it as a POST, and decodes the DataFrame-shaped
// response. QueryMetrics and QueryLogs differ only in endpoint, so they both funnel
// through here.
func (c *Client) postQuery(ctx context.Context, endpoint string, body O11yQueryRequest, fromAlert bool) (*O11yQueryResponse, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("encoding request body for %s: %w", endpoint, err)
	}

	raw, err := c.do(ctx, http.MethodPost, endpoint, bytes.NewReader(payload), fromAlert, maxQueryResponseBodySize)
	if err != nil {
		return nil, err
	}

	var decoded O11yQueryResponse
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, fmt.Errorf("decoding response from %s: %w", endpoint, err)
	}
	return &decoded, nil
}

// do builds and executes an HTTP request against the read-api and returns its body
// once the response is confirmed successful. postQuery and FetchLogsFields both
// funnel through here, so request construction, headers, the bounded body read, and
// status-code handling stay in one place instead of being duplicated per call.
func (c *Client) do(ctx context.Context, method, endpoint string, body io.Reader, fromAlert bool, maxBodySize int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, fmt.Errorf("building %s request to %s: %w", method, endpoint, err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	c.setHeaders(req, fromAlert)

	res, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("reaching the VTEX Observability API at %s: %w", endpoint, err)
	}
	defer func() { _ = res.Body.Close() }()

	raw, err := io.ReadAll(io.LimitReader(res.Body, maxBodySize))
	if err != nil {
		return nil, fmt.Errorf("reading response from %s: %w", endpoint, err)
	}

	if err := statusError(res.StatusCode, raw); err != nil {
		return nil, err
	}
	return raw, nil
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
