package main

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"studio-v3/api/internal/procreg"
)

// TestStoppingAPIProcessTerminatesTrackedRuntime proves the API signal/exit
// path (NotifyContext → awaitRuntimeShutdown → ShutdownAll) terminates tracked
// server/bot-style children and process-group grandchildren with no orphans.
func TestStoppingAPIProcessTerminatesTrackedRuntime(t *testing.T) {
	if os.Getenv("STUDIO_V3_API_SIGNAL_HELPER") == "1" {
		runAPISignalHelper(t)
		return
	}

	dir := t.TempDir()
	pidFile := filepath.Join(dir, "pids.txt")
	readyFile := filepath.Join(dir, "ready")
	hookFile := filepath.Join(dir, "hook")

	cmd := exec.Command(os.Args[0], "-test.run=^TestStoppingAPIProcessTerminatesTrackedRuntime$", "-test.count=1", "-test.v=false")
	cmd.Env = append(os.Environ(),
		"STUDIO_V3_API_SIGNAL_HELPER=1",
		"STUDIO_V3_API_SIGNAL_PIDFILE="+pidFile,
		"STUDIO_V3_API_SIGNAL_READY="+readyFile,
		"STUDIO_V3_API_SIGNAL_HOOKFILE="+hookFile,
	)
	// Keep helper output quiet; failures still surface via non-zero exit.
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatalf("start signal helper: %v", err)
	}

	waitForFile(t, readyFile, 5*time.Second)
	pids := readPIDFile(t, pidFile)
	if len(pids) < 3 {
		_ = cmd.Process.Kill()
		t.Fatalf("expected bot + group + grandchild PIDs, got %v", pids)
	}
	for _, pid := range pids {
		if !processAlive(pid) {
			_ = cmd.Process.Kill()
			t.Fatalf("tracked pid %d was not alive before SIGTERM", pid)
		}
	}

	if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatalf("SIGTERM helper: %v", err)
	}

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("helper exit: %v", err)
		}
	case <-time.After(15 * time.Second):
		_ = cmd.Process.Kill()
		t.Fatal("helper did not exit after SIGTERM")
	}

	waitForFile(t, hookFile, 2*time.Second)
	for _, pid := range pids {
		assertProcessDead(t, pid)
	}
}

// TestHarnessCancelTerminatesTrackedRuntime covers the same shutdown function
// the API uses on signal, driven by context cancel (unit/harness path).
func TestHarnessCancelTerminatesTrackedRuntime(t *testing.T) {
	reg := procreg.New()
	var hookRan atomic.Bool
	reg.Register(procreg.Hook(func() error {
		hookRan.Store(true)
		return nil
	}))

	serverLike, err := procreg.StartChild("sleep", "60")
	if err != nil {
		t.Fatalf("start server-like child: %v", err)
	}
	botLike, err := procreg.StartChild("sleep", "60")
	if err != nil {
		t.Fatalf("start bot-like child: %v", err)
	}
	reg.Register(serverLike)
	reg.Register(botLike)

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		awaitRuntimeShutdown(ctx, nil, reg)
		close(done)
	}()

	cancel() // same effect as signal.NotifyContext receiving SIGTERM/SIGINT
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("awaitRuntimeShutdown did not finish after cancel")
	}

	if !hookRan.Load() {
		t.Fatal("shutdown hook did not run")
	}
	if got := reg.Len(); got != 0 {
		t.Fatalf("registry Len() = %d, want 0", got)
	}
	assertProcessDead(t, serverLike.Cmd.Process.Pid)
	assertProcessDead(t, botLike.Cmd.Process.Pid)
}

func runAPISignalHelper(t *testing.T) {
	pidFile := os.Getenv("STUDIO_V3_API_SIGNAL_PIDFILE")
	readyFile := os.Getenv("STUDIO_V3_API_SIGNAL_READY")
	hookFile := os.Getenv("STUDIO_V3_API_SIGNAL_HOOKFILE")
	if pidFile == "" || readyFile == "" || hookFile == "" {
		t.Fatal("signal helper missing env paths")
	}

	reg := procreg.New()
	reg.Register(procreg.Hook(func() error {
		return os.WriteFile(hookFile, []byte("ok\n"), 0o644)
	}))

	// Bot-like direct child.
	bot, err := procreg.StartChild("sleep", "60")
	if err != nil {
		t.Fatalf("start bot child: %v", err)
	}
	reg.Register(bot)

	// Server-like child that spawns a grandchild in the same process group so
	// ShutdownAll must not leave orphans.
	grandPIDPath := filepath.Join(t.TempDir(), "grandchild.pid")
	shellCmd := fmt.Sprintf("sleep 60 & echo $! >%q; wait", grandPIDPath)
	group, err := procreg.StartChild("sh", "-c", shellCmd)
	if err != nil {
		t.Fatalf("start process-group child: %v", err)
	}
	reg.Register(group)

	grandPID := waitForPIDFile(t, grandPIDPath, 5*time.Second)
	pids := []int{bot.Cmd.Process.Pid, group.Cmd.Process.Pid, grandPID}
	if err := writePIDFile(pidFile, pids); err != nil {
		t.Fatalf("write pid file: %v", err)
	}
	if err := os.WriteFile(readyFile, []byte("ready\n"), 0o644); err != nil {
		t.Fatalf("write ready file: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	awaitRuntimeShutdown(ctx, nil, reg)
}

func writePIDFile(path string, pids []int) error {
	var b strings.Builder
	for _, pid := range pids {
		fmt.Fprintf(&b, "%d\n", pid)
	}
	return os.WriteFile(path, []byte(b.String()), 0o644)
}

func readPIDFile(t *testing.T, path string) []int {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatalf("open pid file: %v", err)
	}
	defer f.Close()

	var pids []int
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		pid, err := strconv.Atoi(line)
		if err != nil {
			t.Fatalf("parse pid %q: %v", line, err)
		}
		pids = append(pids, pid)
	}
	if err := sc.Err(); err != nil {
		t.Fatalf("scan pid file: %v", err)
	}
	return pids
}

func waitForPIDFile(t *testing.T, path string, timeout time.Duration) int {
	t.Helper()
	waitForFile(t, path, timeout)
	pids := readPIDFile(t, path)
	if len(pids) != 1 {
		t.Fatalf("grandchild pid file: got %v, want 1 pid", pids)
	}
	return pids[0]
}

func waitForFile(t *testing.T, path string, timeout time.Duration) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for {
		if _, err := os.Stat(path); err == nil {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", path)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func assertProcessDead(t *testing.T, pid int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for processAlive(pid) {
		if time.Now().After(deadline) {
			t.Fatalf("pid %d still running after API shutdown path", pid)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func processAlive(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil
}
