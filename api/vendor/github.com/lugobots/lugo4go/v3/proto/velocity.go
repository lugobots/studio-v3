package proto

import "math"

// NewZeroedVelocity creates a velocity with speed zero
func NewZeroedVelocity(direction Vector) Velocity {
	s := Velocity{}
	s.Direction = &direction
	s.Speed = 0
	return s
}

// Copy copies the object
func (m Velocity) Copy() *Velocity {
	copyS := NewZeroedVelocity(*m.Direction.Copy())
	copyS.Speed = m.Speed
	return &copyS
}

// Add two velocities values. The direction will be a simple vector sum, so they will be affected by their magnitude.
func (m *Velocity) Add(velocity Velocity) {
	copied := velocity.Copy()

	copied.Direction.SetLength(copied.Speed)
	m.Direction.SetLength(m.Speed)
	//if the vector is the inverse of the actual, we cannot sum them because they would null each other
	if copied.Copy().Direction.Invert().IsEqualTo(m.Direction) {
		m.Direction.Invert()
		m.Speed = 0
	} else {
		m.Direction.Add(copied.Direction)
		m.Speed = m.Direction.Length()
	}

	m.Direction.Normalize()
}

// Return the next point the element will be considering the direction and speed.
func (m *Velocity) GetNextPoint(from Point) Point {
	if m.Speed == 0 {
		return from
	} else {
		speedX := m.Speed * m.Direction.Cos()
		speedY := m.Speed * m.Direction.Sin()
		return Point{
			X: from.X + int32(math.Round(speedX)),
			Y: from.Y + int32(math.Round(speedY)),
		}
	}
}
