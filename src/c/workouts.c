#include "workouts.h"
#include "../common/session_cache.h"

#define EXPORTED_KEY 10
#define EXPORTED_MAX 60  // 240 bytes, fits in one persist value (256 max)
#define HISTORY_CHUNK 60

static HealthActivity prv_activity(uint8_t code) {
  switch (code) {
    case 1: return HealthActivityRun;
    case 2: return HealthActivityWalk;
    default: return HealthActivityOpenWorkout;
  }
}

int workouts_load(Workout *out, int max) {
  // Pebble Health only reports today's sessions, so read them through the
  // cache, which the background worker also fills.
  session_cache_snapshot();
  static CachedSession sessions[SESSION_CACHE_MAX];
  int total = session_cache_load(sessions, SESSION_CACHE_MAX);
  time_t oldest = time(NULL) - WORKOUT_LOOKBACK_DAYS * SECONDS_PER_DAY;
  int count = 0;
  for (int i = 0; i < total && count < max; i++) {
    const CachedSession *s = &sessions[i];
    if ((time_t)s->start < oldest || s->minutes * 60 < WORKOUT_MIN_SECONDS) {
      continue;
    }
    out[count++] = (Workout){
        .start = (time_t)s->start,
        .end = (time_t)s->start + s->minutes * 60,
        .activity = prv_activity(s->code),
        .exported = workouts_is_exported((time_t)s->start),
    };
  }
  return count;
}

const char *workouts_activity_name(HealthActivity activity) {
  switch (activity) {
    case HealthActivityRun: return "Run";
    case HealthActivityWalk: return "Walk";
    case HealthActivityOpenWorkout: return "Workout";
    default: return "Activity";
  }
}

int workouts_activity_code(HealthActivity activity) {
  switch (activity) {
    case HealthActivityRun: return 1;
    case HealthActivityWalk: return 2;
    default: return 3;
  }
}

bool workouts_read_data(const Workout *workout, WorkoutData *data) {
  memset(data, 0, sizeof(*data));
  time_t start = workout->start - (workout->start % 60);
  int minutes = (int)((workout->end - start + 59) / 60);
  if (minutes <= 0) {
    return false;
  }
  if (minutes > WORKOUT_MAX_MINUTES) {
    minutes = WORKOUT_MAX_MINUTES;
  }
  data->minutes = (uint16_t)minutes;
  data->heart_rates = calloc(minutes, 1);
  data->steps = calloc(minutes, 1);
  HealthMinuteData *chunk = malloc(HISTORY_CHUNK * sizeof(HealthMinuteData));
  if (!data->heart_rates || !data->steps || !chunk) {
    free(chunk);
    workouts_free_data(data);
    return false;
  }

  time_t end = start + minutes * 60;
  time_t cursor = start;
  while (cursor < end) {
    time_t chunk_start = cursor;
    time_t chunk_end = end;
    uint32_t n = health_service_get_minute_history(chunk, HISTORY_CHUNK, &chunk_start, &chunk_end);
    if (n == 0 || chunk_end <= cursor) {
      break;
    }
    for (uint32_t i = 0; i < n; i++) {
      int index = (int)((chunk_start - start) / 60) + (int)i;
      if (index < 0 || index >= minutes || chunk[i].is_invalid) {
        continue;
      }
      data->heart_rates[index] = chunk[i].heart_rate_bpm;
      data->steps[index] = chunk[i].steps;
    }
    cursor = chunk_end;
  }
  free(chunk);

  HealthValue distance = health_service_sum(HealthMetricWalkedDistanceMeters, workout->start, workout->end);
  HealthValue kcal = health_service_sum(HealthMetricActiveKCalories, workout->start, workout->end);
  data->distance_m = distance > 0 ? (uint32_t)distance : 0;
  data->calories = kcal > 0 ? (uint32_t)kcal : 0;
  return true;
}

void workouts_free_data(WorkoutData *data) {
  free(data->heart_rates);
  free(data->steps);
  data->heart_rates = NULL;
  data->steps = NULL;
}

// Exported workouts are remembered by start time in a small ring buffer.
static int prv_read_exported(uint32_t *list) {
  int size = persist_read_data(EXPORTED_KEY, list, EXPORTED_MAX * sizeof(uint32_t));
  return size > 0 ? size / (int)sizeof(uint32_t) : 0;
}

bool workouts_is_exported(time_t start) {
  uint32_t list[EXPORTED_MAX];
  int count = prv_read_exported(list);
  for (int i = 0; i < count; i++) {
    if (list[i] == (uint32_t)start) {
      return true;
    }
  }
  return false;
}

void workouts_mark_exported(time_t start) {
  if (workouts_is_exported(start)) {
    return;
  }
  uint32_t list[EXPORTED_MAX];
  int count = prv_read_exported(list);
  if (count == EXPORTED_MAX) {
    memmove(list, list + 1, (EXPORTED_MAX - 1) * sizeof(uint32_t));
    count--;
  }
  list[count++] = (uint32_t)start;
  persist_write_data(EXPORTED_KEY, list, count * sizeof(uint32_t));
}
