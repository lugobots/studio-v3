package field

import (
	"fmt"
	"math"

	"github.com/lugobots/lugo4go/v3/proto"
	"github.com/lugobots/lugo4go/v3/specs"
)

type Direction string

const (
	Forward       Direction = "forward"
	Backward      Direction = "backward"
	Left          Direction = "left"
	Right         Direction = "right"
	BackwardLeft  Direction = "backward_left"
	BackwardRight Direction = "backward_right"
	ForwardLeft   Direction = "forward_left"
	ForwardRight  Direction = "forward_right"
)

type Orientation proto.Vector

var (
	North = Orientation(proto.North())
	South = Orientation(proto.South())
	East  = Orientation(proto.East())
	West  = Orientation(proto.West())

	NorthEast = Orientation(proto.NorthEast())
	SouthEast = Orientation(proto.SouthEast())
	NorthWest = Orientation(proto.NorthWest())
	SouthWest = Orientation(proto.SouthWest())
)

// Goal is a set of value about a goal from a team
type Goal struct {
	// Center the is coordinate of the center of the goal
	Center proto.Point
	// Place identifies the team of this goal (the team that should defend this goal)
	Place proto.Team_Side
	// TopPole is the coordinates of the pole with a higher Y coordinate
	TopPole proto.Point
	// BottomPole is the coordinates of the pole  with a lower Y coordinate
	BottomPole proto.Point
}

func AwaySideTeamGoal() Goal {
	return Goal{
		Place:      proto.Team_AWAY,
		Center:     proto.Point{X: specs.MaxXCoordinate, Y: specs.MaxYCoordinate / 2},
		TopPole:    proto.Point{X: specs.MaxXCoordinate, Y: specs.GoalMaxY},
		BottomPole: proto.Point{X: specs.MaxXCoordinate, Y: specs.GoalMinY},
	}
}

func HomeSideTeamGoal() Goal {
	return Goal{
		Place:      proto.Team_HOME,
		Center:     proto.Point{X: 0, Y: specs.MaxYCoordinate / 2},
		TopPole:    proto.Point{X: 0, Y: specs.GoalMaxY},
		BottomPole: proto.Point{X: 0, Y: specs.GoalMinY},
	}
}

func GetGoal(side proto.Team_Side) Goal {
	if side == proto.Team_HOME {
		return HomeSideTeamGoal()
	}
	return AwaySideTeamGoal()
}

func FieldCenter() proto.Point {
	return proto.Point{X: specs.MaxXCoordinate / 2, Y: specs.MaxYCoordinate / 2}
}

// Important note: since our bot needs to have the best performance possible. We may ensure that some errors will never
// happen based on our configuration. Once the errors are in a controlled and limited list of methods, we are able
// to ignore the errors during the game, and only test them in our unit tests.
//
// For doing that, in our bot, we may create a limited list of MapArea coordinates that will be translated to Regions,
// and then test all of them. The other direction is the conversion from a Point to a MapArea. In this case, we
// assume that the server will only send us valid points (within the field limits).

const (
	// MinCols Define the min number of cols allowed on the field division by the Map
	MinCols int = 4
	// MinRows Define the min number of rows allowed on the field division by the Map
	MinRows int = 2
	// MaxCols Define the max number of cols allowed on the field division by the Map
	MaxCols int = 200
	// MaxRows Define the max number of rows allowed on the field division by the Map
	MaxRows int = 100
)

// NewMapper creates a new Mapper that will map the field to provide Regions
func NewMapper(cols, rows int, sideRef proto.Team_Side) (*Map, error) {
	if cols < MinCols {
		return nil, ErrMinCols
	}
	if cols > MaxCols {
		return nil, ErrMaxCols
	}
	if rows < MinRows {
		return nil, ErrMinRows
	}
	if rows > MaxRows {
		return nil, ErrMaxRows
	}

	return &Map{
		TeamSide:     sideRef,
		cols:         cols,
		rows:         rows,
		regionWidth:  specs.MaxXCoordinate / float64(cols),
		regionHeight: specs.MaxYCoordinate / float64(rows),
	}, nil
}

type Map struct {
	TeamSide     proto.Team_Side
	cols         int
	rows         int
	regionWidth  float64
	regionHeight float64
}

func (m *Map) GetMyTeamSide() proto.Team_Side {
	return m.TeamSide
}

func (m *Map) GetOpponentSide() proto.Team_Side {
	if m.TeamSide == proto.Team_HOME {
		return proto.Team_AWAY
	}
	return proto.Team_HOME
}

func (m *Map) GetDefenseGoal() Goal {
	if m.TeamSide == proto.Team_HOME {
		return HomeSideTeamGoal()
	}
	return AwaySideTeamGoal()
}

func (m *Map) GetAttackGoal() Goal {
	if m.TeamSide == proto.Team_HOME {
		return AwaySideTeamGoal()
	}
	return HomeSideTeamGoal()
}

func (m *Map) GetRegion(col, row int) (Region, error) {
	if col >= m.cols {
		return nil, ErrMaxCols
	}
	if row >= m.rows {
		return nil, ErrMaxRows
	}

	if col < 0 {
		col = 0
	}
	if row < 0 {
		row = 0
	}

	center := &proto.Point{
		X: int32(math.Round(float64(col)*m.regionWidth + m.regionWidth/2)),
		Y: int32(math.Round(float64(row)*m.regionHeight + m.regionHeight/2)),
	}
	if m.TeamSide == proto.Team_AWAY {
		center = mirrorCoordsToAway(center)
	}

	return MapArea{
		col:        col,
		row:        row,
		sideRef:    m.TeamSide,
		center:     center,
		positioner: m,
	}, nil
}

func (m *Map) GetPointRegion(point *proto.Point) (Region, error) {
	if m.TeamSide == proto.Team_AWAY {
		point = mirrorCoordsToAway(point)
	}
	cx := float64(point.X) / m.regionWidth
	cy := float64(point.Y) / m.regionHeight
	col := int(math.Min(cx, float64(m.cols-1)))
	row := int(math.Min(cy, float64(m.rows-1)))
	return m.GetRegion(col, row)
}

type MapArea struct {
	col        int
	row        int
	sideRef    proto.Team_Side
	center     *proto.Point
	positioner *Map
}

func (r MapArea) Eq(region Region) bool {
	return region.Col() == r.Col() && region.Row() == r.Row()
}

func (r MapArea) Col() int {
	return r.col
}

func (r MapArea) Row() int {
	return r.row
}

func (r MapArea) Center() *proto.Point {
	return r.center.Copy()
}

func (r MapArea) String() string {
	return fmt.Sprintf("{%d,%d-%s}", r.col, r.row, r.sideRef)
}

func (r MapArea) Front() Region {
	if n, err := r.positioner.GetRegion(r.col+1, r.row); err == nil {
		return n
	}
	return r
}

func (r MapArea) Back() Region {
	if n, err := r.positioner.GetRegion(r.col-1, r.row); err == nil {
		return n
	}
	return r
}

func (r MapArea) Left() Region {
	if n, err := r.positioner.GetRegion(r.col, r.row+1); err == nil {
		return n
	}
	return r
}

func (r MapArea) Right() Region {
	if n, err := r.positioner.GetRegion(r.col, r.row-1); err == nil {
		return n
	}
	return r
}

// Invert the coords X and Y as in a mirror to found out the same position seen from the away team field
// Keep in mind that all coords in the field are based in the bottom left corner!
func mirrorCoordsToAway(coords *proto.Point) *proto.Point {
	return &proto.Point{
		X: specs.MaxXCoordinate - coords.X,
		Y: specs.MaxYCoordinate - coords.Y,
	}
}
