# Lugo4Go - A Lugo Bots Client
[![Build Status](https://app.travis-ci.com/lugobots/lugo4go.svg?branch=master)](https://app.travis-ci.com/lugobots/lugo4go)
[![GoDoc](https://godoc.org/github.com/lugobots/lugo4go?status.svg)](https://godoc.org/github.com/lugobots/lugo4go)
[![Go Report Card](https://goreportcard.com/badge/github.com/lugobots/lugo4go)](https://goreportcard.com/report/github.com/lugobots/lugo4go)

Lugo4Go is a Go implementation of a client player for [Lugo](https://lugobots.dev/) game. 

It **is not a bot** that plays the game, it is only the client to connect to the game server. 

This package implements many methods that does not affect the player intelligence/behaviour/decisions. It is meant to reduce the developer concerns on communication, protocols, attributes, etc.

Using this client, you just need to implement the Artificial Intelligence of your player and some other few methods to support your strategy (see the [example](./example/simple) folder and [The Dummies GO](https://github.com/lugobots/the-dummies-go)).


# Table of Contents
* [Documentation](#documentation)
* [Requirements](#requirements)
* [Installation](#installation)
* [Usage](#usage)
* [First option: Implementing a Bot class (simpler and recommended)](#first-option-implementing-a-bot-class-simpler-and-recommended)
* [Second option: Implementing the turn handler (a little more work)](#second-option-implementing-the-turn-handler-a-little-more-work)
- [Helpers](#helpers)
  * [Snapshot inspector](#snapshot-inspector)
  * [Mapper and Region classes](#mapper-and-region-classes)
    + [The Mapper](#the-mapper)
    + [The Region](#the-region)
 
### Documentation

* [API Reference](http://godoc.org/github.com/lugobots/lugo4go)

### Requirements

* Go Lang >= 1.16 (https://golang.org/doc/install)

### Installation

git get https://github.com/lugobots/lugo4go.git

### Usage

There are two ways to use **Lugo4Go** client:

### First option: Implementing a Bot class (simpler and recommended)

See [example](./examples/bot-interface)

**Lugo4Go** *PlayAsBot* implements a very basic logic to reduce the code boilerplate. This client will wrap most repetitive
code that handles the raw data got by the bot and will identify the player state.

The `Bot` interface requires the methods to handle each player state based on the ball possession.

```go

type Bot struct {
	
}

// OnDisputing is called when no one has the ball possession
func (b *Bot) OnDisputing(ctx context.Context, inspector SnapshotInspector) ([]proto.PlayerOrder, string, error) {
	// the magic code comes here
	return ...
}

// OnDefending is called when an opponent player has the ball possession
func (b *Bot) OnDefending(ctx context.Context, inspector SnapshotInspector) ([]proto.PlayerOrder, string, error) {
	// the magic code comes here
	return ...
}

// OnHolding is called when this bot has the ball possession
func (b *Bot) OnHolding(ctx context.Context, inspector SnapshotInspector) ([]proto.PlayerOrder, string, error) {
	// the magic code comes here
	return ...
}

// OnSupporting is called when a teammate player has the ball possession
func (b *Bot) OnSupporting(ctx context.Context, inspector SnapshotInspector) ([]proto.PlayerOrder, string, error) {
	// the magic code comes here
	return ...
}

// AsGoalkeeper is only called when this bot is the goalkeeper (number 1). This method is called on every turn,
// and the player state is passed at the last parameter.
func (b *Bot) AsGoalkeeper(ctx context.Context, inspector SnapshotInspector, state PlayerState) ([]proto.PlayerOrder, string, error) {
	// the magic code comes here
	return ...
}
```

### Second option: Implementing the turn handler (a little more work)

See [example](./examples/turn-handler)

If you rather to handle everything on your side, you only need to implement the `TurnHandler` interface.

The `TurnHandler` will receive the turn context and the turn snapshot for each turn.

Your bot will need a `lugo4go.OrderSender` to send the orders back to the Game Server during each turn.

```go

type Bot struct {
    OrderSender lugo4go.OrderSender
}

func (b *Bot) Handle(ctx context.Context, inspector clientGo.SnapshotInspector) {
	// the magic code comes here
	resp, "", err := b.OrderSender.Send(ctx, snapshot.Turn, orders, "")
}

```

## Kick-start

0. Copy one of the examples from [the example directory](./examples) as a new Golang project.

1. Run the game server using the command 
    ```bash
    docker run -p 8080:8080  lugobots/server:v1.1 play --dev-mode
   ```
2. Now you will need to start your team processes. Each team must have 11 process (one for each player).
    
    **Option A**: You may start your team players manually executing the command `go run main.go -team=home -number=[1-11]`
    eleven times. 
          
    **or**
    
    **Option B**: You can use the script in examples directory to do this automatically for you:
    `./play.sh home`

3. And, **if your have not started the away team**, you may do the same for the other team. 
    
    You play against your own team repeating the last step, but in the `away` side: 
    ```
    ./play.sh away
   ```

### Next steps

As you may have noticed, the bot player in the example directory does not play well. 
Now, you may start your bot by implementing its behaviour.  

### Deploying you bots

After developing your bot, you may share it with other developers.

Please find the instructions for uploading your bot on [lugobots.dev](https://lugobots.dev).

There is a Dockerfile template in [the example directory](./examples) to guide you how to create a container.


<!-- ## Field Library

There are a many things that you will repeatedly need to do on your bot code, e.g. getting your bot position,
creating a move/kick/catch order, finding your teammates positions, etc.

The Field library brings a collection of functions that will help you get that data from the game snapshot:

Examples ([see all functions on the documentation page](https://pkg.go.dev/github.com/lugobots/lugo4go))

```go

myTeamGoal := field.GetTeamsGoal(proto.Team_HOME)

moveOrder, err := field.MakeOrderMoveMaxSpeed(*me.Position, myTeamGoal)

``` -->

## Helpers

There are a many things that you will repeatedly need to do on your bot code, e.g. getting your bot position, creating a
move/kick/catch order, finding your teammates positions, etc.

**Lugo4Go** brings some libraries to help you with that:

### Snapshot inspector

The Snapshot inspector is quite useful. Firs to it helps you to extract data from the [Game Snapshot](https://github.com/lugobots/protos/blob/master/doc/docs.md#lugo.GameSnapshot) each game turn.

```go
inspector, err := NewGameSnapshotInspector(proto.Team_HOME, 8, snapshot);

inspector.GetSnapshot() *proto.GameSnapshot
inspector.GetMe() *proto.Player
inspector.GetBall() *proto.Ball
inspector.GetBallHolder() (*proto.Player, bool)
inspector.IsBallHolder(player *proto.Player) bool
inspector.GetTeam(side proto.Team_Side) *proto.Team
inspector.GetMyTeam() *proto.Team
inspector.GetOpponentTeam() *proto.Team
inspector.GetPlayer(side proto.Team_Side, number int) *proto.Player
inspector.GetMyTeamPlayers() []*proto.Player
inspector.GetOpponentPlayers() []*proto.Player
inspector.GetMyTeamGoalkeeper() *proto.Player
inspector.GetOpponentGoalkeeper() *proto.Player
```

And also help us to create the [Turn Orders Set](https://github.com/lugobots/protos/blob/master/doc/docs.md#lugo.OrderSet) based on the game state and our bot team side:

```go
inspector.MakeOrderMove(target proto.Point, speed float64) (*proto.Order_Move, error)
inspector.MakeOrderMoveMaxSpeed(target proto.Point) (*proto.Order_Move, error)
inspector.MakeOrderMoveFromPoint(origin, target proto.Point, speed float64) (*proto.Order_Move, error)
inspector.MakeOrderMoveFromVector(vector proto.Vector, speed float64) *proto.Order_Move
inspector.MakeOrderMoveByDirection(direction field.Direction, speed float64) *proto.Order_Move
inspector.MakeOrderMoveToStop() *proto.Order_Move
inspector.MakeOrderJump(target proto.Point, speed float64) (*proto.Order_Jump, error)
inspector.MakeOrderKick(target proto.Point, speed float64) (*proto.Order_Kick, error)
inspector.MakeOrderKickMaxSpeed(target proto.Point) (*proto.Order_Kick, error)
inspector.MakeOrderCatch() *proto.Order_Catch
```

### Mapper and Region classes

Naturally, the bots see the game field based on coordinates `x` and `y`, as in a cartesian plane.

However, that's not something that we want to be concerned about during the bot development.

The classes Mapper and Region work together to facilitate it for use.

#### The Mapper

`Mapper` slices the field in columns and rows, so your bot does not have to care about precise coordinates or the team
side. The mapper will automatically translate the map position to the bot side.

And you may define how many columns/rows your field will be divided into.

```go

// let's create a map 10x5 
fieldMapper, err := field.NewMapper(10, 5, proto.Team_HOME)

// you may find a Map Region based in coordinates:
aRegion, err := fieldMapper.GetRegion(2, 4)

// and you can also know the position of the goals
fieldMapper.GetAttackGoal(): Goal
fieldMapper.GetDefenseGoal(): Goal

```

#### The Region

The Region helps your bot to see the game map in quadrants, so it can move over the field without caring about coordinates or team side.

```go

region.Front()
region.Back()
region.Left()
region.Right()

```
