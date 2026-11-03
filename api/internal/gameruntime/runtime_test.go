package gameruntime

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"syscall"
	"testing"
	"time"

	"studio-v3/api/internal/procreg"
)

func TestPortsFromEnvDefaults(t *testing.T) {
	t.Setenv("LUGO_STUDIO_GAME_SERVER_PORT", "")
	t.Setenv("LUGO_STUDIO_GAME_FRONTEND_PORT", "")
	p := PortsFromEnv()
	if p.GameServer != 5000 || p.GameFrontend != 8080 {
		t.Fatalf("ports = %#v", p)
	}
}

func TestPortsFromEnvCustom(t *testing.T) {
	t.Setenv("LUGO_STUDIO_GAME_SERVER_PORT", "5123")
	t.Setenv("LUGO_STUDIO_GAME_FRONTEND_PORT", "8123")
	p := PortsFromEnv()
	if p.GameServer != 5123 || p.GameFrontend != 8123 {
		t.Fatalf("ports = %#v", p)
	}
}

func TestLocalStartMakesFrontendReachable(t *testing.T) {
	grpcPort := freePort(t)
	httpPort := freePort(t)

	reg := procreg.New()
	starter := New(reg)
	if err := starter.Start(Ports{GameServer: grpcPort, GameFrontend: httpPort}); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() {
		if err := reg.ShutdownAll(); err != nil {
			t.Errorf("ShutdownAll: %v", err)
		}
	})

	if reg.Len() != 1 {
		t.Fatalf("registry len = %d, want shutdown hook registered", reg.Len())
	}

	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/", httpPort))
	if err != nil {
		t.Fatalf("frontend GET: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("frontend status %d body %q", resp.StatusCode, body)
	}

	// Idempotent second start.
	if err := starter.Start(Ports{GameServer: grpcPort, GameFrontend: httpPort}); err != nil {
		t.Fatalf("second Start: %v", err)
	}
	if reg.Len() != 1 {
		t.Fatalf("registry grew on idempotent start: %d", reg.Len())
	}
}

func TestLocalStartRunningStopLifecycle(t *testing.T) {
	grpcPort := freePort(t)
	httpPort := freePort(t)

	reg := procreg.New()
	runtime := New(reg)

	if runtime.Running() {
		t.Fatal("Running() = true before Start")
	}
	if err := runtime.Stop(); err != nil {
		t.Fatalf("Stop before Start: %v", err)
	}

	if err := runtime.Start(Ports{GameServer: grpcPort, GameFrontend: httpPort}); err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !runtime.Running() {
		t.Fatal("Running() = false after Start")
	}

	bot, err := procreg.StartChild("sleep", "60")
	if err != nil {
		t.Fatalf("StartChild: %v", err)
	}
	botPID := bot.Cmd.Process.Pid
	reg.Register(bot)
	if reg.Len() != 2 {
		t.Fatalf("registry len = %d, want game hook + bot child", reg.Len())
	}

	if err := runtime.Stop(); err != nil {
		t.Fatalf("Stop: %v", err)
	}
	if runtime.Running() {
		t.Fatal("Running() = true after Stop")
	}
	if reg.Len() != 0 {
		t.Fatalf("registry len = %d after Stop, want 0", reg.Len())
	}
	assertProcessGone(t, "match bot", botPID)

	client := &http.Client{Timeout: 500 * time.Millisecond}
	if _, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/", httpPort)); err == nil {
		t.Fatal("frontend still reachable after Stop")
	}

	if err := runtime.Stop(); err != nil {
		t.Fatalf("second Stop: %v", err)
	}
	if runtime.Running() {
		t.Fatal("Running() = true after double Stop")
	}

	// Restart must succeed after a clean stop.
	grpcPort = freePort(t)
	httpPort = freePort(t)
	if err := runtime.Start(Ports{GameServer: grpcPort, GameFrontend: httpPort}); err != nil {
		t.Fatalf("Start after Stop: %v", err)
	}
	t.Cleanup(func() {
		if err := runtime.Stop(); err != nil {
			t.Errorf("cleanup Stop: %v", err)
		}
	})
	if !runtime.Running() {
		t.Fatal("Running() = false after restart")
	}
}

func assertProcessGone(t *testing.T, name string, pid int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for processAlive(pid) {
		if time.Now().After(deadline) {
			t.Fatalf("%s (pid %d) still running after Stop", name, pid)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func processAlive(pid int) bool {
	return syscall.Kill(pid, 0) == nil
}

func freePort(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	if err := ln.Close(); err != nil {
		t.Fatal(err)
	}
	return port
}
