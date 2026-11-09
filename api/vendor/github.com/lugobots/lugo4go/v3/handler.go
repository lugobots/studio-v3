package lugo4go

import (
	"context"
	"fmt"

	"github.com/pkg/errors"

	"github.com/lugobots/lugo4go/v3/proto"
	"github.com/lugobots/lugo4go/v3/specs"
)

func hewRawBotWrapper(bot Bot, logger Logger, playerNumber int, side proto.Team_Side) *rawBotWrapper {
	return &rawBotWrapper{
		Logger:       logger,
		PlayerNumber: playerNumber,
		Side:         side,
		Bot:          bot,
	}
}

// rawBotWrapper is a Lugo4go client that allow you to create an interface to follow a basic strategy based on team
// states.
type rawBotWrapper struct {
	Logger       Logger
	PlayerNumber int
	Side         proto.Team_Side
	Bot          Bot
}

func (h *rawBotWrapper) GetReadyHandler(ctx context.Context, inspector SnapshotInspector) {
	h.Bot.OnGetReady(ctx, inspector)
}

func (h *rawBotWrapper) TurnHandler(ctx context.Context, inspector SnapshotInspector) ([]proto.PlayerOrder, string, error) {
	if inspector == nil {
		return nil, "", fmt.Errorf("error processing turn: %s", ErrNilSnapshot)

	}

	state, err := defineMyState(inspector.GetSnapshot(), int(h.PlayerNumber), h.Side)
	if err != nil {
		return nil, "", fmt.Errorf("error processing turn %d: %s", inspector.GetSnapshot().Turn, err)

	}
	var order []proto.PlayerOrder
	var debugMsg string
	if specs.GoalkeeperNumber == uint32(h.PlayerNumber) {
		order, debugMsg, err = h.Bot.AsGoalkeeper(ctx, inspector, state)
		return errorWrapper("GoalkeeperNumber", order, debugMsg, err)
	} else {
		switch state {
		case Supporting:
			order, debugMsg, err = h.Bot.OnSupporting(ctx, inspector)
		case HoldingTheBall:
			order, debugMsg, err = h.Bot.OnHolding(ctx, inspector)
		case Defending:
			order, debugMsg, err = h.Bot.OnDefending(ctx, inspector)
		case DisputingTheBall:
			order, debugMsg, err = h.Bot.OnDisputing(ctx, inspector)

		default:
			return nil, "", fmt.Errorf("unknown player state '%s'", state)
		}
		return errorWrapper(string(state), order, debugMsg, err)
	}

}

func errorWrapper(method string, order []proto.PlayerOrder, debugMsg string, err error) ([]proto.PlayerOrder, string, error) {
	return order, debugMsg, errors.Wrapf(err, "method %s returned an error", method)
}

// PlayerState defines states specific for players
type PlayerState string

const (
	// Supporting identifies the player supporting the teammate
	Supporting PlayerState = "supporting"
	// HoldingTheBall identifies the player holding	the ball
	HoldingTheBall PlayerState = "holding"
	// Defending identifies the player defending against the opponent team
	Defending PlayerState = "defending"
	// DisputingTheBall identifies the player disputing the ball
	DisputingTheBall PlayerState = "disputing"
)

func defineMyState(snapshot *proto.GameSnapshot, playerNumber int, side proto.Team_Side) (PlayerState, error) {
	if snapshot == nil || snapshot.Ball == nil {
		return "", ErrNoBall
	}

	myTeam := snapshot.HomeTeam
	if side == proto.Team_AWAY {
		myTeam = snapshot.AwayTeam
	}

	var me *proto.Player
	for _, player := range myTeam.GetPlayers() {
		if int(player.Number) == playerNumber {
			me = player
			break
		}
	}

	if me == nil {
		return "", ErrPlayerNotFound
	}

	ballHolder := snapshot.Ball.Holder

	if ballHolder == nil {
		return DisputingTheBall, nil
	} else if ballHolder.TeamSide == side {
		if int(ballHolder.Number) == playerNumber {
			return HoldingTheBall, nil
		}
		return Supporting, nil
	}
	return Defending, nil
}
