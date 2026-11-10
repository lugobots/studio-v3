package bottemplate

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestRepoForLanguage(t *testing.T) {
	cases := map[string]string{
		"python":     "the-dummies-py",
		"go":         "the-dummies-go",
		"typescript": "the-dummies-js",
	}
	for lang, repo := range cases {
		got, ok := RepoForLanguage(lang)
		if !ok || got != repo {
			t.Fatalf("%s: got %q ok=%v", lang, got, ok)
		}
	}
	if _, ok := RepoForLanguage("rust"); ok {
		t.Fatal("rust should be unsupported")
	}
}

func TestDirInstallerCopiesTemplate(t *testing.T) {
	root := t.TempDir()
	repo := filepath.Join(root, "the-dummies-py")
	if err := os.MkdirAll(filepath.Join(repo, ".lugo"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, ".lugo", "info.json"), []byte(`{"studio":{"major":1}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "main.py"), []byte("print('hi')\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	dest := t.TempDir()
	if err := (DirInstaller{Root: root}).Install("python", dest); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(dest, ".lugo", "info.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != `{"studio":{"major":1}}` {
		t.Fatalf("info.json = %s", got)
	}
	if _, err := os.Stat(filepath.Join(dest, "main.py")); err != nil {
		t.Fatal(err)
	}
}

func TestGitHubInstallerFetchesLatestTag(t *testing.T) {
	archive := buildTarGz(t, "the-dummies-go-v1.2.0", map[string]string{
		"the-dummies-go-v1.2.0/.lugo/info.json": `{"studio":{"major":1}}`,
		"the-dummies-go-v1.2.0/main.go":         "package main\n",
	})

	mux := http.NewServeMux()
	mux.HandleFunc("/repos/lugobots/the-dummies-go/tags", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode([]map[string]string{
			{"name": "v1.0.0"},
			{"name": "v1.2.0"},
			{"name": "v1.1.0"},
		})
	})
	mux.HandleFunc("/lugobots/the-dummies-go/tar.gz/v1.2.0", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/gzip")
		_, _ = w.Write(archive)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	dest := t.TempDir()
	inst := &GitHubInstaller{
		HTTPClient: srv.Client(),
		BaseAPI:    srv.URL,
		BaseCode:   srv.URL,
	}
	if err := inst.Install("go", dest); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dest, ".lugo", "info.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dest, "main.go")); err != nil {
		t.Fatal(err)
	}
}

func TestCompareSemver(t *testing.T) {
	if compareSemver("v1.0.0", "v1.2.0") >= 0 {
		t.Fatal("expected v1.0.0 < v1.2.0")
	}
	if compareSemver("1.10.0", "1.2.0") <= 0 {
		t.Fatal("expected 1.10.0 > 1.2.0")
	}
}

func buildTarGz(t *testing.T, _ string, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, content := range files {
		hdr := &tar.Header{
			Name: name,
			Mode: 0o644,
			Size: int64(len(content)),
		}
		if err := tw.WriteHeader(hdr); err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(tw, content); err != nil {
			t.Fatal(err)
		}
	}
	if err := tw.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}
