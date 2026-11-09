package helpers

import (
	"github.com/lugobots/lugo4go/v3/proto"
)

func GetBallHolder(inspector *proto.GameSnapshot) (*proto.Player, bool) {
	holder := inspector.GetBall().GetHolder()
	return holder, holder != nil
}
func IsBallHolder(snapshot *proto.GameSnapshot, player *proto.Player) bool {
	holder := snapshot.GetBall().GetHolder()
	return holder != nil && holder.TeamSide == player.TeamSide && holder.Number == player.Number
}
func GetTeam(snapshot *proto.GameSnapshot, side proto.Team_Side) *proto.Team {
	if side == proto.Team_HOME {
		return snapshot.HomeTeam
	}
	return snapshot.AwayTeam
}

func GetPlayer(snapshot *proto.GameSnapshot, side proto.Team_Side, number int) *proto.Player {
	team := GetTeam(snapshot, side)
	for _, player := range team.GetPlayers() {
		if int(player.Number) == number {
			return player
		}
	}
	return nil
}

func GetOpponentSide(side proto.Team_Side) proto.Team_Side {
	if side == proto.Team_HOME {
		return proto.Team_AWAY
	}
	return proto.Team_HOME
}
