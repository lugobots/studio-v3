package config

import (
	"encoding/json"
	"fmt"
	"image/color"
	"math"
	"os"
	"strings"
	"time"

	"github.com/lugobots/lugo4go/v3"
	"github.com/lugobots/lugo4go/v3/proto"
	"github.com/pkg/errors"
	"github.com/spf13/cobra"
)

const SERVER_VERSION = "v2.4"

const ListeningModeTimer = "wait"
const ListeningModeRush = "rush"
const ListeningModeRemote = "remote"

const ConfigStartModeWait = "wait"      //wait for a start command
const ConfigStartModeDelay = "delay"    //wait for at least one frontend connection for 3 min
const ConfigStartModeNoWait = "no-wait" //starts ASAP

const ProtocolMainVersion = 1
const ProtocolSecondaryVersion = 0

const WaitStartingDelay = 4 * time.Minute

const MaxTeamNameSize = 15

// this sh!t should be parameters!!
const (
	EnvHomeTeamName = "HOME_TEAM_NAME"
	EnvAwayTeamName = "AWAY_TEAM_NAME"

	EnvHomeAvatar = "HOME_TEAM_AVATAR_URL"
	EnvAwayAvatar = "AWAY_TEAM_AVATAR_URL"

	EnvHomePrimaryColor = "HOME_TEAM_PRI_COLOR"
	EnvAwayPrimaryColor = "AWAY_TEAM_PRI_COLOR"

	EnvHomeSecondaryColor = "HOME_TEAM_SEC_COLOR"
	EnvAwaySecondaryColor = "AWAY_TEAM_SEC_COLOR"
)

var defaultHomeColor = TeamColors{
	PrimaryColor: Color{
		R: 240, //10,
		G: 240, //36,
		B: 240, //133,
	},
	SecondaryColor: Color{
		R: 0,   //240,
		G: 0,   //209,
		B: 240, //0,
	},
}

var defaultAwayColor = TeamColors{
	PrimaryColor: Color{
		R: 50, //188,
		G: 50, //75,
		B: 50, //55,
	},
	SecondaryColor: Color{
		R: 210, //180,
		G: 210, //189,
		B: 210, //191,
	},
}

type Color struct {
	R int `json:"r"`
	G int `json:"g"`
	B int `json:"b"`
}

func (c Color) MarshalJSON() ([]byte, error) {
	return json.Marshal([]int{
		c.R, c.G, c.B,
	})
}

type TeamColors struct {
	PrimaryColor   Color `json:"a"`
	SecondaryColor Color `json:"b"`
}

type TeamConfiguration struct {
	Name   string     `json:"name"`
	Avatar string     `json:"avatar"`
	Colors TeamColors `json:"colors"`
}

//colocar configuracao no jarvis para setar o time interval
//chamar o log do container apenas antes de matar o container e colocar  --since=1h
//

type Configuration struct {
	GRPCPort          uint16             `json:"-"`
	HTTPPort          uint16             `json:"-"`
	Uuid              string             `json:"-"`
	WaitingDuration   time.Duration      `json:"waiting_duration"`
	ListeningDuration time.Duration      `json:"listening_duration"`
	GetReadyDuration  time.Duration      `json:"get_ready_duration"`
	ListeningMode     string             `json:"timer_mode"`
	GameOutPut        string             `json:"-"`
	ReplaySource      string             `json:"-"`
	DevMode           bool               `json:"dev_mode"`
	VerboseLog        bool               `json:"verbose_log"`
	Quiet             bool               `json:"quite"`
	Headless          bool               `json:"headless"`
	StartingMode      string             `json:"start_mode"`
	EnableGoldenGoal  bool               `json:"enable_golden_goal"`
	SkipToGoldenGoal  bool               `json:"skip_to_golden_goal"`
	PlayerToken       map[string]*string `json:"-"`
	//QueueURL          string             `json:"-"`
	//QueueName         string             `json:"-"`
	HomeTeam TeamConfiguration `json:"home_team"`
	AwayTeam TeamConfiguration `json:"away_team"`

	KnockoutTimeLimit    time.Duration `json:"knockout_time_limit"`
	KnockoutMaxScoreDiff int           `json:"knockout_max_score_diff"`
}

var pasList map[string]*string

// @todo it is too too messy!! the configuration should not be mixed with the flags
func (c *Configuration) DefinePlayCommand() *cobra.Command {
	var cmdPLay = &cobra.Command{
		Use:   "play",
		Short: "Run the game server",
		Long:  `"play" starts the game server for a new match`,
		Args:  cobra.MaximumNArgs(1),
	}

	cmdPLay.PersistentFlags().StringVar(&c.Uuid, "uuid", "local", "The match UUID (useless locally)")
	cmdPLay.Flags().StringVar(&c.ListeningMode, "timer-mode", ListeningModeTimer,
		"wait: wait for the time interval\n"+
			"rush: process the orders as soon as all players have sent the orders\n"+
			"remote: allow a web socket connection to end the listening phase before all players have sent their orders (only in dev mode)")

	cmdPLay.Flags().BoolVar(&c.DevMode, "dev-mode", false, "Enable features for helping developers")
	cmdPLay.Flags().BoolVar(&c.VerboseLog, "verbose", false, "Sends all logs to the output. When false, only send logs related to bots communication. ")
	cmdPLay.Flags().BoolVar(&c.Quiet, "quiet", false, "Mutes the logs (pay improve performance)")
	cmdPLay.Flags().BoolVar(&c.Headless, "headless", false, "Disable the HTTP server that renders the game")
	cmdPLay.Flags().DurationVar(&c.KnockoutTimeLimit, "knockout-time-limit", time.Minute, "Duration of the game after which the score difference condition is checked for knockout.")
	cmdPLay.Flags().IntVar(&c.KnockoutMaxScoreDiff, "knockout-score-diff", 10, "Score diff that will be considered a knockout after knockout-time-limit")

	cmdPLay.Flags().BoolVar(&c.EnableGoldenGoal, "golden-goal", false, "Enable golden goal")
	cmdPLay.Flags().BoolVar(&c.SkipToGoldenGoal, "golden-goal-only", false, "Skips the game directly to golden goal (it only works with dev-mode) (it enables golden goal)")

	//cmdPLay.Flags().StringVar(&c.QueueURL, "queue-url", "", "Queue server address")
	//cmdPLay.Flags().StringVar(&c.QueueName, "queue-name", "", "Queue server address")
	cmdPLay.Flags().StringVar(&c.GameOutPut, "record-path", "", "Define a path to a file where the game will be recorded at to be reproduced later")
	return cmdPLay
}

func (c *Configuration) DefineOfficialPlayCommand() *cobra.Command {
	var cmdPlayCertified = &cobra.Command{
		Use:   "certified",
		Short: "Run the game server on certified mode",
		Long:  `The certified mode requires an exclusive token in the player connection headers`,
		Args:  cobra.NoArgs,
	}

	pasList = map[string]*string{}
	for i := 1; i <= 11; i++ {
		index := fmt.Sprintf("home-%d", i)
		pasList[index] = new(string)
		cmdPlayCertified.Flags().StringVar(pasList[index], fmt.Sprintf("token-%s", index), "", fmt.Sprintf("Token to identify player %s", index))
	}
	for i := 1; i <= 11; i++ {
		index := fmt.Sprintf("away-%d", i)
		pasList[index] = new(string)
		cmdPlayCertified.Flags().StringVar(pasList[index], fmt.Sprintf("token-%s", index), "", fmt.Sprintf("Token to identify player %s", index))
	}

	return cmdPlayCertified
}

func (c *Configuration) DefineReplayCommand() *cobra.Command {
	var cmdPlayCertified = &cobra.Command{
		Use:   "replay [source file]",
		Short: "Replays a recorded game",
		Long:  "Replays a game previously recorded by using the flag `record-path` during a game",
		Args:  cobra.ExactArgs(1),
	}

	return cmdPlayCertified
}

func (c *Configuration) DefineRLAssistantCommand() *cobra.Command {
	var cmdRLAssistant = &cobra.Command{
		Use:   "gym",
		Short: "Started the game server with a Reinforcement Learning assistant mode",
		Long:  "Gym is the game server in a mode designed to help you to connect Reinforcement Learning training projects",
	}

	cmdRLAssistant.Flags().BoolVar(&c.VerboseLog, "verbose", false, "Sends all logs to the output. When false, only send logs related to bots communication. ")
	cmdRLAssistant.Flags().BoolVar(&c.Quiet, "quiet", false, "Mutes the logs (pay improve performance)")
	cmdRLAssistant.Flags().BoolVar(&c.Headless, "headless", false, "Disable the HTTP server that renders the game")

	return cmdRLAssistant
}

func GetDefaultConfig() (*Configuration, error) {

	homeTeamConfig, err := getHomeConfiguration(proto.Team_HOME)
	if err != nil {
		return nil, errors.Wrap(err, "home team bad configuration (environment variables)")
	}
	awayTeamConfig, err := getHomeConfiguration(proto.Team_AWAY)
	if err != nil {
		return nil, errors.Wrap(err, "away team bad configuration (environment variables)")
	}
	return &Configuration{
		HomeTeam: *homeTeamConfig,
		AwayTeam: *awayTeamConfig,
	}, nil
}

func getHomeConfiguration(teamSide proto.Team_Side) (*TeamConfiguration, error) {
	teamColor, err := getEnvTeamColor(teamSide)
	if err != nil {
		return nil, err
	}
	return &TeamConfiguration{
		Name:   getEnvTeamName(teamSide),
		Avatar: getEnvTeamAvatar(teamSide),
		Colors: *teamColor,
	}, nil
}

func (c *Configuration) ValidateArgs() error {

	if c.ListeningDuration < time.Millisecond {
		return fmt.Errorf("the interval between frames must be greater than %s", time.Millisecond)
	}

	c.PlayerToken = pasList
	if c.ListeningMode == ListeningModeRemote && !c.DevMode {
		return fmt.Errorf("timer-mode 'remote' can only be used when dev mode is on: %s", c.ListeningMode)
	}

	if c.SkipToGoldenGoal && !c.DevMode {
		return fmt.Errorf("the game server only supports golden goal on dev mode - use the flag --dev-mode")
	}

	if c.SkipToGoldenGoal {
		// auto enables golden goal when skipping to golden goal
		c.EnableGoldenGoal = true
	}
	if c.ListeningMode != ListeningModeTimer && c.ListeningMode != ListeningModeRush && c.ListeningMode != ListeningModeRemote {
		return fmt.Errorf("invalid value for timer-mode: %s", c.ListeningMode)
	}

	if c.StartingMode != ConfigStartModeNoWait && c.StartingMode != ConfigStartModeWait {
		return fmt.Errorf("invalid value for start-mode: %s", c.StartingMode)
	}

	return nil
}

// @todo this function should not be necessary. A configurator should create the
// configuration with a GameSetup object
func ConvertToGameSetup(c Configuration, gameDuration uint32) (*proto.GameSetup, error) {
	setup := &proto.GameSetup{
		ProtocolVersion:   lugo4go.ProtocolVersion,
		DevMode:           c.DevMode,
		ListeningDuration: uint32(c.ListeningDuration / time.Millisecond),
		GameDuration:      gameDuration,
		HomeTeam: &proto.TeamSettings{
			Name:   c.HomeTeam.Name,
			Avatar: c.HomeTeam.Avatar,
			Colors: &proto.TeamColors{
				Primary: &proto.TeamColor{
					Red:   uint32(c.HomeTeam.Colors.PrimaryColor.R),
					Green: uint32(c.HomeTeam.Colors.PrimaryColor.G),
					Blue:  uint32(c.HomeTeam.Colors.PrimaryColor.B),
				},
				Secondary: &proto.TeamColor{
					Red:   uint32(c.HomeTeam.Colors.SecondaryColor.R),
					Green: uint32(c.HomeTeam.Colors.SecondaryColor.G),
					Blue:  uint32(c.HomeTeam.Colors.SecondaryColor.B),
				},
			},
		},
		AwayTeam: &proto.TeamSettings{
			Name:   c.AwayTeam.Name,
			Avatar: c.AwayTeam.Avatar,
			Colors: &proto.TeamColors{
				Primary: &proto.TeamColor{
					Red:   uint32(c.AwayTeam.Colors.PrimaryColor.R),
					Green: uint32(c.AwayTeam.Colors.PrimaryColor.G),
					Blue:  uint32(c.AwayTeam.Colors.PrimaryColor.B),
				},
				Secondary: &proto.TeamColor{
					Red:   uint32(c.AwayTeam.Colors.SecondaryColor.R),
					Green: uint32(c.AwayTeam.Colors.SecondaryColor.G),
					Blue:  uint32(c.AwayTeam.Colors.SecondaryColor.B),
				},
			},
		},
	}

	switch c.StartingMode {
	//case ConfigStartModeDelay:
	//	setup.StartMode = proto.GameSetup_DELAY
	case ConfigStartModeNoWait:
		setup.StartMode = proto.GameSetup_NO_WAIT
	case ConfigStartModeWait:
		setup.StartMode = proto.GameSetup_WAIT
	default:
		return setup, fmt.Errorf("unkown start mode %s: ", c.StartingMode)
	}

	switch c.ListeningMode {
	case ListeningModeRemote:
		setup.ListeningMode = proto.GameSetup_REMOTE
	case ListeningModeRush:
		setup.ListeningMode = proto.GameSetup_RUSH
	case ListeningModeTimer:
		setup.ListeningMode = proto.GameSetup_TIMER
	default:
		return setup, fmt.Errorf("unkown listening mode %s: ", c.ListeningMode)
	}
	return setup, nil
}

func getEnvTeamName(side proto.Team_Side) string {
	name := proto.Team_Side_name[int32(side)]
	envName := EnvHomeTeamName
	if side == proto.Team_AWAY {
		envName = EnvAwayTeamName
	}
	if setName := os.Getenv(envName); setName != "" {
		name = strings.TrimSpace(setName)
		name = name[:int(math.Min(MaxTeamNameSize, float64(len(name))))]
	}
	return name
}

func getEnvTeamAvatar(side proto.Team_Side) string {
	envName := EnvHomeAvatar
	if side == proto.Team_AWAY {
		envName = EnvAwayAvatar
	}
	envVal := os.Getenv(envName)
	if envVal != "" {
		envVal = strings.TrimSpace(envVal)
	}
	return envVal
}

func getEnvTeamColor(side proto.Team_Side) (*TeamColors, error) {
	envPrimaryName := EnvHomePrimaryColor
	if side == proto.Team_AWAY {
		envPrimaryName = EnvAwayPrimaryColor
	}

	envSecondaryName := EnvHomeSecondaryColor
	if side == proto.Team_AWAY {
		envSecondaryName = EnvAwaySecondaryColor
	}

	env1Val := os.Getenv(envPrimaryName)
	env2Val := os.Getenv(envSecondaryName)
	if (env1Val == "") != (env2Val == "") {
		return nil, errors.Errorf("error on team '%s' color- must set both colors or none", side)
	}

	if env1Val == "" {
		if side == proto.Team_AWAY {
			return &defaultHomeColor, nil
		}
		return &defaultAwayColor, nil
	}
	pColor, err := ParseHexColor(env1Val)
	if err != nil {
		return nil, errors.Errorf("error on team '%s' primary color: %s", side, err)
	}
	sColor, err := ParseHexColor(env2Val)
	if err != nil {
		return nil, errors.Errorf("error on team '%s' secondary color: %s", side, err)
	}

	return &TeamColors{
		PrimaryColor: Color{
			R: int(pColor.R),
			G: int(pColor.G),
			B: int(pColor.B),
		},
		SecondaryColor: Color{
			R: int(sColor.R),
			G: int(sColor.G),
			B: int(sColor.B),
		},
	}, nil

}

func ParseHexColor(s string) (c color.RGBA, err error) {
	c.A = 0xff
	switch len(s) {
	case 7:
		_, err = fmt.Sscanf(s, "#%02x%02x%02x", &c.R, &c.G, &c.B)
	case 4:
		_, err = fmt.Sscanf(s, "#%1x%1x%1x", &c.R, &c.G, &c.B)
		// Double the hex digits:
		c.R *= 17
		c.G *= 17
		c.B *= 17
	default:
		err = fmt.Errorf("invalid length, must be 7 or 4")

	}
	return
}
