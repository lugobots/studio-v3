package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"studio-v3/api/internal/bottemplate"
)

func TestHealth(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	rec := httptest.NewRecorder()
	NewMux().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["status"] != "OK" {
		t.Fatalf("status = %#v", body["status"])
	}
}

func TestStudioStatusMissingWhenNoProject(t *testing.T) {
	t.Setenv("LUGO_HOST_PROJECT_PATH", "")
	t.Setenv("BOT_SOURCE_PATH", t.TempDir())

	req := httptest.NewRequest(http.MethodGet, "/api/studio/status", nil)
	rec := httptest.NewRecorder()
	NewMux().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["project_status"] != "missing" || body["project_path"] != "" {
		t.Fatalf("status = %#v", body)
	}
}

func TestStudioStatusReadyWhenProjectExists(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".lugo"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".lugo", "info.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("BOT_SOURCE_PATH", root)
	t.Setenv("LUGO_HOST_PROJECT_PATH", "/host/bots/demo")

	req := httptest.NewRequest(http.MethodGet, "/api/studio/status", nil)
	rec := httptest.NewRecorder()
	NewMux().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["project_status"] != "ready" || body["project_path"] != "/host/bots/demo" {
		t.Fatalf("status = %#v", body)
	}
}

func TestStudioStatusMissingWithoutHostPath(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".lugo"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".lugo", "info.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("BOT_SOURCE_PATH", root)
	t.Setenv("LUGO_HOST_PROJECT_PATH", "")

	req := httptest.NewRequest(http.MethodGet, "/api/studio/status", nil)
	rec := httptest.NewRecorder()
	NewMux().ServeHTTP(rec, req)

	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["project_status"] != "missing" {
		t.Fatalf("status = %#v", body)
	}
}

func TestSetupNewBotCopiesSupportedLanguages(t *testing.T) {
	original := templateInstaller
	t.Cleanup(func() { templateInstaller = original })

	type call struct {
		lang string
		dest string
	}
	var calls []call
	templateInstaller = bottemplate.FuncInstaller(func(language, destDir string) error {
		calls = append(calls, call{lang: language, dest: destDir})
		return os.WriteFile(filepath.Join(destDir, "marker-"+language), []byte(language), 0o644)
	})

	project := t.TempDir()
	t.Setenv("BOT_SOURCE_PATH", project)

	mux := NewMux()
	for _, lang := range []string{"python", "go", "typescript"} {
		rec := postSetupForm(t, mux, url.Values{"lang": {lang}})
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status %d body %s", lang, rec.Code, rec.Body.String())
		}
		var body map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body["status"] != "OK" {
			t.Fatalf("%s body = %#v", lang, body)
		}
		if _, ok := body["implemented"]; ok {
			t.Fatalf("%s included implemented: %#v", lang, body)
		}
		if _, err := os.Stat(filepath.Join(project, "marker-"+lang)); err != nil {
			t.Fatalf("%s marker missing: %v", lang, err)
		}
	}
	if len(calls) != 3 {
		t.Fatalf("calls = %#v", calls)
	}
	for i, lang := range []string{"python", "go", "typescript"} {
		if calls[i].lang != lang || calls[i].dest != project {
			t.Fatalf("call %d = %#v", i, calls[i])
		}
	}
}

func TestSetupNewBotRejectsUnknownLanguage(t *testing.T) {
	original := templateInstaller
	t.Cleanup(func() { templateInstaller = original })

	called := false
	templateInstaller = bottemplate.FuncInstaller(func(language, destDir string) error {
		called = true
		return nil
	})

	project := t.TempDir()
	t.Setenv("BOT_SOURCE_PATH", project)
	before, err := os.ReadDir(project)
	if err != nil {
		t.Fatal(err)
	}

	rec := postSetupForm(t, NewMux(), url.Values{"lang": {"rust"}})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if called {
		t.Fatal("installer should not run for unknown language")
	}
	after, err := os.ReadDir(project)
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(before) {
		t.Fatalf("project changed: before=%d after=%d", len(before), len(after))
	}
}

func TestSetupNewBotInstallFailure(t *testing.T) {
	original := templateInstaller
	t.Cleanup(func() { templateInstaller = original })
	templateInstaller = bottemplate.FuncInstaller(func(language, destDir string) error {
		return os.ErrPermission
	})
	t.Setenv("BOT_SOURCE_PATH", t.TempDir())

	rec := postSetupForm(t, NewMux(), url.Values{"lang": {"python"}})
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["status"] == "OK" {
		t.Fatalf("failure returned OK: %#v", body)
	}
	if body["error"] == nil || body["error"] == "" {
		t.Fatalf("missing error: %#v", body)
	}
}

func postSetupForm(t *testing.T, h http.Handler, values url.Values) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/init/setup-new-bot", strings.NewReader(values.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}
