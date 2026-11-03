package machine

import (
	"time"
)

const TimeLimitTeamsConnect = 5 * time.Minute

const CadenceRatio = 20 // FPS

const DefaultListeningDuration = time.Second / CadenceRatio

const PhaseReadyDuration = DefaultListeningDuration
