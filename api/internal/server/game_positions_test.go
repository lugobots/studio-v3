package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/lugobots/lugo4go/v3/proto"

	"studio-v3/api/internal/gameremote"
	"studio-v3/api/internal/procreg"
)

func TestGamePositionsRoundTripApplyRestoresSnapshot(t *testing.T) {
	snap := testSnapshotForReset()
	savedBall := *snap.Ball.Position
	savedHome := *snap.HomeTeam.Players[0].Position
	savedAway := *snap.AwayTeam.Players[0].Position

	fake, port := startRemoteFake(t, snap)
	t.Setenv("LUGO_STUDIO_GAME_SERVER_PORT", strconv.Itoa(port))
	t.Setenv("LUGO_STUDIO_GAME_FRONTEND_PORT", "8809")

	mux := NewMuxWith(Deps{
		Registry: procreg.New(),
		Starter:  &fakeStarter{running: true},
		Match:    &fakeMatch{},
	})

	// Capture current elements via GET.
	getReq := httptest.NewRequest(http.MethodGet, "/api/game/positions", nil)
	getRec := httptest.NewRecorder()
	mux.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("get status %d body %s", getRec.Code, getRec.Body.String())
	}
	var saved gameremote.ElementPositions
	if err := json.Unmarshal(getRec.Body.Bytes(), &saved); err != nil {
		t.Fatal(err)
	}
	if saved.Ball.X != savedBall.X || saved.Ball.Y != savedBall.Y {
		t.Fatalf("saved ball = %#v, want %#v", saved.Ball, savedBall)
	}
	if got := saved.HomeTeam[1]; got.X != savedHome.X || got.Y != savedHome.Y {
		t.Fatalf("saved home = %#v, want %#v", got, savedHome)
	}
	if got := saved.AwayTeam[7]; got.X != savedAway.X || got.Y != savedAway.Y {
		t.Fatalf("saved away = %#v, want %#v", got, savedAway)
	}

	// Move elements away from the saved snapshot on the Remote fake.
	fake.mu.Lock()
	fake.snapshot.Ball.Position = &proto.Point{X: 1, Y: 2}
	fake.snapshot.HomeTeam.Players[0].Position = &proto.Point{X: 3, Y: 4}
	fake.snapshot.AwayTeam.Players[0].Position = &proto.Point{X: 5, Y: 6}
	fake.mu.Unlock()

	body, err := json.Marshal(saved)
	if err != nil {
		t.Fatal(err)
	}
	applyReq := httptest.NewRequest(http.MethodPost, "/api/game/positions", bytes.NewReader(body))
	applyRec := httptest.NewRecorder()
	mux.ServeHTTP(applyRec, applyReq)
	if applyRec.Code != http.StatusOK {
		t.Fatalf("apply status %d body %s", applyRec.Code, applyRec.Body.String())
	}
	var applyBody map[string]string
	if err := json.Unmarshal(applyRec.Body.Bytes(), &applyBody); err != nil {
		t.Fatal(err)
	}
	if applyBody["status"] != "OK" {
		t.Fatalf("apply body = %#v", applyBody)
	}

	fake.mu.Lock()
	defer fake.mu.Unlock()
	gotBall := fake.snapshot.Ball.Position
	if gotBall == nil || gotBall.X != savedBall.X || gotBall.Y != savedBall.Y {
		t.Fatalf("ball after apply = %#v, want %#v", gotBall, savedBall)
	}
	gotHome := fake.snapshot.HomeTeam.Players[0].Position
	if gotHome == nil || gotHome.X != savedHome.X || gotHome.Y != savedHome.Y {
		t.Fatalf("home after apply = %#v, want %#v", gotHome, savedHome)
	}
	gotAway := fake.snapshot.AwayTeam.Players[0].Position
	if gotAway == nil || gotAway.X != savedAway.X || gotAway.Y != savedAway.Y {
		t.Fatalf("away after apply = %#v, want %#v", gotAway, savedAway)
	}
}

func TestGamePositionsRequiresRunningServer(t *testing.T) {
	mux := NewMuxWith(Deps{
		Registry: procreg.New(),
		Starter:  &fakeStarter{running: false},
		Match:    &fakeMatch{},
	})

	getReq := httptest.NewRequest(http.MethodGet, "/api/game/positions", nil)
	getRec := httptest.NewRecorder()
	mux.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusConflict {
		t.Fatalf("get status %d, want 409", getRec.Code)
	}

	applyReq := httptest.NewRequest(http.MethodPost, "/api/game/positions",
		bytes.NewReader([]byte(`{"ball":{"x":1,"y":2},"homeTeam":{},"awayTeam":{}}`)))
	applyRec := httptest.NewRecorder()
	mux.ServeHTTP(applyRec, applyReq)
	if applyRec.Code != http.StatusConflict {
		t.Fatalf("apply status %d, want 409", applyRec.Code)
	}
}
