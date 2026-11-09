package lugo4go

import (
	"context"
	"fmt"
	"io"
	"sync"
	"time"

	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/stats"

	"github.com/lugobots/lugo4go/v3/proto"
)

// ProtocolVersion defines the current game protocol
const ProtocolVersion = "0.0.1"

// NewClient creates a Lugo4Go client that will hide common logic and let you focus on your bot.
func NewClient(config Config, logger *zap.SugaredLogger) (*Client, error) {
	var err error
	c := &Client{
		config: config,
		Logger: logger,
	}

	// A bot may eventually do not listen to server Stream (ignoring OnNewTurn). In this case, the Client must stop
	// when the gRPC connection is closed.
	connHandler := grpc.WithStatsHandler(c)

	ctx, _ := context.WithTimeout(context.Background(), 3*time.Second)

	// @todo there are some gRPC options that we should take a look tro improve this part.
	if config.Insecure {
		c.grpcConn, err = grpc.DialContext(ctx, config.GRPCAddress, grpc.WithBlock(), grpc.WithInsecure(), connHandler)
	} else {
		c.grpcConn, err = grpc.DialContext(ctx, config.GRPCAddress, grpc.WithBlock(), connHandler)
	}
	if err != nil {
		return nil, err
	}

	c.Logger.Debug("trying to connect to the server")
	c.GRPCClient = proto.NewGameClient(c.grpcConn)

	if c.Stream, err = c.GRPCClient.JoinATeam(context.Background(), &proto.JoinRequest{
		Token:           config.Token,
		Number:          uint32(config.Number),
		InitPosition:    config.InitialPosition,
		TeamSide:        config.TeamSide,
		ProtocolVersion: ProtocolVersion,
	}); err != nil {
		return nil, err
	}
	c.Logger.Debug("connected to the game server")

	c.Sender = newSender(c.GRPCClient)
	return c, nil
}

// Client handle the gRPC stuff and provide you an easy way to handle the game messages
type Client struct {
	Stream     proto.Game_JoinATeamClient
	GRPCClient proto.GameClient
	grpcConn   *grpc.ClientConn
	Logger     Logger
	Sender     OrderSender
	config     Config
}

// PlayAsBot is a sugared Play mode that uses an RawBot from coach package.
// Coach RawBot creates basic player states to help the development of new bots.
func (c *Client) PlayAsBot(bot Bot) error {
	handler := hewRawBotWrapper(bot, c.Logger, c.config.Number, c.config.TeamSide)
	return c.Play(handler)
}

// Play starts the player communication with the server. The RawBot will receive the raw snapshot from the
// game server. The context passed to the rawBotWrapper will be canceled as soon a new turn starts.
func (c *Client) Play(rawBot RawBot) error {
	var turnCrx context.Context
	var stop context.CancelFunc = func() {}
	c.Logger.Debug("ready to play")
	m := sync.Mutex{}
	for {
		snapshot, err := c.Stream.Recv()
		stop()
		if err != nil {
			if err != io.EOF {
				return fmt.Errorf("%w: %s", ErrGRPCConnectionLost, err)
			}
			return ErrGRPCConnectionClosed
		}
		mySide := c.config.TeamSide
		myNumber := c.config.Number
		// TODO bad practice - create a SnapshotToolMaker to allow it to be created externally
		snapshotInspector, err := NewGameSnapshotInspector(mySide, myNumber, snapshot)

		if snapshot.State == proto.GameSnapshot_GET_READY {
			rawBot.GetReadyHandler(context.Background(), snapshotInspector)
			continue
		}
		if snapshot.State != proto.GameSnapshot_LISTENING {
			c.Logger.Errorf("wrong server version? the server sent a snapshot in an expected state: '%s'", snapshot.State)
			continue
		}
		turnCrx, stop = context.WithCancel(context.Background())
		// to avoid race conditions we need to ensure that the loop can only start after the Go routine has started.
		mustHasStarted := make(chan bool)

		go func() {
			defer func() {
				if r := recover(); r != nil {
					fmt.Printf("%v", r)
					c.Logger.Warnf("panic recovered: %v", r)
				}
			}()
			// make this looks clear!
			m.Lock()
			close(mustHasStarted)
			defer m.Unlock()

			if err != nil {
				c.Logger.Errorf("failed to create an inspector for the game snapshot: %s", err)
				return
			}

			playerOrders, debugMsg, err := rawBot.TurnHandler(turnCrx, snapshotInspector)
			if err != nil {
				c.Logger.Errorf("failed to orders to the turn %d: %s", snapshot.Turn, err)
				return
			}

			resp, errSend := c.Sender.Send(turnCrx, snapshot.Turn, playerOrders, debugMsg)
			if errSend != nil {
				c.Logger.Errorf("error sending orders to turn %d: %s", snapshot.Turn, errSend)
			} else if resp.Code != proto.OrderResponse_SUCCESS {
				c.Logger.Errorf("order not sent during turn %d: %s", snapshot.Turn, resp.String())
			}

		}()
		<-mustHasStarted
	}
}

// Stop drops the communication with the gRPC server.
func (c *Client) Stop() error {
	return c.grpcConn.Close()
}

// TagRPC implements the interface required by gRPC rawBotWrapper
func (c *Client) TagRPC(ctx context.Context, _ *stats.RPCTagInfo) context.Context {
	return ctx
}

// HandleRPC implements the interface required by gRPC rawBotWrapper
func (c *Client) HandleRPC(context.Context, stats.RPCStats) {

}

// TagConn implements the interface required by gRPC rawBotWrapper
func (c *Client) TagConn(ctx context.Context, _ *stats.ConnTagInfo) context.Context {
	return ctx
}

// HandleConn implements the interface required by gRPC rawBotWrapper
func (c *Client) HandleConn(_ context.Context, sts stats.ConnStats) {
	switch sts.(type) {
	case *stats.ConnEnd:
		_ = c.Stop()
		break
	}
}
