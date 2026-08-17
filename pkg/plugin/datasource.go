package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
)

// Datasource is the backend half of the VTEX IO data source. It exists so Grafana's
// alerting engine has something to call: alert rules are evaluated server-side, where
// the browser-based frontend query path is unavailable.
//
// Dashboard queries still run through the TypeScript path, but — despite the plugin
// still declaring `routes` in plugin.json for backwards documentation — no longer
// through Grafana's own data source proxy: once a plugin has a backend, Grafana routes
// every /resources/* call to CallResource below instead of honoring `routes` itself,
// so this plugin has to do that proxying.
type Datasource struct {
	client *O11yApiClient
}

var (
	_ backend.QueryDataHandler      = (*Datasource)(nil)
	_ backend.CheckHealthHandler    = (*Datasource)(nil)
	_ backend.CallResourceHandler   = (*Datasource)(nil)
	_ instancemgmt.InstanceDisposer = (*Datasource)(nil)
)

// instanceSettings mirrors the ConfigEditor's jsonData.
type instanceSettings struct {
	AppKey string `json:"appKey"`
	Tenant string `json:"tenant"`
	// ApiUrl overrides the read-api base URL. Empty means production. It exists so the
	// backend can be pointed at a locally running read-api during development — the
	// frontend gets that from its `local` proxy route, and without this the backend
	// would have no equivalent.
	ApiUrl string `json:"apiUrl"`
}

// NewDatasource builds a data source instance from its saved settings. The App Token
// comes from decrypted secure settings and is never exposed to the frontend.
//
// The context parameter is unused here but not optional: this function is passed
// directly to datasource.Manage in main.go as a datasource.InstanceFactoryFunc, whose
// signature grafana-plugin-sdk-go defines with a context, so it must be present to
// satisfy that type even though building an instance needs nothing from it.
func NewDatasource(_ context.Context, settings backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	var parsed instanceSettings
	if len(settings.JSONData) > 0 {
		if err := json.Unmarshal(settings.JSONData, &parsed); err != nil {
			return nil, fmt.Errorf("reading data source settings: %w", err)
		}
	}

	return &Datasource{
		client: NewClient(parsed.Tenant, parsed.AppKey, settings.DecryptedSecureJSONData["appToken"], parsed.ApiUrl),
	}, nil
}

// Dispose is called when the instance settings change.
func (d *Datasource) Dispose() {}

// QueryData runs every target in the request.
//
// Errors are returned per refId rather than failing the whole request, so one broken
// target cannot blank the other panels — or the other conditions in an alert rule.
func (d *Datasource) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	response := backend.NewQueryDataResponse()
	fromAlert := isFromAlert(req)

	for _, q := range req.Queries {
		response.Responses[q.RefID] = d.query(ctx, q, fromAlert)
	}

	return response, nil
}

// isFromAlert reports whether Grafana's alerting engine issued this request. Grafana
// sets the FromAlert header when a rule evaluation is the caller.
func isFromAlert(req *backend.QueryDataRequest) bool {
	if req == nil {
		return false
	}
	return req.Headers["FromAlert"] == "true" || req.Headers[backend.FromAlertHeaderName] == "true"
}

func (d *Datasource) query(ctx context.Context, q backend.DataQuery, fromAlert bool) backend.DataResponse {
	var model QueryModel
	if err := json.Unmarshal(q.JSON, &model); err != nil {
		return errorResponse(backend.StatusBadRequest, fmt.Errorf("reading query: %w", err))
	}

	// Each check below returns the same errorResponse(status, errors.New(message))
	// shape, so they are listed declaratively here and applied in one place instead of
	// repeating that shape once per check.
	checks := []struct {
		invalid bool
		status  backend.Status
		message string
	}{
		{!d.client.IsConfigured(), backend.StatusUnauthorized,
			"this data source is not fully configured: an App Key and App Token are required"},
		{model.AppName == "", backend.StatusBadRequest, "select an app before running this query"},
		{model.Type == QueryTypeMetrics && model.PredefinedMetric == "", backend.StatusBadRequest,
			"select a metric before running this query"},
	}
	for _, c := range checks {
		if c.invalid {
			return errorResponse(c.status, errors.New(c.message))
		}
	}

	// Bucket alert queries to the evaluation interval. Without this the per-(minute x
	// account) fan-out is truncated at pageSize, and the rule would evaluate a slice of
	// the series while looking perfectly healthy.
	var step *int
	if fromAlert {
		step = stepFromInterval(q.Interval, q.TimeRange)
	}

	body := BuildRequest(model, q.TimeRange.From, q.TimeRange.To, step)

	res, err := d.client.QueryMetrics(ctx, body, fromAlert)
	if err != nil {
		return errorResponse(backend.StatusInternal, err)
	}

	// A partial series would produce a silently wrong threshold, so an alert
	// evaluation fails loudly instead. Dashboards keep rendering what arrived.
	if fromAlert && res.IsTruncated() {
		return errorResponse(backend.StatusInternal, errors.New(
			"the VTEX Observability API returned an incomplete result for this time range, "+
				"so this rule was not evaluated: narrow the range, raise the page size, or widen the interval"))
	}

	return backend.DataResponse{Frames: BuildFrames(q.RefID, model, res, fromAlert, step, q.TimeRange.To)}
}

// stepFromInterval derives the bucket width from Grafana's suggested interval, falling
// back to a width that keeps the range inside one page when no interval is set.
func stepFromInterval(interval time.Duration, timeRange backend.TimeRange) *int {
	seconds := int(interval.Seconds())
	if seconds <= 0 {
		// Aim for roughly 500 buckets across the range, floored at a minute — the
		// storage granularity, below which bucketing gains nothing.
		span := timeRange.To.Sub(timeRange.From).Seconds()
		seconds = int(span / 500)
	}
	if seconds < 60 {
		seconds = 60
	}
	if seconds > maxStepSeconds {
		seconds = maxStepSeconds
	}
	return &seconds
}

// maxStepSeconds matches read-api's cap of one day.
const maxStepSeconds = 86400

// CheckHealth reports whether the data source can actually reach read-api, so
// "Save & test" reflects reality rather than just well-formed settings.
func (d *Datasource) CheckHealth(ctx context.Context, _ *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	if !d.client.IsConfigured() {
		return healthError("App Key and App Token are required. Please configure their values first.")
	}

	if err := d.client.FetchLogsFields(ctx); err != nil {
		return healthError(fmt.Sprintf("Failed to connect to VTEX Observability Platform: %s", err))
	}

	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusOk,
		Message: "Successfully connected to VTEX Observability Platform.",
	}, nil
}

// CallResource proxies the app-name/field-autocomplete and browser-side dashboard
// query routes the frontend's o11yApi.ts client calls directly against
// plugin.json's declared `routes` paths (e.g. "local/apps", "remote/metrics/query").
// Grafana only honors those routes itself when a plugin has no backend; since this one
// does, every /resources/* call arrives here instead, and this plugin must forward it
// to read-api itself or those routes 500 with "an error occurred within the plugin".
//
// This is a transparent pass-through, not a typed query: whatever body the frontend
// already built is forwarded as-is, and the response — status included — is relayed
// back unchanged, matching what Grafana's own reverse proxy used to do.
func (d *Datasource) CallResource(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	if !d.client.IsConfigured() {
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusUnauthorized,
			Body:   []byte("this data source is not fully configured: an App Key and App Token are required"),
		})
	}

	endpoint, ok := d.client.resourceEndpoint(req.Path)
	if !ok {
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusNotFound,
			Body:   []byte(fmt.Sprintf("unknown resource path %q", req.Path)),
		})
	}

	status, body, err := d.client.Proxy(ctx, req.Method, endpoint, req.Body)
	if err != nil {
		return sender.Send(&backend.CallResourceResponse{
			Status: http.StatusBadGateway,
			Body:   []byte(err.Error()),
		})
	}

	return sender.Send(&backend.CallResourceResponse{
		Status:  status,
		Headers: map[string][]string{"Content-Type": {"application/json"}},
		Body:    body,
	})
}

// errorResponse attaches a status and an error source so Grafana attributes the
// failure correctly — a bad App Token is a downstream problem, not a plugin fault, and
// only the latter should page whoever maintains this plugin.
func errorResponse(status backend.Status, err error) backend.DataResponse {
	return backend.DataResponse{
		Error:       err,
		ErrorSource: backend.ErrorSourceFromHTTPStatus(int(status)),
		Status:      status,
	}
}

// healthError builds the failing half of CheckHealth's result. The two failure cases
// in CheckHealth built this same shape independently; only the message differs.
func healthError(message string) (*backend.CheckHealthResult, error) {
	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusError,
		Message: message,
	}, nil
}
