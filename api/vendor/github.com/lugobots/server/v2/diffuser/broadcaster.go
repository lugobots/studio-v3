package diffuser

import (
	"context"
	"github.com/google/uuid"
	"github.com/lugobots/lugo4go/v3"
	"github.com/lugobots/lugo4go/v3/proto"
	"github.com/lugobots/lugo4go/v3/specs"
	"github.com/lugobots/server/v2/config"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"sync"
	"time"
)

// Broadcaster implements an EventBroadcaster interface and a BroadcasterServer (gRPC).
// EventBroadcaster may be used by whoever produce game events (e.g. game server or game reproducer), and then
// it will feed its gRPC clients.
type Broadcaster struct {
	proto.UnimplementedBroadcastServer // gambiarra feia do CARALHO feita pelo pessoal que implementou Go grpc
	Logger                             lugo4go.Logger
	watchers                           map[uuid.UUID]EventListenner
	watchersLock                       sync.Mutex
	gameConfig                         config.Configuration
	lastEvent                          *proto.GameEvent

	startingCtx     context.Context
	startingTrigger context.CancelFunc
}

func NewBroadcaster(logger lugo4go.Logger, gameConfig config.Configuration) *Broadcaster {
	var ctx context.Context
	var stop context.CancelFunc

	if gameConfig.StartingMode == config.ConfigStartModeWait {
		ctx, stop = context.WithCancel(context.Background())
	}

	return &Broadcaster{
		Logger:          logger,
		watchers:        map[uuid.UUID]EventListenner{},
		watchersLock:    sync.Mutex{},
		gameConfig:      gameConfig,
		startingCtx:     ctx,
		startingTrigger: stop,
	}
}

func (a *Broadcaster) AddListenner(listener EventListenner) uuid.UUID {
	a.watchersLock.Lock()
	u := uuid.New()
	a.watchers[u] = listener
	if a.lastEvent != nil {
		if err := listener.OnSend(a.lastEvent); err != nil {
			a.Logger.Errorf("error sending last event message to a new broadcast client %s: %s", u, err)
		}
	}
	a.watchersLock.Unlock()
	return u
}

func (a *Broadcaster) DeleteListenner(id uuid.UUID) {
	a.watchersLock.Lock()
	delete(a.watchers, id)
	a.watchersLock.Unlock()
}

func (a *Broadcaster) OnEvent(request *proto.WatcherRequest, server proto.Broadcast_OnEventServer) error {
	// todo check if the request UUID is valid
	u := a.AddListenner(&grpcStreamWrapper{server})
	select {
	case <-server.Context().Done():
		a.Logger.Infof("broadcast client connection closed (uuid %s): %s", request.Uuid, server.Context().Err())
	}
	a.DeleteListenner(u)
	return nil
}

func (a *Broadcaster) GetGameSetup(ctx context.Context, request *proto.WatcherRequest) (*proto.GameSetup, error) {
	// todo check if the request UUID is valid
	return config.ConvertToGameSetup(a.gameConfig, specs.GameDuration)
	//return &lugo.GameSetup{
	//	DevMode:           false,
	//	StartingMode:         lugo.GameSetup_DELAY,
	//	ListeningMode:     lugo.GameSetup_REMOTE,
	//	ListeningDuration: 50,
	//	GameDuration:      1 * 60 * 15,
	//	HomeTeam: &lugo.TeamSettings{
	//		Name:   "The Dummies",
	//		Avatar: "external/profile-team-home.jpg",
	//		Colors: &lugo.TeamColors{
	//			Primary: &lugo.TeamColor{
	//				Red:   240,
	//				Green: 240,
	//				Blue:  240,
	//				//Red:   240,
	//				//Green: 240,
	//				//Blue:  240,
	//			},
	//			Secondary: &lugo.TeamColor{
	//				Red:   0,
	//				Green: 0,
	//				Blue:  240,
	//			},
	//		},
	//	},
	//	AwayTeam: &lugo.TeamSettings{
	//		Name:   "Robossaurs",
	//		Avatar: "external/profile-team-away.jpg",
	//		Colors: &lugo.TeamColors{
	//			Primary: &lugo.TeamColor{
	//				Red:   50,
	//				Green: 50,
	//				Blue:  50,
	//			},
	//			Secondary: &lugo.TeamColor{
	//				Red:   200,
	//				Green: 200,
	//				Blue:  200,
	//			},
	//		},
	//	},
	//}, nil
}

func (a *Broadcaster) StartGame(ctx context.Context, request *proto.StartRequest) (*proto.GameSetup, error) {
	// should check if the requester is the master watcher
	if a.gameConfig.StartingMode == config.ConfigStartModeWait {
		a.startingTrigger()
		return config.ConvertToGameSetup(a.gameConfig, specs.GameDuration)
	}
	return nil, status.Error(codes.FailedPrecondition, "game server is not on 'wait' starting mode")
}

func (a *Broadcaster) StartPlaying() <-chan struct{} {
	holder := make(chan struct{})
	if a.gameConfig.StartingMode == config.ConfigStartModeNoWait {
		close(holder)
		return holder
	}

	go func() {
		for {
			select {
			case <-a.startingCtx.Done():
				close(holder)
				return
			case <-time.Tick(5 * time.Second):
				switch a.gameConfig.StartingMode {
				case config.ConfigStartModeDelay:
					a.Logger.Infof("waiting a client frontend be connected")
				case config.ConfigStartModeWait:
					a.Logger.Infof("waiting master watcher request starting the game")
				default:
					a.Logger.Warnf("broacaster does not wait who should start the game - starting mode '%s'", a.gameConfig.StartingMode)
				}
			}
		}
	}()

	return holder
}

func (a *Broadcaster) Send(eventMsg *proto.GameEvent) {
	a.watchersLock.Lock()
	defer a.watchersLock.Unlock()

	holder := make(chan bool, 1)
	wg := sync.WaitGroup{}
	a.lastEvent = eventMsg
	//https://play.golang.org/p/bEPvJlj2nWv
	for u, client := range a.watchers {
		wg.Add(1)
		go func(c EventListenner) {
			defer wg.Done()
			<-holder
			if err := c.OnSend(eventMsg); err != nil {
				a.Logger.Errorf("error sending message to a broadcast client %s: %s", u, err)
			}
		}(client)
	}
	close(holder)
	wg.Wait()
}

type grpcStreamWrapper struct {
	proto.Broadcast_OnEventServer
}

func (w *grpcStreamWrapper) OnSend(gameEvent *proto.GameEvent) error {
	return w.Send(gameEvent)
}
