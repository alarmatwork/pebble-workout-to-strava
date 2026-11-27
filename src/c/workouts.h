#pragma once
#include <pebble.h>

// Workouts are read from Pebble Health: sessions recorded by the built-in
// Workout app (Run, Walk, Open Workout). Runs and walks the watch detected on
// its own show up as well, since the Health API reports them the same way.

#define WORKOUT_LOOKBACK_DAYS 7
#define WORKOUT_MAX_COUNT 32
#define WORKOUT_MIN_SECONDS (3 * 60)
#define WORKOUT_MAX_MINUTES (12 * 60)

typedef struct {
  time_t start;
  time_t end;
  HealthActivity activity;
  bool exported;
} Workout;

typedef struct {
  uint16_t minutes;
  uint8_t *heart_rates;  // bpm per minute, 0 = no reading
  uint8_t *steps;        // steps per minute
  uint32_t distance_m;
  uint32_t calories;     // active kcal
} WorkoutData;

// Fills `out` with recent workouts, newest first. Returns the count.
int workouts_load(Workout *out, int max);

const char *workouts_activity_name(HealthActivity activity);
// Protocol value sent to the phone: 1 = run, 2 = walk, 3 = open workout.
int workouts_activity_code(HealthActivity activity);

// Reads per-minute heart rate and steps plus totals. Free with workouts_free_data.
bool workouts_read_data(const Workout *workout, WorkoutData *data);
void workouts_free_data(WorkoutData *data);

bool workouts_is_exported(time_t start);
void workouts_mark_exported(time_t start);
