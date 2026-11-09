package field

import "errors"

var (
	// ErrMinCols defines an error for invalid number of cols
	ErrMinCols = errors.New("number of cols lower the minimum")
	// ErrMaxCols defines an error for invalid number of cols
	ErrMaxCols = errors.New("number of cols higher the maximum")
	// ErrMinRows defines an error for invalid number of rows
	ErrMinRows = errors.New("number of rows lower the minimum")
	// ErrMaxRows defines an error for invalid number of rows
	ErrMaxRows = errors.New("number of rows higher the maximum")
)
