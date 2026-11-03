package gameruntime

import (
	"fmt"
	"time"

	serverConfig "github.com/lugobots/server/v2/config"
	"github.com/lugobots/server/v2/machine"
)

// TeamSide is the player's configured match side.
type TeamSide string

const (
	TeamSideHome TeamSide = "home"
	TeamSideAway TeamSide = "away"
)

// GameSpeed scales turn cadence (listening / get-ready durations).
type GameSpeed string

const (
	GameSpeedSlow   GameSpeed = "slow"
	GameSpeedNormal GameSpeed = "normal"
	GameSpeedFast   GameSpeed = "fast"
)

// Speed multipliers relative to machine.DefaultListeningDuration /
// machine.PhaseReadyDuration. Documented and locked by unit tests.
const (
	speedSlowMultiplier   = 4.0
	speedNormalMultiplier = 1.0
	speedFastMultiplier   = 0.5
)

// MatchSettings are preferences applied when composing server/v2 Configuration
// on local game-server start. JSON field names match the Studio request body /
// app-level user.json keys.
type MatchSettings struct {
	TeamSide         TeamSide  `json:"team_side"`
	SkipToGoldenGoal bool      `json:"skip_to_golden_goal"`
	GameSpeed        GameSpeed `json:"game_speed"`
}

// ComposeConfiguration builds a server/v2 Configuration from ports and match
// settings: speed scales listening/get-ready durations, SkipToGoldenGoal is
// set when requested, and team side places player branding on that side
// (swapping the default home/away team blocks when the player is away).
func ComposeConfiguration(ports Ports, settings MatchSettings) (serverConfig.Configuration, error) {
	if ports.GameServer <= 0 || ports.GameFrontend <= 0 {
		return serverConfig.Configuration{}, fmt.Errorf("invalid ports: game_server=%d game_frontend=%d", ports.GameServer, ports.GameFrontend)
	}

	teams, err := serverConfig.GetDefaultConfig()
	if err != nil {
		return serverConfig.Configuration{}, fmt.Errorf("default team config: %w", err)
	}

	listening, getReady := durationsForSpeed(settings.GameSpeed)
	homeTeam, awayTeam := brandTeams(teams.HomeTeam, teams.AwayTeam, settings.TeamSide)

	cfg := serverConfig.Configuration{
		GRPCPort:             uint16(ports.GameServer),
		HTTPPort:             uint16(ports.GameFrontend),
		WaitingDuration:      machine.TimeLimitTeamsConnect,
		ListeningDuration:    listening,
		GetReadyDuration:     getReady,
		ListeningMode:        serverConfig.ListeningModeTimer,
		DevMode:              true,
		VerboseLog:           false,
		Quiet:                true,
		Headless:             true, // frontend is started separately
		StartingMode:         serverConfig.ConfigStartModeNoWait,
		EnableGoldenGoal:     true,
		SkipToGoldenGoal:     settings.SkipToGoldenGoal,
		HomeTeam:             homeTeam,
		AwayTeam:             awayTeam,
		KnockoutTimeLimit:    time.Minute,
		KnockoutMaxScoreDiff: 10,
	}
	if settings.SkipToGoldenGoal {
		cfg.EnableGoldenGoal = true
	}
	return cfg, nil
}

func durationsForSpeed(speed GameSpeed) (listening, getReady time.Duration) {
	mult := speedNormalMultiplier
	switch speed {
	case GameSpeedSlow:
		mult = speedSlowMultiplier
	case GameSpeedFast:
		mult = speedFastMultiplier
	case GameSpeedNormal, "":
		mult = speedNormalMultiplier
	default:
		mult = speedNormalMultiplier
	}
	listening = time.Duration(float64(machine.DefaultListeningDuration) * mult)
	getReady = time.Duration(float64(machine.PhaseReadyDuration) * mult)
	return listening, getReady
}

// brandTeams treats defaultHome as the player branding block and defaultAway as
// the opponent block. When the player side is away, the blocks are swapped so
// player branding appears on AwayTeam.
func brandTeams(defaultHome, defaultAway serverConfig.TeamConfiguration, side TeamSide) (home, away serverConfig.TeamConfiguration) {
	player := defaultHome
	opponent := defaultAway
	if side == TeamSideAway {
		return opponent, player
	}
	return player, opponent
}
