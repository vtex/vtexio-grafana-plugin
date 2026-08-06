//go:build mage

package main

// Build entry point for the data source backend. mage -v buildAll produces the
// per-platform binaries Grafana looks for in dist/.
import (
	// mage:import
	build "github.com/grafana/grafana-plugin-sdk-go/build"
)

// Default target when mage is run with no arguments.
var Default = build.BuildAll
