package proto

import (
	"encoding/json"
	"errors"
	"math"
)

func North() Vector     { return Vector{Y: 1} }
func South() Vector     { return Vector{Y: -1} }
func East() Vector      { return Vector{X: 1} }
func West() Vector      { return Vector{X: -1} }
func NorthEast() Vector { return Vector{Y: 1, X: 1} }
func SouthEast() Vector { return Vector{Y: -1, X: 1} }
func NorthWest() Vector { return Vector{Y: 1, X: -1} }
func SouthWest() Vector { return Vector{Y: -1, X: -1} }

func NewVector(from Point, to Point) (*Vector, error) {
	v := new(Vector)
	v.X = float64(to.X) - float64(from.X)
	v.Y = float64(to.Y) - float64(from.Y)
	if err := v.isValidCoords(v.X, v.Y); err != nil {
		return nil, err
	}
	return v, nil
}

func (v Vector) Copy() *Vector {
	nv := new(Vector)
	nv.X = v.X
	nv.Y = v.Y
	return nv
}

func (v Vector) Perpendicular() *Vector {
	nv := new(Vector)
	nv.X = v.Y
	nv.Y = -v.X
	return nv
}

func (v *Vector) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]interface{}{
		"x":   v.X,
		"y":   v.Y,
		"ang": v.AngleDegrees(),
	})
}

func (v *Vector) UnmarshalJSON(b []byte) error {
	var tmp struct {
		X float64 `json:"x"`
		Y float64 `json:"y"`
	}
	err := json.Unmarshal(b, &tmp)
	if err != nil {
		return err
	}
	v.X = tmp.X
	v.Y = tmp.Y
	if err := v.isValidCoords(v.X, v.Y); err != nil {
		return err
	}
	return nil
}

// Normalizes the vector on base 100 (not 1 as conventional) to reduce the loss.
func (v *Vector) Normalize() *Vector {
	length := v.Length()
	_, _ = v.Scale(100 / length)
	return v
}

func (v *Vector) SetLength(length float64) (*Vector, error) {
	return v.Scale(length / v.Length())
}

func (v *Vector) SetX(x float64) (*Vector, error) {
	if err := v.isValidCoords(x, v.Y); err != nil {
		return nil, err
	}
	v.X = x
	return v, nil
}

func (v *Vector) SetY(y float64) (*Vector, error) {
	if err := v.isValidCoords(v.X, y); err != nil {
		return nil, err
	}
	v.Y = y
	return v, nil
}

func (v *Vector) Invert() *Vector {
	v.X = -v.X
	v.Y = -v.Y
	return v
}

func (v *Vector) Scale(t float64) (*Vector, error) {
	if t == 0 {
		return nil, errors.New("vector can not have zero length")
	}
	v.X *= t
	v.Y *= t
	return v, nil
}

func (v *Vector) Sin() float64 {
	return v.Y / v.Length()
}

func (v *Vector) Cos() float64 {
	return v.X / v.Length()
}

// Angle returns the angle of the vector with the X axis
func (v *Vector) Angle() float64 {
	return math.Atan2(v.Y, v.X)
}

func (v *Vector) AngleDegrees() float64 {
	return v.Angle() * 180 / math.Pi
}

func (v *Vector) OppositeAngle() float64 {
	return math.Acos(v.Cos())
}

func (v *Vector) AddAngleDegree(degree float64) *Vector {
	newAngle := v.AngleDegrees() + degree
	newAngle *= math.Pi / 180

	length := v.Length()
	v.X = length * math.Cos(newAngle)
	v.Y = length * math.Sin(newAngle)
	return v
}

func (v *Vector) Length() float64 {
	return math.Hypot(v.X, v.Y)
}

// torcar pra valow de copia
func (v *Vector) Add(vector *Vector) (*Vector, error) {
	x := v.X + vector.X
	y := v.Y + vector.Y
	if err := v.isValidCoords(x, y); err != nil {
		return nil, err
	}
	v.X = x
	v.Y = y
	return v, nil
}

func (v *Vector) Sub(vector *Vector) (*Vector, error) {
	x := v.X - vector.X
	y := v.Y - vector.Y
	if err := v.isValidCoords(x, y); err != nil {
		return nil, err
	}
	v.X = x
	v.Y = y
	return v, nil
}

func (v *Vector) TargetFrom(point Point) Point {
	return Point{
		X: point.X + int32(math.Round(v.X)),
		Y: point.Y + int32(math.Round(v.Y)),
	}
}

func (v *Vector) IsEqualTo(b *Vector) bool {
	return b.Y == v.Y && b.X == v.X
}

func (v *Vector) AngleWith(b *Vector) float64 {
	//http://onlinemschool.com/math/assistance/vector/angl/
	copyMe := v.Copy().Normalize()
	copyOther := b.Copy().Normalize()

	dotProduct := (copyMe.X * copyOther.X) + (copyMe.Y * copyOther.Y)
	cos := dotProduct / (copyMe.Length() * copyOther.Length())
	ang := math.Round(math.Acos(cos)*(180/math.Pi)*100) / 100
	cross := (copyMe.X * copyOther.Y) - (copyMe.Y * copyOther.X)
	if cross < 0 {
		ang *= -1
	}
	return ang
}

func (v *Vector) IsObstacle(from Point, obstacle Point) bool {
	to := v.TargetFrom(from)
	a := from.DistanceTo(obstacle)
	b := obstacle.DistanceTo(to)
	hypo := from.DistanceTo(to)
	return math.Round(a+b-hypo) < 0.1
}

func (v *Vector) isValidCoords(x, y float64) error {
	if x == 0 && y == 0 {
		return errors.New("vector can not have zero length")
	}
	return nil
}
