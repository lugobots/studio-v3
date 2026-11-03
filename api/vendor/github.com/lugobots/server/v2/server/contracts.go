package server

import (
	"context"
	"fmt"

	"github.com/lugobots/lugo4go/v3/proto"
)

type Gamer interface {
	RegisterPlayer(request *proto.JoinRequest, stream proto.Game_JoinATeamServer) (ctx context.Context, id string, err error)
	ProcessOrder(playerCon proto.JoinRequest, orders proto.OrderSet) (responseCode proto.OrderResponse_StatusCode, err error)
	DropPlayer(side proto.Team_Side, number uint32) error
	State() proto.GameSnapshot_State
	//Stop(context.Context, StopRequest)
	//Run() error
	//MakeRemoteController() dev.Controller
}

type StopRequest struct {
	Reason proto.EventGameOver_EndingReason
	Blame  proto.EventGameOver_BlameStop
}

func (s *StopRequest) Error() string {
	return fmt.Sprintf("stoped due to %s (blame %s)", s.Reason, s.Blame)
}

type GameEndReason string

//const (
//	GameEnd_TimeOver        GameEndReason = "time_over"
//	GameEnd_WaitingExpired  GameEndReason = "waiting_expired"
//	GameEnd_NoEnoughPlayer  GameEndReason = "no_enough_player"
//	GameEnd_ExternalRequest GameEndReason = "external_request"
//)

type BlameStop string

const (
	BlameStop_Both   BlameStop = "both_teams"
	BlameStop_Home   BlameStop = "home"
	BlameStop_Away   BlameStop = "away"
	BlameStop_System BlameStop = "system"
	BlameStop_Normal BlameStop = "normal"
)
