#!/bin/bash

mockgen -package=lugo4go \
        -source=./contracts.go \
        -destination=./mocks_test.go

mockgen -package=lugo4go \
        -destination=./mocks_lugo_test.go \
        github.com/lugobots/lugo4go/v3/proto PlayerOrder,GameServer,GameClient,Game_JoinATeamClient,\
Game_JoinATeamServer,BroadcastClient,Broadcast_OnEventClient,BroadcastServer,Broadcast_OnEventServer

