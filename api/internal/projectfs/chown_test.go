package projectfs

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestChownToCoderMissingRootIsNil(t *testing.T) {
	if err := ChownToCoder(filepath.Join(t.TempDir(), "missing")); err != nil {
		t.Fatalf("missing root: %v", err)
	}
}

func TestChownToCoderEmptyRootIsNil(t *testing.T) {
	if err := ChownToCoder(""); err != nil {
		t.Fatalf("empty root: %v", err)
	}
}

func TestChownToCoderWalksExistingDir(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("chown is a no-op on Windows hosts; exercised in the Linux API image")
	}
	root := t.TempDir()
	nested := filepath.Join(root, "src")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(nested, "main.py")
	if err := os.WriteFile(file, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := ChownToCoder(root); err != nil {
		t.Fatalf("ChownToCoder: %v", err)
	}
}
