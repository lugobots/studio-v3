package proto

import (
	"fmt"
	"math"
)

// DistanceTo finds the distance of this point to a target point
func (m Point) DistanceTo(target Point) (distance float64) {
	return math.Hypot(float64(target.X-m.X), float64(target.Y-m.Y))
}

// MiddlePointTo finds a point between this point and a target point
func (m Point) MiddlePointTo(target Point) Point {
	x := math.Abs(float64(m.X - target.X))
	y := math.Abs(float64(m.Y - target.Y))

	return Point{
		X: int32(math.Round(math.Min(float64(m.X), float64(target.X)) + x)),
		Y: int32(math.Round(math.Min(float64(m.Y), float64(target.Y)) + y)),
	}
}

func (m Point) Copy() *Point {
	return &Point{
		X: m.X,
		Y: m.Y,
	}
}

// FindIntersection finds the point where two lines intersect each other.
// One line is define by the points a1 and a2, and the second line is defined by b1 and b2.
// If the lines do not touch each other (e.g. they are parallel) it returns an error, otherwise the point will be
// returned.
// If the intersection point is between {a1, a2} and {b1,b2}, then the the second returned value will be true.
//
//https://en.wikipedia.org/wiki/Line%E2%80%93line_intersection#Given_two_points_on_each_line
func FindIntersection(a1, a2, b1, b2 Point) (Point, bool, error) {

	div := ((a1.X - a2.X) * (b1.Y - b2.Y)) - ((a1.Y - a2.Y) * (b1.X - b2.X))
	if div == 0 {
		return Point{}, false, fmt.Errorf("invalid points, they may be parallel")
	}
	quoX := ((a1.X*a2.Y)-(a1.Y*a2.X))*(b1.X-b2.X) - ((a1.X - a2.X) * (b1.X*b2.Y - b1.Y*b2.X))
	quoY := ((a1.X*a2.Y)-(a1.Y*a2.X))*(b1.Y-b2.Y) - ((a1.Y - a2.Y) * (b1.X*b2.Y - b1.Y*b2.X))

	crossPoints := Point{
		X: quoX / div,
		Y: quoY / div,
	}

	isInAX := isBetween(crossPoints.X, a1.X, a2.X)
	isInAY := isBetween(crossPoints.Y, a1.Y, a2.Y)
	isInBX := isBetween(crossPoints.X, b1.X, b2.X)
	isInBY := isBetween(crossPoints.Y, b1.Y, b2.Y)

	touchLines := isInAX && isInAY && isInBX && isInBY
	return crossPoints, touchLines, nil
}

func isBetween(target, coordA, coordB int32) bool {
	targetF := float64(target)
	coordAF := float64(coordA)
	coordBF := float64(coordB)
	return targetF <= math.Max(coordAF, coordBF) && targetF >= math.Min(coordAF, coordBF)
}
