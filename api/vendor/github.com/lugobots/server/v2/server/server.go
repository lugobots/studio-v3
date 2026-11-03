package server

import (
	"context"
	"fmt"
	"sync"

	"github.com/lugobots/lugo4go/v3/proto"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/stats"
	"google.golang.org/grpc/status"
)

const ConnectionTagName = "connection_seq"

func NewServer(logger *zap.SugaredLogger, gamer Gamer) *GameServer {
	return &GameServer{
		Gamer:          gamer,
		muConn:         sync.Mutex{},
		Logger:         logger,
		connectionsMap: map[uint16]proto.JoinRequest{},
	}
}

type GameServer struct {
	proto.UnimplementedGameServer
	proto.UnimplementedHealthServer
	Logger         *zap.SugaredLogger
	Gamer          Gamer
	connectionSeq  uint16
	connectionsMap map[uint16]proto.JoinRequest
	muConn         sync.Mutex
}

func (s *GameServer) TagRPC(ctx context.Context, sts *stats.RPCTagInfo) context.Context {

	// TODO get the user agent to find out the language of the bot
	//s.Logger.Infof("user agent connted: %v", ctx.Value("user-agent"))
	return ctx
}

func (s *GameServer) HandleRPC(context.Context, stats.RPCStats) {

}

func (s *GameServer) JoinATeam(request *proto.JoinRequest, stream proto.Game_JoinATeamServer) error {
	//q := stream.Context().(grpc.ServerStream)
	defer func() {
		if r := recover(); r != nil {
			s.Logger.With("panic", r).Error("connection interrupted by panic in the stream")
		}
	}()
	connectionSeq, ok := stream.Context().Value(ConnectionTagName).(uint16)
	if !ok {
		err := status.Error(codes.Internal, "internal error: connection missing tag")
		s.Logger.Error(err)
		return err
	}

	playerCtx, playerId, err := s.Gamer.RegisterPlayer(request, stream)
	if err != nil {
		s.Logger.Error(err)
		return status.Errorf(codes.InvalidArgument, "registration failed: %s", err)
	}

	//let's keep the player connection while it is listening to the stream
	s.muConn.Lock()
	_, connected := s.connectionsMap[connectionSeq]
	if connected {
		return status.Errorf(codes.AlreadyExists, "this grpc connection is already playing")
	}
	s.connectionsMap[connectionSeq] = *request
	s.muConn.Unlock()
	select {
	case <-stream.Context().Done():
		s.Logger.With(zap.String("player_id", playerId)).Warnf("connection closed by the player (%s)", stream.Context().Err())
	case <-playerCtx.Done():
		s.Logger.With(zap.String("player_id", playerId)).Infof("connection closed by the server (%s)", playerCtx.Err())
	}

	//let's drop the player if it is no longer listening to the stream
	s.muConn.Lock()
	if err := s.Gamer.DropPlayer(request.TeamSide, request.Number); err != nil {
		s.Logger.Warnf("error when tried to drop player: %s", err)
	}
	delete(s.connectionsMap, connectionSeq)
	s.muConn.Unlock()

	return nil
}

func (s *GameServer) SendOrders(ctx context.Context, orders *proto.OrderSet) (*proto.OrderResponse, error) {
	connectionSeq, ok := ctx.Value(ConnectionTagName).(uint16)
	if !ok {
		err := fmt.Errorf("internal error: connection missing tag")
		s.Logger.Error(err)
		return nil, err
	}
	playerConn, ok := s.connectionsMap[connectionSeq]
	if !ok {
		s.Logger.Errorf("orders received from non mapped player: %d", connectionSeq)
		return &proto.OrderResponse{
			Code:    proto.OrderResponse_UNKNOWN_PLAYER,
			Details: fmt.Sprintf(""),
		}, nil
	}

	espCode, err := s.Gamer.ProcessOrder(playerConn, *orders)
	if err != nil {
		s.Logger.Errorf("orders received from non mapped player: %d", connectionSeq)
		return &proto.OrderResponse{
			Code: espCode,
		}, nil
	}

	return &proto.OrderResponse{
		Code:    espCode,
		Details: fmt.Sprintf("enqueued"),
	}, nil
}

func (s *GameServer) TagConn(ctx context.Context, info *stats.ConnTagInfo) context.Context {
	// TODO bug: if the client make a pool of connections, a single client may send orders for all players!
	// we should find a way to detect the same client
	s.muConn.Lock()
	defer s.muConn.Unlock()
	s.connectionSeq++
	return context.WithValue(ctx, ConnectionTagName, s.connectionSeq)
}

func (s *GameServer) HandleConn(ctx context.Context, sts stats.ConnStats) {
	connectionSeq, ok := ctx.Value(ConnectionTagName).(uint16)
	if !ok {
		s.Logger.Errorf("connection missing seq number: %v", ctx)
	}

	switch sts.(type) {
	case *stats.ConnBegin:
		s.Logger.Infof("new gRPC connection, seq #%d (%v)", connectionSeq, sts.IsClient())
		break
	case *stats.ConnEnd:
		s.Logger.Infof("player disconnected, seq #%d", connectionSeq)
		break
	}
}

func (s *GameServer) Check(_ context.Context, _ *proto.HealthCheckRequest) (*proto.HealthCheckResponse, error) {
	if s.Gamer.State() >= proto.GameSnapshot_WAITING {
		s.Logger.With("state", s.Gamer.State()).Info("checking health status: serving")
		return &proto.HealthCheckResponse{
			Status: proto.HealthCheckResponse_SERVING,
		}, nil
	}
	s.Logger.With("state", s.Gamer.State()).Info("checking health status: not serving yet")
	return &proto.HealthCheckResponse{
		Status: proto.HealthCheckResponse_NOT_SERVING,
	}, nil

}

func (s *GameServer) Watch(request *proto.HealthCheckRequest, server proto.Health_WatchServer) error {
	panic("sorry, not implemented yet.")
}
