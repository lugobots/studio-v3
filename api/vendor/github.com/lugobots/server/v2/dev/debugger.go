package dev

import (
	"context"
	"time"

	"github.com/lugobots/lugo4go/v3/proto"
)

func NewBug() *Bug {
	return &Bug{}
}

type Bug struct {
	ctx                            context.Context
	stopper                        context.CancelFunc
	current                        proto.EventDebugBreakpoint_Breakpoint
	onGoingCtx                     context.Context
	onGoingDone                    context.CancelFunc
	callbackOnResumeListeningPhase context.CancelFunc
	rushModeCtx                    context.Context

	resetGame chan bool
}

func (b *Bug) isNil() bool {
	if b.ctx != nil {
	}
	return b.ctx == nil || b.ctx.Err() != nil
}

func (b *Bug) StopAt(ctx context.Context, breakpoint proto.EventDebugBreakpoint_Breakpoint) bool {
	b.current = breakpoint
	if !b.isNil() {
		b.stopper()
	}
	b.ctx, b.stopper = context.WithCancel(context.Background())
	//We need to know when the target was reached
	b.onGoingCtx, b.onGoingDone = context.WithCancel(ctx)
	<-b.onGoingCtx.Done()
	return b.onGoingCtx.Err() == context.Canceled && ctx.Err() == nil
}

func (b *Bug) Wait(breakpoint proto.EventDebugBreakpoint_Breakpoint, maxWaitTime time.Duration, beforeWait func()) error {
	if b.isNil() {
		return ErrBrkPointClosed
	}
	if b.current != breakpoint {
		return ErrBrkPointNotWaiting
	}
	beforeWait()
	b.onGoingDone()
	select {
	case <-b.ctx.Done():
		return nil
	case <-time.After(maxWaitTime):
		return ErrBrkPointTimeExceeded
	}
}

func (b *Bug) ShouldReset() bool {
	select {
	case _, ok := <-b.resetGame:
		return ok
	default:
		return false
	}
}

func (b *Bug) WaitResetGame(ctx context.Context) {
	b.resetGame = make(chan bool)
	defer close(b.resetGame)

	// in case it is waiting for orders
	b.ResumeListeningPhase()

	// in case it is at a break-point
	//_ = b.Close()

	select {
	case <-ctx.Done():
	case b.resetGame <- true:
	}
}

func (b *Bug) Close() error {
	if b.isNil() {
		return ErrBrkPointAlreadyClosed
	}
	b.stopper()
	return nil
}

func (b *Bug) OnResumeListeningPhase(rushModeCtx context.Context, stop context.CancelFunc) {
	b.callbackOnResumeListeningPhase = stop
	b.rushModeCtx = rushModeCtx
}
func (b *Bug) ResumeListeningPhase() {
	if b.callbackOnResumeListeningPhase != nil {
		<-b.rushModeCtx.Done()
		b.callbackOnResumeListeningPhase()
	}
}

//
//func (b *Bug) PauseOrResume(ctx context.Context, _ *empty.Empty) (*lugo.CommandResponse, error) {
//	if err := b.Close(); err == ErrBrkPointAlreadyClosed {
//		return b.NextTurn(ctx, nil)
//	}
//
//	return &lugo.CommandResponse{
//		GameSnapshot: nil,
//		Code:         lugo.CommandResponse_SUCCESS,
//	}, nil
//}
//
//func (b *Bug) NextTurn(ctx context.Context, _ *empty.Empty) (*lugo.CommandResponse, error) {
//	ctxTimeOut, _ := context.WithTimeout(ctx, MaxWaitGoto)
//	if b.StopAt(ctxTimeOut, BreakpointTurn) {
//		return &lugo.CommandResponse{
//			GameSnapshot: nil,
//			Code:         lugo.CommandResponse_SUCCESS,
//		}, nil
//	}
//	return &lugo.CommandResponse{
//		GameSnapshot: nil,
//		Code:         lugo.CommandResponse_DEADLINE_EXCEEDED,
//		Details:      "command waited too long until the game be interrupted.",
//	}, nil
//}
//
//func (b *Bug) NextOrder(ctx context.Context, _ *empty.Empty) (*lugo.CommandResponse, error) {
//	ctxTimeOut, _ := context.WithTimeout(ctx, MaxWaitGoto)
//	if b.StopAt(ctxTimeOut, BreakpointOrder) {
//		return &lugo.CommandResponse{
//			GameSnapshot: nil,
//			Code:         lugo.CommandResponse_SUCCESS,
//		}, nil
//	}
//	return &lugo.CommandResponse{
//		GameSnapshot: nil,
//		Code:         lugo.CommandResponse_DEADLINE_EXCEEDED,
//		Details:      "command waited too long until the game be interrupted.",
//	}, nil
//}
//
//func (b *Bug) SetBallProperties(context.Context, *lugo.BallProperties) (*lugo.CommandResponse, error) {
//	panic("implement me")
//}
//
//func (b *Bug) SetPlayerProperties(context.Context, *lugo.PlayerProperties) (*lugo.CommandResponse, error) {
//	panic("implement me")
//}
//
//func (b *Bug) SetGameProperties(context.Context, *lugo.GameProperties) (*lugo.CommandResponse, error) {
//	panic("implement me")
//}
//
//func (b *Bug) Debugger() machine.Debugger {
//	return b.}
