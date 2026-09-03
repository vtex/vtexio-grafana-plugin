package plugin

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/stretchr/testify/require"
)

// Credentials used only against the local test server. Distinctive strings so the
// "never leaked" assertions are meaningful.
const (
	testAppKey   = "vtexappkey-testtenant-AAAAAA"
	testAppToken = "TESTTOKENSHOULDNEVERAPPEARINOUTPUT" // #nosec G101 -- fake fixture, never a real credential
)

// newTestDatasource points a Datasource at a stub read-api.
func newTestDatasource(t *testing.T, handler http.HandlerFunc) (*Datasource, *httptest.Server) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	ds := &Datasource{client: NewClient("testtenant", testAppKey, testAppToken, "")}
	ds.client.baseURL = server.URL
	return ds, server
}

func metricsQuery(t *testing.T, refID string, metric PredefinedMetric) backend.DataQuery {
	t.Helper()
	raw, err := json.Marshal(QueryModel{
		Type:             QueryTypeMetrics,
		AppName:          "vtex.apps-graphql@3.19.0",
		PredefinedMetric: metric,
		PageSize:         100,
	})
	require.NoError(t, err)

	return backend.DataQuery{
		RefID:    refID,
		JSON:     raw,
		Interval: time.Minute,
		TimeRange: backend.TimeRange{
			From: time.Unix(1767225600, 0).UTC(),
			To:   time.Unix(1767229200, 0).UTC(),
		},
	}
}

func alertRequest(queries ...backend.DataQuery) *backend.QueryDataRequest {
	return &backend.QueryDataRequest{Headers: map[string]string{"FromAlert": "true"}, Queries: queries}
}

func dashboardRequest(queries ...backend.DataQuery) *backend.QueryDataRequest {
	return &backend.QueryDataRequest{Queries: queries}
}

// respondJSON writes a read-api-shaped response.
func respondJSON(t *testing.T, w http.ResponseWriter, body O11yQueryResponse) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	require.NoError(t, json.NewEncoder(w).Encode(body))
}

func TestQueryDataIsolatesPerTargetErrors(t *testing.T) {
	// One failing target must not blank the others — in a dashboard that would empty
	// unrelated panels, and in an alert rule it would take out the other conditions.
	var calls int
	ds, _ := newTestDatasource(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 2 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		respondJSON(t, w, O11yQueryResponse{Fields: []O11yField{
			{Name: TimestampColumn, Type: "time", Values: []interface{}{"2026-01-01T00:00:00Z"}},
			{Name: "account", Type: "string", Values: []interface{}{"footloose"}},
			{Name: "Sum", Type: "number", Values: []interface{}{3.0}},
		}})
	})

	res, err := ds.QueryData(context.Background(), dashboardRequest(
		metricsQuery(t, "A", MetricRequestRate),
		metricsQuery(t, "B", MetricRequestRate),
		metricsQuery(t, "C", MetricRequestRate),
	))
	require.NoError(t, err)

	require.NoError(t, res.Responses["A"].Error)
	require.Error(t, res.Responses["B"].Error)
	require.NoError(t, res.Responses["C"].Error)
	require.NotEmpty(t, res.Responses["A"].Frames)
	require.NotEmpty(t, res.Responses["C"].Frames)
}

func TestQueryDataCredentialHandling(t *testing.T) {
	t.Run("missing credentials fail before any request", func(t *testing.T) {
		var reached bool
		ds, _ := newTestDatasource(t, func(w http.ResponseWriter, r *http.Request) { reached = true })
		ds.client = NewClient("testtenant", "", "", "")

		res, err := ds.QueryData(context.Background(), dashboardRequest(metricsQuery(t, "A", MetricRequestRate)))
		require.NoError(t, err)
		require.Error(t, res.Responses["A"].Error)
		require.Contains(t, res.Responses["A"].Error.Error(), "App Key")
		require.False(t, reached, "no request should be made without credentials")
	})

	t.Run("credentials are sent as VTEX headers", func(t *testing.T) {
		var gotKey, gotToken, gotFromAlert string
		ds, _ := newTestDatasource(t, func(w http.ResponseWriter, r *http.Request) {
			gotKey = r.Header.Get(headerAppKey)
			gotToken = r.Header.Get(headerAppToken)
			gotFromAlert = r.Header.Get(headerFromAlert)
			respondJSON(t, w, O11yQueryResponse{})
		})

		_, err := ds.QueryData(context.Background(), alertRequest(metricsQuery(t, "A", MetricRequestRate)))
		require.NoError(t, err)
		require.Equal(t, testAppKey, gotKey)
		require.Equal(t, testAppToken, gotToken)
		require.Equal(t, "true", gotFromAlert, "alert evaluations must be attributable in read-api")
	})

	t.Run("dashboard queries are not marked as alert traffic", func(t *testing.T) {
		var gotFromAlert string
		ds, _ := newTestDatasource(t, func(w http.ResponseWriter, r *http.Request) {
			gotFromAlert = r.Header.Get(headerFromAlert)
			respondJSON(t, w, O11yQueryResponse{})
		})

		_, err := ds.QueryData(context.Background(), dashboardRequest(metricsQuery(t, "A", MetricRequestRate)))
		require.NoError(t, err)
		require.Empty(t, gotFromAlert)
	})

	for _, status := range []int{http.StatusUnauthorized, http.StatusForbidden} {
		t.Run("rejected credentials surface as an auth error", func(t *testing.T) {
			ds, _ := newTestDatasource(t, func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
			})

			res, err := ds.QueryData(context.Background(), dashboardRequest(metricsQuery(t, "A", MetricRequestRate)))
			require.NoError(t, err)
			require.Error(t, res.Responses["A"].Error)
			require.Contains(t, res.Responses["A"].Error.Error(), "authentication failed")
		})
	}
}

// TestCredentialsNeverAppearInErrors guards the rule that no error a user can see —
// or that Grafana logs — carries the App Key or App Token.
func TestCredentialsNeverAppearInErrors(t *testing.T) {
	statuses := []int{http.StatusUnauthorized, http.StatusForbidden, http.StatusTooManyRequests,
		http.StatusInternalServerError, http.StatusBadGateway}

	for _, status := range statuses {
		ds, _ := newTestDatasource(t, func(w http.ResponseWriter, r *http.Request) {
			// Echo the credentials back, the worst case for a client that reflects
			// response bodies into error text.
			w.WriteHeader(status)
			_, _ = w.Write([]byte(`{"error":"` + testAppKey + ` ` + testAppToken + `"}`))
		})

		res, err := ds.QueryData(context.Background(), dashboardRequest(metricsQuery(t, "A", MetricRequestRate)))
		require.NoError(t, err)
		require.Error(t, res.Responses["A"].Error)

		message := res.Responses["A"].Error.Error()
		require.NotContains(t, message, testAppToken, "status %d leaked the App Token", status)
		require.NotContains(t, message, testAppKey, "status %d leaked the App Key", status)
	}

	t.Run("health check failures are also clean", func(t *testing.T) {
		ds, _ := newTestDatasource(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(testAppToken))
		})

		result, err := ds.CheckHealth(context.Background(), &backend.CheckHealthRequest{})
		require.NoError(t, err)
		require.Equal(t, backend.HealthStatusError, result.Status)
		require.NotContains(t, result.Message, testAppToken)
		require.NotContains(t, result.Message, testAppKey)
	})
}

func TestQueryDataTruncation(t *testing.T) {
	truncated := O11yQueryResponse{
		Fields: []O11yField{
			{Name: TimestampColumn, Type: "time", Values: []interface{}{"2026-01-01T00:00:00Z"}},
			{Name: "account", Type: "string", Values: []interface{}{"footloose"}},
			{Name: "Sum", Type: "number", Values: []interface{}{7.0}},
		},
		Meta: map[string]interface{}{"truncated": true},
	}

	t.Run("alert evaluation refuses a partial series", func(t *testing.T) {
		ds, _ := newTestDatasource(t, func(w http.ResponseWriter, r *http.Request) {
			respondJSON(t, w, truncated)
		})

		res, err := ds.QueryData(context.Background(), alertRequest(metricsQuery(t, "A", MetricRequestRate)))
		require.NoError(t, err)
		require.Error(t, res.Responses["A"].Error)
		require.Contains(t, res.Responses["A"].Error.Error(), "incomplete")
		require.Empty(t, res.Responses["A"].Frames, "no frames, so nothing can be reduced to a threshold")
	})

	t.Run("dashboards still render what arrived", func(t *testing.T) {
		ds, _ := newTestDatasource(t, func(w http.ResponseWriter, r *http.Request) {
			respondJSON(t, w, truncated)
		})

		res, err := ds.QueryData(context.Background(), dashboardRequest(metricsQuery(t, "A", MetricRequestRate)))
		require.NoError(t, err)
		require.NoError(t, res.Responses["A"].Error)
		require.NotEmpty(t, res.Responses["A"].Frames)
	})

	t.Run("hasMore alone does not fail an alert", func(t *testing.T) {
		// hasMore comes from a COUNT(*) that ignores GROUP BY, so it is true for
		// essentially every grouped query. Reacting to it would break every alert.
		ds, _ := newTestDatasource(t, func(w http.ResponseWriter, r *http.Request) {
			respondJSON(t, w, O11yQueryResponse{
				Fields: truncated.Fields,
				Meta: map[string]interface{}{
					"truncated":  false,
					"pagination": map[string]interface{}{"hasMore": true, "total": 180610},
				},
			})
		})

		res, err := ds.QueryData(context.Background(), alertRequest(metricsQuery(t, "A", MetricRequestRate)))
		require.NoError(t, err)
		require.NoError(t, res.Responses["A"].Error)
		require.NotEmpty(t, res.Responses["A"].Frames)
	})
}

func TestQueryDataSendsStepOnlyWhenAlerting(t *testing.T) {
	capture := func(t *testing.T, req *backend.QueryDataRequest) *int {
		t.Helper()
		var body O11yQueryRequest
		ds, _ := newTestDatasource(t, func(w http.ResponseWriter, r *http.Request) {
			require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
			respondJSON(t, w, O11yQueryResponse{})
		})
		_, err := ds.QueryData(context.Background(), req)
		require.NoError(t, err)
		return body.Step
	}

	t.Run("alert query carries the interval as step", func(t *testing.T) {
		step := capture(t, alertRequest(metricsQuery(t, "A", MetricRequestRate)))
		require.NotNil(t, step)
		require.Equal(t, 60, *step)
	})

	t.Run("dashboard query carries no step", func(t *testing.T) {
		require.Nil(t, capture(t, dashboardRequest(metricsQuery(t, "A", MetricRequestRate))))
	})
}

func TestStepFromInterval(t *testing.T) {
	rng := backend.TimeRange{From: time.Unix(0, 0), To: time.Unix(3600, 0)}

	t.Run("uses the interval when Grafana supplies one", func(t *testing.T) {
		require.Equal(t, 300, *stepFromInterval(5*time.Minute, rng))
	})

	t.Run("floors at the storage granularity", func(t *testing.T) {
		// Buckets narrower than a minute cannot subdivide minute-granularity rows.
		require.Equal(t, 60, *stepFromInterval(time.Second, rng))
	})

	t.Run("derives a step when no interval is set", func(t *testing.T) {
		require.Equal(t, 60, *stepFromInterval(0, rng))
	})

	t.Run("caps at read-api's maximum", func(t *testing.T) {
		require.Equal(t, maxStepSeconds, *stepFromInterval(48*time.Hour, rng))
	})
}

func TestCheckHealth(t *testing.T) {
	t.Run("reports success when read-api is reachable", func(t *testing.T) {
		ds, _ := newTestDatasource(t, func(w http.ResponseWriter, r *http.Request) {
			require.True(t, strings.HasSuffix(r.URL.Path, "/logs/testtenant/fields"))
			respondJSON(t, w, O11yQueryResponse{})
		})

		result, err := ds.CheckHealth(context.Background(), &backend.CheckHealthRequest{})
		require.NoError(t, err)
		require.Equal(t, backend.HealthStatusOk, result.Status)
	})

	t.Run("reports an error when credentials are missing", func(t *testing.T) {
		ds := &Datasource{client: NewClient("testtenant", "", "", "")}
		result, err := ds.CheckHealth(context.Background(), &backend.CheckHealthRequest{})
		require.NoError(t, err)
		require.Equal(t, backend.HealthStatusError, result.Status)
		require.Contains(t, result.Message, "App Key")
	})
}

func TestLatencyStatsFrameShapeDependsOnCaller(t *testing.T) {
	// The two latency-stats metrics render as tables on a dashboard, but a table frame
	// is not something Grafana's alerting pipeline can reduce. Alert evaluations get a
	// numeric-long frame instead: same columns, no time field.
	// read-api always groups by TimestampTime for these metrics, so the response
	// carries it even though the dashboard renders them as a table.
	response := O11yQueryResponse{Fields: []O11yField{
		{Name: TimestampColumn, Type: "time", Values: []interface{}{
			"2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z",
		}},
		{Name: "account", Type: "string", Values: []interface{}{"footloose", "canali"}},
		{Name: "handler", Type: "string", Values: []interface{}{"graphql-handler:__graphql", "health"}},
		{Name: "ExplicitBounds", Type: "other", Values: []interface{}{
			[]interface{}{5.0, 10.0, 25.0, 50.0}, []interface{}{5.0, 10.0, 25.0, 50.0},
		}},
		{Name: "BucketCounts", Type: "other", Values: []interface{}{
			[]interface{}{10.0, 20.0, 5.0, 1.0}, []interface{}{40.0, 2.0, 0.0, 0.0},
		}},
	}}

	serve := func(w http.ResponseWriter, r *http.Request) { respondJSON(t, w, response) }

	t.Run("dashboard gets a table frame", func(t *testing.T) {
		ds, _ := newTestDatasource(t, serve)
		res, err := ds.QueryData(context.Background(),
			dashboardRequest(metricsQuery(t, "A", MetricLatencyStatsByAccountAndHandler)))
		require.NoError(t, err)
		require.NoError(t, res.Responses["A"].Error)

		frame := res.Responses["A"].Frames[0]
		require.EqualValues(t, data.VisTypeTable, frame.Meta.PreferredVisualization)
		require.Equal(t, []string{"account", "handler", "p50", "p95", "p99"}, fieldNames(frame))
	})

	t.Run("alert gets a wide time series, not a numeric frame", func(t *testing.T) {
		// Grafana 11.5's expression engine rejects both numeric shapes outright —
		// numeric-long and numeric-wide each fail with "input data must be a wide
		// series" — so an alert built on them never evaluates. These metrics therefore
		// use the same time-series shape as the other five, which is proven to work.
		ds, _ := newTestDatasource(t, serve)
		res, err := ds.QueryData(context.Background(),
			alertRequest(metricsQuery(t, "A", MetricLatencyStatsByAccountAndHandler)))
		require.NoError(t, err)
		require.NoError(t, res.Responses["A"].Error)

		frame := res.Responses["A"].Frames[0]
		require.Equal(t, data.FieldTypeTime, frame.Fields[0].Type(), "must lead with a time field")

		seen := map[string]bool{}
		for _, f := range frame.Fields[1:] {
			require.NotEmpty(t, f.Labels, "identity must live in labels")
			l := f.Labels
			seen[l["account"]+"|"+l["handler"]+"|"+l["percentile"]] = true
		}
		require.True(t, seen["footloose|graphql-handler:__graphql|p99"],
			"expected a p99 series for footloose/graphql, got %v", seen)
		require.Len(t, frame.Fields, 1+6, "time field + 2 series x 3 percentiles")
	})
}

func TestTimeSeriesFrameShape(t *testing.T) {
	// Two handlers, and handler "b" has no sample in the first bucket. The gap must be
	// null rather than zero: a zero would drag a Reduce(mean) down and could hold an
	// alert below its threshold.
	ds, _ := newTestDatasource(t, func(w http.ResponseWriter, r *http.Request) {
		respondJSON(t, w, O11yQueryResponse{Fields: []O11yField{
			{Name: TimestampColumn, Type: "time", Values: []interface{}{
				"2026-01-01T00:01:00Z", "2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z",
			}},
			{Name: "app", Type: "string", Values: []interface{}{"app", "app", "app"}},
			{Name: "handler", Type: "string", Values: []interface{}{"b", "a", "a"}},
			{Name: "error_rate", Type: "number", Values: []interface{}{5.0, 1.0, 2.0}},
		}})
	})

	res, err := ds.QueryData(context.Background(),
		alertRequest(metricsQuery(t, "A", MetricErrorRateByHandler)))
	require.NoError(t, err)
	require.NoError(t, res.Responses["A"].Error)

	frame := res.Responses["A"].Frames[0]

	times, ok := frame.Fields[0].At(0).(time.Time)
	require.True(t, ok)
	require.Equal(t, "2026-01-01T00:00:00Z", times.Format(time.RFC3339), "time field must be ascending")
	require.Equal(t, 2, frame.Fields[0].Len(), "timestamps must be de-duplicated")

	byName := map[string]*data.Field{}
	for _, f := range frame.Fields[1:] {
		byName[f.Name] = f
	}
	require.Contains(t, byName, "a")
	require.Contains(t, byName, "b")

	// Handler "b" is absent from the first bucket.
	require.Nil(t, byName["b"].At(0), "a missing point must be null, not zero")
	require.NotNil(t, byName["b"].At(1))

	// Labels carry the handler so Reduce produces one value per handler.
	require.Equal(t, "b", byName["b"].Labels["handler"])

	// The effective step is visible for debugging a threshold.
	require.Equal(t, 60, frame.Meta.Custom.(map[string]interface{})["step"])
}

func fieldNames(frame *data.Frame) []string {
	names := make([]string, 0, len(frame.Fields))
	for _, f := range frame.Fields {
		names = append(names, f.Name)
	}
	return names
}

// captureResourceResponse adapts a plain variable into a backend.CallResourceResponseSender.
func captureResourceResponse(dst **backend.CallResourceResponse) backend.CallResourceResponseSender {
	return backend.CallResourceResponseSenderFunc(func(resp *backend.CallResourceResponse) error {
		*dst = resp
		return nil
	})
}

func TestCallResource(t *testing.T) {
	t.Run("given the data source is not configured", func(t *testing.T) {
		ds, _ := newTestDatasource(t, func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("read-api should never be reached when credentials are missing")
		})
		ds.client = NewClient("testtenant", "", "", "")

		t.Run("when CallResource is called", func(t *testing.T) {
			var resp *backend.CallResourceResponse
			err := ds.CallResource(context.Background(),
				&backend.CallResourceRequest{Path: "local/apps", Method: http.MethodGet},
				captureResourceResponse(&resp))

			t.Run("it should not return a transport error", func(t *testing.T) {
				require.NoError(t, err)
			})
			t.Run("it should respond with 401 and a clear message", func(t *testing.T) {
				require.Equal(t, http.StatusUnauthorized, resp.Status)
				require.Contains(t, string(resp.Body), "App Key and App Token")
			})
		})
	})

	t.Run("given an unrecognized resource path", func(t *testing.T) {
		ds, _ := newTestDatasource(t, func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("read-api should never be reached for an unknown route")
		})

		t.Run("when CallResource is called", func(t *testing.T) {
			var resp *backend.CallResourceResponse
			err := ds.CallResource(context.Background(),
				&backend.CallResourceRequest{Path: "local/metrics/names", Method: http.MethodGet},
				captureResourceResponse(&resp))

			t.Run("it should not return a transport error", func(t *testing.T) {
				require.NoError(t, err)
			})
			t.Run("it should respond with 404", func(t *testing.T) {
				require.Equal(t, http.StatusNotFound, resp.Status)
			})
		})
	})

	t.Run("given a known resource path and a healthy read-api", func(t *testing.T) {
		var gotMethod, gotPath, gotAppKey, gotAppToken string
		ds, _ := newTestDatasource(t, func(w http.ResponseWriter, r *http.Request) {
			gotMethod, gotPath = r.Method, r.URL.Path
			gotAppKey = r.Header.Get(headerAppKey)
			gotAppToken = r.Header.Get(headerAppToken)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`["vtex.checkout-graphql","vtex.orders-graphql"]`))
		})

		t.Run("when CallResource is called for local/apps", func(t *testing.T) {
			var resp *backend.CallResourceResponse
			err := ds.CallResource(context.Background(),
				&backend.CallResourceRequest{Path: "local/apps", Method: http.MethodGet},
				captureResourceResponse(&resp))
			require.NoError(t, err)

			t.Run("it should GET the tenant's apps endpoint", func(t *testing.T) {
				require.Equal(t, http.MethodGet, gotMethod)
				require.Equal(t, "/testtenant/apps", gotPath)
			})
			t.Run("it should authenticate with the App Key and App Token headers", func(t *testing.T) {
				require.Equal(t, testAppKey, gotAppKey)
				require.Equal(t, testAppToken, gotAppToken)
			})
			t.Run("it should relay read-api's status code", func(t *testing.T) {
				require.Equal(t, http.StatusOK, resp.Status)
			})
			t.Run("it should relay read-api's response body unchanged", func(t *testing.T) {
				require.JSONEq(t, `["vtex.checkout-graphql","vtex.orders-graphql"]`, string(resp.Body))
			})
		})

		t.Run("when CallResource is called for remote/apps", func(t *testing.T) {
			var resp *backend.CallResourceResponse
			err := ds.CallResource(context.Background(),
				&backend.CallResourceRequest{Path: "remote/apps", Method: http.MethodGet},
				captureResourceResponse(&resp))
			require.NoError(t, err)

			t.Run("it should resolve to the same endpoint as the local route", func(t *testing.T) {
				require.Equal(t, "/testtenant/apps", gotPath)
				require.Equal(t, http.StatusOK, resp.Status)
			})
		})
	})

	t.Run("given a GET resource path carrying query parameters", func(t *testing.T) {
		var gotRawQuery string
		ds, _ := newTestDatasource(t, func(w http.ResponseWriter, r *http.Request) {
			gotRawQuery = r.URL.RawQuery
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`["vtex.checkout-graphql"]`))
		})

		t.Run("when CallResource is called for local/apps with fromTime and toTime", func(t *testing.T) {
			var resp *backend.CallResourceResponse
			err := ds.CallResource(context.Background(),
				&backend.CallResourceRequest{
					Path:   "local/apps",
					Method: http.MethodGet,
					URL:    "local/apps?fromTime=1700000000&toTime=1700003600",
				},
				captureResourceResponse(&resp))
			require.NoError(t, err)

			t.Run("it should forward the query string to read-api", func(t *testing.T) {
				require.Equal(t, "fromTime=1700000000&toTime=1700003600", gotRawQuery)
			})
			t.Run("it should relay read-api's status code", func(t *testing.T) {
				require.Equal(t, http.StatusOK, resp.Status)
			})
		})
	})

	t.Run("given a POST resource path carrying a query body", func(t *testing.T) {
		var gotMethod, gotPath string
		var gotBody []byte
		ds, _ := newTestDatasource(t, func(w http.ResponseWriter, r *http.Request) {
			gotMethod, gotPath = r.Method, r.URL.Path
			gotBody, _ = io.ReadAll(r.Body)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"fields":[]}`))
		})

		t.Run("when CallResource is called for remote/metrics/query", func(t *testing.T) {
			payload := []byte(`{"page":1,"pageSize":100,"filters":[]}`)
			var resp *backend.CallResourceResponse
			err := ds.CallResource(context.Background(),
				&backend.CallResourceRequest{Path: "remote/metrics/query", Method: http.MethodPost, Body: payload},
				captureResourceResponse(&resp))
			require.NoError(t, err)

			t.Run("it should POST to the tenant's metrics query endpoint", func(t *testing.T) {
				require.Equal(t, http.MethodPost, gotMethod)
				require.Equal(t, "/metrics/testtenant/query", gotPath)
			})
			t.Run("it should forward the frontend's request body unchanged", func(t *testing.T) {
				require.Equal(t, payload, gotBody)
			})
		})
	})

	t.Run("given read-api rejects the request", func(t *testing.T) {
		ds, _ := newTestDatasource(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"invalid app key"}`))
		})

		t.Run("when CallResource is called", func(t *testing.T) {
			var resp *backend.CallResourceResponse
			err := ds.CallResource(context.Background(),
				&backend.CallResourceRequest{Path: "local/apps", Method: http.MethodGet},
				captureResourceResponse(&resp))
			require.NoError(t, err)

			t.Run("it should relay the exact upstream status, not a canned one", func(t *testing.T) {
				require.Equal(t, http.StatusUnauthorized, resp.Status)
			})
			t.Run("it should relay the exact upstream body", func(t *testing.T) {
				require.JSONEq(t, `{"error":"invalid app key"}`, string(resp.Body))
			})
		})
	})
}
