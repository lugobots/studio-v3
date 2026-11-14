package bots

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"studio-v3/api/internal/procreg"
)

func TestPrepareProjectRunsLanguageCommands(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "requirements.txt"), []byte("lugo4py\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	mgr := New(procreg.New())
	var mu sync.Mutex
	var cmds []string
	mgr.RunSync = func(dir, command string, env map[string]string) error {
		mu.Lock()
		cmds = append(cmds, command)
		mu.Unlock()
		return nil
	}
	var logs []string
	if err := mgr.PrepareProject(root, func(line string) { logs = append(logs, line) }); err != nil {
		t.Fatal(err)
	}
	if len(cmds) == 0 {
		t.Fatal("expected prepare commands")
	}
	joined := strings.Join(cmds, "\n")
	if !strings.Contains(joined, "pip install") {
		t.Fatalf("expected pip install, got %#v", cmds)
	}
	if _, err := os.Stat(prepareStampPath(root)); err != nil {
		t.Fatalf("expected stamp: %v", err)
	}
	if len(logs) == 0 {
		t.Fatal("expected prepare logs")
	}

	venvBin := filepath.Join(root, ".studio", "venv-lugo", "bin")
	if err := os.MkdirAll(venvBin, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(venvBin, "python3"), []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	cmds = nil
	if err := mgr.PrepareProject(root, nil); err != nil {
		t.Fatal(err)
	}
	if len(cmds) != 0 {
		t.Fatalf("second prepare should skip cold install, got %#v", cmds)
	}
}

func TestPrepareAlreadyReadySkipsMatchPrepare(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"name":"x"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, ".dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := writePrepareStamp(LangTypeScript, root); err != nil {
		t.Fatal(err)
	}

	mgr := New(procreg.New())
	var cmds int
	mgr.RunSync = func(dir, command string, env map[string]string) error {
		cmds++
		return nil
	}
	opp := filepath.Join(t.TempDir(), "opp")
	if err := os.WriteFile(opp, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	mgr.StartProcess = func(dir, command string, env map[string]string) (*procreg.Child, error) {
		return procreg.StartChild("sleep", "60")
	}
	err := mgr.StartMatch(Config{
		ProjectRoot:    root,
		GRPCURL:        "localhost:5000",
		OpponentBinary: opp,
	}, []Slot{{Side: SideHome, Number: 1}})
	if err != nil {
		t.Fatal(err)
	}
	if cmds != 0 {
		t.Fatalf("match start should skip cold prepare when stamp is valid, ran %d cmds", cmds)
	}
}

func TestPrepareCommandsPerLanguageStillExposed(t *testing.T) {
	root := t.TempDir()
	cache := filepath.Join(root, ".cache")
	cmd, env := goPrepareCommand(root, cache)
	if cmd == "" || env["GOCACHE"] == "" {
		t.Fatalf("go prepare incomplete: %q %#v", cmd, env)
	}
	if jsPrepareCommands()[0] != "npm install" {
		t.Fatalf("js prepare = %#v", jsPrepareCommands())
	}
	missing := pythonPrepareCommands(root)
	if len(missing) < 2 || !strings.Contains(missing[len(missing)-1], "pip install") {
		t.Fatalf("python prepare should create venv when missing: %#v", missing)
	}
}

func TestManifestFingerprintChangesInvalidateStamp(t *testing.T) {
	root := t.TempDir()
	req := filepath.Join(root, "requirements.txt")
	if err := os.WriteFile(req, []byte("a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	venvBin := filepath.Join(root, ".studio", "venv-lugo", "bin")
	if err := os.MkdirAll(venvBin, 0o755); err != nil {
		t.Fatal(err)
	}
	py := filepath.Join(venvBin, "python3")
	if err := os.WriteFile(py, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := writePrepareStamp(LangPython, root); err != nil {
		t.Fatal(err)
	}
	cache := filepath.Join(root, ".cache")
	if !prepareAlreadyReady(LangPython, root, cache) {
		t.Fatal("expected ready after stamp")
	}
	if err := os.WriteFile(req, []byte("b\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if prepareAlreadyReady(LangPython, root, cache) {
		t.Fatal("changed requirements must invalidate stamp")
	}
}
