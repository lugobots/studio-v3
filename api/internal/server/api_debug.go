package server

import (
	"fmt"
	"net/http"
	"strings"
)

const apiLogSource = "api"

// debugf retains a Studio API debug line only while the api source is armed.
// Unarmed calls do not touch the hub, and arming api does not arm other sources.
func (a *api) debugf(format string, args ...any) {
	if a == nil || a.logs == nil || !a.logs.Armed(apiLogSource) {
		return
	}
	a.logs.Append(apiLogSource, fmt.Sprintf(format, args...))
}

// withAPIDebug records one hub line per finished request. Logging runs after
// the handler so an arm of the api source during that request is visible.
// Disarmed sessions append nothing.
func withAPIDebug(a *api, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)
		if a == nil || r == nil || r.URL == nil {
			return
		}
		path := r.URL.Path
		if path == "" {
			path = "/"
		}
		// The log transport itself must not echo into the hub it is streaming.
		if strings.HasPrefix(path, "/api/logs/") {
			return
		}
		a.debugf("%s %s", r.Method, path)
	})
}
