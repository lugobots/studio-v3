package dev

import (
	"context"
	"github.com/lugobots/lugo4go/v3/field"
	"github.com/lugobots/lugo4go/v3/helpers"
	"github.com/pkg/errors"
	"time"

	"github.com/lugobots/lugo4go/v3/proto"

	googleProto "github.com/golang/protobuf/proto"
	"github.com/lugobots/server/v2/machine"
)

const MaxWaitGoto = 50 * time.Second

func NewRemote(snapshot *proto.GameSnapshot, bug machine.Debugger, mutator machine.Mutator) *Remote {
	return &Remote{
		Snapshot: snapshot,
		Debugger: bug,
		Mutator:  mutator,
	}
}

type Remote struct {
	proto.UnimplementedRemoteServer
	Snapshot *proto.GameSnapshot
	Debugger machine.Debugger
	Mutator  machine.Mutator
}

func (c *Remote) ResumeListeningPhase(ctx context.Context, request *proto.ResumeListeningRequest) (*proto.ResumeListeningResponse, error) {
	c.Debugger.ResumeListeningPhase()
	return &proto.ResumeListeningResponse{}, nil
}

func (c *Remote) PauseOrResume(ctx context.Context, _ *proto.PauseResumeRequest) (*proto.CommandResponse, error) {
	if err := c.Debugger.Close(); err == ErrBrkPointAlreadyClosed {
		go c.NextTurn(ctx, nil)
	}
	return &proto.CommandResponse{
		GameSnapshot: c.Snapshot,
		Code:         proto.CommandResponse_SUCCESS,
	}, nil
}

func (c *Remote) NextTurn(ctx context.Context, _ *proto.NextTurnRequest) (*proto.CommandResponse, error) {
	ctxTimeOut, _ := context.WithTimeout(ctx, MaxWaitGoto)
	if c.Debugger.StopAt(ctxTimeOut, proto.EventDebugBreakpoint_TURN) {
		return &proto.CommandResponse{
			GameSnapshot: c.Snapshot,
			Code:         proto.CommandResponse_SUCCESS,
		}, nil
	}
	return &proto.CommandResponse{
		GameSnapshot: c.Snapshot,
		Code:         proto.CommandResponse_DEADLINE_EXCEEDED,
		Details:      "command waited too long until the game be interrupted.",
	}, nil
}

func (c *Remote) NextOrder(ctx context.Context, _ *proto.NextOrderRequest) (*proto.CommandResponse, error) {
	ctxTimeOut, _ := context.WithTimeout(ctx, MaxWaitGoto)
	if c.Debugger.StopAt(ctxTimeOut, proto.EventDebugBreakpoint_ORDERS) {
		return &proto.CommandResponse{
			GameSnapshot: c.Snapshot,
			Code:         proto.CommandResponse_SUCCESS,
		}, nil
	}
	return &proto.CommandResponse{
		GameSnapshot: c.Snapshot,
		Code:         proto.CommandResponse_DEADLINE_EXCEEDED,
		Details:      "command waited too long until the game be interrupted.",
	}, nil
}

func (c *Remote) SetBallProperties(ctx context.Context, prop *proto.BallProperties) (*proto.CommandResponse, error) {
	resp := &proto.CommandResponse{
		GameSnapshot: c.Snapshot,
		Code:         proto.CommandResponse_SUCCESS,
	}
	c.Snapshot.Ball.Position = prop.Position
	if prop.Velocity != nil {
		c.Snapshot.Ball.Velocity = prop.Velocity
	}
	c.Snapshot.Ball.Holder = nil
	if prop.Holder != nil {
		player := helpers.GetPlayer(c.Snapshot, prop.Holder.TeamSide, int(prop.Holder.Number))
		resp.Details = "holder node found"
		if player != nil {
			c.Snapshot.Ball.Holder = player
			resp.Details = "holder replaced"
		}
	}
	return resp, nil
}

func (c *Remote) SetPlayerProperties(ctx context.Context, prop *proto.PlayerProperties) (*proto.CommandResponse, error) {
	player := helpers.GetPlayer(c.Snapshot, prop.Side, int(prop.Number))
	if player == nil {
		return &proto.CommandResponse{
			GameSnapshot: c.Snapshot,
			Code:         proto.CommandResponse_INVALID_VALUE,
			Details:      "player not found",
		}, nil
	}

	c.Mutator.SetPlayerPosition(player, proto.Point{
		X: prop.Position.X,
		Y: prop.Position.Y,
	}, nil)

	//if prop.Velocity != nil {
	//	player.Velocity = prop.Velocity
	//}
	return &proto.CommandResponse{
		GameSnapshot: c.Snapshot,
		Code:         proto.CommandResponse_SUCCESS,
	}, nil
}

func (c *Remote) SetGameProperties(ctx context.Context, prop *proto.GameProperties) (*proto.CommandResponse, error) {
	c.Snapshot.Turn = prop.Turn
	c.Snapshot.HomeTeam.Score = prop.HomeScore
	c.Snapshot.AwayTeam.Score = prop.AwayScore

	return &proto.CommandResponse{
		GameSnapshot: c.Snapshot,
		Code:         proto.CommandResponse_SUCCESS,
	}, nil
}

func (c *Remote) ResetPlayerPositions(ctx context.Context, request *proto.ResetPlayerPositionsRequest) (*proto.ResetPlayerPositionsResponse, error) {
	center := field.FieldCenter()
	goingNorth := proto.NewZeroedVelocity(proto.North())
	c.Snapshot.Ball.Position = &center
	c.Snapshot.Ball.Velocity = &goingNorth
	c.Snapshot.Ball.Holder = nil

	c.Snapshot.ShotClock = nil

	for _, player := range c.Snapshot.AwayTeam.Players {
		*player.Position = *player.InitPosition
	}
	for _, player := range c.Snapshot.HomeTeam.Players {
		*player.Position = *player.InitPosition
	}
	return &proto.ResetPlayerPositionsResponse{
		GameSnapshot: c.Snapshot,
	}, nil
}

func (c *Remote) ResetGame(ctx context.Context, request *proto.ResetGameRequest) (*proto.CommandResponse, error) {
	_, err := c.ResetPlayerPositions(ctx, &proto.ResetPlayerPositionsRequest{})
	if err != nil {
		return nil, errors.Wrap(err, "failed to reset player positions")
	}
	c.Debugger.WaitResetGame(ctx)
	c.Snapshot.Turn = 1
	c.Snapshot.HomeTeam.Score = 0
	c.Snapshot.AwayTeam.Score = 0
	return &proto.CommandResponse{
		GameSnapshot: c.Snapshot,
	}, nil
}

func (c *Remote) GetGameSnapshot(ctx context.Context, request *proto.GameSnapshotRequest) (*proto.GameSnapshotResponse, error) {
	release := c.Mutator.LockSnapshotForReading(ctx)
	defer release()
	m := googleProto.Clone(c.Snapshot)
	return &proto.GameSnapshotResponse{
		GameSnapshot: m.(*proto.GameSnapshot),
	}, nil
}
