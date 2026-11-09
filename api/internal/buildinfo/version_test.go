package buildinfo

import "testing"

func TestVersionDefaultsToDev(t *testing.T) {
	if Version != "dev" {
		t.Fatalf("Version = %q, want %q for builds without -ldflags -X", Version, "dev")
	}
}
