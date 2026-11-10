package specs

import "time"

const (
	// GameDuration Number of turns in the regular phase of the game.
	// After this many turns, if one team is ahead, the game ends.
	// If the score is tied, overtime may be applied if the game it configured to accept golden goal
	GameDuration = 6000

	// ExtraOvertimeDuration Number of additional turns granted if the game is tied
	// at the end of the regular duration.
	// If still tied after this period, the match ends in a draw.
	ExtraOvertimeDuration = 2400

	// BaseUnit is used to increase the integer units scale and improve the precision when the integer numbers
	// come from float  calculations. Some units have to be integer to avoid infinite intervals (e.g. a point in the field)
	BaseUnit = 100

	// PlayerSize is the size of each player
	PlayerSize = 4 * BaseUnit

	// GoalkeeperSize is the width of the goalkeeper
	GoalkeeperSize = PlayerSize * 2.3

	// PlayerReconnectionWaitTime is a penalty time imposed to the player that needs to reconnect during the match.
	// this interval ensure players won't drop connection in purpose to be reallocated to their initial position.
	PlayerReconnectionWaitTime = 20 * time.Second

	// MaxPlayers max number of players in a team by mach
	MaxPlayers = 11

	// MinPlayers min number of players in a team by mach, if a team gets to have less to this number, the team loses by W.O.
	MinPlayers = 6

	// PlayerMaxSpeed is the max speed that a play may move  by frame
	PlayerMaxSpeed = 100.0

	// MaxXCoordinate help us to remember that we should not use the field width to check the field boundaries!
	// The field dimensions counts the total number of coordinates, but the coordinates are zero-indexed.
	// e.g. If the field width is 10, so the max coordinate will be 9
	MaxXCoordinate = 200 * BaseUnit

	// MaxYCoordinate help us to remember that we should not use the field width to check the field boundaries!
	// The field dimensions counts the total number of coordinates, but the coordinates are zero-indexed.
	// e.g. If the field height is 10, so the max coordinate will be 9
	MaxYCoordinate = 100 * BaseUnit

	// FieldWidth is the width of the field (horizontal view)
	// This value must be an odd number because the central coordinate must be neutral, and we want to have the same number
	// of coordinates on both sides.
	// e.g. If the field width is 10, and the coordinates go from 0 to 9, there is no precise middle.
	// Thus, the field width would have to be 11, so the coordinate 5 is at the precise center
	FieldWidth = MaxXCoordinate + 1

	// FieldHeight is the height of the field (horizontal view)
	// This value must be an odd number because we cant to a coordinate at the perfect middle of the field
	// e.g. If the field height is 10, and the coordinates go from 0 to 9, there is no precise middle.
	// Thus, the field height would have to be 11, so the coordinate 5 is at the precise center
	FieldHeight = MaxYCoordinate + 1

	// FieldNeutralCenter is the radius of the neutral circle in the center of the field
	FieldNeutralCenter = 1000

	// BallSize size of the element ball
	BallSize = 2 * BaseUnit

	// BallDeceleration is the deceleration rate of the ball speed  by frame
	BallDeceleration = 10.0

	// BallMaxSpeed is the max speed of the ball by frame
	BallMaxSpeed = 4.0 * BaseUnit

	// BallMinSpeed is the minimal speed of the ball  by frame. When the ball was at this speed or slower, it will be considered stopped.
	BallMinSpeed = 2

	// BallTimeInGoalZone is the max number of turns that the ball may be in a goal zone. After that, the ball will be auto kicked
	// towards the center of the field.
	BallTimeInGoalZone = 40 // 40 / 20 fps = 2 seconds

	// GoalWidth is the goal width
	GoalWidth = 30 * BaseUnit

	// GoalMinY is the coordinate Y of the lower pole of the goals
	GoalMinY = (MaxYCoordinate - GoalWidth) / 2

	// GoalMaxY is the coordinate Y of the upper pole of the goals
	GoalMaxY = GoalMinY + GoalWidth

	// GoalZoneRange is the minimal distance that a player can stay from the opponent goal
	GoalZoneRange = 14 * BaseUnit

	// GoalKeeperJumpDuration is the number of turns that the jump takes. A jump cannot be interrupted after has been requested
	GoalKeeperJumpDuration = 3

	// GoalKeeperJumpSpeed is the max speed of the goalkeeper during the jump
	GoalKeeperJumpSpeed = 2 * PlayerMaxSpeed

	// GoalkeeperNumber defines the goalkeeper number
	GoalkeeperNumber = uint32(1)

	// ShotClockTime Number of turns each teams has on attack before losing the ball possession.
	ShotClockTime = 300
)
