#pragma once
#include <pebble.h>
#include "workouts.h"

// Watch <-> phone protocol. Keep in sync with src/pkjs/index.js.
//
// Watch -> phone, `Command`:
//   1 = upload begin  (StartTime, EndTime, PebbleActivity, SportType, DistanceM, Calories, Minutes)
//   2 = upload chunk  (ChunkOffset, HeartRates, Steps)  bytes, one per minute
//   3 = upload end
// Phone -> watch:
//   settings: Favorites (csv of Strava ids), DefaultRun, DefaultWalk, DefaultWorkout, StravaConnected
//   upload progress: Status (1 = progress, 2 = done, 3 = error) + StatusText

typedef enum {
  CommStatusProgress = 1,
  CommStatusDone = 2,
  CommStatusError = 3,
} CommStatus;

typedef void (*CommSettingsHandler)(void);
typedef void (*CommStatusHandler)(CommStatus status, const char *text);

void comm_init(CommSettingsHandler on_settings);
// Starts sending a workout to the phone. Progress is reported to `on_status`.
bool comm_start_upload(const Workout *workout, const char *sport_id, CommStatusHandler on_status);
// Stops reporting progress (the phone may still finish an upload in flight).
void comm_cancel_upload(void);
