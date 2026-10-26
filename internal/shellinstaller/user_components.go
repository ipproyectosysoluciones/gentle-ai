package shellinstaller

import (
	"sort"
	"strings"
)

// Component scope names carried by UserInstallRequest.Scope and
// UserShellUpdate.Scope. An empty scope is a full install.
const (
	UserComponentSupervisor = "supervisor"
	UserComponentNode       = "node"
	UserComponentSDK        = "sdk"
	UserComponentCodeGraph  = "codegraph"
	UserComponentContext7   = "context7"
)

// CanonicalUpdateScope renders report component names as the canonical
// request scope string for UserInstallRequest.Scope.
func CanonicalUpdateScope(components []string) string {
	set := map[string]bool{}
	for _, name := range components {
		set[name] = true
	}
	names := make([]string, 0, len(set))
	for name := range set {
		names = append(names, name)
	}
	sort.Strings(names)
	return strings.Join(names, ",")
}

// userSortedComponents returns the scope names in canonical report order.
func userSortedComponents(scope map[string]bool) []string {
	names := make([]string, 0, len(scope))
	for name, on := range scope {
		if on {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return names
}

// userScopeComponents returns the canonical component names of a request
// scope string in sorted order; an empty scope is a full install.
func userScopeComponents(scope string) []string {
	if scope == "" {
		return nil
	}
	return strings.Split(scope, ",")
}
