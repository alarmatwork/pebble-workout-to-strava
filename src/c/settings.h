#pragma once
#include <pebble.h>

#define MAX_FAVORITES 24

// Settings chosen on the phone settings page, cached on the watch so the
// sport type menu opens instantly. Sport types are stored as indices into
// the sport table; the phone re-sends the settings (by Strava id) every time
// the app starts, so the indices never go stale across app updates.
typedef struct {
  uint8_t favorite_count;
  uint8_t favorites[MAX_FAVORITES];
  int8_t default_run;      // -1 = none
  int8_t default_walk;
  int8_t default_workout;  // for Pebble "Open Workout"
  bool strava_connected;
} Settings;

void settings_load(void);
void settings_save(void);
Settings *settings_get(void);

// Applies a comma separated list of Strava sport ids to the favorites.
void settings_set_favorites_csv(const char *csv);
