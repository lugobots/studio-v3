package machine

import (
	"context"
	"fmt"
	"github.com/lugobots/lugo4go/v3/specs"
	"sync"
	"time"

	"github.com/lugobots/lugo4go/v3/field"
	"github.com/lugobots/lugo4go/v3/proto"
	srvmgr "github.com/rubens21/srvmgr"
	"go.uber.org/zap"

	"github.com/lugobots/server/v2/config"
	"github.com/lugobots/server/v2/referee"
	"github.com/lugobots/server/v2/server"
)

const InvalidInitialState = proto.GameSnapshot_State(-1)

func NewGamer(
	logger *zap.SugaredLogger,
	devLogger *zap.SugaredLogger,
	gameSnapshot *proto.GameSnapshot,
	diffuser EventDiffuser,
	mutator Mutator,
	config config.Configuration,
	control Debugger,
	starter MatchStartTrigger,
) *LugoServer {

	return &LugoServer{
		logger:    logger,
		devLogger: devLogger,
		snapshot:  gameSnapshot,
		judge:     mutator,
		playersMap: map[proto.Team_Side]map[uint32]playersMap{
			proto.Team_HOME: {},
			proto.Team_AWAY: {},
		},
		orders:               make([]orderMap, 0, specs.MaxPlayers*2),
		orderMu:              sync.Mutex{},
		ListeningTimeLife:    stateTimeLife{},
		WaitingTimeLife:      stateTimeLife{},
		diffuser:             diffuser,
		bug:                  control,
		playerRegistrationMu: sync.Mutex{},
		config:               config,
		serverLife:           srvmgr.NewProcess(),
		starter:              starter,
	}
}

func InitGameSnapShot(config config.Configuration) *proto.GameSnapshot {
	goingNorth := proto.NewZeroedVelocity(proto.North())
	center := field.FieldCenter()
	return &proto.GameSnapshot{
		State: InvalidInitialState, // the game should have an INVALID status when it is not ready for connections yet.
		HomeTeam: &proto.Team{
			Players: make([]*proto.Player, 0, specs.MaxPlayers),
			Side:    proto.Team_HOME,
			Name:    config.HomeTeam.Name,
		},
		AwayTeam: &proto.Team{
			Players: make([]*proto.Player, 0, specs.MaxPlayers),
			Side:    proto.Team_AWAY,
			Name:    config.AwayTeam.Name,
		},
		Turn: 1,
		Ball: &proto.Ball{Velocity: &goingNorth, Position: &center},
	}
}

type playersMap struct {
	player      *proto.Player
	id          string
	stream      proto.Game_JoinATeamServer
	ctx         context.Context
	JumpCounter uint8
	stop        func()
}

type orderMap struct {
	playerNumber uint32
	teamSide     proto.Team_Side
	order        proto.OrderSet
}

type stateTimeLife struct {
	Ctx  context.Context
	Stop context.CancelFunc
}

type LugoServer struct {
	serverLife srvmgr.Process

	snapshot             *proto.GameSnapshot
	playersMap           map[proto.Team_Side]map[uint32]playersMap
	orders               []orderMap
	orderMu              sync.Mutex
	playerRegistrationMu sync.Mutex
	logger               *zap.SugaredLogger
	// used only to logs things that devs can/should/want to see
	devLogger *zap.SugaredLogger
	diffuser  EventDiffuser
	config    config.Configuration

	bug               Debugger
	judge             Mutator
	ListeningTimeLife stateTimeLife

	stopRequest     *server.StopRequest
	isRunning       bool
	WaitingTimeLife stateTimeLife

	starter MatchStartTrigger

	realStartTime *time.Time
}

func (g *LugoServer) Name() string {
	return "game"
}

func (g *LugoServer) Start() error {
	defer g.serverLife.Deceased()
	//g.ctx, g.stopper = context.WithCancel(context.Background())
	g.devLogger.
		With(zap.Duration("listening-duration", g.config.ListeningDuration)).
		Info("starting LugoServer")
	//only exception where the states are affected in gamer file
	if g.snapshot.State != InvalidInitialState {
		return fmt.Errorf("cannot start the machine in start: %s", g.snapshot.State)
	}
	g.runMachine()
	// let's keep the server up until an external request interrup the processor.
	// it is useful when we want to keep the frontend or other audiencies connected while they show or process something
	// e.g. the frontend may be behind the game timeline due animations or pauses
	<-g.serverLife.Died()
	return nil
}

func (g *LugoServer) Stop(ctx context.Context) error {
	if g.stopRequest == nil {
		g.stopRequest = &server.StopRequest{Reason: proto.EventGameOver_EXTERNAL_REQUEST, Blame: proto.EventGameOver_NORMAL}
	}
	g.serverLife.Die()
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		if !g.isRunning {
			return nil
		}
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
		case <-g.serverLife.Dying():
		}
	}
}

func (g *LugoServer) runMachine() {
	gamePhase := proto.GameSnapshot_WAITING
	//g.MachineTimeLife = stateTimeLife{}
	//g.MachineTimeLife.Ctx, g.MachineTimeLife.Stop = context.WithCancel(g.ctx)
	var stopRequest *server.StopRequest
	g.isRunning = true
	startTime := time.Now()
	g.realStartTime = &startTime
	defer func() {
		g.realStartTime = nil
	}()
	for g.stopRequest == nil {
		switch gamePhase {
		case proto.GameSnapshot_WAITING:
			gamePhase, stopRequest = g.GotoWaiting()
		case proto.GameSnapshot_GET_READY:
			gamePhase, stopRequest = g.GotoReady()
		case proto.GameSnapshot_LISTENING:
			if g.bug.ShouldReset() {
				gamePhase = proto.GameSnapshot_WAITING
				continue
			}
			gamePhase, stopRequest = g.GotoListening()
		case proto.GameSnapshot_PLAYING:
			if g.bug.ShouldReset() {
				gamePhase = proto.GameSnapshot_WAITING
				continue
			}
			gamePhase, stopRequest = g.GotoPlaying()
		case proto.GameSnapshot_SHIFTING:
			gamePhase, stopRequest = g.GotoShifting()
		case proto.GameSnapshot_OVER:
			// All methods that returns "GameSnapshot_OVER" also returns a non nil stopRequest. So, this value won't be nil
			//noinspection GoNilness
			g.stopRequest = stopRequest
		}
	}
	g.GotoOver()
}

func (g *LugoServer) RegisterPlayer(request *proto.JoinRequest, stream proto.Game_JoinATeamServer) (ctx context.Context, id string, err error) {
	if g.snapshot.State != proto.GameSnapshot_WAITING && !g.config.DevMode {
		// makes the player waits for a penalty time for having lost connection during the LugoServer.
		// it ensure it won't be intentionally done to move the player faster over the field
		// @todo it should be count turns, not time. But we do not have a ticker for turns.
		// @todo we should accept the goalkeeper as soon as possible.
		time.Sleep(specs.PlayerReconnectionWaitTime)
	}

	g.playerRegistrationMu.Lock()
	defer g.playerRegistrationMu.Unlock()

	if err := validateJoinRequest(g.snapshot, *request); err != nil {
		return nil, "", err
	}

	dir, _ := proto.NewVector(*request.InitPosition, field.FieldCenter())

	initPos := *request.InitPosition
	if request.Number == specs.GoalkeeperNumber {
		initPos = field.GetGoal(request.TeamSide).Center
	}

	newPlayer := &proto.Player{}
	newPlayer.Number = request.Number
	newPlayer.TeamSide = request.TeamSide
	newPlayer.Velocity = &proto.Velocity{
		Speed:     0,
		Direction: dir.Normalize(),
	}
	// this position does not matter much because the mutator resets the position during the `GetReady` phase
	newPlayer.Position = new(proto.Point)
	*newPlayer.Position = initPos

	newPlayer.InitPosition = new(proto.Point)
	*newPlayer.InitPosition = initPos

	mapping := playersMap{
		player: newPlayer,
		stream: stream,
		id:     fmt.Sprintf("%s-%d", request.TeamSide.String(), request.Number),
	}

	mapping.ctx, mapping.stop = context.WithCancel(stream.Context())

	g.playersMap[request.TeamSide][request.Number] = mapping

	team := getTeam(g.snapshot, request.TeamSide)
	team.Players = append(team.Players, newPlayer)

	g.devLogger.
		With("state", g.snapshot.State).
		Infof("%s has joined to the team %s (%d players now)", mapping.id, request.TeamSide.String(), len(team.Players))
	g.diffuser.DiffuseNewPlayer(g.snapshot, newPlayer)

	g.logger.Debugf("%d HOME and %d away ", len(g.snapshot.HomeTeam.Players), len(g.snapshot.AwayTeam.Players))
	if g.snapshot.State == proto.GameSnapshot_WAITING && len(g.snapshot.AwayTeam.Players) == specs.MaxPlayers &&
		len(g.snapshot.HomeTeam.Players) == specs.MaxPlayers {
		g.WaitingTimeLife.Stop()
	}

	return mapping.ctx, mapping.id, nil
}

func (g *LugoServer) ProcessOrder(request proto.JoinRequest, orders proto.OrderSet) (responseCode proto.OrderResponse_StatusCode, err error) {
	//g.logger.Infof("another thing not right: %s", g.snapshot.State.String())
	if g.snapshot.State != proto.GameSnapshot_LISTENING {
		return proto.OrderResponse_NOT_LISTENING, nil
	}

	_, ok := g.playersMap[request.TeamSide][request.Number]
	if !ok {
		return proto.OrderResponse_UNKNOWN_PLAYER, nil
	}

	if orders.Turn != g.snapshot.Turn {
		g.logger.With("team", request.TeamSide).With("number", request.TeamSide).Infof("at turn %d got order for turn %d", g.snapshot.Turn, orders.Turn)
		return proto.OrderResponse_WRONG_TURN, nil
	}

	orderMapping := orderMap{
		playerNumber: request.Number,
		teamSide:     request.TeamSide,
		order:        orders,
	}
	g.orderMu.Lock()
	defer g.orderMu.Unlock()
	g.orders = append(g.orders, orderMapping)

	if len(g.orders) >= len(g.playersMap[proto.Team_HOME])+len(g.playersMap[proto.Team_AWAY]) {
		g.ListeningTimeLife.Stop()
	}
	g.devLogger.
		With("player", fmt.Sprintf("%s-%d", request.TeamSide, request.Number)).
		With("msg", orders.DebugMessage).
		With("turn", g.snapshot.Turn).
		With("orders", orders).
		Info("got to turn's order")
	return proto.OrderResponse_SUCCESS, nil
}

// should only be called AFTER the communication with the player has been interrupted.
func (g *LugoServer) DropPlayer(side proto.Team_Side, number uint32) error {
	g.playerRegistrationMu.Lock()
	defer g.playerRegistrationMu.Unlock()

	team := getTeam(g.snapshot, side)
	delete(g.playersMap[side], number)
	var lostPlayer *proto.Player
	for index, player := range team.Players {
		if player.Number == number {
			lostPlayer = player
			team.Players = append(team.Players[:index], team.Players[index+1:]...)
		}
	}
	if g.snapshot.Ball.Holder != nil && g.snapshot.Ball.Holder.TeamSide == side && g.snapshot.Ball.Holder.Number == number {
		g.snapshot.Ball.Holder = nil
	}
	if lostPlayer != nil {
		g.diffuser.DiffuseLostPlayer(g.snapshot, lostPlayer)
	}

	return nil
}

func (g *LugoServer) State() proto.GameSnapshot_State {
	return g.snapshot.State
}

func (g *LugoServer) isExtraTime() bool {
	return g.snapshot.Period == proto.GameSnapshot_OVERTIME
}

func validateJoinRequest(snapshot *proto.GameSnapshot, request proto.JoinRequest) error {
	// todo: should check the protocol version
	if player := getPlayer(snapshot, request.TeamSide, request.Number); player != nil {
		return ErrPositionNotAvailable
	}

	if request.Number > specs.MaxPlayers || request.Number < 1 {
		return ErrInvalidPlayerNumber
	}

	if request.InitPosition == nil {
		return ErrInvalidInitialPosition
	}

	// do not require a valid position to the goalkeeper
	if request.Number == specs.GoalkeeperNumber {
		return nil
	}

	initPos := *request.InitPosition
	isOnLeftSide := initPos.X < field.FieldCenter().X
	isHome := request.TeamSide == proto.Team_HOME
	if isOnLeftSide != isHome {
		return ErrInvalidInitialPosition
	}

	distToCenter := initPos.DistanceTo(field.FieldCenter())
	if distToCenter < specs.FieldNeutralCenter+(specs.PlayerSize/2) {
		return ErrInvalidInitialPosition
	}

	if initPos.X < 0 || initPos.X > specs.MaxXCoordinate || initPos.Y < 0 || initPos.Y > specs.MaxYCoordinate {
		return ErrInvalidInitialPosition
	}

	if referee.GoalZoneInvasion(initPos, field.HomeSideTeamGoal()) > 0 || referee.GoalZoneInvasion(initPos, field.AwaySideTeamGoal()) > 0 {
		return ErrInvalidInitialPosition
	}

	return nil
}

func getTeam(snapshot *proto.GameSnapshot, teamPlace proto.Team_Side) *proto.Team {
	team := snapshot.HomeTeam
	if teamPlace == proto.Team_AWAY {
		team = snapshot.AwayTeam
	}
	return team
}

func getPlayer(snapshot *proto.GameSnapshot, teamPlace proto.Team_Side, number uint32) *proto.Player {
	team := getTeam(snapshot, teamPlace)
	for _, player := range team.Players {
		if player.Number == number {
			return player
		}
	}
	return nil
}
