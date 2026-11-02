package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
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
