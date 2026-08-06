package plugin

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// mageInvocationPattern captures the target list passed to `mage -v` in an npm script,
// e.g. "go run github.com/magefile/mage@latest -v build:linux build:linuxARM64".
var mageInvocationPattern = regexp.MustCompile(`mage(?:@latest)?\s+-v\s+([a-zA-Z0-9:_ ]+)`)

// TestPackageJSONMageTargetsExist guards against a real bug found while validating this
// plugin end to end: build:backend:local once referenced "build:linuxAMD64", a target
// mage does not have — the real one is "build:linux" — which silently broke `npm run
// server`'s dev loop before Grafana ever started (the preserver hook failed and
// docker-compose never ran). Every mage target referenced from package.json must
// actually exist, checked against what `mage -l` itself reports.
func TestPackageJSONMageTargetsExist(t *testing.T) {
	repoRoot := "../.."

	raw, err := os.ReadFile(filepath.Join(repoRoot, "package.json"))
	require.NoError(t, err)

	var pkg struct {
		Scripts map[string]string `json:"scripts"`
	}
	require.NoError(t, json.Unmarshal(raw, &pkg))

	referenced := map[string][]string{} // target -> npm scripts that reference it
	for name, cmd := range pkg.Scripts {
		for _, match := range mageInvocationPattern.FindAllStringSubmatch(cmd, -1) {
			for _, target := range strings.Fields(match[1]) {
				referenced[target] = append(referenced[target], name)
			}
		}
	}
	require.NotEmpty(t, referenced, "expected at least one npm script to invoke mage -v <target>")

	cmd := exec.Command("go", "run", "github.com/magefile/mage@latest", "-l")
	cmd.Dir = repoRoot
	out, err := cmd.CombinedOutput()
	require.NoError(t, err, "mage -l failed: %s", out)

	available := map[string]bool{}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 {
			continue
		}
		// The default target is suffixed with "*" in `mage -l` output.
		available[strings.TrimSuffix(fields[0], "*")] = true
	}
	require.NotEmpty(t, available, "expected `mage -l` to list at least one target")

	for target, scripts := range referenced {
		require.True(t, available[target],
			"package.json script(s) %v reference mage target %q, which `mage -l` does not list", scripts, target)
	}
}
