#include "comm.h"
#include "settings.h"
#include "sports.h"

#define CMD_BEGIN 1
#define CMD_CHUNK 2
#define CMD_END 3

#define CHUNK_MINUTES 120
#define MAX_RETRIES 3
#define RETRY_DELAY_MS 600
#define PHONE_TIMEOUT_MS (120 * 1000)

typedef enum {
  PhaseIdle,
  PhaseBegin,
  PhaseChunks,
  PhaseEnd,
  PhaseWaiting,  // all data sent, waiting for Strava result from the phone
} Phase;

static struct {
  Phase phase;
  Workout workout;
  WorkoutData data;
  char sport_id[40];
  uint16_t offset;
  uint8_t retries;
  AppTimer *timer;
  CommStatusHandler on_status;
} s_upload;

static CommSettingsHandler s_on_settings;

static void prv_send_next(void);

static void prv_finish(CommStatus status, const char *text) {
  if (s_upload.timer) {
    app_timer_cancel(s_upload.timer);
    s_upload.timer = NULL;
  }
  workouts_free_data(&s_upload.data);
  CommStatusHandler handler = s_upload.on_status;
  s_upload.phase = PhaseIdle;
  s_upload.on_status = NULL;
  if (status == CommStatusDone) {
    workouts_mark_exported(s_upload.workout.start);
  }
  if (handler) {
    handler(status, text);
  }
}

static void prv_report(const char *text) {
  if (s_upload.on_status) {
    s_upload.on_status(CommStatusProgress, text);
  }
}

static void prv_timeout_cb(void *context) {
  s_upload.timer = NULL;
  if (s_upload.phase == PhaseWaiting) {
    prv_finish(CommStatusError, "No answer from the phone.");
  }
}

static void prv_retry_cb(void *context) {
  s_upload.timer = NULL;
  prv_send_next();
}

static void prv_send_next(void) {
  DictionaryIterator *iter;
  AppMessageResult result = app_message_outbox_begin(&iter);
  if (result != APP_MSG_OK) {
    s_upload.timer = app_timer_register(RETRY_DELAY_MS, prv_retry_cb, NULL);
    return;
  }

  switch (s_upload.phase) {
    case PhaseBegin:
      dict_write_int32(iter, MESSAGE_KEY_Command, CMD_BEGIN);
      dict_write_int32(iter, MESSAGE_KEY_StartTime, (int32_t)s_upload.workout.start);
      dict_write_int32(iter, MESSAGE_KEY_EndTime, (int32_t)s_upload.workout.end);
      dict_write_int32(iter, MESSAGE_KEY_PebbleActivity, workouts_activity_code(s_upload.workout.activity));
      dict_write_cstring(iter, MESSAGE_KEY_SportType, s_upload.sport_id);
      dict_write_int32(iter, MESSAGE_KEY_DistanceM, (int32_t)s_upload.data.distance_m);
      dict_write_int32(iter, MESSAGE_KEY_Calories, (int32_t)s_upload.data.calories);
      dict_write_int32(iter, MESSAGE_KEY_Minutes, s_upload.data.minutes);
      break;
    case PhaseChunks: {
      uint16_t count = s_upload.data.minutes - s_upload.offset;
      if (count > CHUNK_MINUTES) {
        count = CHUNK_MINUTES;
      }
      dict_write_int32(iter, MESSAGE_KEY_Command, CMD_CHUNK);
      dict_write_int32(iter, MESSAGE_KEY_ChunkOffset, s_upload.offset);
      dict_write_data(iter, MESSAGE_KEY_HeartRates, s_upload.data.heart_rates + s_upload.offset, count);
      dict_write_data(iter, MESSAGE_KEY_Steps, s_upload.data.steps + s_upload.offset, count);
      break;
    }
    case PhaseEnd:
      dict_write_int32(iter, MESSAGE_KEY_Command, CMD_END);
      break;
    default:
      return;
  }
  app_message_outbox_send();
}

static void prv_outbox_sent(DictionaryIterator *iter, void *context) {
  s_upload.retries = 0;
  switch (s_upload.phase) {
    case PhaseBegin:
      s_upload.phase = PhaseChunks;
      s_upload.offset = 0;
      break;
    case PhaseChunks:
      s_upload.offset += CHUNK_MINUTES;
      if (s_upload.offset >= s_upload.data.minutes) {
        s_upload.phase = PhaseEnd;
      }
      break;
    case PhaseEnd:
      s_upload.phase = PhaseWaiting;
      prv_report("Uploading to Strava...");
      s_upload.timer = app_timer_register(PHONE_TIMEOUT_MS, prv_timeout_cb, NULL);
      return;
    default:
      return;
  }
  prv_send_next();
}

static void prv_outbox_failed(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "Outbox failed: %d", (int)reason);
  if (s_upload.phase == PhaseIdle || s_upload.phase == PhaseWaiting) {
    return;
  }
  if (++s_upload.retries > MAX_RETRIES) {
    prv_finish(CommStatusError, "Phone not reachable. Is the Pebble app running?");
    return;
  }
  s_upload.timer = app_timer_register(RETRY_DELAY_MS, prv_retry_cb, NULL);
}

static int8_t prv_sport_index(DictionaryIterator *iter, uint32_t key, int8_t fallback) {
  Tuple *t = dict_find(iter, key);
  if (!t || t->type != TUPLE_CSTRING) {
    return fallback;
  }
  return (int8_t)sports_find(t->value->cstring);
}

static void prv_inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *favorites = dict_find(iter, MESSAGE_KEY_Favorites);
  Tuple *connected = dict_find(iter, MESSAGE_KEY_StravaConnected);
  if (favorites || connected) {
    Settings *settings = settings_get();
    if (favorites && favorites->type == TUPLE_CSTRING) {
      settings_set_favorites_csv(favorites->value->cstring);
    }
    settings->default_run = prv_sport_index(iter, MESSAGE_KEY_DefaultRun, settings->default_run);
    settings->default_walk = prv_sport_index(iter, MESSAGE_KEY_DefaultWalk, settings->default_walk);
    settings->default_workout = prv_sport_index(iter, MESSAGE_KEY_DefaultWorkout, settings->default_workout);
    if (connected) {
      settings->strava_connected = connected->value->int32 != 0;
    }
    settings_save();
    if (s_on_settings) {
      s_on_settings();
    }
  }

  Tuple *status = dict_find(iter, MESSAGE_KEY_Status);
  if (status && s_upload.phase != PhaseIdle) {
    Tuple *text = dict_find(iter, MESSAGE_KEY_StatusText);
    const char *message = (text && text->type == TUPLE_CSTRING) ? text->value->cstring : "";
    CommStatus code = (CommStatus)status->value->int32;
    if (code == CommStatusProgress) {
      prv_report(message);
    } else {
      prv_finish(code, message);
    }
  }
}

void comm_init(CommSettingsHandler on_settings) {
  s_on_settings = on_settings;
  app_message_register_inbox_received(prv_inbox_received);
  app_message_register_outbox_sent(prv_outbox_sent);
  app_message_register_outbox_failed(prv_outbox_failed);
  // Favorites arrive as one comma separated string, so the inbox needs room.
  app_message_open(2048, 512);
}

bool comm_start_upload(const Workout *workout, const char *sport_id, CommStatusHandler on_status) {
  if (s_upload.phase != PhaseIdle && s_upload.phase != PhaseWaiting) {
    return false;
  }
  if (s_upload.timer) {
    app_timer_cancel(s_upload.timer);
    s_upload.timer = NULL;
  }
  workouts_free_data(&s_upload.data);
  s_upload.workout = *workout;
  strncpy(s_upload.sport_id, sport_id, sizeof(s_upload.sport_id) - 1);
  s_upload.sport_id[sizeof(s_upload.sport_id) - 1] = '\0';
  s_upload.on_status = on_status;
  s_upload.retries = 0;
  if (!workouts_read_data(workout, &s_upload.data)) {
    s_upload.on_status = NULL;
    on_status(CommStatusError, "Could not read workout data from the watch.");
    return false;
  }
  s_upload.phase = PhaseBegin;
  prv_report("Sending to phone...");
  prv_send_next();
  return true;
}

void comm_cancel_upload(void) {
  s_upload.on_status = NULL;
  // While waiting for Strava, keep listening so a late "done" still marks
  // the workout as exported.
  if (s_upload.phase != PhaseIdle && s_upload.phase != PhaseWaiting) {
    if (s_upload.timer) {
      app_timer_cancel(s_upload.timer);
      s_upload.timer = NULL;
    }
    workouts_free_data(&s_upload.data);
    s_upload.phase = PhaseIdle;
  }
}
