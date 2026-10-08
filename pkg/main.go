package main

import (
	"os"
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/backend/datasource"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/build/buildinfo"

	"github.com/vtex/vtexio-grafana-plugin/pkg/plugin"
)

// version is an optional override injected with -X main.version=... . The SDK's mage build
// (Magefile.go) embeds the package.json version in build/buildinfo instead, which is what
// release binaries carry; resolveVersion prefers that and falls back to this variable.
var version = ""

// Entrypoint for the data source backend. Grafana launches this binary and speaks to
// it over the plugin gRPC protocol; it is what makes the data source usable from alert
// rules, which are evaluated server-side.
func main() {
	plugin.SetClientVersion(resolveVersion(buildinfo.GetBuildInfo, version))
	if err := datasource.Manage("vtexio-grafana-datasource", plugin.NewDatasource, datasource.ManageOpts{}); err != nil {
		log.DefaultLogger.Error("failed to start the VTEX IO data source backend", "error", err.Error())
		os.Exit(1)
	}
}

// resolveVersion returns the plugin version reported in the User-Agent: the SDK build
// metadata when the binary was built with mage, else the -X main.version override, else ""
// (plugin.SetClientVersion then keeps its "dev" fallback).
func resolveVersion(get buildinfo.Getter, override string) string {
	if get != nil {
		if info, err := get.GetInfo(); err == nil && strings.TrimSpace(info.Version) != "" {
			return strings.TrimSpace(info.Version)
		}
	}
	return strings.TrimSpace(override)
}
