// Package gameremote dials the local game-server Remote service.
package gameremote

import (
	"context"
	"fmt"

	"github.com/lugobots/lugo4go/v3/proto"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// ResetPlayerPositions calls Remote.ResetPlayerPositions on the game server at
// addr (host:port). The server clears the shot clock, restores init positions,
// and centers the ball; scores and turn counter are left unchanged.
func ResetPlayerPositions(ctx context.Context, addr string) (*proto.GameSnapshot, error) {
	conn, err := grpc.NewClient(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, fmt.Errorf("dial game server remote: %w", err)
	}
	defer conn.Close()

	client := proto.NewRemoteClient(conn)
	resp, err := client.ResetPlayerPositions(ctx, &proto.ResetPlayerPositionsRequest{})
	if err != nil {
		return nil, fmt.Errorf("reset player positions: %w", err)
	}
	if resp == nil {
		return nil, nil
	}
	return resp.GameSnapshot, nil
}
