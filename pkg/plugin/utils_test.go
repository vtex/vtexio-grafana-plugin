package plugin

import (
	"net/http"
	"strings"
	"testing"
)

func TestParseBaseURL(t *testing.T) {
	tests := []struct {
		name   string
		tenant string
		apiURL string
		want   string
	}{
		{
			name:   "empty apiURL falls back to production",
			tenant: "acmestore",
			apiURL: "",
			want:   "https://acmestore.vtexcommercebeta.com.br/api/extensions/observability",
		},
		{
			name:   "whitespace-only apiURL falls back to production",
			tenant: "acmestore",
			apiURL: "   ",
			want:   "https://acmestore.vtexcommercebeta.com.br/api/extensions/observability",
		},
		{
			name:   "explicit apiURL is used as-is, trailing slash trimmed",
			tenant: "acmestore",
			apiURL: "http://localhost:8080/",
			want:   "http://localhost:8080",
		},
		{
			name:   "explicit apiURL with surrounding whitespace is trimmed",
			tenant: "acmestore",
			apiURL: "  http://localhost:8080  ",
			want:   "http://localhost:8080",
		},
		{
			name:   "tenant is URL-escaped in the production URL",
			tenant: "acme store/x",
			apiURL: "",
			want:   "https://acme%20store%2Fx.vtexcommercebeta.com.br/api/extensions/observability",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := parseBaseURL(tt.tenant, tt.apiURL)
			if got != tt.want {
				t.Errorf("parseBaseURL(%q, %q) = %q, want %q", tt.tenant, tt.apiURL, got, tt.want)
			}
		})
	}
}

func TestStatusError(t *testing.T) {
	tests := []struct {
		name        string
		status      int
		wantNil     bool
		wantContain []string
	}{
		{name: "200 is not an error", status: http.StatusOK, wantNil: true},
		{name: "204 is not an error", status: http.StatusNoContent, wantNil: true},
		{
			name:        "401 gets a canned auth message",
			status:      http.StatusUnauthorized,
			wantContain: []string{"authentication failed", "App Key", "App Token"},
		},
		{
			name:        "403 gets the same canned auth message",
			status:      http.StatusForbidden,
			wantContain: []string{"authentication failed"},
		},
		{
			name:        "429 gets a canned rate-limit message",
			status:      http.StatusTooManyRequests,
			wantContain: []string{"quota or rate limit"},
		},
		{
			name:        "unmapped status reports only the status, never the body",
			status:      http.StatusInternalServerError,
			wantContain: []string{"HTTP 500"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := statusError(tt.status)
			if tt.wantNil {
				if err != nil {
					t.Fatalf("statusError(%d) = %v, want nil", tt.status, err)
				}
				return
			}
			if err == nil {
				t.Fatalf("statusError(%d) = nil, want an error", tt.status)
			}
			msg := err.Error()
			for _, want := range tt.wantContain {
				if !strings.Contains(msg, want) {
					t.Errorf("statusError(%d) = %q, want it to contain %q", tt.status, msg, want)
				}
			}
		})
	}
}
