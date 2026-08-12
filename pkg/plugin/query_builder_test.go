package plugin

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// contractFixtures is the shared contract between the TypeScript client and this Go
// builder. tests/unit/queryContract.test.ts reads the same file, so a change made on
// one side and not the other fails CI rather than surfacing as a panel and its alert
// quietly disagreeing.
const contractFixtures = "../../tests/fixtures/query-contract.json"

type contractFile struct {
	FromTime int64 `json:"fromTime"`
	ToTime   int64 `json:"toTime"`
	Cases    []struct {
		Name     string          `json:"name"`
		Query    QueryModel      `json:"query"`
		Expected json.RawMessage `json:"expected"`
	} `json:"cases"`
}

func loadContract(t *testing.T) contractFile {
	t.Helper()
	raw, err := os.ReadFile(filepath.Clean(contractFixtures))
	require.NoError(t, err, "shared contract fixtures must be readable")

	var parsed contractFile
	require.NoError(t, json.Unmarshal(raw, &parsed))
	require.NotEmpty(t, parsed.Cases)
	return parsed
}

func TestBuildRequestMatchesSharedContract(t *testing.T) {
	contract := loadContract(t)
	from := time.UnixMilli(contract.FromTime).UTC()
	to := time.UnixMilli(contract.ToTime).UTC()

	for _, tc := range contract.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			got, err := json.Marshal(BuildRequest(tc.Query, from, to, nil))
			require.NoError(t, err)

			// Compare as decoded JSON so key order and formatting are irrelevant;
			// what must match is the request the API actually receives.
			var gotAny, wantAny interface{}
			require.NoError(t, json.Unmarshal(got, &gotAny))
			require.NoError(t, json.Unmarshal(tc.Expected, &wantAny))
			require.Equal(t, wantAny, gotAny)
		})
	}
}

func TestBuildRequestStep(t *testing.T) {
	from := time.UnixMilli(1767225600000).UTC()
	to := time.UnixMilli(1767229200000).UTC()
	q := QueryModel{Type: QueryTypeMetrics, AppName: "app", PredefinedMetric: MetricRequestRate, PageSize: 100}

	t.Run("absent step is omitted from the body", func(t *testing.T) {
		body, err := json.Marshal(BuildRequest(q, from, to, nil))
		require.NoError(t, err)
		require.NotContains(t, string(body), "step")
	})

	t.Run("step is sent when bucketing is requested", func(t *testing.T) {
		step := 300
		req := BuildRequest(q, from, to, &step)
		require.NotNil(t, req.Step)
		require.Equal(t, 300, *req.Step)
	})
}

func TestBuildFetchFiltersBaseWins(t *testing.T) {
	// A panel filter must never be able to redefine what the predefined metric IS.
	// A collision is the same (column, operator) pair.
	q := QueryModel{
		AppName:          "vtex.apps-graphql@3.19.0",
		PredefinedMetric: MetricRequestRate,
		Filters: []QueryFilter{
			{Column: "app", Operator: "=", Type: "string", Value: "someone-elses-app"},
			{Column: "account", Operator: "=", Type: "string", Value: "footloose"},
			{Column: "account", Operator: "!=", Type: "string", Value: "excluded"},
		},
	}

	filters := buildFetchFilters(q)

	// The app filter keeps the metric's value, and appears exactly once.
	appFilters := 0
	for _, f := range filters {
		if f.Column == "app" {
			appFilters++
			require.Equal(t, "vtex.apps-graphql@3.19.0", f.Value)
		}
	}
	require.Equal(t, 1, appFilters)

	// A different operator on the same column is not a collision, so both survive.
	require.Contains(t, filters, QueryFilter{Column: "account", Operator: "=", Type: "string", Value: "footloose"})
	require.Contains(t, filters, QueryFilter{Column: "account", Operator: "!=", Type: "string", Value: "excluded"})
}
