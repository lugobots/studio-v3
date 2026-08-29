# Lugo Studio V3

Desktop environment for building bots that play [Lugo Bots](https://lugobots.ai).

Lugo Studio V3 is an Electron app, strongly inspired by Lugo Studio V1. The main change is a new Docker image that centralizes most of the Lugo Bots Server logic, including bot runtimes. Bots and the server share the same memory space, which improves performance compared to running those pieces as separate processes.

## What it does

- **Starts the Lugo Studio image.** That image runs the Lugo Bots server and the bots internally.
- **Optionally opens VS Code for the Web** with the environment already set up, so you can start coding on day one.
- **Publishes a Docker image with your bot code.** Publishing uses the same single image: it builds and publishes for you.

## Requirements

- [Node.js](https://nodejs.org/) 18 or later
- npm (included with Node.js)

## Install

From the project root:

```powershell
npm install
```

## Start in development mode

```powershell
npm run dev
```

This launches the Electron window. `npm start` does the same thing.
