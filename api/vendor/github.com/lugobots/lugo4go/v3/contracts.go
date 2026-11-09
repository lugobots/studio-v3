package lugo4go

import (
	"context"

	"github.com/lugobots/lugo4go/v3/field"
	"github.com/lugobots/lugo4go/v3/proto"
)

// RawBot is required by the Lugo4Go client to handle each turn snapshot
type RawBot interface {

	// TurnHandler is called every turn with the new game state
	TurnHandler(ctx context.Context, inspector SnapshotInspector) ([]proto.PlayerOrder, string, error)
	GetReadyHandler(ctx context.Context, inspector SnapshotInspector)
}

type Bot interface {
	// OnDisputing is called when no one has the ball possession
	OnDisputing(ctx context.Context, inspector SnapshotInspector) ([]proto.PlayerOrder, string, error)
	// OnDefending is called when an opponent player has the ball possession
	OnDefending(ctx context.Context, inspector SnapshotInspector) ([]proto.PlayerOrder, string, error)
	// OnHolding is called when this bot has the ball possession
	OnHolding(ctx context.Context, inspector SnapshotInspector) ([]proto.PlayerOrder, string, error)
	// OnSupporting is called when a teammate player has the ball possession
	OnSupporting(ctx context.Context, inspector SnapshotInspector) ([]proto.PlayerOrder, string, error)
	// AsGoalkeeper is only called when this bot is the goalkeeper (number 1). This method is called on every turn,
	// and the player state is passed at the last parameter.
	AsGoalkeeper(ctx context.Context, inspector SnapshotInspector, state PlayerState) ([]proto.PlayerOrder, string, error)

	OnGetReady(ctx context.Context, inspector SnapshotInspector)
}

type SnapshotInspector interface {
	GetSnapshot() *proto.GameSnapshot
	GetMe() *proto.Player

	GetBall() *proto.Ball
	GetBallHolder() (*proto.Player, bool)
	IsBallHolder(player *proto.Player) bool

	GetTeam(side proto.Team_Side) *proto.Team
	GetMyTeam() *proto.Team
	GetOpponentTeam() *proto.Team

	GetPlayer(side proto.Team_Side, number int) *proto.Player
	GetMyTeamPlayers() []*proto.Player
	GetOpponentPlayers() []*proto.Player

	GetMyTeamGoalkeeper() *proto.Player
	GetOpponentGoalkeeper() *proto.Player

	MakeOrderMove(target proto.Point, speed float64) (*proto.Order_Move, error)
	MakeOrderMoveMaxSpeed(target proto.Point) (*proto.Order_Move, error)
	MakeOrderMoveFromPoint(origin, target proto.Point, speed float64) (*proto.Order_Move, error)
	MakeOrderMoveFromVector(vector proto.Vector, speed float64) *proto.Order_Move
	MakeOrderMoveByDirection(direction field.Direction, speed float64) *proto.Order_Move
	MakeOrderMoveToStop() *proto.Order_Move

	MakeOrderJump(target proto.Point, speed float64) (*proto.Order_Jump, error)

	MakeOrderKick(target proto.Point, speed float64) (*proto.Order_Kick, error)

	MakeOrderKickMaxSpeed(target proto.Point) (*proto.Order_Kick, error)

	MakeOrderCatch() *proto.Order_Catch
}

type Logger interface {
	Debug(args ...interface{})
	Debugf(template string, args ...interface{})
	Infof(template string, args ...interface{})
	Warnf(template string, args ...interface{})
	Errorf(template string, args ...interface{})
	Fatalf(template string, args ...interface{})
}

type OrderSender interface {
	Send(ctx context.Context, turn uint32, orders []proto.PlayerOrder, debugMsg string) (*proto.OrderResponse, error)
}
