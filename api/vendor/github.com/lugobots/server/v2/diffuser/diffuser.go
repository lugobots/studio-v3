package diffuser

import (
	"github.com/lugobots/lugo4go/v3/proto"
)

// Diffuser (please reat tje machine.EventDiffuser interface's documentation)
type Diffuser struct {
	broadcaster EventBroadcaster
}

func NewDiffuser(broadcaster EventBroadcaster) *Diffuser {
	return &Diffuser{broadcaster: broadcaster}
}

func (a *Diffuser) DiffuseNewPlayer(s *proto.GameSnapshot, p *proto.Player) {
	a.broadcaster.Send(&proto.GameEvent{
		GameSnapshot: s,
		Event: &proto.GameEvent_NewPlayer{
			NewPlayer: &proto.EventNewPlayer{
				Player: p,
			},
		},
	})
}

func (a *Diffuser) DiffuseLostPlayer(s *proto.GameSnapshot, p *proto.Player) {
	a.broadcaster.Send(&proto.GameEvent{
		GameSnapshot: s,
		Event: &proto.GameEvent_LostPlayer{
			LostPlayer: &proto.EventLostPlayer{
				Player: p,
			},
		},
	})
}

func (a *Diffuser) DiffuseStateChange(s *proto.GameSnapshot, previousState proto.GameSnapshot_State) {
	a.broadcaster.Send(&proto.GameEvent{
		GameSnapshot: s,
		Event: &proto.GameEvent_StateChange{
			StateChange: &proto.EventStateChange{
				PreviousState: previousState,
				NewState:      s.State,
			},
		},
	})
}

func (a *Diffuser) DiffuseGoal(s *proto.GameSnapshot, teamSide proto.Team_Side) {
	a.broadcaster.Send(&proto.GameEvent{
		GameSnapshot: s,
		Event: &proto.GameEvent_Goal{
			Goal: &proto.EventGoal{Side: teamSide},
		},
	})
}

func (a *Diffuser) DiffuseGameOver(s *proto.GameSnapshot, reason proto.EventGameOver_EndingReason, blame proto.EventGameOver_BlameStop) {
	a.broadcaster.Send(&proto.GameEvent{
		GameSnapshot: s,
		Event: &proto.GameEvent_GameOver{
			GameOver: &proto.EventGameOver{
				Reason: reason,
				Blame:  blame,
			},
		},
	})
}

func (a *Diffuser) DiffuseDebugBreakpoint(s *proto.GameSnapshot, breakpoint proto.EventDebugBreakpoint_Breakpoint) {
	a.broadcaster.Send(&proto.GameEvent{
		GameSnapshot: s,
		Event: &proto.GameEvent_Breakpoint{
			Breakpoint: &proto.EventDebugBreakpoint{
				Breakpoint: breakpoint,
			},
		},
	})
}

func (a *Diffuser) DiffuseDebugReleased(s *proto.GameSnapshot) {
	a.broadcaster.Send(&proto.GameEvent{
		GameSnapshot: s,
		Event: &proto.GameEvent_DebugReleased{
			DebugReleased: &proto.EventDebugReleased{},
		},
	})
}

func (a *Diffuser) DiffusePeriodChanged(s *proto.GameSnapshot) {
	a.broadcaster.Send(&proto.GameEvent{
		GameSnapshot: s,
		Event:        &proto.GameEvent_PeriodChanged{},
	})
}
