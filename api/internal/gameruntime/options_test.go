package gameruntime

import (
	"strings"
	"testing"
	"time"

	serverConfig "github.com/lugobots/server/v2/config"
	"github.com/lugobots/server/v2/machine"
)

func TestComposeConfigurationSpeedMultipliers(t *testing.T) {
	// Multipliers relative to machine.DefaultListeningDuration /
	// machine.PhaseReadyDuration: slow ×4, normal ×1, fast ×0.5.
	ports := Ports{GameServer: 5000, GameFrontend: 8080}

	slow, err := ComposeConfiguration(ports, MatchSettings{GameSpeed: GameSpeedSlow})
	if err != nil {
		t.Fatalf("slow: %v", err)
	}
	normal, err := ComposeConfiguration(ports, MatchSettings{GameSpeed: GameSpeedNormal})
	if err != nil {
		t.Fatalf("normal: %v", err)
	}
	fast, err := ComposeConfiguration(ports, MatchSettings{GameSpeed: GameSpeedFast})
	if err != nil {
		t.Fatalf("fast: %v", err)
	}

	if !(slow.ListeningDuration > normal.ListeningDuration && normal.ListeningDuration > fast.ListeningDuration) {
		t.Fatalf("want slow > normal > fast listening; got slow=%s normal=%s fast=%s",
			slow.ListeningDuration, normal.ListeningDuration, fast.ListeningDuration)
	}
	if !(slow.GetReadyDuration > normal.GetReadyDuration && normal.GetReadyDuration > fast.GetReadyDuration) {
		t.Fatalf("want slow > normal > fast get-ready; got slow=%s normal=%s fast=%s",
			slow.GetReadyDuration, normal.GetReadyDuration, fast.GetReadyDuration)
	}

	wantNormal := machine.DefaultListeningDuration
	wantSlow := time.Duration(float64(machine.DefaultListeningDuration) * speedSlowMultiplier)
	wantFast := time.Duration(float64(machine.DefaultListeningDuration) * speedFastMultiplier)
	if normal.ListeningDuration != wantNormal {
		t.Fatalf("normal listening = %s, want %s (×1)", normal.ListeningDuration, wantNormal)
	}
	if slow.ListeningDuration != wantSlow {
		t.Fatalf("slow listening = %s, want %s (×4)", slow.ListeningDuration, wantSlow)
	}
	if fast.ListeningDuration != wantFast {
		t.Fatalf("fast listening = %s, want %s (×0.5)", fast.ListeningDuration, wantFast)
	}
}

func TestComposeConfigurationSkipToGoldenGoal(t *testing.T) {
	ports := Ports{GameServer: 5000, GameFrontend: 8080}

	off, err := ComposeConfiguration(ports, MatchSettings{SkipToGoldenGoal: false})
	if err != nil {
		t.Fatalf("off: %v", err)
	}
	if off.SkipToGoldenGoal {
		t.Fatal("SkipToGoldenGoal = true, want false when not requested")
	}

	on, err := ComposeConfiguration(ports, MatchSettings{SkipToGoldenGoal: true})
	if err != nil {
		t.Fatalf("on: %v", err)
	}
	if !on.SkipToGoldenGoal {
		t.Fatal("SkipToGoldenGoal = false, want true when requested")
	}
	if !on.EnableGoldenGoal {
		t.Fatal("EnableGoldenGoal = false when SkipToGoldenGoal requested")
	}
}

func TestComposeConfigurationSideBranding(t *testing.T) {
	ports := Ports{GameServer: 5000, GameFrontend: 8080}

	home, err := ComposeConfiguration(ports, MatchSettings{TeamSide: TeamSideHome})
	if err != nil {
		t.Fatalf("home: %v", err)
	}
	away, err := ComposeConfiguration(ports, MatchSettings{TeamSide: TeamSideAway})
	if err != nil {
		t.Fatalf("away: %v", err)
	}

	if home.HomeTeam.Name != away.AwayTeam.Name || home.AwayTeam.Name != away.HomeTeam.Name {
		t.Fatalf("away side should swap default team blocks; home=(%q,%q) away=(%q,%q)",
			home.HomeTeam.Name, home.AwayTeam.Name, away.HomeTeam.Name, away.AwayTeam.Name)
	}
}

func TestComposeConfigurationTeamDisplayNames(t *testing.T) {
	ports := Ports{GameServer: 5000, GameFrontend: 8080}
	long := strings.Repeat("X", serverConfig.MaxTeamNameSize+5)

	home, err := ComposeConfiguration(ports, MatchSettings{
		TeamSide:         TeamSideHome,
		PlayerTeamName:   "MyBots",
		OpponentTeamName: "Rivals",
	})
	if err != nil {
		t.Fatalf("home: %v", err)
	}
	if home.HomeTeam.Name != "MyBots" || home.AwayTeam.Name != "Rivals" {
		t.Fatalf("home side names: got home=%q away=%q", home.HomeTeam.Name, home.AwayTeam.Name)
	}

	away, err := ComposeConfiguration(ports, MatchSettings{
		TeamSide:         TeamSideAway,
		PlayerTeamName:   "MyBots",
		OpponentTeamName: "Level-1",
	})
	if err != nil {
		t.Fatalf("away: %v", err)
	}
	if away.AwayTeam.Name != "MyBots" || away.HomeTeam.Name != "Level-1" {
		t.Fatalf("away side names: got home=%q away=%q", away.HomeTeam.Name, away.AwayTeam.Name)
	}

	truncated, err := ComposeConfiguration(ports, MatchSettings{
		TeamSide:         TeamSideHome,
		PlayerTeamName:   long,
		OpponentTeamName: "  Rivals  ",
	})
	if err != nil {
		t.Fatalf("truncated: %v", err)
	}
	if len(truncated.HomeTeam.Name) != serverConfig.MaxTeamNameSize {
		t.Fatalf("player name length=%d want %d (%q)", len(truncated.HomeTeam.Name), serverConfig.MaxTeamNameSize, truncated.HomeTeam.Name)
	}
	if truncated.AwayTeam.Name != "Rivals" {
		t.Fatalf("opponent trim: got %q", truncated.AwayTeam.Name)
	}
}
