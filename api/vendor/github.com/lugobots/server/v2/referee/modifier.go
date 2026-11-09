package referee

import (
	"context"
	"fmt"
	"github.com/lugobots/lugo4go/v3/specs"
	"math"
	"sync"

	"github.com/lugobots/lugo4go/v3/field"
	"github.com/lugobots/lugo4go/v3/helpers"
	"github.com/lugobots/lugo4go/v3/proto"
	"github.com/twpayne/go-geom"
	"github.com/twpayne/go-geom/xy"
	"go.uber.org/zap"
)

func NewMutator(logger *zap.SugaredLogger) *Modifier {
	return &Modifier{
		logger: logger,
		locker: sync.Mutex{},
	}
}

type Modifier struct {
	locker sync.Mutex
	logger *zap.SugaredLogger
}

func (m *Modifier) LockSnapshotForReading(ctx context.Context) context.CancelFunc {
	m.locker.Lock()
	subCtx, subCancel := context.WithCancel(ctx)

	go func() {
		defer m.locker.Unlock()
		<-subCtx.Done()
	}()
	return subCancel
}

func (m *Modifier) ShiftPossession(snapshot *proto.GameSnapshot, logger *zap.SugaredLogger) {
	m.locker.Lock()
	defer m.locker.Unlock()
	if snapshot.ShotClock == nil {
		panic("wrong state: it cannot shit possetiong when shot clock is not set ")
	}
	snapshot.ShotClock = &proto.ShotClock{
		TeamSide:       helpers.GetOpponentSide(snapshot.ShotClock.TeamSide),
		RemainingTurns: specs.ShotClockTime,
	}

	goalkeeper := helpers.GetPlayer(snapshot, snapshot.ShotClock.TeamSide, int(specs.GoalkeeperNumber))

	snapshot.Ball.Holder = goalkeeper
	snapshot.Ball.Velocity.Speed = 0
	syncBallPositionWithHolder(snapshot.Ball)
	logger.
		With("team_granted", snapshot.ShotClock.TeamSide).
		Info("ball possetion shiftted")
}

func (m *Modifier) MoveBall(ball *proto.Ball) {
	m.locker.Lock()
	defer m.locker.Unlock()
	if ball.Holder != nil {
		// not moving by it own
		return
	}
	if ball.Velocity == nil || ball.Velocity.Speed == 0 {
		// the ball is stopped
		return
	}
	previousPos := *ball.Position
	// S = So + Vo*T + (a*T^2)/2
	// T is always 1 because I'm counting an instance
	distance := ball.Velocity.Speed - (specs.BallDeceleration / 2)
	if math.Abs(distance) > 0 {
		point, _ := ball.Velocity.Direction.SetLength(distance)
		*ball.Position = point.TargetFrom(*ball.Position)
		ball.Velocity.Direction.Normalize()
	}
	ball.Velocity.Speed -= specs.BallDeceleration
	if ball.Velocity.Speed < specs.BallMinSpeed {
		ball.Velocity.Speed = 0
	}

	//if is crossed the goal line, the position is not fixed
	if ball.Position.X <= 0 || ball.Position.X >= specs.MaxXCoordinate {
		crossLine := func(teamGoal field.Goal, initialPos, finalPos proto.Point) bool {
			goalLineA := geom.Coord{float64(teamGoal.BottomPole.X), float64(teamGoal.BottomPole.Y)}
			goalLineB := geom.Coord{float64(teamGoal.TopPole.X), float64(teamGoal.TopPole.Y)}
			ballTrackA := geom.Coord{float64(initialPos.X), float64(initialPos.Y)}
			ballTrackB := geom.Coord{float64(finalPos.X), float64(finalPos.Y)}
			return xy.DoLinesOverlap(goalLineA, goalLineB, ballTrackA, ballTrackB)
		}

		if crossLine(field.HomeSideTeamGoal(), previousPos, *ball.Position) ||
			crossLine(field.AwaySideTeamGoal(), previousPos, *ball.Position) {

			if ball.Position.X >= specs.MaxXCoordinate {
				ball.Position.X = specs.MaxXCoordinate
			} else {
				ball.Position.X = 0
			}
			return
		}
	}
	fixBallPosition(ball, previousPos) // keeps the ball inside the field
}

func (m *Modifier) SetPlayerPosition(player *proto.Player, position proto.Point, entry *zap.SugaredLogger) bool {
	m.locker.Lock()
	defer m.locker.Unlock()
	if player.Position.DistanceTo(position) == 0 {
		return false
	}

	if player.Number == specs.GoalkeeperNumber {

		player.Position.X = player.InitPosition.X
		player.Position.Y = int32(math.Min(float64(position.Y), float64(maxY)))
		player.Position.Y = int32(math.Max(float64(player.Position.Y), float64(minY)))
		return false
	} else if GoalZoneInvasion(position, field.HomeSideTeamGoal()) > 0 || GoalZoneInvasion(position, field.AwaySideTeamGoal()) > 0 {
		// don't move
		return true
	}
	player.Position = &position
	// @todo known bug: some players will get closer than others, because they can move 100pts by frame, and as soon
	// a collision is detected they are not allowed to move, so, some of them may be 99pts from the goalzone
	// while other ones may be just 1pt from that

	player.Position.X = int32(math.Min(float64(player.Position.X), float64(specs.MaxXCoordinate)))
	player.Position.X = int32(math.Max(float64(player.Position.X), float64(0)))
	player.Position.Y = int32(math.Min(float64(player.Position.Y), float64(specs.MaxYCoordinate)))
	player.Position.Y = int32(math.Max(float64(player.Position.Y), float64(0)))

	// why idoes it returns false?!?!?
	return false
}
func (m *Modifier) UpdatePlayerPosition(player *proto.Player, ball *proto.Ball, entry *zap.SugaredLogger) {
	previous := player.Position
	if player.Velocity != nil && player.Velocity.Speed > 0 {
		point := player.Velocity.GetNextPoint(*player.Position)
		if m.SetPlayerPosition(player, point, entry) {
			player.Velocity.Speed = 0
		}
		entry.Debugf(fmt.Sprintf("Moved from %s to %s \tVel: %s", previous, player.Position, player.Velocity))
		//} else {
		//entry.Infof(fmt.Sprintf("DIDNT MOVE  %s to %s \tVel: %s", previous, player.Position, player.Velocity))
	}
	// the locker cannot be before here because I may be used by SetPLayerPosition
	m.locker.Lock()
	defer m.locker.Unlock()
	if IsHoldingTheBall(player, ball) {
		syncBallPositionWithHolder(ball)
	}
}

func (m *Modifier) ResetElementPositions(snapshot *proto.GameSnapshot, entry *zap.SugaredLogger) {
	m.locker.Lock()
	defer m.locker.Unlock()
	center := field.FieldCenter()
	goingNorth := proto.NewZeroedVelocity(proto.North())
	snapshot.Ball.Position = &center
	snapshot.Ball.Velocity = &goingNorth
	snapshot.Ball.Holder = nil
	snapshot.ShotClock = nil

	for _, player := range snapshot.AwayTeam.Players {
		*player.Position = *player.InitPosition
	}
	for _, player := range snapshot.HomeTeam.Players {
		*player.Position = *player.InitPosition
	}
}

func (m *Modifier) ExecuteMoveOrder(player *proto.Player, ball *proto.Ball, move *proto.Move, entry *zap.SugaredLogger) {
	previous := player.Velocity.Copy()

	if move.Velocity.GetDirection().Length() == 0 {
		entry.
			With(zap.String("previous", fmt.Sprintf("%s", previous))).
			With(zap.String("new", fmt.Sprintf("%s", player.Velocity))).
			Warn("bot sent invalid move order, the velocity length is zero")
		return
	}

	updateUserVelocityProperties(player, move.Velocity, specs.PlayerMaxSpeed)
	m.UpdatePlayerPosition(player, ball, entry)
	entry.
		With(zap.String("previous", fmt.Sprintf("%s", previous))).
		With(zap.String("new", fmt.Sprintf("%s", player.Velocity))).
		Debugf("Move Order Executed")
}

func (m *Modifier) ExecuteJumpOrder(player *proto.Player, ball *proto.Ball, jump *proto.Jump, entry *zap.SugaredLogger) {
	if player.Number != specs.GoalkeeperNumber {
		// It's not keeper
		return
	}
	updateUserVelocityProperties(player, jump.Velocity, specs.GoalKeeperJumpSpeed)
	m.UpdatePlayerPosition(player, ball, entry)
	return
}

func (m *Modifier) ExecuteCatchOrder(snapshot *proto.GameSnapshot, player *proto.Player, catch *proto.Catch, entry *zap.SugaredLogger) bool {
	m.locker.Lock()
	defer m.locker.Unlock()

	dist := (specs.PlayerSize + specs.BallSize) / 2
	actualDistance := int(math.Abs(math.Round(player.Position.DistanceTo(*snapshot.Ball.Position))))

	caught := false
	if player.Number == 1 {
		bP := snapshot.Ball.Position
		playerP := player.Position
		goalkeeperSize := specs.GoalkeeperSize
		if snapshot.Period != proto.GameSnapshot_REGULAR_TIME {
			goalkeeperSize = specs.PlayerSize
		}
		distY := ((goalkeeperSize) + specs.BallSize) / 2
		if math.Abs(float64(bP.X)-float64(playerP.X)) <= float64(dist) {
			if math.Abs(float64(bP.Y)-float64(playerP.Y)) <= float64(distY) {
				caught = true
			}
		}
	}

	if actualDistance <= dist || caught {
		snapshot.Ball.Holder = player
		snapshot.Ball.Velocity.Speed = 0
		syncBallPositionWithHolder(snapshot.Ball)

		if snapshot.ShotClock == nil || snapshot.ShotClock.TeamSide != player.TeamSide {
			snapshot.ShotClock = &proto.ShotClock{
				TeamSide:       player.TeamSide,
				RemainingTurns: specs.ShotClockTime,
			}
		}

		return true
	}
	return false
}

func (m *Modifier) ExecuteKickOrder(ball *proto.Ball, player *proto.Player, kick *proto.Kick, entry *zap.SugaredLogger) {
	if IsHoldingTheBall(player, ball) {
		if kick.Velocity.Speed > specs.BallMaxSpeed {
			kick.Velocity.Speed = specs.BallMaxSpeed
			entry.Warnf("Requested ball speed is greater than the limit, setting to max (%.2f)", specs.BallMaxSpeed)
		}

		ang := math.Abs(player.Velocity.Direction.AngleWith(kick.Velocity.Direction))
		SpeedReducerFactor := 0.5 + (0.5 * ((180 - ang) / 180))
		kick.Velocity.Speed *= SpeedReducerFactor

		syncBallPositionWithHolder(ball)

		applyKickProperties(ball, kick.Velocity)
		m.MoveBall(ball)

		//entry.Infof("kicked the ball towards\t%s", ball.Velocity.Direction)
	}
}

func applyKickProperties(ball *proto.Ball, velocity *proto.Velocity) {

	ball.Holder = nil

	velocity.Speed = math.Abs(velocity.Speed)

	if ball.Velocity.Speed != 0 {
		ball.Velocity.Add(*velocity)
	} else {
		*ball.Velocity = *velocity
	}
	ball.Velocity.Direction.Normalize()

	if ball.Velocity.Speed > specs.BallMaxSpeed {
		ball.Velocity.Speed = specs.BallMaxSpeed
	}
}

func (m *Modifier) CheckGoal(snapshot *proto.GameSnapshot, entry *zap.SugaredLogger) (bool, proto.Team_Side) {
	m.locker.Lock()
	defer m.locker.Unlock()
	if snapshot.Ball.Holder == nil && snapshot.Ball.Position.Y >= specs.GoalMinY && snapshot.Ball.Position.Y <= specs.GoalMaxY {
		if snapshot.Ball.Position.X <= 0 {
			snapshot.AwayTeam.Score++
			return true, proto.Team_AWAY
		} else if snapshot.Ball.Position.X >= specs.MaxXCoordinate {
			snapshot.HomeTeam.Score++
			return true, proto.Team_HOME
		}
	}
	return false, proto.Team_AWAY
}

func (m *Modifier) WatchBallInGoalZone(ball *proto.Ball, currentCounter uint32) (newCounter uint32) {
	if GoalZoneInvasion(*ball.Position, field.HomeSideTeamGoal()) > 0 || GoalZoneInvasion(*ball.Position, field.AwaySideTeamGoal()) > 0 {
		currentCounter++
		if currentCounter >= specs.BallTimeInGoalZone {
			ball.Holder = nil
			ball.Velocity.Speed = 0

			dir, _ := proto.NewVector(*ball.Position, field.FieldCenter())
			vel := proto.NewZeroedVelocity(*dir)
			vel.Speed = specs.BallMaxSpeed
			applyKickProperties(ball, &vel)
			m.MoveBall(ball)
			currentCounter = 0
		}
		return currentCounter
	}
	return 0
}

func GoalZoneInvasion(elementPosition proto.Point, goal field.Goal) float64 {
	distX := math.Abs(float64(goal.Center.X - elementPosition.X))
	// if TRUE, it is in the imaginary rectangle.
	if elementPosition.Y > specs.GoalMinY-specs.GoalZoneRange && elementPosition.Y < specs.GoalMaxY+specs.GoalZoneRange && distX < specs.GoalZoneRange {
		if elementPosition.Y > specs.GoalMinY && elementPosition.Y < specs.GoalMaxY {
			return math.Max(distX, specs.GoalZoneRange-elementPosition.DistanceTo(goal.Center))
		} else {
			return specs.GoalZoneRange - math.Min(elementPosition.DistanceTo(goal.BottomPole), elementPosition.DistanceTo(goal.TopPole))
		}
	}
	return 0
}

func fixBallPosition(ball *proto.Ball, previousPos proto.Point) bool {
	var margin string

	if ball.Position.X < 0 {
		ball.Position.X *= -1
		margin = "left"
		_, _ = ball.Velocity.Direction.SetX(-1 * ball.Velocity.Direction.GetX())
	} else if ball.Position.X > specs.MaxXCoordinate {

		ball.Position.X = specs.MaxXCoordinate - (ball.Position.X - specs.MaxXCoordinate)

		margin = "right"
		_, _ = ball.Velocity.Direction.SetX(-1 * ball.Velocity.Direction.GetX())
	}

	if ball.Position.Y < 0 {
		ball.Position.Y *= -1
		margin = "bottom"
		_, _ = ball.Velocity.Direction.SetY(-1 * ball.Velocity.Direction.GetY())
	} else if ball.Position.Y > specs.MaxYCoordinate {

		ball.Position.Y = specs.MaxYCoordinate - (ball.Position.Y - specs.MaxYCoordinate)

		margin = "top"
		_, _ = ball.Velocity.Direction.SetY(-1 * ball.Velocity.Direction.GetY())
	}

	return margin != ""
}

func IsHoldingTheBall(player *proto.Player, ball *proto.Ball) bool {
	return ball.Holder != nil && ball.Holder.Number == player.Number && ball.Holder.TeamSide == player.TeamSide
}

func syncBallPositionWithHolder(ball *proto.Ball) {
	dir := proto.East()
	if ball.Holder.Number == specs.GoalkeeperNumber {
		if ball.Holder.TeamSide == proto.Team_AWAY {
			dir = proto.West()
		}
	} else {
		dir = *ball.Holder.Velocity.Direction
	}
	previousPos := *ball.Holder.Position

	ballPos, _ := dir.Copy().SetLength(specs.PlayerSize / 2)
	*ball.Position = ballPos.TargetFrom(*ball.Holder.Position)

	ball.Velocity = ball.Holder.Velocity.Copy()
	ball.Velocity.Direction.Normalize()
	if fixBallPosition(ball, previousPos) { // keeps the ball inside the field
		ball.Holder = nil // if the position needed to tbe fixed, the ball holder lost the possession
	}
}

const (
	maxY = specs.GoalMaxY - (specs.PlayerSize / 2)
	minY = specs.GoalMinY + (specs.PlayerSize / 2)
)

//func movePlayerTo(player *lugo.Player, point lugo.Point) (hasCollide bool) {
//
//}

func updateUserVelocityProperties(player *proto.Player, velocity *proto.Velocity, maxAllowedSpeed float64) {
	player.Velocity = velocity

	player.Velocity.Direction.Normalize()
	if player.Velocity.Speed > maxAllowedSpeed+0.0001 {
		player.Velocity.Speed = maxAllowedSpeed
	}
	//if player.Number == 1 {
	//	player.Velocity.Speed *= 1.4
	//}
}
