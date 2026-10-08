package main

import (
	"errors"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/build/buildinfo"
)

func TestResolveVersion(t *testing.T) {
	withInfo := func(v string) buildinfo.Getter {
		return buildinfo.GetterFunc(func() (buildinfo.Info, error) { return buildinfo.Info{Version: v}, nil })
	}
	noInfo := buildinfo.GetterFunc(func() (buildinfo.Info, error) {
		return buildinfo.Info{}, errors.New("build info was not set when this was compiled")
	})

	tests := []struct {
		name     string
		getter   buildinfo.Getter
		override string
		want     string
	}{
		{"sdk build metadata wins", withInfo("0.3.2-beta.2"), "1.0.0", "0.3.2-beta.2"},
		{"sdk metadata is trimmed", withInfo("  0.3.3 "), "", "0.3.3"},
		{"falls back to ldflag override", noInfo, "1.0.0", "1.0.0"},
		{"empty sdk version falls back to override", withInfo(""), "2.0.0", "2.0.0"},
		{"nothing available yields empty (dev fallback downstream)", noInfo, "", ""},
		{"nil getter", nil, " 9.9.9 ", "9.9.9"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := resolveVersion(tt.getter, tt.override); got != tt.want {
				t.Errorf("resolveVersion() = %q, want %q", got, tt.want)
			}
		})
	}
}
