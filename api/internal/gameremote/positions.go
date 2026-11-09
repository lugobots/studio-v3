package gameremote

import (
	"context"
	"fmt"

	"github.com/lugobots/lugo4go/v3/proto"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// ElementPositions is a JSON-friendly snapshot of ball and player coordinates,
// matching Studio V2's GameElementsPositions shape for saved presets.
type ElementPositions struct {
	Ball     proto.Point         `json:"ball"`
	HomeTeam map[int]proto.Point `json:"homeTeam"`
	AwayTeam map[int]proto.Point `json:"awayTeam"`
}

// GetElementPositions reads the current ball and player positions via Remote.GetGameSnapshot.
func GetElementPositions(ctx context.Context, addr string) (ElementPositions, error) {
	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return ElementPositions{}, fmt.Errorf("dial game server remote: %w", err)
	}
	defer conn.Close()

	client := proto.NewRemoteClient(conn)
	resp, err := client.GetGameSnapshot(ctx, &proto.GameSnapshotRequest{})
	if err != nil {
		return ElementPositions{}, fmt.Errorf("get game snapshot: %w", err)
	}
	if resp == nil || resp.GameSnapshot == nil {
		return ElementPositions{}, fmt.Errorf("get game snapshot: empty response")
	}
	return positionsFromSnapshot(resp.GameSnapshot), nil
}

// SetElementPositions applies ball and player positions via Remote SetBallProperties
// and SetPlayerProperties.
func SetElementPositions(ctx context.Context, addr string, positions ElementPositions) error {
	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return fmt.Errorf("dial game server remote: %w", err)
	}
	defer conn.Close()

	client := proto.NewRemoteClient(conn)
	ball := positions.Ball
	if _, err := client.SetBallProperties(ctx, &proto.BallProperties{
		Position: &ball,
		Velocity: nil,
		Holder:   nil,
	}); err != nil {
		return fmt.Errorf("set ball properties: %w", err)
	}

	for number, point := range positions.HomeTeam {
		p := point
		if _, err := client.SetPlayerProperties(ctx, &proto.PlayerProperties{
			Side:     proto.Team_HOME,
			Number:   uint32(number),
			Position: &p,
			Velocity: nil,
		}); err != nil {
			return fmt.Errorf("set home player %d: %w", number, err)
		}
	}
	for number, point := range positions.AwayTeam {
		p := point
		if _, err := client.SetPlayerProperties(ctx, &proto.PlayerProperties{
			Side:     proto.Team_AWAY,
			Number:   uint32(number),
			Position: &p,
			Velocity: nil,
		}); err != nil {
			return fmt.Errorf("set away player %d: %w", number, err)
		}
	}
	return nil
}

func positionsFromSnapshot(snap *proto.GameSnapshot) ElementPositions {
	out := ElementPositions{
		HomeTeam: map[int]proto.Point{},
		AwayTeam: map[int]proto.Point{},
	}
	if snap.Ball != nil && snap.Ball.Position != nil {
		out.Ball = *snap.Ball.Position
	}
	if snap.HomeTeam != nil {
		for _, player := range snap.HomeTeam.Players {
			if player == nil || player.Position == nil {
				continue
			}
			out.HomeTeam[int(player.Number)] = *player.Position
		}
	}
	if snap.AwayTeam != nil {
		for _, player := range snap.AwayTeam.Players {
			if player == nil || player.Position == nil {
				continue
			}
			out.AwayTeam[int(player.Number)] = *player.Position
		}
	}
	return out
}
