package machine

import (
	"context"
	"fmt"
	"github.com/lugobots/lugo4go/v3/specs"
	"math"
	"math/rand"
	"sync"
	"time"

	"github.com/lugobots/lugo4go/v3/proto"
	"go.uber.org/zap"

	"github.com/lugobots/server/v2/config"
	"github.com/lugobots/server/v2/server"
)

func (g *LugoServer) GotoWaiting() (proto.GameSnapshot_State, *server.StopRequest) {
	log := g.changeState(proto.GameSnapshot_WAITING)

	g.WaitingTimeLife.Ctx, g.WaitingTimeLife.Stop = context.WithTimeout(context.Background(), g.config.WaitingDuration)

	g.devLogger.With("state", g.snapshot.State).With("turn", g.snapshot.Turn).Info("Waiting for players")

	select {
	case <-g.WaitingTimeLife.Ctx.Done():
	case <-g.serverLife.Died():
		log.Debug("stopping waiting for players, the server is already stopped.")
		return proto.GameSnapshot_OVER, nil
	}

	homeReady := len(g.snapshot.HomeTeam.Players) == specs.MaxPlayers
	awayReady := len(g.snapshot.AwayTeam.Players) == specs.MaxPlayers
	if homeReady && awayReady {
		if g.config.SkipToGoldenGoal && g.config.DevMode {
			log.Warn("skipping to golden goal")
			g.snapshot.Turn = specs.GameDuration
		}
		return proto.GameSnapshot_GET_READY, nil
	}
	blame := proto.EventGameOver_BOTH_TEAMS
	if homeReady {
		blame = proto.EventGameOver_AWAY_TEAM
	}
	if awayReady {
		blame = proto.EventGameOver_HOME_TEAM
	}
	log.Warn("Stopping LugoServer, no enough players")
	return proto.GameSnapshot_OVER, &server.StopRequest{Reason: proto.EventGameOver_WAITING_EXPIRED, Blame: blame}
}

func (g *LugoServer) GotoReady() (proto.GameSnapshot_State, *server.StopRequest) {
	log := g.changeState(proto.GameSnapshot_GET_READY)

	g.judge.ResetElementPositions(g.snapshot, g.logger)
	if g.snapshot.Turn == 1 {
		log.
			With("starting-mode", g.config.StartingMode).
			Info("ready to start - waiting starting mode's firing event")
		select {
		case <-g.starter.StartPlaying():
		case <-g.serverLife.Died():
			log.Warn("waiting for starting fire event, the server is already stopped.")
			return proto.GameSnapshot_OVER, nil
		}
	}

	g.playerRegistrationMu.Lock()
	forEachPlayerFairlyDistribuited(g.snapshot, func(player *proto.Player, side proto.Team_Side, done func()) {
		mappedPlayer, ok := g.playersMap[side][player.Number]
		if !ok {
			panic("mapped players do not match with gRPC connections")
		}
		if err := mappedPlayer.stream.Send(g.snapshot); err != nil {
			log.
				With(zap.Error(err)).
				With(zap.Any("destination", mappedPlayer.id)).
				Error("error sending message to client")
		}
		done()
	})
	g.playerRegistrationMu.Unlock()

	log.Infof("pause for getting ready (%s)", PhaseReadyDuration)
	time.Sleep(g.config.GetReadyDuration)
	return proto.GameSnapshot_LISTENING, nil
}

func (g *LugoServer) GotoListening() (proto.GameSnapshot_State, *server.StopRequest) {
	if yes, to, stopRequest := g.shouldListenningSkip(g.devLogger, g.snapshot, g.config, *g.realStartTime); yes {
		return to, stopRequest
	}

	//// the remote should be able to hold before listening to wait
	g.orderMu.Lock()
	g.orders = make([]orderMap, 0, specs.MaxPlayers*2)
	g.orderMu.Unlock()
	log := g.changeState(proto.GameSnapshot_LISTENING)

	//log.Info("starting listening phase")

	resetListeningTimeLife(&g.ListeningTimeLife, g.config, g.bug)
	g.playerRegistrationMu.Lock()
	forEachPlayerFairlyDistribuited(g.snapshot, func(player *proto.Player, side proto.Team_Side, done func()) {
		mappedPlayer, ok := g.playersMap[side][player.Number]
		if !ok {
			panic("mapped players do not match with gRPC connections")
		}
		if err := mappedPlayer.stream.Send(g.snapshot); err != nil {
			log.
				With(zap.Error(err)).
				With(zap.Any("destination", mappedPlayer.id)).
				Error("error sending message to client")
		}
		done()
	})
	g.playerRegistrationMu.Unlock()
	<-g.ListeningTimeLife.Ctx.Done()

	missing := (len(g.playersMap[proto.Team_HOME]) + len(g.playersMap[proto.Team_AWAY])) - len(g.orders)
	if missing > 0 {
		log.Warnf("%d player did not send orders on time", missing)
	}
	return proto.GameSnapshot_PLAYING, nil
}

func (g *LugoServer) shouldListenningSkip(logger *zap.SugaredLogger, snapshot *proto.GameSnapshot, gameConfig config.Configuration, realStartTime time.Time) (bool, proto.GameSnapshot_State, *server.StopRequest) {
	if snapshot.Turn >= specs.GameDuration {
		isADraw := snapshot.HomeTeam.Score == snapshot.AwayTeam.Score

		// conditions to end the game after the duration is over
		// Not a draw, or
		// Golden goal is turned off (accepting the draw)
		// Or, even with draw and golden goal, it is over if the duration is greater than the max overtime
		if !isADraw || !gameConfig.EnableGoldenGoal || snapshot.Turn >= specs.ExtraOvertimeDuration+specs.GameDuration {
			return true, proto.GameSnapshot_OVER, &server.StopRequest{Reason: proto.EventGameOver_TIME_IS_OVER, Blame: proto.EventGameOver_NORMAL}
		}
		if snapshot.Period == proto.GameSnapshot_REGULAR_TIME {
			snapshot.Period = proto.GameSnapshot_OVERTIME
			g.diffuser.DiffusePeriodChanged(snapshot)
			return true, proto.GameSnapshot_GET_READY, nil
		}

	}
	countHome := len(snapshot.HomeTeam.Players)
	countAway := len(snapshot.AwayTeam.Players)
	blame := proto.EventGameOver_BOTH_TEAMS
	if countAway < specs.MinPlayers {
		blame = proto.EventGameOver_AWAY_TEAM
	} else if countHome < specs.MinPlayers {
		blame = proto.EventGameOver_HOME_TEAM
	}
	if !gameConfig.DevMode && (countAway < specs.MinPlayers || countHome < specs.MinPlayers) {
		return true, proto.GameSnapshot_OVER, &server.StopRequest{Reason: proto.EventGameOver_NO_ENOUGH_PLAYER, Blame: blame}
	}
	if snapshot.ShotClock != nil && snapshot.ShotClock.RemainingTurns == 0 {
		return true, proto.GameSnapshot_SHIFTING, nil
	}

	diffScore := int(math.Abs(float64(snapshot.HomeTeam.Score) - float64(snapshot.AwayTeam.Score)))

	// check for knockout!
	if !gameConfig.DevMode && diffScore >= gameConfig.KnockoutMaxScoreDiff && time.Now().Sub(realStartTime) >= gameConfig.KnockoutTimeLimit {
		logger.
			With("dev_mode", gameConfig.DevMode).
			With("diff_score", diffScore).
			With("dif_time", time.Now().Sub(realStartTime).String()).
			Info("knockout detected")
		return true, proto.GameSnapshot_OVER, &server.StopRequest{Reason: proto.EventGameOver_KNOCKOUT, Blame: proto.EventGameOver_NORMAL}
	}

	return false, proto.GameSnapshot_LISTENING, nil
}

func resetListeningTimeLife(timeLife *stateTimeLife, gameConfig config.Configuration, bug Debugger) {
	if gameConfig.ListeningMode == config.ListeningModeRush { //on rush mode, whatever happens first: or all orders or time exceeded
		timeLife.Ctx, timeLife.Stop = context.WithTimeout(context.Background(), gameConfig.ListeningDuration)
	} else if gameConfig.ListeningMode == config.ListeningModeRemote { //on remote mode, the listen state is controlled remotely
		var remoteStopper context.CancelFunc
		rushCtx, rushDone := context.WithCancel(context.Background())
		rushDone()
		timeLife.Ctx, remoteStopper = context.WithCancel(context.Background())
		bug.OnResumeListeningPhase(rushCtx, remoteStopper)
		timeLife.Stop = func() {
			//rushDone()
		}
	} else { //in the normal scenario, we can not skip the default time interval
		timeLife.Ctx, _ = context.WithTimeout(context.Background(), gameConfig.ListeningDuration)
		timeLife.Stop = func() {
			//log.Debug("ignoring command end the listening state: not in rush mode")
		}
	}
}

func (g *LugoServer) GotoPlaying() (proto.GameSnapshot_State, *server.StopRequest) {
	log := g.changeState(proto.GameSnapshot_PLAYING)

	//log.Info("starting playing")
	debugging := false
	if err := g.bug.Wait(proto.EventDebugBreakpoint_TURN, MaxWaitBreakPoint, func() {
		log.Info("waiting debug")
		debugging = true
		g.diffuser.DiffuseDebugBreakpoint(g.snapshot, proto.EventDebugBreakpoint_TURN)
	}); err != nil {
		log.With(config.SilentError(err)).Debugf("break point '%s' not used", BreakpointTurn)
	}
	g.judge.MoveBall(g.snapshot.Ball)
	g.orderMu.Lock()
	if g.snapshot.ShotClock != nil {
		//if g.snapshot.ShotClock != nil && g.snapshot.ShotClock.RemainingTurns > 1 {
		g.snapshot.ShotClock.RemainingTurns--
	}

	for _, orders := range g.orders {
		if err := g.bug.Wait(proto.EventDebugBreakpoint_ORDERS, MaxWaitBreakPoint, func() {
			g.diffuser.DiffuseDebugBreakpoint(g.snapshot, proto.EventDebugBreakpoint_ORDERS)
			debugging = true
		}); err != nil {
			log.With(config.SilentError(err)).Debugf("break point '%s' not used", BreakpointOrder)
		}
		ProcessPlayerRequest(g, orders)
	}
	g.orderMu.Unlock()

	scoreHasChanged, teamScored := g.judge.CheckGoal(g.snapshot, g.logger)
	g.snapshot.Turn++

	if debugging {
		g.diffuser.DiffuseDebugReleased(g.snapshot)
	}
	if scoreHasChanged {
		g.diffuser.DiffuseGoal(g.snapshot, teamScored)
		if g.isExtraTime() {
			return proto.GameSnapshot_OVER, &server.StopRequest{Reason: proto.EventGameOver_GOLDEN_GOL, Blame: proto.EventGameOver_NORMAL}
		}

		return proto.GameSnapshot_GET_READY, nil
	}
	g.snapshot.TurnsBallInGoalZone = g.judge.WatchBallInGoalZone(g.snapshot.Ball, g.snapshot.TurnsBallInGoalZone)
	return proto.GameSnapshot_LISTENING, nil
}

func (g *LugoServer) GotoShifting() (proto.GameSnapshot_State, *server.StopRequest) {
	log := g.changeState(proto.GameSnapshot_SHIFTING)

	g.judge.ShiftPossession(g.snapshot, log)

	return proto.GameSnapshot_LISTENING, nil
}

func (g *LugoServer) GotoOver() {
	log := g.changeState(proto.GameSnapshot_OVER)
	g.diffuser.DiffuseGameOver(g.snapshot, g.stopRequest.Reason, g.stopRequest.Blame)

	g.devLogger.
		With(zap.String("status", fmt.Sprintf("%s", g.snapshot.State))).
		With(zap.String("reason", fmt.Sprintf("%s", g.stopRequest.Reason))).
		With(zap.String("blame", fmt.Sprintf("%s", g.stopRequest.Blame))).
		With(zap.Uint32("home_score", g.snapshot.HomeTeam.Score)).
		With(zap.Uint32("away_score", g.snapshot.AwayTeam.Score)).
		Info("Stopping LugoServer")
	// IMPORTANT: this method just stops the user context. We assume that the connection will be externally dropped,
	// and the the DropPlayer method will be called.
	// If we drop the user here we may have to bug writing concurrency and we may fall on deadlocks
	for _, mapped := range g.playersMap[proto.Team_HOME] {
		mapped.stop()
	}
	for _, mapped := range g.playersMap[proto.Team_AWAY] {
		mapped.stop()
	}

	log.Infof("Game Over")
	g.isRunning = false
}

func (g *LugoServer) changeState(newState proto.GameSnapshot_State) *zap.SugaredLogger {
	previousState := g.snapshot.State
	g.snapshot.State = newState
	log := g.logger.With(zap.Any("state", g.snapshot.State)).With(zap.Any("turn", g.snapshot.Turn))
	g.diffuser.DiffuseStateChange(g.snapshot, previousState)

	return log
}

func ProcessPlayerRequest(g *LugoServer, ordersMapping orderMap) {
	playerMapped := g.playersMap[ordersMapping.teamSide][ordersMapping.playerNumber]
	logger := g.logger.
		With(zap.String("player", playerMapped.id)).
		With(zap.Uint32("turn", g.snapshot.Turn))

	defer func() {
		if r := recover(); r != nil {
			logger.Errorf("critical error while processing ordersMapping: %s", r)
		}
	}()
	hasMoved := false
	ballCaught := false
	for _, order := range ordersMapping.order.Orders {
		switch action := order.GetAction().(type) {
		case *proto.Order_Move, *proto.Order_Jump:
			if !hasMoved {
				if playerMapped.JumpCounter > 0 { // since he is already jumping, he is just prioritizing the jump over the other actions
					g.judge.UpdatePlayerPosition(playerMapped.player, g.snapshot.Ball, logger)
					playerMapped.JumpCounter--
					if playerMapped.JumpCounter == 0 {
						// @todo this change breaks the design of having all changes made by the mutator. Must be fixed
						playerMapped.player.Velocity.Speed = 0
						playerMapped.player.IsJumping = false
					}
				} else if moveOrder := order.GetMove(); moveOrder != nil {
					g.judge.ExecuteMoveOrder(playerMapped.player, g.snapshot.Ball, moveOrder, logger)
				} else if jumpOrder := order.GetJump(); jumpOrder != nil {
					g.judge.ExecuteJumpOrder(playerMapped.player, g.snapshot.Ball, jumpOrder, logger)
					playerMapped.JumpCounter = specs.GoalKeeperJumpDuration
					playerMapped.player.IsJumping = true
				} else {
					// this would be a very creepy error
					logger.Errorf("order type did not receive a valid value: %v", order)
				}
				hasMoved = true
			} else {
				logger.Warnf("ignoring 2nd movement order: %v", order)
			}
		case *proto.Order_Catch:
			if !ballCaught {
				ballCaught = g.judge.ExecuteCatchOrder(g.snapshot, playerMapped.player, action.Catch, logger)
			} else {
				logger.Debugf("ignoring catch order: the ball was already catch this turn")
			}

		case *proto.Order_Kick:
			g.judge.ExecuteKickOrder(g.snapshot.Ball, playerMapped.player, action.Kick, logger)
		default:
			logger.Debugf("ignoring unknown action type: %v", action)

		}
	}
	if !hasMoved {
		g.judge.UpdatePlayerPosition(playerMapped.player, g.snapshot.Ball, logger)
	}
}

func forEachPlayerFairlyDistribuited(snapshot *proto.GameSnapshot, cb func(player *proto.Player, side proto.Team_Side, done func())) {
	block := make(chan struct{})  // used to fire all calls simultaneously
	initGroup := sync.WaitGroup{} // used to ensure all Go routines are already running before fire the calls
	execGroup := sync.WaitGroup{} // wait everyone be contacted

	everybody := make([]*proto.Player, 0, len(snapshot.HomeTeam.Players)+len(snapshot.AwayTeam.Players))

	for _, player := range snapshot.AwayTeam.Players {
		player := player
		everybody = append(everybody, player)
	}
	for _, player := range snapshot.HomeTeam.Players {
		player := player
		everybody = append(everybody, player)
	}

	rand.Shuffle(len(everybody), func(i, j int) { everybody[i], everybody[j] = everybody[j], everybody[i] })

	initGroup.Add(len(everybody))
	for _, p := range everybody {
		p := p
		go func() {
			execGroup.Add(1)
			initGroup.Done()
			<-block
			//allCalls = append(allCalls, func() {
			//log.Printf("\n*****%s-%d\n\n", player.TeamSide, player.Number)
			//time.Sleep(500 * time.Millisecond)
			cb(p, p.TeamSide, execGroup.Done)
			//})
		}()

	}

	// colocar um lock aqui

	initGroup.Wait()
	close(block)
	execGroup.Wait()

}
