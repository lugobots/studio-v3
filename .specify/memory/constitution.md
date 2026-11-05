# Studio V3 Constitution

## Core Principles

### I. Behavior in Specs, Contracts in Code
Specs describe the desktop Studio client and local match / bot workflow. Wire formats and numeric constants stay in code. Specs MUST link to `protos` (`src/*.proto`) and `lugo4go/specs/specs.go` when relevant. Specs MUST NOT paste field lists, RPC signatures, or constant values.

### II. Specs Describe Behavior, Not Invented Reality
Baseline and feature specs document current or agreed intended behavior. Do not invent features and call them current. Desired changes are Spec Kit features, not silent edits to baseline requirements.

### III. Studio V3 Is the Spec Home for Studio
`studio` and `studio-v2` are deprecated and have no Spec Kit project. Studio requirements—including content formerly under the OpenSpec `studio` capability—live here. Do not reopen Spec Kit work in deprecated Studio repos.

### IV. Runtime Boundaries
Studio V3 starts the Studio image (server and bots in one runtime), may open a prepared editor environment, and can publish a bot image. Match-engine protocol changes belong in `protos` / `server`. Doorway update checks and account surfaces belong in `doorway` unless the change is purely client-side consumption.

### V. Game Rules Stay External
Human-readable game rules live at https://spec.lugobots.ai/. Link that site when local match UX depends on them. Do not copy or replace that content in this Spec Kit project.

## Platform Coordination

Lugo Blueprint (`lugo-blueprint`) is the platform index and dependency graph (`services.yaml`), not the source of truth for requirements.

During `/speckit-plan` (or equivalent plan skill), run the Blueprint `impact-check` skill. `studio-v3` currently has no dependents on the graph; still confirm before editing upstream repos such as `protos`, `server`, or `doorway`. Do not create a central multi-repo `tasks.md` in Blueprint.

OpenSpec under Blueprint is frozen archive. The `studio` capability maps here.

## Development Workflow

1. `/speckit-specify` in this repo for Studio desktop and local match workflow changes.
2. `/speckit-plan` with Blueprint impact-check before implementation.
3. Prefer existing Electron / Node tooling and the Studio runtime image conventions documented in this repository.
4. Propagate only to confirmed dependent or upstream projects.

## Governance

This constitution governs Spec Kit planning and implementation in `studio-v3`. Amendments require updating this file with a version bump and date. All PRs that change specs or Studio behavior should respect these principles. Complexity must be justified in the feature plan.

**Version**: 1.0.0 | **Ratified**: 2026-11-05 | **Last Amended**: 2026-11-05
