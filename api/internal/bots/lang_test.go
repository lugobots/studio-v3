package bots

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDetectLanguage(t *testing.T) {
	cases := []struct {
		file string
		want Language
	}{
		{"go.mod", LangGo},
		{"requirements.txt", LangPython},
		{"package.json", LangTypeScript},
	}
	for _, tc := range cases {
		t.Run(string(tc.want), func(t *testing.T) {
			root := t.TempDir()
			if err := os.WriteFile(filepath.Join(root, tc.file), []byte("x"), 0o644); err != nil {
				t.Fatal(err)
			}
			if got := DetectLanguage(root); got != tc.want {
				t.Fatalf("DetectLanguage = %q, want %q", got, tc.want)
			}
		})
	}

	if got := DetectLanguage(t.TempDir()); got != LangUnknown {
		t.Fatalf("empty project = %q", got)
	}
}

func TestDetectLanguagePrefersGoWhenMultiple(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"go.mod", "requirements.txt", "package.json"} {
		if err := os.WriteFile(filepath.Join(root, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if got := DetectLanguage(root); got != LangGo {
		t.Fatalf("got %q, want go first", got)
	}
}
