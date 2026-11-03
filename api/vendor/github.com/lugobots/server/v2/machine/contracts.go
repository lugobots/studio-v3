package machine

import (
	"context"
	"time"

	"github.com/lugobots/lugo4go/v3/proto"
	"go.uber.org/zap"
)

// EventDiffuser is used by the gamer to diffuse events happened in the LugoServer.
type EventDiffuser interface {
	DiffuseNewPlayer(s *proto.GameSnapshot, p *proto.Player)
	DiffuseLostPlayer(s *proto.GameSnapshot, p *proto.Player)
	DiffuseStateChange(s *proto.GameSnapshot, previousState proto.GameSnapshot_State)
	DiffuseGoal(s *proto.GameSnapshot, teamSide proto.Team_Side)
	DiffuseGameOver(s *proto.GameSnapshot, reason proto.EventGameOver_EndingReason, blame proto.EventGameOver_BlameStop)
	DiffuseDebugBreakpoint(s *proto.GameSnapshot, breakpoint proto.EventDebugBreakpoint_Breakpoint)
	DiffuseDebugReleased(s *proto.GameSnapshot)
	DiffusePeriodChanged(s *proto.GameSnapshot)
}

const MaxWaitBreakPoint = 10 * time.Minute

const (
	BreakpointOrder = "next-order"
	BreakpointTurn  = "next-turn"
)

type Debugger interface {
	StopAt(ctx context.Context, breakpoint proto.EventDebugBreakpoint_Breakpoint) bool
	Close() error
	Wait(breakpoint proto.EventDebugBreakpoint_Breakpoint, t time.Duration, beforeWait func()) error
	OnResumeListeningPhase(rushModeCtx context.Context, stop context.CancelFunc)
	ResumeListeningPhase()
	//if the debugger is waiting for the game to be reset, it will return true.
	//After a call has returned true, the debugger assumes the game was reset, so the immediate subsequent call will return false.
	//and, whoever is waiting the game to be reset will be notified by the debugger.
	ShouldReset() bool
	WaitResetGame(ctx context.Context)
}

// MatchStartTrigger allow us to have a way to hold the match beginning based on an external factor, so the game server
// does not have to care about external rules that might delay the game begining
type MatchStartTrigger interface {
	StartPlaying() <-chan struct{}
}

type Mutator interface {
	// MoveBall only updates the bal position when it is not been held by anyone
	MoveBall(ball *proto.Ball)
	UpdatePlayerPosition(player *proto.Player, ball *proto.Ball, entry *zap.SugaredLogger)
	SetPlayerPosition(player *proto.Player, position proto.Point, entry *zap.SugaredLogger) bool
	ResetElementPositions(snapshot *proto.GameSnapshot, entry *zap.SugaredLogger)
	ExecuteMoveOrder(player *proto.Player, ball *proto.Ball, move *proto.Move, entry *zap.SugaredLogger)
	ExecuteJumpOrder(player *proto.Player, ball *proto.Ball, jump *proto.Jump, entry *zap.SugaredLogger)
	ExecuteCatchOrder(snapshot *proto.GameSnapshot, player *proto.Player, catch *proto.Catch, entry *zap.SugaredLogger) bool
	ExecuteKickOrder(ball *proto.Ball, player *proto.Player, kick *proto.Kick, entry *zap.SugaredLogger)
	// checks a team has scored, and than updated the team score
	CheckGoal(snapshot *proto.GameSnapshot, entry *zap.SugaredLogger) (bool, proto.Team_Side)
	// Checks if the ball must be kicked out of the goal zone, and if so it kicks the ball
	WatchBallInGoalZone(ball *proto.Ball, currentCounter uint32) (newCounter uint32)
	ShiftPossession(snapshot *proto.GameSnapshot, logger *zap.SugaredLogger)

	LockSnapshotForReading(ctx context.Context) context.CancelFunc
}
