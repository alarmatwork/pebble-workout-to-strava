#pragma once

// Strava sport types. The table is generated at build time from
// src/pkjs/sport_types.json (see wscript), so the watch and the phone
// settings page always share one list.

typedef struct {
  const char *id;    // Strava API value, e.g. "WeightTraining"
  const char *name;  // Display name, e.g. "Weight Training"
} SportType;

int sports_count(void);
const SportType *sports_get(int index);
// Returns the index of the sport type with this Strava id, or -1.
int sports_find(const char *id);
