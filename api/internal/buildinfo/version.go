// Package buildinfo holds compile-time Studio API identity.
package buildinfo

// Version is the Studio API build label shown to clients.
// Development builds leave the default "dev". Release builds inject a
// non-dev string with:
//
//	go build -ldflags "-X studio-v3/api/internal/buildinfo.Version=<version>"
var Version = "dev"
