package plugin

import (
	"encoding/json"
	"math"
	"testing"
	"time"
)

func TestAsTime(t *testing.T) {
	t.Run("given an RFC3339 string with fractional seconds", func(t *testing.T) {
		t.Run("when asTime is called", func(t *testing.T) {
			got, ok := asTime("2026-01-01T00:58:30.500Z")

			t.Run("it should parse successfully", func(t *testing.T) {
				if !ok {
					t.Fatal("ok = false, want true")
				}
			})
			t.Run("it should return the exact instant, in UTC", func(t *testing.T) {
				want := time.Date(2026, 1, 1, 0, 58, 30, 500_000_000, time.UTC)
				if !got.Equal(want) {
					t.Errorf("got %v, want %v", got, want)
				}
			})
		})
	})

	t.Run("given the read-api space-separated timestamp form", func(t *testing.T) {
		t.Run("when asTime is called", func(t *testing.T) {
			got, ok := asTime("2026-01-01 00:58:30")

			t.Run("it should parse successfully", func(t *testing.T) {
				if !ok {
					t.Fatal("ok = false, want true")
				}
				want := time.Date(2026, 1, 1, 0, 58, 30, 0, time.UTC)
				if !got.Equal(want) {
					t.Errorf("got %v, want %v", got, want)
				}
			})
		})
	})

	t.Run("given a string that matches none of the known layouts", func(t *testing.T) {
		t.Run("when asTime is called", func(t *testing.T) {
			_, ok := asTime("not a timestamp")

			t.Run("it should report not ok", func(t *testing.T) {
				if ok {
					t.Error("ok = true, want false")
				}
			})
		})
	})

	t.Run("given a small numeric value (float64)", func(t *testing.T) {
		t.Run("when asTime is called", func(t *testing.T) {
			got, ok := asTime(float64(1767225600))

			t.Run("it should treat it as epoch seconds", func(t *testing.T) {
				if !ok {
					t.Fatal("ok = false, want true")
				}
				if !got.Equal(time.Unix(1767225600, 0).UTC()) {
					t.Errorf("got %v, want the epoch-seconds instant", got)
				}
			})
		})
	})

	t.Run("given a large numeric value (json.Number)", func(t *testing.T) {
		t.Run("when asTime is called", func(t *testing.T) {
			got, ok := asTime(json.Number("1767225600000"))

			t.Run("it should treat it as epoch milliseconds", func(t *testing.T) {
				if !ok {
					t.Fatal("ok = false, want true")
				}
				if !got.Equal(time.UnixMilli(1767225600000).UTC()) {
					t.Errorf("got %v, want the epoch-millis instant", got)
				}
			})
		})
	})

	t.Run("given a non-numeric, non-string value", func(t *testing.T) {
		t.Run("when asTime is called", func(t *testing.T) {
			_, ok := asTime(true)

			t.Run("it should report not ok", func(t *testing.T) {
				if ok {
					t.Error("ok = true, want false")
				}
			})
		})
	})

	t.Run("given nil", func(t *testing.T) {
		t.Run("when asTime is called", func(t *testing.T) {
			_, ok := asTime(nil)

			t.Run("it should report not ok", func(t *testing.T) {
				if ok {
					t.Error("ok = true, want false")
				}
			})
		})
	})
}

func TestEpochToTime(t *testing.T) {
	t.Run("given a value below 1e12", func(t *testing.T) {
		t.Run("when epochToTime is called", func(t *testing.T) {
			got := epochToTime(1767225600)

			t.Run("it should interpret the value as seconds", func(t *testing.T) {
				if !got.Equal(time.Unix(1767225600, 0).UTC()) {
					t.Errorf("got %v, want the epoch-seconds instant", got)
				}
			})
		})
	})

	t.Run("given a value at or above 1e12", func(t *testing.T) {
		t.Run("when epochToTime is called", func(t *testing.T) {
			got := epochToTime(1767225600000)

			t.Run("it should interpret the value as milliseconds", func(t *testing.T) {
				if !got.Equal(time.UnixMilli(1767225600000).UTC()) {
					t.Errorf("got %v, want the epoch-millis instant", got)
				}
			})
		})
	})
}

func TestAsString(t *testing.T) {
	cases := []struct {
		scenario string
		input    interface{}
		want     string
	}{
		{"the value is nil", nil, ""},
		{"the value is already a string", "footloose", "footloose"},
		{"the value is a json.Number", json.Number("42"), "42"},
		{"the value is a float64", 3.5, "3.5"},
		{"the value is a bool true", true, "true"},
		{"the value is a bool false", false, "false"},
		{"the value is an unsupported type", []int{1, 2}, ""},
	}

	for _, tc := range cases {
		t.Run("given "+tc.scenario, func(t *testing.T) {
			t.Run("when asString is called", func(t *testing.T) {
				got := asString(tc.input)

				t.Run("it should return the expected rendering", func(t *testing.T) {
					if got != tc.want {
						t.Errorf("asString(%#v) = %q, want %q", tc.input, got, tc.want)
					}
				})
			})
		})
	}
}

func TestAsFloat(t *testing.T) {
	t.Run("given a float64 value", func(t *testing.T) {
		t.Run("when asFloat is called", func(t *testing.T) {
			got := asFloat(3.5)

			t.Run("it should return it unchanged", func(t *testing.T) {
				if got != 3.5 {
					t.Errorf("got %v, want 3.5", got)
				}
			})
		})
	})

	t.Run("given a valid json.Number", func(t *testing.T) {
		t.Run("when asFloat is called", func(t *testing.T) {
			got := asFloat(json.Number("42.5"))

			t.Run("it should parse it", func(t *testing.T) {
				if got != 42.5 {
					t.Errorf("got %v, want 42.5", got)
				}
			})
		})
	})

	t.Run("given an unparseable json.Number", func(t *testing.T) {
		t.Run("when asFloat is called", func(t *testing.T) {
			got := asFloat(json.Number("not-a-number"))

			t.Run("it should return NaN", func(t *testing.T) {
				if !math.IsNaN(got) {
					t.Errorf("got %v, want NaN", got)
				}
			})
		})
	})

	t.Run("given an int64", func(t *testing.T) {
		t.Run("when asFloat is called", func(t *testing.T) {
			got := asFloat(int64(7))

			t.Run("it should convert it to float64", func(t *testing.T) {
				if got != 7 {
					t.Errorf("got %v, want 7", got)
				}
			})
		})
	})

	t.Run("given a valid numeric string", func(t *testing.T) {
		t.Run("when asFloat is called", func(t *testing.T) {
			got := asFloat("9.25")

			t.Run("it should parse it", func(t *testing.T) {
				if got != 9.25 {
					t.Errorf("got %v, want 9.25", got)
				}
			})
		})
	})

	t.Run("given an unparseable string", func(t *testing.T) {
		t.Run("when asFloat is called", func(t *testing.T) {
			got := asFloat("not-a-number")

			t.Run("it should return NaN", func(t *testing.T) {
				if !math.IsNaN(got) {
					t.Errorf("got %v, want NaN", got)
				}
			})
		})
	})

	t.Run("given a bool true", func(t *testing.T) {
		t.Run("when asFloat is called", func(t *testing.T) {
			got := asFloat(true)

			t.Run("it should return 1", func(t *testing.T) {
				if got != 1 {
					t.Errorf("got %v, want 1", got)
				}
			})
		})
	})

	t.Run("given a bool false", func(t *testing.T) {
		t.Run("when asFloat is called", func(t *testing.T) {
			got := asFloat(false)

			t.Run("it should return 0", func(t *testing.T) {
				if got != 0 {
					t.Errorf("got %v, want 0", got)
				}
			})
		})
	})

	t.Run("given nil", func(t *testing.T) {
		t.Run("when asFloat is called", func(t *testing.T) {
			got := asFloat(nil)

			t.Run("it should return NaN", func(t *testing.T) {
				if !math.IsNaN(got) {
					t.Errorf("got %v, want NaN", got)
				}
			})
		})
	})
}

func TestAsFloats(t *testing.T) {
	t.Run("given an array cell of numbers", func(t *testing.T) {
		t.Run("when asFloats is called", func(t *testing.T) {
			got := asFloats([]interface{}{1.0, json.Number("2"), "3"})

			t.Run("it should convert every element", func(t *testing.T) {
				want := []float64{1, 2, 3}
				if len(got) != len(want) {
					t.Fatalf("got %v, want %v", got, want)
				}
				for i := range want {
					if got[i] != want[i] {
						t.Errorf("index %d: got %v, want %v", i, got[i], want[i])
					}
				}
			})
		})
	})

	t.Run("given a value that is not an array", func(t *testing.T) {
		t.Run("when asFloats is called", func(t *testing.T) {
			got := asFloats("not an array")

			t.Run("it should return nil", func(t *testing.T) {
				if got != nil {
					t.Errorf("got %v, want nil", got)
				}
			})
		})
	})
}
