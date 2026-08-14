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
		body        []byte
		wantNil     bool
		wantContain []string
		wantExclude []string
	}{
		{name: "200 is not an error", status: http.StatusOK, wantNil: true},
		{name: "204 is not an error", status: http.StatusNoContent, wantNil: true},
		{
			name:        "401 gets a canned auth message, not the body",
			status:      http.StatusUnauthorized,
			body:        []byte("some internal detail"),
			wantContain: []string{"authentication failed", "App Key", "App Token"},
			wantExclude: []string{"some internal detail"},
		},
		{
			name:        "403 gets the same canned auth message",
			status:      http.StatusForbidden,
			body:        []byte("some internal detail"),
			wantContain: []string{"authentication failed"},
			wantExclude: []string{"some internal detail"},
		},
		{
			name:        "429 gets a canned rate-limit message",
			status:      http.StatusTooManyRequests,
			wantContain: []string{"quota or rate limit"},
		},
		{
			name:        "unmapped status echoes the response body",
			status:      http.StatusInternalServerError,
			body:        []byte("upstream exploded"),
			wantContain: []string{"HTTP 500", "upstream exploded"},
		},
		{
			name:        "unmapped status truncates an oversized body",
			status:      http.StatusInternalServerError,
			body:        []byte(strings.Repeat("x", maxStatusErrorBodyPreview+100)),
			wantContain: []string{strings.Repeat("x", maxStatusErrorBodyPreview)},
			wantExclude: []string{strings.Repeat("x", maxStatusErrorBodyPreview+1)},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := statusError(tt.status, tt.body)
			if tt.wantNil {
				if err != nil {
					t.Fatalf("statusError(%d, ...) = %v, want nil", tt.status, err)
				}
				return
			}
			if err == nil {
				t.Fatalf("statusError(%d, ...) = nil, want an error", tt.status)
			}
			msg := err.Error()
			for _, want := range tt.wantContain {
				if !strings.Contains(msg, want) {
					t.Errorf("statusError(%d, ...) = %q, want it to contain %q", tt.status, msg, want)
				}
			}
			for _, exclude := range tt.wantExclude {
				if strings.Contains(msg, exclude) {
					t.Errorf("statusError(%d, ...) = %q, want it to NOT contain %q", tt.status, msg, exclude)
				}
			}
		})
	}
}
