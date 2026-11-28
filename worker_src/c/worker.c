// Background worker: saves the day's Pebble Health sessions before the watch
// drops them at midnight. See src/common/session_cache.h.
#define SESSION_CACHE_WORKER
#include "../../src/common/session_cache.h"

#define SNAPSHOT_EVERY_MINUTES 5

static void prv_tick(struct tm *now, TimeUnits changed) {
  if (now->tm_min % SNAPSHOT_EVERY_MINUTES == SNAPSHOT_EVERY_MINUTES - 1) {
    session_cache_snapshot();
  }
}

int main(void) {
  session_cache_snapshot();
  tick_timer_service_subscribe(MINUTE_UNIT, prv_tick);
  worker_event_loop();
  tick_timer_service_unsubscribe();
}
