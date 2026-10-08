package main

import (
	"os"

	"github.com/grafana/grafana-plugin-sdk-go/backend/datasource"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"

	"github.com/vtex/vtexio-grafana-plugin/pkg/plugin"
)

// version is injected at build time by the Grafana plugin SDK build (-X main.version=...).
// Left as "dev" for plain `go build`.
var version = "dev"

// Entrypoint for the data source backend. Grafana launches this binary and speaks to
// it over the plugin gRPC protocol; it is what makes the data source usable from alert
// rules, which are evaluated server-side.
func main() {
	plugin.SetClientVersion(version)
	if err := datasource.Manage("vtexio-grafana-datasource", plugin.NewDatasource, datasource.ManageOpts{}); err != nil {
		log.DefaultLogger.Error("failed to start the VTEX IO data source backend", "error", err.Error())
		os.Exit(1)
	}
}
