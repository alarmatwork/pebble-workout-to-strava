#pragma once
// Pebble Health only reports activity sessions from the current day: at
// midnight the watch drops earlier sessions. This cache copies them to
// persistent storage, which the app and its background worker share, so
// workouts stay listed for the whole lookback period.

#ifdef SESSION_CACHE_WORKER
#include <pebble_worker.h>
#else
#include <pebble.h>
#endif

#define SESSION_CACHE_MAX 60
#define SESSION_CACHE_KEEP_DAYS 8

typedef struct {
  uint32_t start;
  uint16_t minutes;
  uint8_t code;  // 1 = run, 2 = walk, 3 = open workout
  uint8_t reserved;
} CachedSession;

// Copies the sessions Pebble Health has now into the cache. Writes storage only
// when something changed.
void session_cache_snapshot(void);

// Fills `out` with cached sessions, newest first. Returns the count.
int session_cache_load(CachedSession *out, int max);
