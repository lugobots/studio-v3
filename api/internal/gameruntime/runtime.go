// Package gameruntime starts the local game server and game-frontend HTTP
// using production github.com/lugobots/server/v2 contracts (same path Studio V2
// uses: headless Play + helpers.InitializeFrontend).
package gameruntime

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"

	serverConfig "github.com/lugobots/server/v2/config"
	"github.com/lugobots/server/v2/helpers"
	serverInits "github.com/lugobots/server/v2/initializers"
	"github.com/lugobots/server/v2/machine"
	"github.com/rubens21/srvmgr"
	"go.uber.org/zap"

	"studio-v3/api/internal/procreg"
)

const (
	managerStopTimeout = 5 * time.Second
	readyWaitTimeout   = 8 * time.Second
	readyPollInterval  = 50 * time.Millisecond
)

// Starter starts, stops, and reports the local game server and game frontend.
type Starter interface {
	Start(ports Ports) error
	Running() bool
	Stop() error
}

// Local starts an in-process game server (gRPC) and game-frontend HTTP server,
// registering shutdown with the process registry.
type Local struct {
	Registry *procreg.Registry
	Logger   *zap.SugaredLogger

	mu      sync.Mutex
	started bool
	hookID  procreg.ID
	stopFn  func() error
}

// New returns a Local starter that registers cleanup on reg.
func New(reg *procreg.Registry) *Local {
	if reg == nil {
		panic("gameruntime: New(nil registry)")
	}
	return &Local{
		Registry: reg,
		Logger:   zap.NewNop().Sugar(),
	}
}

// Running reports whether Start has successfully brought up the game runtime
// and Stop has not yet torn it down.
func (l *Local) Running() bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.started
}

// Stop shuts down the registered game frontend/server managers, unregisters
// the procreg hook, tears down any remaining session children on the shared
// registry (match bots), and resets started so a later Start can succeed.
// Stop is safe when already stopped.
func (l *Local) Stop() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.started {
		return nil
	}

	hookID := l.hookID
	stopFn := l.stopFn
	l.Registry.Unregister(hookID)

	var mgrErr error
	if stopFn != nil {
		mgrErr = stopFn()
	}
	// Match bots (and any other session children) share this registry; clear
	// them so stop does not leave orphans after the game server is down.
	botErr := l.Registry.ShutdownAll()

	l.hookID = 0
	l.stopFn = nil
	l.started = false
	return errors.Join(mgrErr, botErr)
}

// Start brings up the game server and frontend. It is idempotent: a second
// call while already started returns nil without restarting.
func (l *Local) Start(ports Ports) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.started {
		return nil
	}
	if ports.GameServer <= 0 || ports.GameFrontend <= 0 {
		return fmt.Errorf("invalid ports: game_server=%d game_frontend=%d", ports.GameServer, ports.GameFrontend)
	}

	logger := l.Logger
	if logger == nil {
		logger = zap.NewNop().Sugar()
	}

	teams, err := serverConfig.GetDefaultConfig()
	if err != nil {
		return fmt.Errorf("default team config: %w", err)
	}

	cfg := serverConfig.Configuration{
		GRPCPort:             uint16(ports.GameServer),
		HTTPPort:             uint16(ports.GameFrontend),
		WaitingDuration:      machine.TimeLimitTeamsConnect,
		ListeningDuration:    machine.DefaultListeningDuration,
		GetReadyDuration:     machine.PhaseReadyDuration,
		ListeningMode:        serverConfig.ListeningModeTimer,
		DevMode:              true,
		VerboseLog:           false,
		Quiet:                true,
		Headless:             true, // frontend is started separately below
		StartingMode:         serverConfig.ConfigStartModeNoWait,
		EnableGoldenGoal:     true,
		HomeTeam:             teams.HomeTeam,
		AwayTeam:             teams.AwayTeam,
		KnockoutTimeLimit:    time.Minute,
		KnockoutMaxScoreDiff: 10,
	}

	frontMgr := srvmgr.NewManager(logger.Named("game-frontend"), managerStopTimeout)
	if err := helpers.InitializeFrontend(cfg, logger, frontMgr); err != nil {
		return fmt.Errorf("start game frontend: %w", err)
	}

	gameMgr, _, err := serverInits.Play(cfg, false, logger.Named("game-server"))
	if err != nil {
		return fmt.Errorf("start game server: %w", err)
	}

	frontErr := make(chan error, 1)
	gameErr := make(chan error, 1)
	go func() { frontErr <- frontMgr.Run() }()
	go func() { gameErr <- gameMgr.Run() }()

	if err := waitFrontendReady(ports.GameFrontend, readyWaitTimeout); err != nil {
		ctx, cancel := context.WithTimeout(context.Background(), managerStopTimeout)
		_ = frontMgr.Shutdown(ctx)
		_ = gameMgr.Shutdown(ctx)
		cancel()
		return fmt.Errorf("game frontend not reachable: %w", err)
	}

	// Surface early run failures without blocking the happy path.
	select {
	case err := <-frontErr:
		ctx, cancel := context.WithTimeout(context.Background(), managerStopTimeout)
		_ = gameMgr.Shutdown(ctx)
		cancel()
		if err != nil {
			return fmt.Errorf("game frontend exited: %w", err)
		}
		return errors.New("game frontend exited unexpectedly")
	case err := <-gameErr:
		ctx, cancel := context.WithTimeout(context.Background(), managerStopTimeout)
		_ = frontMgr.Shutdown(ctx)
		cancel()
		if err != nil {
			return fmt.Errorf("game server exited: %w", err)
		}
		return errors.New("game server exited unexpectedly")
	default:
	}

	stopFn := func() error {
		ctx, cancel := context.WithTimeout(context.Background(), managerStopTimeout)
		defer cancel()
		return errors.Join(frontMgr.Shutdown(ctx), gameMgr.Shutdown(ctx))
	}
	hookID := l.Registry.Register(procreg.Hook(stopFn))

	l.hookID = hookID
	l.stopFn = stopFn
	l.started = true
	return nil
}

func waitFrontendReady(port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	url := fmt.Sprintf("http://127.0.0.1:%d/", port)
	client := &http.Client{Timeout: 500 * time.Millisecond}
	var last error
	for time.Now().Before(deadline) {
		if err := probeTCP(port); err != nil {
			last = err
			time.Sleep(readyPollInterval)
			continue
		}
		resp, err := client.Get(url)
		if err != nil {
			last = err
			time.Sleep(readyPollInterval)
			continue
		}
		_ = resp.Body.Close()
		if resp.StatusCode > 0 {
			return nil
		}
		last = fmt.Errorf("unexpected status %d", resp.StatusCode)
		time.Sleep(readyPollInterval)
	}
	if last == nil {
		last = errors.New("timeout")
	}
	return last
}

func probeTCP(port int) error {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 200*time.Millisecond)
	if err != nil {
		return err
	}
	return conn.Close()
}
