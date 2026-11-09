package lugo4go

import (
	"context"

	"github.com/lugobots/lugo4go/v3/proto"
)

func newSender(grpcClient proto.GameClient) *sender {
	return &sender{
		GRPCClient: grpcClient,
	}
}

type sender struct {
	GRPCClient proto.GameClient
}

func (s *sender) Send(ctx context.Context, turn uint32, orders []proto.PlayerOrder, debugMsg string) (*proto.OrderResponse, error) {
	orderSet := &proto.OrderSet{
		Turn:         turn,
		DebugMessage: debugMsg,
		Orders:       []*proto.Order{},
	}
	for _, order := range orders {
		orderSet.Orders = append(orderSet.Orders, &proto.Order{Action: order})
	}
	return s.GRPCClient.SendOrders(ctx, orderSet)
}
