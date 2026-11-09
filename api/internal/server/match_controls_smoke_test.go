package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lugobots/lugo4go/v3/field"
	"github.com/lugobots/lugo4go/v3/proto"
	"github.com/lugobots/server/v2/machine"

	"studio-v3/api/internal/bots"
	"studio-v3/api/internal/gameremote"
	"studio-v3/api/internal/gameruntime"
	"studio-v3/api/internal/procreg"
)

// TestMatchControlsSmoke is the task 6.2 API-level smoke for workspace match
// controls. It chains the delta scenarios against the HTTP API: away + golden
// skip + slow + zombies on server start, partial active match start, bot
// toggle off/on, reset, and positions get/apply. Game-server Remote is a
// local gRPC fake; bot processes are short-lived sleep stubs so the smoke
// stays runnable without Studio desktop or a Docker image rebuild.
func TestMatchControlsSmoke(t *testing.T) {
	project := t.TempDir()
	if err := os.WriteFile(filepath.Join(project, "go.mod"), []byte("module demo\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	opp := filepath.Join(t.TempDir(), "opp-bot")
	if err := os.WriteFile(opp, []byte("#!/bin/sh\nexec sleep 60\n"), 0o755); err != nil {
		t.Fatal(err)
	}

	snap := testSnapshotForReset()
	wantHomeScore, wantAwayScore, wantTurn := snap.HomeTeam.Score, snap.AwayTeam.Score, snap.Turn
	savedBall := *snap.Ball.Position
	savedHome := *snap.HomeTeam.Players[0].Position
	savedAway := *snap.AwayTeam.Players[0].Position
	remote, remotePort := startRemoteFake(t, snap)

	var (
		envMu   sync.Mutex
		launched []map[string]string
	)
	reg := procreg.New()
	match := bots.New(reg)
	match.RunSync = func(dir, command string, env map[string]string) error { return nil }
	match.StartProcess = func(dir, command string, env map[string]string) (*procreg.Child, error) {
		cp := make(map[string]string, len(env))
		for k, v := range env {
			cp[k] = v
		}
		envMu.Lock()
		launched = append(launched, cp)
		envMu.Unlock()
		return procreg.StartChild("sleep", "60")
	}

	starter := &fakeStarter{
		onStart: func(ports gameruntime.Ports, settings gameruntime.MatchSettings) error {
			cfg, err := gameruntime.ComposeConfiguration(ports, settings)
			if err != nil {
				return err
			}
			if settings.TeamSide != gameruntime.TeamSideAway {
				t.Errorf("start settings team_side = %q, want away", settings.TeamSide)
			}
			if !settings.SkipToGoldenGoal || !cfg.SkipToGoldenGoal {
				t.Error("expected skip_to_golden_goal applied to composed config")
			}
			if settings.GameSpeed != gameruntime.GameSpeedSlow {
				t.Errorf("start settings game_speed = %q, want slow", settings.GameSpeed)
			}
			wantSlow := time.Duration(float64(machine.DefaultListeningDuration) * 4.0)
			if cfg.ListeningDuration != wantSlow {
				t.Errorf("listening duration = %s, want slow %s", cfg.ListeningDuration, wantSlow)
			}
			normalListening := machine.DefaultListeningDuration
			if !(cfg.ListeningDuration > normalListening) {
				t.Errorf("slow listening %s should be > normal %s", cfg.ListeningDuration, normalListening)
			}
			if settings.OpponentMode != gameruntime.OpponentModeZombies {
				t.Errorf("start settings opponent_mode = %q, want zombies", settings.OpponentMode)
			}
			return nil
		},
	}

	mux := NewMuxWith(Deps{Registry: reg, Starter: starter, Match: match})
	t.Setenv("BOT_SOURCE_PATH", project)
	t.Setenv("LUGO_STUDIO_OPPONENT_BOT", opp)
	t.Setenv("LUGO_STUDIO_GAME_SERVER_PORT", strconv.Itoa(remotePort))
	t.Setenv("LUGO_STUDIO_GAME_FRONTEND_PORT", "8810")
	t.Cleanup(func() { _ = reg.ShutdownAll() })

	// 1) Server start with away + golden skip + slow + zombies.
	startBody := `{"team_side":"away","skip_to_golden_goal":true,"game_speed":"slow","opponent_mode":"zombies"}`
	startReq := httptest.NewRequest(http.MethodPost, "/api/server/start", strings.NewReader(startBody))
	startReq.Header.Set("Content-Type", "application/json")
	startRec := httptest.NewRecorder()
	mux.ServeHTTP(startRec, startReq)
	if startRec.Code != http.StatusOK {
		t.Fatalf("server start status %d body %s", startRec.Code, startRec.Body.String())
	}
	if starter.calls != 1 || !starter.Running() {
		t.Fatalf("server start calls=%d running=%v", starter.calls, starter.Running())
	}

	// 2) Match start with a few active bots (player on AWAY, opponent on HOME).
	matchBody := `{"team_side":"away","skip_to_golden_goal":true,"game_speed":"slow","opponent_mode":"zombies","active":[{"side":"AWAY","number":1},{"side":"AWAY","number":2},{"side":"HOME","number":1}]}`
	matchReq := httptest.NewRequest(http.MethodPost, "/api/game/start", strings.NewReader(matchBody))
	matchReq.Header.Set("Content-Type", "application/json")
	matchRec := httptest.NewRecorder()
	mux.ServeHTTP(matchRec, matchReq)
	if matchRec.Code != http.StatusOK {
		t.Fatalf("game start status %d body %s", matchRec.Code, matchRec.Body.String())
	}
	if reg.Len() != 3 {
		t.Fatalf("after match start registry len = %d, want 3 active bots", reg.Len())
	}
	for _, path := range []string{
		"/api/team/AWAY/bots/1",
		"/api/team/AWAY/bots/2",
		"/api/team/HOME/bots/1",
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status %s: %d %s", path, rec.Code, rec.Body.String())
		}
		var body map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body["running"] != true {
			t.Fatalf("%s running = %#v, want true", path, body["running"])
		}
	}
	// Inactive slot stays down.
	inactive := httptest.NewRecorder()
	mux.ServeHTTP(inactive, httptest.NewRequest(http.MethodGet, "/api/team/AWAY/bots/3", nil))
	assertBotStatus(t, inactive, bots.SideAway, 3, false)

	envMu.Lock()
	envs := append([]map[string]string(nil), launched...)
	envMu.Unlock()
	var sawPlayerAway, sawOpponentHomeZombies bool
	for _, env := range envs {
		switch {
		case env["BOT_TEAM"] == bots.SideAway && env["BOT_NUMBER"] != "" && env["MODE"] == "":
			sawPlayerAway = true
		case env["BOT_TEAM"] == bots.SideHome && env["MODE"] == "zombies":
			sawOpponentHomeZombies = true
		}
	}
	if !sawPlayerAway {
		t.Fatalf("expected player project bots on AWAY; launched=%#v", envs)
	}
	if !sawOpponentHomeZombies {
		t.Fatalf("expected HOME opponent with MODE=zombies; launched=%#v", envs)
	}

	// 3) Toggle one bot off, then on.
	stopRec := httptest.NewRecorder()
	mux.ServeHTTP(stopRec, httptest.NewRequest(http.MethodDelete, "/api/team/AWAY/bots/2", nil))
	assertBotStatus(t, stopRec, bots.SideAway, 2, false)
	if match.BotRunning(bots.Slot{Side: bots.SideAway, Number: 2}) {
		t.Fatal("AWAY/2 still running after stop")
	}
	if reg.Len() != 2 {
		t.Fatalf("registry after stop = %d, want 2", reg.Len())
	}

	startBotRec := httptest.NewRecorder()
	mux.ServeHTTP(startBotRec, httptest.NewRequest(http.MethodPost, "/api/team/AWAY/bots/2", nil))
	assertBotStatus(t, startBotRec, bots.SideAway, 2, true)
	if !match.BotRunning(bots.Slot{Side: bots.SideAway, Number: 2}) {
		t.Fatal("AWAY/2 not running after start")
	}
	if reg.Len() != 3 {
		t.Fatalf("registry after restart = %d, want 3", reg.Len())
	}

	// 4) Save positions (GET snapshot).
	getRec := httptest.NewRecorder()
	mux.ServeHTTP(getRec, httptest.NewRequest(http.MethodGet, "/api/game/positions", nil))
	if getRec.Code != http.StatusOK {
		t.Fatalf("positions get status %d body %s", getRec.Code, getRec.Body.String())
	}
	var saved gameremote.ElementPositions
	if err := json.Unmarshal(getRec.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Ball.X != savedBall.X || saved.Ball.Y != savedBall.Y {
		t.Fatalf("saved ball = %#v, want %#v", saved.Ball, savedBall)
	}

	// 5) Reset: positions + shot clock clear; scores/turns unchanged.
	// Move elements first so reset is observable.
	remote.mu.Lock()
	remote.snapshot.Ball.Position = &proto.Point{X: 1, Y: 2}
	remote.snapshot.HomeTeam.Players[0].Position = &proto.Point{X: 3, Y: 4}
	remote.snapshot.AwayTeam.Players[0].Position = &proto.Point{X: 5, Y: 6}
	remote.snapshot.ShotClock = &proto.ShotClock{TeamSide: proto.Team_AWAY, RemainingTurns: 4}
	remote.mu.Unlock()

	resetRec := httptest.NewRecorder()
	mux.ServeHTTP(resetRec, httptest.NewRequest(http.MethodPost, "/api/game/reset", nil))
	if resetRec.Code != http.StatusOK {
		t.Fatalf("reset status %d body %s", resetRec.Code, resetRec.Body.String())
	}
	center := field.FieldCenter()
	remote.mu.Lock()
	if remote.calls != 1 {
		t.Fatalf("ResetPlayerPositions calls = %d", remote.calls)
	}
	if remote.snapshot.ShotClock != nil {
		t.Fatalf("shot clock after reset = %#v", remote.snapshot.ShotClock)
	}
	if remote.snapshot.Turn != wantTurn ||
		remote.snapshot.HomeTeam.Score != wantHomeScore ||
		remote.snapshot.AwayTeam.Score != wantAwayScore {
		t.Fatalf("scores/turn changed: turn=%d home=%d away=%d",
			remote.snapshot.Turn, remote.snapshot.HomeTeam.Score, remote.snapshot.AwayTeam.Score)
	}
	if remote.snapshot.Ball.Position == nil ||
		remote.snapshot.Ball.Position.X != center.X ||
		remote.snapshot.Ball.Position.Y != center.Y {
		t.Fatalf("ball after reset = %#v, want center %#v", remote.snapshot.Ball.Position, center)
	}
	remote.mu.Unlock()

	// 6) Apply previously saved positions.
	remote.mu.Lock()
	remote.snapshot.Ball.Position = &proto.Point{X: 9, Y: 9}
	remote.snapshot.HomeTeam.Players[0].Position = &proto.Point{X: 8, Y: 8}
	remote.snapshot.AwayTeam.Players[0].Position = &proto.Point{X: 7, Y: 7}
	remote.mu.Unlock()

	applyBody, err := json.Marshal(saved)
	if err != nil {
		t.Fatal(err)
	}
	applyRec := httptest.NewRecorder()
	applyReq := httptest.NewRequest(http.MethodPost, "/api/game/positions", bytes.NewReader(applyBody))
	mux.ServeHTTP(applyRec, applyReq)
	if applyRec.Code != http.StatusOK {
		t.Fatalf("positions apply status %d body %s", applyRec.Code, applyRec.Body.String())
	}

	remote.mu.Lock()
	defer remote.mu.Unlock()
	if remote.snapshot.Ball.Position == nil ||
		remote.snapshot.Ball.Position.X != savedBall.X ||
		remote.snapshot.Ball.Position.Y != savedBall.Y {
		t.Fatalf("ball after apply = %#v, want %#v", remote.snapshot.Ball.Position, savedBall)
	}
	gotHome := remote.snapshot.HomeTeam.Players[0].Position
	if gotHome == nil || gotHome.X != savedHome.X || gotHome.Y != savedHome.Y {
		t.Fatalf("home after apply = %#v, want %#v", gotHome, savedHome)
	}
	gotAway := remote.snapshot.AwayTeam.Players[0].Position
	if gotAway == nil || gotAway.X != savedAway.X || gotAway.Y != savedAway.Y {
		t.Fatalf("away after apply = %#v, want %#v", gotAway, savedAway)
	}
}
