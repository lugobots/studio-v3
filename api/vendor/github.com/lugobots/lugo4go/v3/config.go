package lugo4go

import (
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/pkg/errors"

	"github.com/lugobots/lugo4go/v3/proto"
	"github.com/lugobots/lugo4go/v3/specs"
)

const (
	EnvVarBotTeam         = "BOT_TEAM"
	EnvVarBotNumber       = "BOT_NUMBER"
	EnvVarBotGrpcUrl      = "BOT_GRPC_URL"
	EnvVarBotGrpcInsecure = "BOT_GRPC_INSECURE"
	EnvVarBotToken        = "BOT_TOKEN"
)

// Config is the set of values expected as a initial configuration of the player
type Config struct {
	//PlayerPositionFn func(playerNumber int, inspector SnapshotInspector) *proto.Point

	// Full url to the gRPC server
	GRPCAddress     string          `json:"grpc_address"`
	Insecure        bool            `json:"insecure"`
	Token           string          `json:"token"`
	TeamSide        proto.Team_Side `json:"-"`
	Number          int             `json:"-"`
	InitialPosition *proto.Point    `json:"-"`

	readValues configReadValues
}

type configReadValues struct {
	GRPCAddress string
	Insecure    bool
	Token       string
	Team        string
	Num         uint
}

func (c *Config) parseConfigFlags(args []string) error {
	flags := flag.NewFlagSet("bot-flags", flag.ContinueOnError)

	flags.StringVar(&c.readValues.Team, "team", "home", "Team (home or away)")
	flags.UintVar(&c.readValues.Num, "number", 1, "Player's number (1-11)")
	flags.StringVar(&c.readValues.GRPCAddress, "grpc_address", "localhost:5000", "Address to connect to the game server")
	flags.StringVar(&c.readValues.Token, "token", "", "Token used by the server to identify the right connection")
	flags.BoolVar(&c.readValues.Insecure, "insecure", true, "Allow insecure connections (important for development environments)")
	return errors.Wrap(flags.Parse(args), "error parsing the bot flags")
}

func (c *Config) readEnvVars() (err error) {
	if team := os.Getenv(EnvVarBotTeam); team != "" {
		c.readValues.Team = team
	}

	if number := os.Getenv(EnvVarBotNumber); number != "" {
		num, err := strconv.ParseUint(number, 10, 8)
		if err != nil {
			return errors.Wrap(err, "invalid player number read from env var")
		}
		c.readValues.Num = uint(num)
	}

	if grpcAdd := os.Getenv(EnvVarBotGrpcUrl); grpcAdd != "" {
		c.readValues.GRPCAddress = grpcAdd
	}

	if insecure := os.Getenv(EnvVarBotGrpcInsecure); insecure != "" {
		insecureBool, err := strconv.ParseBool(insecure)
		if err != nil {
			return errors.Wrap(err, "invalid gRPC insecure flag read from env var - must be a parseable boolean")
		}
		c.readValues.Insecure = insecureBool
	}

	if token := os.Getenv(EnvVarBotToken); token != "" {
		c.readValues.Token = token
	}

	return nil
}

func (c *Config) loadConfig(args []string) error {
	if err := c.parseConfigFlags(args); err != nil {
		return err
	}

	if err := c.readEnvVars(); err != nil {
		return errors.Wrap(err, "failed reading the configuration from environment variables")
	}

	side, ok := proto.Team_Side_value[strings.ToUpper(c.readValues.Team)]
	if !ok {
		return fmt.Errorf("invalid team option '%s'. Must be either HOME or AWAY", c.readValues.Team)
	}
	c.TeamSide = proto.Team_Side(side)

	if c.readValues.Num < 1 || c.readValues.Num > specs.MaxPlayers {
		return fmt.Errorf("invalid player number '%d'. Must be 1 to %d", c.readValues.Num, specs.MaxPlayers)
	}
	c.Number = int(c.readValues.Num)

	c.GRPCAddress = c.readValues.GRPCAddress
	c.Token = c.readValues.Token
	c.Insecure = c.readValues.Insecure
	return nil
}

/*func DefaultPlayerPositionFn(ballRegion field.Region, myTeamSide, possession proto.Team_Side) (s TeamState, e error) {
	regionCol := ballRegion.Col()
	if possession == myTeamSide {
		switch regionCol {
		case 5, 6, 7, 8, 9:
			return OnAttack, nil
		case 2, 3, 4:
			return Offensive, nil
		case 0, 1:
			return Neutral, nil
		}

	} else {
		switch regionCol {
		case 9:
			return Defensive, nil
		case 6, 7, 8:
			return Defensive, nil
		case 3, 4, 5:
			return Defensive, nil
		case 0, 1, 2:
			return UnderPressure, nil
		}
		//return Offensive, nil
	}
	return "", fmt.Errorf("unknown team state for ball in %d col, tor possion with %s", regionCol, possession)
}
*/
