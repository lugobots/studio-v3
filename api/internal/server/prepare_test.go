package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakePrepper struct {
	mu      sync.Mutex
	err     error
	delay   time.Duration
	calls   int
	lastLog string
}

func (f *fakePrepper) PrepareProject(projectRoot string, onLog func(string)) error {
	f.mu.Lock()
	f.calls++
	f.mu.Unlock()
	if onLog != nil {
		onLog("preparing " + projectRoot)
		f.mu.Lock()
		f.lastLog = "preparing " + projectRoot
		f.mu.Unlock()
	}
	if f.delay > 0 {
		time.Sleep(f.delay)
	}
	if onLog != nil {
		onLog("done")
	}
	return f.err
}

func TestPrepareDependenciesSuccess(t *testing.T) {
	t.Setenv("BOT_SOURCE_PATH", t.TempDir())
	prep := &fakePrepper{}
	h := NewMuxWith(Deps{Prepper: prep})
	req := httptest.NewRequest(http.MethodPost, "/api/init/prepare-dependencies", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["status"] != "OK" {
		t.Fatalf("%#v", body)
	}
	if prep.calls != 1 {
		t.Fatalf("calls=%d", prep.calls)
	}
}

func TestPrepareDependenciesFailure(t *testing.T) {
	t.Setenv("BOT_SOURCE_PATH", t.TempDir())
	prep := &fakePrepper{err: errPrepareBoom{}}
	h := NewMuxWith(Deps{Prepper: prep})
	req := httptest.NewRequest(http.MethodPost, "/api/init/prepare-dependencies", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status %d", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["error"] == nil || body["error"] == "" {
		t.Fatalf("%#v", body)
	}
}

type errPrepareBoom struct{}

func (errPrepareBoom) Error() string { return "boom" }

func TestPrepareLogsWhileRunning(t *testing.T) {
	t.Setenv("BOT_SOURCE_PATH", t.TempDir())
	prep := &fakePrepper{delay: 80 * time.Millisecond}
	h := NewMuxWith(Deps{Prepper: prep})

	done := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		req := httptest.NewRequest(http.MethodPost, "/api/init/prepare-dependencies", nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		done <- rec
	}()

	deadline := time.Now().Add(2 * time.Second)
	sawLines := false
	for time.Now().Before(deadline) {
		req := httptest.NewRequest(http.MethodGet, "/api/init/prepare-logs", nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		var body struct {
			Running bool     `json:"running"`
			Lines   []string `json:"lines"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if len(body.Lines) > 0 {
			sawLines = true
			joined := strings.Join(body.Lines, "\n")
			if strings.Contains(joined, "preparing") || strings.Contains(joined, "done") {
				break
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	rec := <-done
	if rec.Code != http.StatusOK {
		t.Fatalf("prepare status %d", rec.Code)
	}
	if !sawLines {
		t.Fatal("expected prepare logs while running")
	}
}
