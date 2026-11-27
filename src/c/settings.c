#include "settings.h"
#include "sports.h"

#define SETTINGS_KEY 1
#define SETTINGS_VERSION_KEY 2
#define SETTINGS_VERSION 1

static Settings s_settings;

static void set_defaults(void) {
  memset(&s_settings, 0, sizeof(s_settings));
  s_settings.default_run = sports_find("Run");
  s_settings.default_walk = sports_find("Walk");
  s_settings.default_workout = sports_find("Workout");
  static const char *const initial[] = {"Run", "Walk", "Ride", "Hike", "WeightTraining", "Workout"};
  for (unsigned i = 0; i < ARRAY_LENGTH(initial); i++) {
    int index = sports_find(initial[i]);
    if (index >= 0) {
      s_settings.favorites[s_settings.favorite_count++] = (uint8_t)index;
    }
  }
}

void settings_load(void) {
  set_defaults();
  if (persist_exists(SETTINGS_KEY) && persist_read_int(SETTINGS_VERSION_KEY) == SETTINGS_VERSION) {
    Settings stored;
    if (persist_read_data(SETTINGS_KEY, &stored, sizeof(stored)) == (int)sizeof(stored)) {
      s_settings = stored;
    }
  }
  // Guard against a table that shrank between app versions.
  int count = sports_count();
  uint8_t kept = 0;
  for (uint8_t i = 0; i < s_settings.favorite_count && i < MAX_FAVORITES; i++) {
    if (s_settings.favorites[i] < count) {
      s_settings.favorites[kept++] = s_settings.favorites[i];
    }
  }
  s_settings.favorite_count = kept;
  if (s_settings.default_run >= count) s_settings.default_run = -1;
  if (s_settings.default_walk >= count) s_settings.default_walk = -1;
  if (s_settings.default_workout >= count) s_settings.default_workout = -1;
}

void settings_save(void) {
  persist_write_int(SETTINGS_VERSION_KEY, SETTINGS_VERSION);
  persist_write_data(SETTINGS_KEY, &s_settings, sizeof(s_settings));
}

Settings *settings_get(void) {
  return &s_settings;
}

void settings_set_favorites_csv(const char *csv) {
  s_settings.favorite_count = 0;
  char id[40];
  size_t len = 0;
  for (const char *p = csv;; p++) {
    if (*p == ',' || *p == '\0') {
      id[len] = '\0';
      int index = sports_find(id);
      if (index >= 0 && s_settings.favorite_count < MAX_FAVORITES) {
        s_settings.favorites[s_settings.favorite_count++] = (uint8_t)index;
      }
      len = 0;
      if (*p == '\0') {
        break;
      }
    } else if (len < sizeof(id) - 1) {
      id[len++] = *p;
    }
  }
}
