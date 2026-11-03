package lugo4go

import (
	"fmt"
	"github.com/lugobots/lugo4go/v3/helpers"

	"github.com/lugobots/lugo4go/v3/field"
	"github.com/lugobots/lugo4go/v3/proto"
	"github.com/lugobots/lugo4go/v3/specs"
)

type inspector struct {
	mySide   proto.Team_Side
	myNumber int
	me       *proto.Player
	snapshot *proto.GameSnapshot
}

func NewGameSnapshotInspector(botSide proto.Team_Side, playerNumber int, gameSnapshot *proto.GameSnapshot) (SnapshotInspector, error) {
	tools := &inspector{mySide: botSide, myNumber: playerNumber, snapshot: gameSnapshot}

	me := tools.GetPlayer(botSide, playerNumber)
	if me == nil {
		return nil, fmt.Errorf("could not to find the player %s-%d", botSide, playerNumber)
	}
	tools.me = me
	return tools, nil
}

func (i *inspector) GetSnapshot() *proto.GameSnapshot {
	return i.snapshot
}

func (i *inspector) GetMe() *proto.Player {
	return i.me
}

func (i *inspector) GetBall() *proto.Ball {
	return i.snapshot.GetBall()
}

func (i *inspector) GetBallHolder() (*proto.Player, bool) {
	return helpers.GetBallHolder(i.snapshot)
}

func (i *inspector) IsBallHolder(player *proto.Player) bool {
	return helpers.IsBallHolder(i.snapshot, player)
}

func (i *inspector) GetTeam(side proto.Team_Side) *proto.Team {
	return helpers.GetTeam(i.snapshot, side)
}

func (i *inspector) GetMyTeam() *proto.Team {
	return i.GetTeam(i.mySide)
}

func (i *inspector) GetOpponentTeam() *proto.Team {
	return i.GetTeam(i.GetOpponentSide())
}

func (i *inspector) GetMyTeamSide() proto.Team_Side {
	return i.mySide
}

func (i *inspector) GetOpponentSide() proto.Team_Side {
	return helpers.GetOpponentSide(i.mySide)
}

func (i *inspector) GetPlayer(side proto.Team_Side, number int) *proto.Player {
	return helpers.GetPlayer(i.snapshot, side, number)
}

func (i *inspector) GetMyTeamPlayers() []*proto.Player {
	return i.GetTeam(i.mySide).Players
}

func (i *inspector) GetOpponentPlayers() []*proto.Player {
	return i.GetTeam(i.GetOpponentSide()).Players
}

func (i *inspector) GetMyTeamGoalkeeper() *proto.Player {
	return i.GetPlayer(i.GetMyTeamSide(), int(specs.GoalkeeperNumber))
}

func (i *inspector) GetOpponentGoalkeeper() *proto.Player {
	return i.GetPlayer(i.GetOpponentSide(), int(specs.GoalkeeperNumber))
}

func (i *inspector) MakeOrderMove(target proto.Point, speed float64) (*proto.Order_Move, error) {
	return i.MakeOrderMoveFromPoint(*i.me.Position, target, speed)
}

func (i *inspector) MakeOrderMoveMaxSpeed(target proto.Point) (*proto.Order_Move, error) {
	return i.MakeOrderMoveFromPoint(*i.me.Position, target, specs.PlayerMaxSpeed)
}

func (i *inspector) MakeOrderMoveFromPoint(origin, target proto.Point, speed float64) (*proto.Order_Move, error) {
	vec, err := proto.NewVector(origin, target)
	if err != nil {
		return nil, err
	}
	vel := proto.NewZeroedVelocity(*vec.Normalize())
	vel.Speed = speed
	return &proto.Order_Move{Move: &proto.Move{Velocity: &vel}}, nil
}

func (i *inspector) MakeOrderMoveFromVector(vector proto.Vector, speed float64) *proto.Order_Move {
	targetPoint := vector.TargetFrom(*i.me.Position)
	// no need to check for errors since a vector will always lead to a valid destination
	order, _ := i.MakeOrderMoveFromPoint(*i.me.Position, targetPoint, speed)
	return order
}

func (i *inspector) MakeOrderMoveByDirection(direction field.Direction, speed float64) *proto.Order_Move {
	directionTarget := directionOrientationMap[i.mySide][direction]
	// no need to check for errors since the vector is known and valid
	return i.MakeOrderMoveFromVector(proto.Vector(directionTarget), speed)
}

func (i *inspector) MakeOrderMoveToStop() *proto.Order_Move {
	myDirection := i.GetMe().GetVelocity().GetDirection()
	if myDirection == nil {
		v := proto.Vector(directionOrientationMap[i.mySide][field.Forward])
		myDirection = &v
	}
	return i.MakeOrderMoveFromVector(*myDirection, 0)
}

func (i *inspector) MakeOrderJump(target proto.Point, speed float64) (*proto.Order_Jump, error) {
	vec, err := proto.NewVector(*i.me.Position, target)
	if err != nil {
		return nil, err
	}
	vel := proto.NewZeroedVelocity(*vec.Normalize())
	vel.Speed = speed
	return &proto.Order_Jump{Jump: &proto.Jump{Velocity: &vel}}, nil
}

func (i *inspector) MakeOrderKick(target proto.Point, speed float64) (*proto.Order_Kick, error) {
	ballExpectedDirection, err := proto.NewVector(*i.snapshot.GetBall().Position, target)
	if err != nil {
		return nil, err
	}

	diffVector, err := ballExpectedDirection.Sub(i.snapshot.GetBall().Velocity.Direction)
	if err != nil {
		return nil, err
	}
	vel := proto.NewZeroedVelocity(*diffVector)
	vel.Direction.Normalize()
	vel.Speed = speed

	return &proto.Order_Kick{Kick: &proto.Kick{Velocity: &vel}}, nil
}

func (i *inspector) MakeOrderKickMaxSpeed(target proto.Point) (*proto.Order_Kick, error) {
	return i.MakeOrderKick(target, specs.BallMaxSpeed)
}

func (i *inspector) MakeOrderCatch() *proto.Order_Catch {
	return &proto.Order_Catch{Catch: &proto.Catch{}}
}

var directionOrientationMap = map[proto.Team_Side]map[field.Direction]field.Orientation{
	proto.Team_HOME: {
		field.Forward:       field.East,
		field.Backward:      field.West,
		field.Left:          field.North,
		field.Right:         field.South,
		field.BackwardLeft:  field.NorthWest,
		field.BackwardRight: field.SouthWest,
		field.ForwardLeft:   field.NorthEast,
		field.ForwardRight:  field.SouthEast,
	},
	proto.Team_AWAY: {
		field.Forward:       field.West,
		field.Backward:      field.East,
		field.Left:          field.South,
		field.Right:         field.North,
		field.BackwardLeft:  field.SouthEast,
		field.BackwardRight: field.NorthEast,
		field.ForwardLeft:   field.SouthWest,
		field.ForwardRight:  field.NorthWest,
	},
}
