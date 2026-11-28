#include "session_cache.h"

// Two persist values of 30 records each (a value holds at most 256 bytes).
#define CACHE_KEY_FIRST 20
#define CACHE_KEYS 2
#define RECORDS_PER_KEY (SESSION_CACHE_MAX / CACHE_KEYS)

typedef struct {
  CachedSession items[SESSION_CACHE_MAX];
  int count;
} Cache;

static int prv_code(HealthActivity activity) {
  switch (activity) {
    case HealthActivityRun: return 1;
    case HealthActivityWalk: return 2;
    default: return 3;
  }
}

static void prv_read(Cache *cache) {
  cache->count = 0;
  for (int k = 0; k < CACHE_KEYS; k++) {
    int size = persist_read_data(CACHE_KEY_FIRST + k, &cache->items[cache->count],
                                 RECORDS_PER_KEY * sizeof(CachedSession));
    if (size > 0) {
      cache->count += size / (int)sizeof(CachedSession);
    }
  }
}

static void prv_write(const Cache *cache) {
  for (int k = 0; k < CACHE_KEYS; k++) {
    int first = k * RECORDS_PER_KEY;
    int n = cache->count - first;
    if (n > RECORDS_PER_KEY) {
      n = RECORDS_PER_KEY;
    }
    if (n > 0) {
      persist_write_data(CACHE_KEY_FIRST + k, &cache->items[first], n * sizeof(CachedSession));
    } else if (persist_exists(CACHE_KEY_FIRST + k)) {
      persist_delete(CACHE_KEY_FIRST + k);
    }
  }
}

// Newest first.
static void prv_sort(Cache *cache) {
  for (int i = 1; i < cache->count; i++) {
    CachedSession item = cache->items[i];
    int j = i - 1;
    while (j >= 0 && cache->items[j].start < item.start) {
      cache->items[j + 1] = cache->items[j];
      j--;
    }
    cache->items[j + 1] = item;
  }
}

typedef struct {
  Cache *cache;
  bool changed;
} SnapshotContext;

static bool prv_session_cb(HealthActivity activity, time_t start, time_t end, void *context) {
  SnapshotContext *ctx = context;
  Cache *cache = ctx->cache;
  uint16_t minutes = (uint16_t)((end - start) / 60);
  uint8_t code = (uint8_t)prv_code(activity);
  for (int i = 0; i < cache->count; i++) {
    CachedSession *item = &cache->items[i];
    if (item->start == (uint32_t)start && item->code == code) {
      // A session still in progress keeps growing.
      if (item->minutes != minutes) {
        item->minutes = minutes;
        ctx->changed = true;
      }
      return true;
    }
  }
  if (cache->count == SESSION_CACHE_MAX) {
    // Full: replace the oldest if this one is newer.
    prv_sort(cache);
    if (cache->items[cache->count - 1].start >= (uint32_t)start) {
      return true;
    }
    cache->count--;
  }
  cache->items[cache->count++] = (CachedSession){.start = (uint32_t)start, .minutes = minutes, .code = code};
  ctx->changed = true;
  return true;
}

void session_cache_snapshot(void) {
  static Cache cache;  // static: keeps it off the small worker stack
  prv_read(&cache);
  SnapshotContext ctx = {.cache = &cache, .changed = false};

  time_t now = time(NULL);
  uint32_t oldest = (uint32_t)(now - SESSION_CACHE_KEEP_DAYS * SECONDS_PER_DAY);
  for (int i = 0; i < cache.count; i++) {
    if (cache.items[i].start < oldest) {
      cache.items[i] = cache.items[--cache.count];
      i--;
      ctx.changed = true;
    }
  }

  health_service_activities_iterate(HealthActivityRun | HealthActivityWalk | HealthActivityOpenWorkout,
                                    now - 2 * SECONDS_PER_DAY, now, HealthIterationDirectionPast,
                                    prv_session_cb, &ctx);
  if (ctx.changed) {
    prv_sort(&cache);
    prv_write(&cache);
  }
}

int session_cache_load(CachedSession *out, int max) {
  static Cache cache;
  prv_read(&cache);
  prv_sort(&cache);
  int n = cache.count < max ? cache.count : max;
  memcpy(out, cache.items, n * sizeof(CachedSession));
  return n;
}
