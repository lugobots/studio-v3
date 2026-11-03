package bots

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"testing"
	"time"

	"studio-v3/api/internal/procreg"
)

func TestManagerStartMatchRegistersTwentyTwoBots(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module demo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	opp := filepath.Join(t.TempDir(), "opp-bot")
	if err := os.WriteFile(opp, []byte("#!/bin/sh\nexec sleep 60\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	reg := procreg.New()
	mgr := New(reg)

	var mu sync.Mutex
	var started []map[string]string
	mgr.RunSync = func(dir, command string, env map[string]string) error {
		return nil
	}
	mgr.StartProcess = func(dir, command string, env map[string]string) (*procreg.Child, error) {
		mu.Lock()
		started = append(started, env)
		mu.Unlock()
		return procreg.StartChild("sleep", "60")
	}

	if err := mgr.StartMatch(Config{
		ProjectRoot:    root,
		GRPCURL:        "localhost:5123",
		PlayerSide:     SideAway,
		OpponentMode:   "zombies",
		OpponentBinary: opp,
	}, AllSlots()); err != nil {
		t.Fatalf("StartMatch: %v", err)
	}
	t.Cleanup(func() { _ = reg.ShutdownAll() })

	mu.Lock()
	defer mu.Unlock()
	if len(started) != 22 {
		t.Fatalf("started %d bots, want 22", len(started))
	}
	if reg.Len() != 22 {
		t.Fatalf("registry len = %d, want 22", reg.Len())
	}

	// Player project on configured side (AWAY); opponents on the other with MODE.
	var players, opponents int
	for _, env := range started {
		if env["BOT_GRPC_URL"] != "localhost:5123" {
			t.Fatalf("grpc url = %#v", env)
		}
		switch {
		case env["BOT_TEAM"] == SideAway && env["MODE"] == "":
			players++
		case env["BOT_TEAM"] == SideHome && env["MODE"] == "zombies":
			opponents++
		default:
			t.Fatalf("unexpected bot env %#v", env)
		}
	}
	if players != 11 || opponents != 11 {
		t.Fatalf("players=%d opponents=%d", players, opponents)
	}
}

func TestManagerStartMatchPartialActiveSet(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module demo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	opp := filepath.Join(t.TempDir(), "opp-bot")
	if err := os.WriteFile(opp, []byte("#!/bin/sh\nexec sleep 60\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	reg := procreg.New()
	mgr := New(reg)

	var mu sync.Mutex
	var started []map[string]string
	mgr.RunSync = func(dir, command string, env map[string]string) error { return nil }
	mgr.StartProcess = func(dir, command string, env map[string]string) (*procreg.Child, error) {
		mu.Lock()
		started = append(started, env)
		mu.Unlock()
		return procreg.StartChild("sleep", "60")
	}

	active := []Slot{
		{Side: SideHome, Number: 1},
		{Side: SideHome, Number: 5},
		{Side: SideAway, Number: 11},
	}
	if err := mgr.StartMatch(Config{
		ProjectRoot:    root,
		GRPCURL:        "localhost:5123",
		PlayerSide:     SideHome,
		OpponentMode:   "kids",
		OpponentBinary: opp,
	}, active); err != nil {
		t.Fatalf("StartMatch: %v", err)
	}
	t.Cleanup(func() { _ = reg.ShutdownAll() })

	mu.Lock()
	defer mu.Unlock()
	if len(started) != 3 {
		t.Fatalf("started %d bots, want 3", len(started))
	}
	if reg.Len() != 3 {
		t.Fatalf("registry len = %d, want 3", reg.Len())
	}

	want := map[string]string{
		SideHome + "/1":  "",
		SideHome + "/5":  "",
		SideAway + "/11": "kids",
	}
	got := map[string]string{}
	for _, env := range started {
		key := env["BOT_TEAM"] + "/" + env["BOT_NUMBER"]
		got[key] = env["MODE"]
	}
	for key, mode := range want {
		if got[key] != mode {
			t.Fatalf("slot %s mode = %q, want %q (started %#v)", key, got[key], mode, got)
		}
	}
	for key := range got {
		if _, ok := want[key]; !ok {
			t.Fatalf("unexpected started slot %s", key)
		}
	}
}

func TestManagerStartMatchEmptyActiveSet(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module demo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	reg := procreg.New()
	mgr := New(reg)
	started := 0
	mgr.RunSync = func(dir, command string, env map[string]string) error {
		t.Fatal("prepare should not run for empty active set")
		return nil
	}
	mgr.StartProcess = func(dir, command string, env map[string]string) (*procreg.Child, error) {
		started++
		return nil, fmt.Errorf("should not start")
	}
	if err := mgr.StartMatch(Config{
		ProjectRoot: root,
		GRPCURL:     "localhost:1",
	}, nil); err != nil {
		t.Fatalf("StartMatch empty: %v", err)
	}
	if started != 0 || reg.Len() != 0 {
		t.Fatalf("started=%d registry=%d", started, reg.Len())
	}
}

func TestManagerRestartStopsPreviousBots(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{}`), 0o644); err != nil {
		t.Fatal(err)
	}
	opp := filepath.Join(t.TempDir(), "opp-bot")
	if err := os.WriteFile(opp, []byte("#!/bin/sh\nexec sleep 60\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	reg := procreg.New()
	mgr := New(reg)
	mgr.RunSync = func(dir, command string, env map[string]string) error { return nil }

	var firstPIDs []int
	mgr.StartProcess = func(dir, command string, env map[string]string) (*procreg.Child, error) {
		child, err := procreg.StartChild("sleep", "60")
		if err != nil {
			return nil, err
		}
		firstPIDs = append(firstPIDs, child.Cmd.Process.Pid)
		return child, nil
	}
	if err := mgr.StartMatch(Config{ProjectRoot: root, GRPCURL: "localhost:1", OpponentBinary: opp}, AllSlots()); err != nil {
		t.Fatalf("first StartMatch: %v", err)
	}

	mgr.StartProcess = func(dir, command string, env map[string]string) (*procreg.Child, error) {
		return procreg.StartChild("sleep", "60")
	}
	if err := mgr.StartMatch(Config{ProjectRoot: root, GRPCURL: "localhost:1", OpponentBinary: opp}, AllSlots()); err != nil {
		t.Fatalf("second StartMatch: %v", err)
	}
	t.Cleanup(func() { _ = reg.ShutdownAll() })

	for _, pid := range firstPIDs {
		assertDead(t, pid)
	}
	if reg.Len() != 22 {
		t.Fatalf("registry len = %d after restart", reg.Len())
	}
}

func TestManagerRequiresDetectableProject(t *testing.T) {
	reg := procreg.New()
	mgr := New(reg)
	opp := filepath.Join(t.TempDir(), "opp")
	if err := os.WriteFile(opp, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	err := mgr.StartMatch(Config{
		ProjectRoot:    t.TempDir(),
		GRPCURL:        "localhost:5000",
		OpponentBinary: opp,
	}, []Slot{{Side: SideHome, Number: 1}})
	if err == nil {
		t.Fatal("expected error for unknown project")
	}
}

func TestManagerMissingOpponentBinary(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "requirements.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	mgr := New(procreg.New())
	err := mgr.StartMatch(Config{
		ProjectRoot:    root,
		GRPCURL:        "localhost:5000",
		OpponentBinary: filepath.Join(t.TempDir(), "missing"),
	}, []Slot{{Side: SideAway, Number: 1}})
	if err == nil {
		t.Fatal("expected missing opponent error")
	}
}

func TestPrepareCommandsPerLanguage(t *testing.T) {
	root := t.TempDir()
	cache := filepath.Join(root, ".cache")
	cmd, env := goPrepareCommand(root, cache)
	if cmd == "" || env["GOCACHE"] == "" {
		t.Fatalf("go prepare incomplete: %q %#v", cmd, env)
	}
	if jsPrepareCommands()[0] != "npm install" {
		t.Fatalf("js prepare = %#v", jsPrepareCommands())
	}
	if pythonPrepareCommands(root) == nil {
		t.Fatal("python prepare should create venv when missing")
	}
}

func TestBotEnv(t *testing.T) {
	env := botEnv(SideHome, 7, "localhost:9", "zombies")
	if env["BOT_NUMBER"] != "7" || env["BOT_TEAM"] != SideHome || env["BOT_GRPC_URL"] != "localhost:9" || env["MODE"] != "zombies" {
		t.Fatalf("%#v", env)
	}
	if _, ok := botEnv(SideAway, 1, "x", "")["MODE"]; ok {
		t.Fatal("empty mode should omit MODE")
	}
}

func assertDead(t *testing.T, pid int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		err := syscall.Kill(pid, 0)
		if err != nil {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("pid %d still alive: %v", pid, fmt.Errorf("timeout"))
		}
		time.Sleep(20 * time.Millisecond)
	}
}
