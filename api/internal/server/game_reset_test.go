package server

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"

	"github.com/lugobots/lugo4go/v3/field"
	"github.com/lugobots/lugo4go/v3/proto"
	"google.golang.org/grpc"

	"studio-v3/api/internal/procreg"
)

// remoteFake implements Remote.ResetPlayerPositions with the same outcomes as
// the game-server Remote path: init positions, ball center, shot clock clear;
// scores and turn left unchanged.
type remoteFake struct {
	proto.UnimplementedRemoteServer
	mu       sync.Mutex
	snapshot *proto.GameSnapshot
	calls    int
}

func (f *remoteFake) ResetPlayerPositions(_ context.Context, _ *proto.ResetPlayerPositionsRequest) (*proto.ResetPlayerPositionsResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++

	center := field.FieldCenter()
	goingNorth := proto.NewZeroedVelocity(proto.North())
	f.snapshot.Ball.Position = &center
	f.snapshot.Ball.Velocity = &goingNorth
	f.snapshot.Ball.Holder = nil
	f.snapshot.ShotClock = nil

	for _, player := range f.snapshot.AwayTeam.Players {
		*player.Position = *player.InitPosition
	}
	for _, player := range f.snapshot.HomeTeam.Players {
		*player.Position = *player.InitPosition
	}
	return &proto.ResetPlayerPositionsResponse{GameSnapshot: f.snapshot}, nil
}

func (f *remoteFake) GetGameSnapshot(_ context.Context, _ *proto.GameSnapshotRequest) (*proto.GameSnapshotResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return &proto.GameSnapshotResponse{GameSnapshot: f.snapshot}, nil
}

func (f *remoteFake) SetBallProperties(_ context.Context, prop *proto.BallProperties) (*proto.CommandResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.snapshot.Ball == nil {
		f.snapshot.Ball = &proto.Ball{}
	}
	if prop.Position != nil {
		pos := *prop.Position
		f.snapshot.Ball.Position = &pos
	}
	f.snapshot.Ball.Velocity = prop.Velocity
	f.snapshot.Ball.Holder = nil
	return &proto.CommandResponse{GameSnapshot: f.snapshot, Code: proto.CommandResponse_SUCCESS}, nil
}

func (f *remoteFake) SetPlayerProperties(_ context.Context, prop *proto.PlayerProperties) (*proto.CommandResponse, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var team *proto.Team
	switch prop.Side {
	case proto.Team_HOME:
		team = f.snapshot.HomeTeam
	case proto.Team_AWAY:
		team = f.snapshot.AwayTeam
	}
	if team == nil {
		return &proto.CommandResponse{GameSnapshot: f.snapshot, Code: proto.CommandResponse_INVALID_VALUE}, nil
	}
	for _, player := range team.Players {
		if player != nil && player.Number == prop.Number {
			if prop.Position != nil {
				pos := *prop.Position
				player.Position = &pos
			}
			return &proto.CommandResponse{GameSnapshot: f.snapshot, Code: proto.CommandResponse_SUCCESS}, nil
		}
	}
	return &proto.CommandResponse{GameSnapshot: f.snapshot, Code: proto.CommandResponse_INVALID_VALUE}, nil
}

func startRemoteFake(t *testing.T, snap *proto.GameSnapshot) (*remoteFake, int) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	fake := &remoteFake{snapshot: snap}
	srv := grpc.NewServer()
	proto.RegisterRemoteServer(srv, fake)
	go func() { _ = srv.Serve(ln) }()
	t.Cleanup(srv.Stop)
	return fake, port
}

func testSnapshotForReset() *proto.GameSnapshot {
	homeInit := &proto.Point{X: 100, Y: 200}
	awayInit := &proto.Point{X: 800, Y: 400}
	return &proto.GameSnapshot{
		Turn: 42,
		HomeTeam: &proto.Team{
			Score: 3,
			Side:  proto.Team_HOME,
			Players: []*proto.Player{{
				Number:       1,
				TeamSide:     proto.Team_HOME,
				InitPosition: homeInit,
				Position:     &proto.Point{X: 555, Y: 666},
			}},
		},
		AwayTeam: &proto.Team{
			Score: 2,
			Side:  proto.Team_AWAY,
			Players: []*proto.Player{{
				Number:       7,
				TeamSide:     proto.Team_AWAY,
				InitPosition: awayInit,
				Position:     &proto.Point{X: 111, Y: 222},
			}},
		},
		Ball: &proto.Ball{
			Position: &proto.Point{X: 333, Y: 444},
			Holder:   &proto.Player{Number: 1, TeamSide: proto.Team_HOME},
		},
		ShotClock: &proto.ShotClock{
			TeamSide:       proto.Team_HOME,
			RemainingTurns: 9,
		},
	}
}

func TestGameResetCallsRemoteResetPlayerPositions(t *testing.T) {
	snap := testSnapshotForReset()
	wantHomeScore, wantAwayScore, wantTurn := snap.HomeTeam.Score, snap.AwayTeam.Score, snap.Turn
	homeInit := *snap.HomeTeam.Players[0].InitPosition
	awayInit := *snap.AwayTeam.Players[0].InitPosition
	center := field.FieldCenter()

	fake, port := startRemoteFake(t, snap)
	t.Setenv("LUGO_STUDIO_GAME_SERVER_PORT", strconv.Itoa(port))
	t.Setenv("LUGO_STUDIO_GAME_FRONTEND_PORT", "8809")

	mux := NewMuxWith(Deps{
		Registry: procreg.New(),
		Starter:  &fakeStarter{running: true},
		Match:    &fakeMatch{},
	})

	req := httptest.NewRequest(http.MethodPost, "/api/game/reset", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["status"] != "OK" {
		t.Fatalf("body = %#v", body)
	}

	fake.mu.Lock()
	defer fake.mu.Unlock()
	if fake.calls != 1 {
		t.Fatalf("ResetPlayerPositions calls = %d", fake.calls)
	}
	got := fake.snapshot
	if got.ShotClock != nil {
		t.Fatalf("shot clock = %#v, want cleared", got.ShotClock)
	}
	if got.Turn != wantTurn {
		t.Fatalf("turn = %d, want %d (unchanged)", got.Turn, wantTurn)
	}
	if got.HomeTeam.Score != wantHomeScore || got.AwayTeam.Score != wantAwayScore {
		t.Fatalf("scores home=%d away=%d, want home=%d away=%d",
			got.HomeTeam.Score, got.AwayTeam.Score, wantHomeScore, wantAwayScore)
	}
	if got.Ball.Holder != nil {
		t.Fatalf("ball holder = %#v, want nil", got.Ball.Holder)
	}
	if got.Ball.Position == nil || got.Ball.Position.X != center.X || got.Ball.Position.Y != center.Y {
		t.Fatalf("ball position = %#v, want center %#v", got.Ball.Position, center)
	}
	hp := got.HomeTeam.Players[0].Position
	if hp == nil || hp.X != homeInit.X || hp.Y != homeInit.Y {
		t.Fatalf("home player position = %#v, want init %#v", hp, homeInit)
	}
	ap := got.AwayTeam.Players[0].Position
	if ap == nil || ap.X != awayInit.X || ap.Y != awayInit.Y {
		t.Fatalf("away player position = %#v, want init %#v", ap, awayInit)
	}
}

func TestGameResetRequiresRunningServer(t *testing.T) {
	mux := NewMuxWith(Deps{
		Registry: procreg.New(),
		Starter:  &fakeStarter{running: false},
		Match:    &fakeMatch{},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/game/reset", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status %d body %s, want 409", rec.Code, rec.Body.String())
	}
}
