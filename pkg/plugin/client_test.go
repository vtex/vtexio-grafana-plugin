package plugin

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// newTestClient points an O11yApiClient at an httptest server standing in for read-api.
func newTestClient(apiURL string) *O11yApiClient {
	return NewClient("acmestore", "test-app-key", "test-app-token", apiURL) // #nosec G101 -- fake fixture
}

func TestIsConfigured(t *testing.T) {
	t.Run("given every credential is present", func(t *testing.T) {
		c := NewClient("t", "k", "tok", "http://example.invalid")

		t.Run("it should report configured", func(t *testing.T) {
			if !c.IsConfigured() {
				t.Error("IsConfigured() = false, want true")
			}
		})
	})

	missingCredential := []struct {
		scenario                 string
		tenant, appKey, appToken string
	}{
		{"the tenant is missing", "", "k", "tok"},
		{"the app key is missing", "t", "", "tok"},
		{"the app token is missing", "t", "k", ""},
		{"every credential is blank", "", "", ""},
		{"every credential is whitespace-only", " ", " ", " "},
	}
	for _, tc := range missingCredential {
		t.Run("given "+tc.scenario, func(t *testing.T) {
			c := NewClient(tc.tenant, tc.appKey, tc.appToken, "http://example.invalid")

			t.Run("it should report not configured", func(t *testing.T) {
				if c.IsConfigured() {
					t.Error("IsConfigured() = true, want false")
				}
			})
		})
	}
}

func TestQueryMetrics(t *testing.T) {
	t.Run("given read-api is healthy and returns a metrics payload", func(t *testing.T) {
		var gotMethod, gotPath, gotAppKey, gotAppToken, gotContentType string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotMethod, gotPath = r.Method, r.URL.Path
			gotAppKey = r.Header.Get(headerAppKey)
			gotAppToken = r.Header.Get(headerAppToken)
			gotContentType = r.Header.Get("Content-Type")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(O11yQueryResponse{RefID: "A", Name: "metrics"})
		}))
		defer srv.Close()
		c := newTestClient(srv.URL)

		t.Run("when QueryMetrics is called", func(t *testing.T) {
			res, err := c.QueryMetrics(context.Background(), O11yQueryRequest{PageSize: 100}, false)
			if err != nil {
				t.Fatalf("QueryMetrics returned an error: %v", err)
			}

			t.Run("it should POST to the tenant's metrics endpoint", func(t *testing.T) {
				if gotMethod != http.MethodPost {
					t.Errorf("method = %q, want POST", gotMethod)
				}
				if want := "/metrics/acmestore/query"; gotPath != want {
					t.Errorf("path = %q, want %q", gotPath, want)
				}
			})

			t.Run("it should authenticate with the App Key and App Token headers", func(t *testing.T) {
				if gotAppKey != "test-app-key" {
					t.Errorf("%s header = %q, want %q", headerAppKey, gotAppKey, "test-app-key")
				}
				if gotAppToken != "test-app-token" {
					t.Errorf("%s header = %q, want %q", headerAppToken, gotAppToken, "test-app-token")
				}
			})

			t.Run("it should send a JSON content type", func(t *testing.T) {
				if gotContentType != "application/json" {
					t.Errorf("Content-Type = %q, want application/json", gotContentType)
				}
			})

			t.Run("it should decode the response body", func(t *testing.T) {
				if res == nil || res.RefID != "A" {
					t.Errorf("decoded response = %+v, want RefID %q", res, "A")
				}
			})
		})
	})

	t.Run("given the query is an alert evaluation", func(t *testing.T) {
		var gotFromAlert string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotFromAlert = r.Header.Get(headerFromAlert)
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(O11yQueryResponse{})
		}))
		defer srv.Close()
		c := newTestClient(srv.URL)

		t.Run("when QueryMetrics is called with fromAlert=true", func(t *testing.T) {
			if _, err := c.QueryMetrics(context.Background(), O11yQueryRequest{}, true); err != nil {
				t.Fatalf("QueryMetrics returned an error: %v", err)
			}

			t.Run("it should mark the request as alert traffic", func(t *testing.T) {
				if gotFromAlert != "true" {
					t.Errorf("%s header = %q, want %q", headerFromAlert, gotFromAlert, "true")
				}
			})
		})
	})

	t.Run("given the query is not an alert evaluation", func(t *testing.T) {
		var gotFromAlert string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotFromAlert = r.Header.Get(headerFromAlert)
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(O11yQueryResponse{})
		}))
		defer srv.Close()
		c := newTestClient(srv.URL)

		t.Run("when QueryMetrics is called with fromAlert=false", func(t *testing.T) {
			if _, err := c.QueryMetrics(context.Background(), O11yQueryRequest{}, false); err != nil {
				t.Fatalf("QueryMetrics returned an error: %v", err)
			}

			t.Run("it should not mark the request as alert traffic", func(t *testing.T) {
				if gotFromAlert != "" {
					t.Errorf("%s header = %q, want empty", headerFromAlert, gotFromAlert)
				}
			})
		})
	})

	t.Run("given read-api rejects the credentials", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte("nope"))
		}))
		defer srv.Close()
		c := newTestClient(srv.URL)

		t.Run("when QueryMetrics is called", func(t *testing.T) {
			_, err := c.QueryMetrics(context.Background(), O11yQueryRequest{}, false)

			t.Run("it should return an authentication error", func(t *testing.T) {
				if err == nil {
					t.Fatal("expected an error for a 401 response, got nil")
				}
				if !strings.Contains(err.Error(), "authentication failed") {
					t.Errorf("error = %q, want it to mention authentication failure", err.Error())
				}
			})
		})
	})

	t.Run("given read-api returns a body that is not valid JSON", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("not json"))
		}))
		defer srv.Close()
		c := newTestClient(srv.URL)

		t.Run("when QueryMetrics is called", func(t *testing.T) {
			_, err := c.QueryMetrics(context.Background(), O11yQueryRequest{}, false)

			t.Run("it should return a decode error", func(t *testing.T) {
				if err == nil {
					t.Fatal("expected a decode error, got nil")
				}
				if !strings.Contains(err.Error(), "decoding response") {
					t.Errorf("error = %q, want it to mention decoding the response", err.Error())
				}
			})
		})
	})

	t.Run("given read-api is unreachable", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
		unreachableURL := srv.URL
		srv.Close() // guarantees nothing is listening on unreachableURL anymore
		c := newTestClient(unreachableURL)

		t.Run("when QueryMetrics is called", func(t *testing.T) {
			_, err := c.QueryMetrics(context.Background(), O11yQueryRequest{}, false)

			t.Run("it should return a reachability error", func(t *testing.T) {
				if err == nil {
					t.Fatal("expected a network error, got nil")
				}
				if !strings.Contains(err.Error(), "reaching the VTEX Observability API") {
					t.Errorf("error = %q, want it to mention reaching the API", err.Error())
				}
			})
		})
	})
}

func TestQueryLogs(t *testing.T) {
	t.Run("given read-api is healthy", func(t *testing.T) {
		var gotPath string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotPath = r.URL.Path
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(O11yQueryResponse{})
		}))
		defer srv.Close()
		c := newTestClient(srv.URL)

		t.Run("when QueryLogs is called", func(t *testing.T) {
			if _, err := c.QueryLogs(context.Background(), O11yQueryRequest{}, false); err != nil {
				t.Fatalf("QueryLogs returned an error: %v", err)
			}

			t.Run("it should POST to the tenant's logs endpoint", func(t *testing.T) {
				if want := "/logs/acmestore/query"; gotPath != want {
					t.Errorf("path = %q, want %q", gotPath, want)
				}
			})
		})
	})
}

func TestFetchLogsFields(t *testing.T) {
	cases := []struct {
		scenario   string
		statusCode int
		wantErr    bool
		wantErrMsg string
	}{
		{"read-api is reachable and healthy", http.StatusOK, false, ""},
		{"read-api rejects the credentials", http.StatusUnauthorized, true, "authentication failed"},
		{"read-api is rate-limiting this tenant", http.StatusTooManyRequests, true, "quota or rate limit"},
	}

	for _, tc := range cases {
		t.Run("given "+tc.scenario, func(t *testing.T) {
			var gotMethod, gotPath string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotMethod, gotPath = r.Method, r.URL.Path
				w.WriteHeader(tc.statusCode)
			}))
			defer srv.Close()
			c := newTestClient(srv.URL)

			t.Run("when FetchLogsFields is called", func(t *testing.T) {
				err := c.FetchLogsFields(context.Background())

				t.Run("it should probe the tenant's logs fields endpoint with GET", func(t *testing.T) {
					if gotMethod != http.MethodGet {
						t.Errorf("method = %q, want GET", gotMethod)
					}
					if want := "/logs/acmestore/fields"; gotPath != want {
						t.Errorf("path = %q, want %q", gotPath, want)
					}
				})

				if !tc.wantErr {
					t.Run("it should not return an error", func(t *testing.T) {
						if err != nil {
							t.Fatalf("expected no error, got %v", err)
						}
					})
					return
				}

				t.Run("it should return an error", func(t *testing.T) {
					if err == nil {
						t.Fatal("expected an error, got nil")
					}
					if !strings.Contains(err.Error(), tc.wantErrMsg) {
						t.Errorf("error = %q, want it to contain %q", err.Error(), tc.wantErrMsg)
					}
				})
			})
		})
	}
}

func TestResourceEndpoint(t *testing.T) {
	c := newTestClient("http://example.invalid")

	cases := []struct {
		scenario string
		path     string
		want     string
	}{
		{"the local apps route", "local/apps", "http://example.invalid/acmestore/apps"},
		{"the remote apps route", "remote/apps", "http://example.invalid/acmestore/apps"},
		{"the local logs fields route", "local/logs/fields", "http://example.invalid/logs/acmestore/fields"},
		{"the remote logs fields route", "remote/logs/fields", "http://example.invalid/logs/acmestore/fields"},
		{"the local logs query route", "local/logs/query", "http://example.invalid/logs/acmestore/query"},
		{"the remote logs query route", "remote/logs/query", "http://example.invalid/logs/acmestore/query"},
		{"the local metrics fields route", "local/metrics/fields", "http://example.invalid/metrics/acmestore/fields"},
		{"the remote metrics fields route", "remote/metrics/fields", "http://example.invalid/metrics/acmestore/fields"},
		{"the local metrics query route", "local/metrics/query", "http://example.invalid/metrics/acmestore/query"},
		{"the remote metrics query route", "remote/metrics/query", "http://example.invalid/metrics/acmestore/query"},
	}

	for _, tc := range cases {
		t.Run("given "+tc.scenario, func(t *testing.T) {
			t.Run("when resourceEndpoint is called", func(t *testing.T) {
				got, ok := c.resourceEndpoint(tc.path)

				t.Run("it should report the route as known", func(t *testing.T) {
					if !ok {
						t.Fatalf("resourceEndpoint(%q) ok = false, want true", tc.path)
					}
				})
				t.Run("it should resolve to the matching read-api endpoint", func(t *testing.T) {
					if got != tc.want {
						t.Errorf("resourceEndpoint(%q) = %q, want %q", tc.path, got, tc.want)
					}
				})
			})
		})
	}

	t.Run("given a path that matches no known route", func(t *testing.T) {
		t.Run("when resourceEndpoint is called", func(t *testing.T) {
			_, ok := c.resourceEndpoint("local/metrics/names")

			t.Run("it should report the route as unknown", func(t *testing.T) {
				if ok {
					t.Error("ok = true, want false for an unrecognized path")
				}
			})
		})
	})
}

func TestProxy(t *testing.T) {
	t.Run("given read-api returns a successful GET response", func(t *testing.T) {
		var gotMethod, gotPath, gotAppKey, gotAppToken string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotMethod, gotPath = r.Method, r.URL.Path
			gotAppKey = r.Header.Get(headerAppKey)
			gotAppToken = r.Header.Get(headerAppToken)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"apps":["a","b"]}`))
		}))
		defer srv.Close()
		c := newTestClient(srv.URL)

		t.Run("when Proxy is called with GET and no body", func(t *testing.T) {
			status, body, err := c.Proxy(context.Background(), http.MethodGet, srv.URL+"/acmestore/apps", nil)

			t.Run("it should not return an error", func(t *testing.T) {
				if err != nil {
					t.Fatalf("Proxy returned an error: %v", err)
				}
			})
			t.Run("it should forward the method and path unchanged", func(t *testing.T) {
				if gotMethod != http.MethodGet {
					t.Errorf("method = %q, want GET", gotMethod)
				}
				if want := "/acmestore/apps"; gotPath != want {
					t.Errorf("path = %q, want %q", gotPath, want)
				}
			})
			t.Run("it should authenticate with the App Key and App Token headers", func(t *testing.T) {
				if gotAppKey != "test-app-key" {
					t.Errorf("%s header = %q, want %q", headerAppKey, gotAppKey, "test-app-key")
				}
				if gotAppToken != "test-app-token" {
					t.Errorf("%s header = %q, want %q", headerAppToken, gotAppToken, "test-app-token")
				}
			})
			t.Run("it should relay the status code as-is", func(t *testing.T) {
				if status != http.StatusOK {
					t.Errorf("status = %d, want %d", status, http.StatusOK)
				}
			})
			t.Run("it should relay the response body as-is", func(t *testing.T) {
				if string(body) != `{"apps":["a","b"]}` {
					t.Errorf("body = %q, want the raw upstream body", body)
				}
			})
		})
	})

	t.Run("given a POST request with a body", func(t *testing.T) {
		var gotMethod string
		var gotBody []byte
		var gotContentType string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotMethod = r.Method
			gotContentType = r.Header.Get("Content-Type")
			gotBody, _ = io.ReadAll(r.Body)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{}`))
		}))
		defer srv.Close()
		c := newTestClient(srv.URL)

		t.Run("when Proxy is called with the frontend's already-built request body", func(t *testing.T) {
			payload := []byte(`{"page":1,"pageSize":100,"filters":[]}`)
			_, _, err := c.Proxy(context.Background(), http.MethodPost, srv.URL+"/metrics/acmestore/query", payload)

			t.Run("it should not return an error", func(t *testing.T) {
				if err != nil {
					t.Fatalf("Proxy returned an error: %v", err)
				}
			})
			t.Run("it should forward the method", func(t *testing.T) {
				if gotMethod != http.MethodPost {
					t.Errorf("method = %q, want POST", gotMethod)
				}
			})
			t.Run("it should forward the body unchanged, without re-encoding it", func(t *testing.T) {
				if string(gotBody) != string(payload) {
					t.Errorf("body = %q, want %q", gotBody, payload)
				}
			})
			t.Run("it should set a JSON content type", func(t *testing.T) {
				if gotContentType != "application/json" {
					t.Errorf("Content-Type = %q, want application/json", gotContentType)
				}
			})
		})
	})

	t.Run("given read-api returns an error status", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"invalid credentials"}`))
		}))
		defer srv.Close()
		c := newTestClient(srv.URL)

		t.Run("when Proxy is called", func(t *testing.T) {
			status, body, err := c.Proxy(context.Background(), http.MethodGet, srv.URL+"/acmestore/apps", nil)

			t.Run("it should not treat the status as a Go error", func(t *testing.T) {
				if err != nil {
					t.Fatalf("Proxy returned an error: %v, want it to relay the status instead", err)
				}
			})
			t.Run("it should relay the exact upstream status code", func(t *testing.T) {
				if status != http.StatusUnauthorized {
					t.Errorf("status = %d, want %d", status, http.StatusUnauthorized)
				}
			})
			t.Run("it should relay the exact upstream body, not a canned message", func(t *testing.T) {
				if string(body) != `{"error":"invalid credentials"}` {
					t.Errorf("body = %q, want the raw upstream error body", body)
				}
			})
		})
	})

	t.Run("given read-api is unreachable", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
		unreachableURL := srv.URL
		srv.Close()
		c := newTestClient(unreachableURL)

		t.Run("when Proxy is called", func(t *testing.T) {
			_, _, err := c.Proxy(context.Background(), http.MethodGet, unreachableURL+"/acmestore/apps", nil)

			t.Run("it should return a reachability error", func(t *testing.T) {
				if err == nil {
					t.Fatal("expected a network error, got nil")
				}
				if !strings.Contains(err.Error(), "reaching the VTEX Observability API") {
					t.Errorf("error = %q, want it to mention reaching the API", err.Error())
				}
			})
		})
	})
}
