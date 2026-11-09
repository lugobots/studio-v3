package helpers

func Contains[T comparable](slice []T, value T) bool {
	for _, v := range slice {
		if v == value {
			return true
		}
	}
	return false
}

func ValueAsPointer[T any](v T) *T {
	return &v
}
