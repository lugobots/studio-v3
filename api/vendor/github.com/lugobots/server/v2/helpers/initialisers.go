package helpers

import (
	"context"
	"fmt"
	"github.com/lugobots/frontend/web/app"
	"github.com/lugobots/frontend/web/app/broker"
	"github.com/lugobots/lugo4go/v3/specs"
	"github.com/lugobots/recorder"
	"github.com/lugobots/server/v2/config"
	"github.com/lugobots/server/v2/diffuser"
	"github.com/pkg/errors"
	"github.com/rubens21/srvmgr"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"io/ioutil"
	"log"
	"net/http"
	"net/url"
	"time"
)

func InitializeGameRecorder(gameConfig config.Configuration, logger *zap.SugaredLogger) (diffuser.EventListenner, recorder.FileWriter, error) {
	localWriter, err := recorder.NewLocalFileWriter(gameConfig.GameOutPut)
	if err != nil {
		return nil, nil, errors.Wrap(err, "failed to create a writer to write the game export file")
	}

	gameSetup, err := config.ConvertToGameSetup(gameConfig, specs.GameDuration)
	if err != nil {
		return nil, nil, errors.Wrap(err, "internal error preparing game setup")
	}

	gameRecorder, err := recorder.NewLugoEventRecorder(localWriter, gameSetup)
	if err != nil {
		return nil, nil, errors.Wrap(err, "internal error preparing game setup")
	}

	return gameRecorder, localWriter, nil

}

func InitializeFrontend(gameConfig config.Configuration, logger *zap.SugaredLogger, srvManager *srvmgr.Manager) error {
	// the eventBroker listen to the game event, and send it to the frontend
	eventBroker := broker.NewBinder(app.Config{
		GRPCAddress:         fmt.Sprintf(":%d", gameConfig.GRPCPort), /// CONFIG
		GRPCInsecure:        true,
		StaysIfDisconnected: true,
	}, logger.Named("broker"))

	frontEndrv := app.NewHandler("", "local", eventBroker) ///// CONFIG
	httpServer := &http.Server{
		Addr:    fmt.Sprintf(":%d", gameConfig.HTTPPort), /// CONFIG
		Handler: frontEndrv,
	}

	// TODO: this gRPC should be optional and turned off by default
	//broadcasterSyncer := propagator.NewPropagator(eventBroker)
	//grpcServer := grpc.NewServer()
	//proto.RegisterBroadcastServer(grpcServer, broadcasterSyncer)
	//reflection.Register(grpcServer)

	//lis, err := net.Listen("tcp", fmt.Sprintf(":%d", 2121))
	//if err != nil {
	//	return fmt.Errorf("failed on listen grpc port (frontend broadcast syncer): %s", err)
	//}

	//srvManager.AddTask(srvmgr.GrpcServerAsTask("frontend-grpc-server", grpcServer, lis))

	srvManager.AddTask(eventBroker)
	srvManager.AddTask(srvmgr.MakeTask(
		"http-server",
		func() error {
			err := httpServer.ListenAndServe()
			if !errors.Is(err, http.ErrServerClosed) {
				return err
			}
			return nil
		},
		func(ctx context.Context) error {
			if err := httpServer.Shutdown(ctx); err != nil {
				return errors.Wrap(err, "error stopping http server")
			}
			return nil
		},
	))

	return nil
}

func CheckNerVersion(currentVersion string, devLogger *zap.SugaredLogger) {
	defer func() {
		if err := recover(); err != nil {
			// nothing to do
		}
	}()
	target, _ := url.Parse("https://lugobots.ai")
	//target, _ := url.Parse("http://localhost")
	target.Path = "/api/server/check-update"

	params := url.Values{}
	params.Add("version", currentVersion)
	target.RawQuery = params.Encode()

	client := http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return nil
		},
		Timeout: time.Second * 3,
	}

	resp, err := client.Get(target.String())
	if err == nil {
		defer resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			newestVersion, _ := ioutil.ReadAll(resp.Body)
			if string(newestVersion) != currentVersion {
				devLogger.
					With("current-version", currentVersion).
					With("new-version", string(newestVersion)).
					Warnf("New Game Server version available! Please run 'docker pull lugobots/server:latest' to pull the latest version!")
			}
		}
	}
}

func InitializeLoggers(gameConfig config.Configuration, logger *zap.SugaredLogger) (*zap.SugaredLogger, *zap.SugaredLogger) {
	// if we are running on verbose mode, both loggers will log everything
	devLogger := logger

	// if it is running in totally quiet mode, both loggers will be quiet
	if gameConfig.Quiet {
		devLogger = zap.NewNop().Sugar()
		logger = zap.NewNop().Sugar()

		// if it is NOT verbose, the internal logger will be quiet, but the devLogger will log the information that helps to see what is going on during the game
	} else if !gameConfig.VerboseLog {
		configZap := zap.NewDevelopmentConfig()
		configZap.EncoderConfig.EncodeLevel = zapcore.CapitalColorLevelEncoder
		configZap.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
		configZap.DisableCaller = true
		configZap.DisableStacktrace = true
		configZap.Development = false
		configZap.Level.SetLevel(zapcore.DebugLevel)
		loggerBuilder, err := configZap.Build()
		if err != nil {
			log.Fatalf("could not initiliase looger: %s", err)
		}
		devLogger = loggerBuilder.Sugar()
		logger = zap.NewNop().Sugar()
	}

	return devLogger, logger
}
