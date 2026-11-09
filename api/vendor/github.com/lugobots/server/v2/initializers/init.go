package helpers

import (
	"context"
	"fmt"
	"github.com/lugobots/lugo4go/v3/proto"
	"github.com/lugobots/server/v2/config"
	"github.com/lugobots/server/v2/dev"
	"github.com/lugobots/server/v2/diffuser"
	"github.com/lugobots/server/v2/helpers"
	"github.com/lugobots/server/v2/machine"
	"github.com/lugobots/server/v2/referee"
	"github.com/lugobots/server/v2/server"
	"github.com/rubens21/srvmgr"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
	"net"
	"time"
)

func Play(gameConfig config.Configuration, checkForUpdates bool, baseLogger *zap.SugaredLogger) (*srvmgr.Manager, *grpc.Server, error) {
	// the devLogger only logs info about the game itself, and does not log information about the internal process
	// the logger logs the internal information about the server process, and helps us to debug the server
	devLogger, logger := helpers.InitializeLoggers(gameConfig, baseLogger)

	// initialising the Services Managers, that will start everything and keep everything OR nothing running
	srvManager := srvmgr.NewManager(logger, 5*time.Second)

	// silently checks for new versions
	if checkForUpdates {
		go helpers.CheckNerVersion(config.SERVER_VERSION, devLogger)
	}

	broadcaster := diffuser.NewBroadcaster(logger.Named("broadcaster"), gameConfig)
	if gameConfig.GameOutPut != "" {
		gameRecorder, recorderWritter, err := helpers.InitializeGameRecorder(gameConfig, logger)
		if err != nil {
			return nil, nil, err
		}
		broadcaster.AddListenner(gameRecorder)
		logger.With("path", gameConfig.GameOutPut).Info("recording game")
		utilAsked, cancel := context.WithCancel(context.Background())

		// creating task to close the file at the end of the game.
		srvManager.AddTask(srvmgr.MakeTask("close-recorder-file", func() error {
			<-utilAsked.Done()
			return nil
		},
			func(ctx context.Context) error {
				err := recorderWritter.Close(ctx)
				if err != nil {
					logger.With("error", err).Error("failed while closing the recording file")
				}
				cancel()
				return nil
			},
		))
	}

	// initialises the interface that is used by the server to throw events from the game
	diffuserGuy := diffuser.NewDiffuser(broadcaster)

	// initialises the interface used to manipulate changes on the game snapshot
	mutator := referee.NewMutator(logger.Named("mutator"))

	// initialises a snapshot
	snapshot := machine.InitGameSnapShot(gameConfig)

	// initialises the interface used to create breakpoints during the game
	debugger := dev.NewBug()

	// initialises the Remote control gRPC service that is used on dev mode to change the game's elements
	devControl := dev.NewRemote(snapshot, debugger, mutator)

	// initialises the game machine - responsible to control the game state and process the orders, etc
	gamer := machine.NewGamer(
		logger.Named("gamer"),
		devLogger,
		snapshot,
		diffuserGuy,
		mutator,
		gameConfig,
		debugger,
		broadcaster,
	)

	// initialises the game server, that controls the Game gRPC service (connections, receiving orders, etc)
	lugoServer := server.NewServer(logger.Named("game-server"), gamer)

	// initialises the gRPC server and assign the grpc services handlers
	grpcServer := grpc.NewServer(grpc.StatsHandler(lugoServer))
	reflection.Register(grpcServer)

	proto.RegisterGameServer(grpcServer, lugoServer)
	proto.RegisterHealthServer(grpcServer, lugoServer)
	proto.RegisterBroadcastServer(grpcServer, broadcaster)
	if gameConfig.DevMode {
		proto.RegisterRemoteServer(grpcServer, devControl)
	}

	// opening tcp listener for thr gRPC server
	lis, err := net.Listen("tcp", fmt.Sprintf(":%d", gameConfig.GRPCPort))
	if err != nil {
		return nil, nil, fmt.Errorf("failed on listen grpc port: %s", err)
	}
	devLogger.
		With("port", fmt.Sprintf(":%d", gameConfig.GRPCPort)).
		With("waiting_duration", gameConfig.WaitingDuration.String()).
		With("knockout_max_score_diff", gameConfig.KnockoutMaxScoreDiff).
		With("knockout_time_limit", gameConfig.KnockoutTimeLimit.String()).
		With("dev_mode", gameConfig.DevMode).
		With("golden_goal", gameConfig.EnableGoldenGoal).
		Info("starting service")

	if !gameConfig.Headless {
		if err := helpers.InitializeFrontend(gameConfig, logger, srvManager); err != nil {
			return nil, nil, fmt.Errorf("failed to start the frontend server: %s", err)
		}
	}

	srvManager.AddTask(gamer)
	srvManager.AddTask(srvmgr.GrpcServerAsTask("grpc-server", grpcServer, lis))

	return srvManager, grpcServer, nil
}
