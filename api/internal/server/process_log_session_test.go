package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"studio-v3/api/internal/bots"
	"studio-v3/api/internal/gameruntime"
	"studio-v3/api/internal/procreg"
)

func TestProcessLogArmingSessionOnlyFreshMux(t *testing.T) {
	hubA := newProcessLogHub()
	hubB := newProcessLogHub()
	regA := procreg.New()
	regB := procreg.New()
	muxA := NewMuxWith(Deps{Registry: regA, Starter: gameruntime.New(regA), Match: bots.New(regA), Logs: hubA})
	_ = NewMuxWith(Deps{Registry: regB, Starter: gameruntime.New(regB), Match: bots.New(regB), Logs: hubB})

	body, _ := json.Marshal(map[string]string{"source": "server"})
	req := httptest.NewRequest(http.MethodPost, "/api/logs/arm", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	muxA.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("arm status %d body %s", rr.Code, rr.Body.String())
	}
	if !hubA.Armed("server") {
		t.Fatal("hubA should be armed")
	}
	// Fresh API process / mux uses its own hub — prior arming must not appear.
	if hubB.Armed("server") {
		t.Fatal("hubB (fresh process) must start disarmed")
	}
	if err := hubA.Arm("home/1"); err != nil {
		t.Fatal(err)
	}
	if hubB.Armed("home/1") {
		t.Fatal("hubB must not inherit bot arming from hubA")
	}
}

func TestProcessLogArmDoesNotAppearInMatchSettingsShape(t *testing.T) {
	// matchSettingsForApi (client) only exposes team_side / skip_to_golden_goal /
	// game_speed / opponent_mode. Confirm server MatchSettings JSON tags match
	// that contract and process-log arming is not a match-settings field.
	raw, err := json.Marshal(gameruntime.MatchSettings{
		TeamSide:         gameruntime.TeamSideHome,
		SkipToGoldenGoal: true,
		GameSpeed:        gameruntime.GameSpeedNormal,
		OpponentMode:     gameruntime.OpponentModeDefault,
	})
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"server_logs", "logs", "armed", "debug_mode", "home_bots_logs"} {
		if _, ok := m[key]; ok {
			t.Fatalf("match settings unexpectedly includes %q", key)
		}
	}
	for _, key := range []string{"team_side", "skip_to_golden_goal", "game_speed", "opponent_mode"} {
		if _, ok := m[key]; !ok {
			t.Fatalf("match settings missing %q", key)
		}
	}
}

func TestProcessLogArmHTTPWiresSharedHubToProducers(t *testing.T) {
	reg := procreg.New()
	starter := gameruntime.New(reg)
	match := bots.New(reg)
	hub := newProcessLogHub()
	mux := NewMuxWith(Deps{Registry: reg, Starter: starter, Match: match, Logs: hub})

	if starter.Logs != hub {
		t.Fatal("gameruntime.Local.Logs not wired to shared hub")
	}
	if match.Logs != hub {
		t.Fatal("bots.Manager.Logs not wired to shared hub")
	}

	body, _ := json.Marshal(map[string]string{"source": "server"})
	req := httptest.NewRequest(http.MethodPost, "/api/logs/arm", bytes.NewReader(body))
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("arm status %d body %s", rr.Code, rr.Body.String())
	}
	if !hub.Armed("server") {
		t.Fatal("hub not armed after HTTP arm")
	}
	if !starter.Logs.Armed("server") {
		t.Fatal("starter sink should observe armed server source")
	}
}
