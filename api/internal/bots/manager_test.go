package bots

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

func TestOpponentBinaryFromEnv(t *testing.T) {
	t.Setenv("LUGO_STUDIO_OPPONENT_BOT", "")
	if got := OpponentBinaryFromEnv(); got != defaultOpponentBinary {
		t.Fatalf("default = %q, want %q", got, defaultOpponentBinary)
	}
	t.Setenv("LUGO_STUDIO_OPPONENT_BOT", "/mounted/level-1")
	if got := OpponentBinaryFromEnv(); got != "/mounted/level-1" {
		t.Fatalf("env override = %q", got)
	}
}

func TestEnsureOpponentBinaryMissingPath(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "no-such-bot")
	err := ensureOpponentBinary(missing)
	if err == nil {
		t.Fatal("expected missing path error")
	}
	msg := err.Error()
	if !strings.Contains(msg, missing) {
		t.Fatalf("error should name path %q, got %q", missing, msg)
	}
	if !strings.Contains(msg, "opponent bot binary") {
		t.Fatalf("error should identify opponent binary, got %q", msg)
	}
	if !strings.Contains(msg, "no such file") && !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("error should indicate missing file, got %q", msg)
	}
}

func TestManagerStartMatchUsesConfiguredOpponentBinary(t *testing.T) {
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
	mgr.RunSync = func(dir, command string, env map[string]string) error { return nil }

	var commands []string
	mgr.StartProcess = func(dir, command string, env map[string]string) (*procreg.Child, error) {
		commands = append(commands, command)
		return procreg.StartChild("sleep", "60")
	}

	if err := mgr.StartMatch(Config{
		ProjectRoot:    root,
		GRPCURL:        "localhost:5123",
		PlayerSide:     SideHome,
		OpponentBinary: opp,
	}, []Slot{{Side: SideAway, Number: 1}}); err != nil {
		t.Fatalf("StartMatch: %v", err)
	}
	t.Cleanup(func() { _ = reg.ShutdownAll() })

	if len(commands) != 1 {
		t.Fatalf("started %d processes, want 1", len(commands))
	}
	if !strings.Contains(commands[0], opp) {
		t.Fatalf("opponent command %q does not use configured binary %q", commands[0], opp)
	}
}

func TestManagerMissingOpponentBinary(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "requirements.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	missing := filepath.Join(t.TempDir(), "missing")
	mgr := New(procreg.New())
	err := mgr.StartMatch(Config{
		ProjectRoot:    root,
		GRPCURL:        "localhost:5000",
		OpponentBinary: missing,
	}, []Slot{{Side: SideAway, Number: 1}})
	if err == nil {
		t.Fatal("expected missing opponent error")
	}
	msg := err.Error()
	if !strings.Contains(msg, missing) || !strings.Contains(msg, "opponent bot binary") {
		t.Fatalf("unclear missing-binary error: %q", msg)
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
	missing := pythonPrepareCommands(root)
	if len(missing) < 2 || !strings.Contains(missing[len(missing)-1], "pip install") {
		t.Fatalf("python prepare should create venv when missing: %#v", missing)
	}

	// A file that Stats as python but cannot run must recreate the venv.
	venvBin := filepath.Join(root, ".studio", "venv-lugo", "bin")
	if err := os.MkdirAll(venvBin, 0o755); err != nil {
		t.Fatal(err)
	}
	py := filepath.Join(venvBin, "python3")
	if err := os.WriteFile(py, []byte("#!/bin/sh\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	unusable := pythonPrepareCommands(root)
	joined := strings.Join(unusable, "\n")
	if len(unusable) < 2 || !strings.Contains(joined, "virtualenv --clear") {
		t.Fatalf("unusable venv should be recreated with virtualenv: %#v", unusable)
	}

	// Stub that succeeds for `import pip` → pip install only.
	if err := os.WriteFile(py, []byte("#!/bin/sh\nexit 0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	existing := pythonPrepareCommands(root)
	if len(existing) != 1 || !strings.Contains(existing[0], "pip install") {
		t.Fatalf("python prepare with healthy venv should pip install: %#v", existing)
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

func TestManagerStartStopBotHomeAndAway(t *testing.T) {
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
	mgr.RunSync = func(dir, command string, env map[string]string) error { return nil }

	var mu sync.Mutex
	var started []map[string]string
	mgr.StartProcess = func(dir, command string, env map[string]string) (*procreg.Child, error) {
		mu.Lock()
		started = append(started, env)
		mu.Unlock()
		return procreg.StartChild("sleep", "60")
	}

	cfg := Config{
		ProjectRoot:    root,
		GRPCURL:        "localhost:5123",
		PlayerSide:     SideHome,
		OpponentMode:   "zombies",
		OpponentBinary: opp,
	}
	home := Slot{Side: SideHome, Number: 3}
	away := Slot{Side: SideAway, Number: 7}

	if mgr.BotRunning(home) || mgr.BotRunning(away) {
		t.Fatal("slots should start stopped")
	}
	if err := mgr.StartBot(cfg, home); err != nil {
		t.Fatalf("StartBot home: %v", err)
	}
	if err := mgr.StartBot(cfg, away); err != nil {
		t.Fatalf("StartBot away: %v", err)
	}
	t.Cleanup(func() { _ = reg.ShutdownAll() })

	if !mgr.BotRunning(home) || !mgr.BotRunning(away) {
		t.Fatalf("running home=%v away=%v", mgr.BotRunning(home), mgr.BotRunning(away))
	}
	if reg.Len() != 2 {
		t.Fatalf("registry len = %d, want 2", reg.Len())
	}

	mu.Lock()
	defer mu.Unlock()
	if len(started) != 2 {
		t.Fatalf("started %d, want 2", len(started))
	}
	got := map[string]string{}
	for _, env := range started {
		got[env["BOT_TEAM"]+"/"+env["BOT_NUMBER"]] = env["MODE"]
	}
	if got[SideHome+"/3"] != "" {
		t.Fatalf("home player MODE = %q", got[SideHome+"/3"])
	}
	if got[SideAway+"/7"] != "zombies" {
		t.Fatalf("away opponent MODE = %q", got[SideAway+"/7"])
	}

	if err := mgr.StopBot(home); err != nil {
		t.Fatalf("StopBot home: %v", err)
	}
	if mgr.BotRunning(home) {
		t.Fatal("home should be stopped")
	}
	if !mgr.BotRunning(away) {
		t.Fatal("away should still run")
	}
	if reg.Len() != 1 {
		t.Fatalf("registry len = %d after home stop, want 1", reg.Len())
	}

	if err := mgr.StopBot(away); err != nil {
		t.Fatalf("StopBot away: %v", err)
	}
	if mgr.BotRunning(away) {
		t.Fatal("away should be stopped")
	}
	if reg.Len() != 0 {
		t.Fatalf("registry len = %d after both stopped", reg.Len())
	}
}

// TestManagerStopStartBotIsolatesSlot verifies StopBot/StartBot kill or spawn
// only the targeted slot: sibling bots keep their PIDs and a registered
// game-server hook is never shut down across stop + restart of one bot.
func TestManagerStopStartBotIsolatesSlot(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "go.mod"), []byte("module demo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	opp := filepath.Join(t.TempDir(), "opp-bot")
	if err := os.WriteFile(opp, []byte("#!/bin/sh\nexec sleep 60\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	reg := procreg.New()
	serverShutdowns := 0
	_ = reg.Register(procreg.Hook(func() error {
		serverShutdowns++
		return nil
	}))

	mgr := New(reg)
	mgr.RunSync = func(dir, command string, env map[string]string) error { return nil }
	mgr.StartProcess = func(dir, command string, env map[string]string) (*procreg.Child, error) {
		return procreg.StartChild("sleep", "60")
	}

	cfg := Config{
		ProjectRoot:    root,
		GRPCURL:        "localhost:5123",
		PlayerSide:     SideHome,
		OpponentMode:   "default",
		OpponentBinary: opp,
	}
	home := Slot{Side: SideHome, Number: 1}
	away := Slot{Side: SideAway, Number: 2}

	if err := mgr.StartBot(cfg, home); err != nil {
		t.Fatalf("StartBot home: %v", err)
	}
	if err := mgr.StartBot(cfg, away); err != nil {
		t.Fatalf("StartBot away: %v", err)
	}
	t.Cleanup(func() { _ = reg.ShutdownAll() })

	homeChild := mgr.bots[slotKey(home)].child
	awayChild := mgr.bots[slotKey(away)].child
	homePID := homeChild.Cmd.Process.Pid
	awayPID := awayChild.Cmd.Process.Pid
	if homePID == 0 || awayPID == 0 {
		t.Fatal("expected live PIDs")
	}

	if err := mgr.StopBot(home); err != nil {
		t.Fatalf("StopBot home: %v", err)
	}
	assertDead(t, homePID)
	if !awayChild.Alive() {
		t.Fatal("sibling away bot process should still be alive after home stop")
	}
	if awayChild.Cmd.Process.Pid != awayPID {
		t.Fatalf("away PID changed after home stop: got %d want %d", awayChild.Cmd.Process.Pid, awayPID)
	}
	if !mgr.BotRunning(away) {
		t.Fatal("away slot should still report running")
	}
	if mgr.BotRunning(home) {
		t.Fatal("home slot should be stopped")
	}
	if serverShutdowns != 0 {
		t.Fatalf("game-server hook shutdowns = %d, want 0 after StopBot", serverShutdowns)
	}
	// away bot + game-server hook
	if reg.Len() != 2 {
		t.Fatalf("registry len = %d after home stop, want 2 (away + server)", reg.Len())
	}

	if err := mgr.StartBot(cfg, home); err != nil {
		t.Fatalf("StartBot home again: %v", err)
	}
	newHome := mgr.bots[slotKey(home)].child
	if newHome.Cmd.Process.Pid == homePID {
		t.Fatal("restarted home bot should be a new process")
	}
	if !awayChild.Alive() || awayChild.Cmd.Process.Pid != awayPID {
		t.Fatalf("sibling away bot must keep original PID %d across home restart", awayPID)
	}
	if serverShutdowns != 0 {
		t.Fatalf("game-server hook shutdowns = %d, want 0 after StartBot", serverShutdowns)
	}
	if reg.Len() != 3 {
		t.Fatalf("registry len = %d after home restart, want 3", reg.Len())
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
