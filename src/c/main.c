#include <pebble.h>
#include "comm.h"
#include "settings.h"
#include "sports.h"
#include "workouts.h"

// ---------------------------------------------------------------------------
// Shared state

static Workout s_workouts[WORKOUT_MAX_COUNT];
static int s_workout_count;
static Workout s_selected;  // workout being exported

static void prv_workout_title(const Workout *w, char *buf, size_t size) {
  int minutes = (int)((w->end - w->start + 30) / 60);
  if (minutes >= 60) {
    snprintf(buf, size, "%s %dh %02dm", workouts_activity_name(w->activity), minutes / 60, minutes % 60);
  } else {
    snprintf(buf, size, "%s %d min", workouts_activity_name(w->activity), minutes);
  }
}

static int8_t prv_default_sport(const Workout *w) {
  Settings *s = settings_get();
  switch (w->activity) {
    case HealthActivityRun: return s->default_run;
    case HealthActivityWalk: return s->default_walk;
    default: return s->default_workout;
  }
}

static Window *s_all_window;
static Window *s_sport_window;

// ---------------------------------------------------------------------------
// Progress window

static Window *s_progress_window;
static TextLayer *s_progress_title;
static TextLayer *s_progress_text;
static char s_progress_title_buf[48];
static char s_progress_buf[128];

static void prv_on_status(CommStatus status, const char *text) {
  if (!s_progress_window) {
    return;
  }
  switch (status) {
    case CommStatusDone:
      snprintf(s_progress_buf, sizeof(s_progress_buf), "Uploaded!\n\n%s", text);
      vibes_short_pulse();
      break;
    case CommStatusError:
      snprintf(s_progress_buf, sizeof(s_progress_buf), "Upload failed\n\n%s", text);
      vibes_double_pulse();
      break;
    default:
      snprintf(s_progress_buf, sizeof(s_progress_buf), "%s", text);
      break;
  }
  text_layer_set_text(s_progress_text, s_progress_buf);
}

static void prv_progress_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);
  int inset = PBL_IF_ROUND_ELSE(24, 8);
  GRect inner = grect_inset(bounds, GEdgeInsets(PBL_IF_ROUND_ELSE(36, 12), inset, 8, inset));

  s_progress_title = text_layer_create(GRect(inner.origin.x, inner.origin.y, inner.size.w, 32));
  text_layer_set_font(s_progress_title, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD));
  text_layer_set_text_alignment(s_progress_title, PBL_IF_ROUND_ELSE(GTextAlignmentCenter, GTextAlignmentLeft));
  text_layer_set_text(s_progress_title, s_progress_title_buf);
  layer_add_child(root, text_layer_get_layer(s_progress_title));

  s_progress_text = text_layer_create(
      GRect(inner.origin.x, inner.origin.y + 36, inner.size.w, inner.size.h - 36));
  text_layer_set_font(s_progress_text, fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_text_alignment(s_progress_text, PBL_IF_ROUND_ELSE(GTextAlignmentCenter, GTextAlignmentLeft));
  text_layer_set_overflow_mode(s_progress_text, GTextOverflowModeWordWrap);
  text_layer_set_text(s_progress_text, s_progress_buf);
  layer_add_child(root, text_layer_get_layer(s_progress_text));
}

static void prv_progress_unload(Window *window) {
  comm_cancel_upload();
  text_layer_destroy(s_progress_title);
  text_layer_destroy(s_progress_text);
  window_destroy(s_progress_window);
  s_progress_window = NULL;
}

// Drop the sport menus so Back from the result returns to the workout list.
static void prv_remove_sport_windows(void *context) {
  if (s_all_window) {
    window_stack_remove(s_all_window, false);
  }
  if (s_sport_window) {
    window_stack_remove(s_sport_window, false);
  }
}

static void prv_start_upload(int sport_index) {
  const SportType *sport = sports_get(sport_index);
  if (!sport) {
    return;
  }
  snprintf(s_progress_title_buf, sizeof(s_progress_title_buf), "%s", sport->name);
  snprintf(s_progress_buf, sizeof(s_progress_buf), "Reading workout...");

  s_progress_window = window_create();
  window_set_window_handlers(s_progress_window, (WindowHandlers){
      .load = prv_progress_load,
      .unload = prv_progress_unload,
  });
  window_stack_push(s_progress_window, true);
  // Deferred: this runs inside a menu's click handler, so the menu must not
  // be destroyed yet.
  app_timer_register(0, prv_remove_sport_windows, NULL);

  if (!settings_get()->strava_connected) {
    prv_on_status(CommStatusError, "Not set up yet. Open the app settings in the Pebble phone app.");
    return;
  }
  comm_start_upload(&s_selected, sport->id, prv_on_status);
}

// ---------------------------------------------------------------------------
// All sport types window

static MenuLayer *s_all_menu;

static uint16_t prv_all_rows(MenuLayer *menu, uint16_t section, void *ctx) {
  return (uint16_t)sports_count();
}

static void prv_all_draw(GContext *gctx, const Layer *cell, MenuIndex *index, void *ctx) {
  menu_cell_basic_draw(gctx, cell, sports_get(index->row)->name, NULL, NULL);
}

static void prv_all_select(MenuLayer *menu, MenuIndex *index, void *ctx) {
  prv_start_upload(index->row);
}

static void prv_all_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_all_menu = menu_layer_create(layer_get_bounds(root));
  menu_layer_set_callbacks(s_all_menu, NULL, (MenuLayerCallbacks){
      .get_num_rows = prv_all_rows,
      .draw_row = prv_all_draw,
      .select_click = prv_all_select,
  });
  menu_layer_set_click_config_onto_window(s_all_menu, window);
  layer_add_child(root, menu_layer_get_layer(s_all_menu));
}

static void prv_all_unload(Window *window) {
  menu_layer_destroy(s_all_menu);
  window_destroy(s_all_window);
  s_all_window = NULL;
}

static void prv_push_all_window(void) {
  s_all_window = window_create();
  window_set_window_handlers(s_all_window, (WindowHandlers){
      .load = prv_all_load,
      .unload = prv_all_unload,
  });
  window_stack_push(s_all_window, true);
}

// ---------------------------------------------------------------------------
// Sport type picker: default first, then favorites, then "More types..."

static MenuLayer *s_sport_menu;
static uint8_t s_sport_rows[MAX_FAVORITES + 1];
static int s_sport_row_count;
static int8_t s_sport_default;
static char s_sport_header[40];

static void prv_build_sport_rows(void) {
  Settings *s = settings_get();
  s_sport_row_count = 0;
  s_sport_default = prv_default_sport(&s_selected);
  if (s_sport_default >= 0) {
    s_sport_rows[s_sport_row_count++] = (uint8_t)s_sport_default;
  }
  for (int i = 0; i < s->favorite_count && s_sport_row_count < (int)ARRAY_LENGTH(s_sport_rows); i++) {
    if (s->favorites[i] != s_sport_default) {
      s_sport_rows[s_sport_row_count++] = s->favorites[i];
    }
  }
}

static uint16_t prv_sport_rows(MenuLayer *menu, uint16_t section, void *ctx) {
  return (uint16_t)(s_sport_row_count + 1);
}

static int16_t prv_sport_header_height(MenuLayer *menu, uint16_t section, void *ctx) {
  return MENU_CELL_BASIC_HEADER_HEIGHT;
}

static void prv_sport_draw_header(GContext *gctx, const Layer *cell, uint16_t section, void *ctx) {
  menu_cell_basic_header_draw(gctx, cell, s_sport_header);
}

static void prv_sport_draw(GContext *gctx, const Layer *cell, MenuIndex *index, void *ctx) {
  if (index->row >= s_sport_row_count) {
    menu_cell_basic_draw(gctx, cell, "More types...", NULL, NULL);
    return;
  }
  int sport = s_sport_rows[index->row];
  const char *subtitle = (sport == s_sport_default) ? "Default" : NULL;
  menu_cell_basic_draw(gctx, cell, sports_get(sport)->name, subtitle, NULL);
}

static void prv_sport_select(MenuLayer *menu, MenuIndex *index, void *ctx) {
  if (index->row >= s_sport_row_count) {
    prv_push_all_window();
  } else {
    prv_start_upload(s_sport_rows[index->row]);
  }
}

static void prv_sport_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_sport_menu = menu_layer_create(layer_get_bounds(root));
  menu_layer_set_callbacks(s_sport_menu, NULL, (MenuLayerCallbacks){
      .get_num_rows = prv_sport_rows,
      .get_header_height = prv_sport_header_height,
      .draw_header = prv_sport_draw_header,
      .draw_row = prv_sport_draw,
      .select_click = prv_sport_select,
  });
  menu_layer_set_click_config_onto_window(s_sport_menu, window);
  layer_add_child(root, menu_layer_get_layer(s_sport_menu));
}

static void prv_sport_unload(Window *window) {
  menu_layer_destroy(s_sport_menu);
  window_destroy(s_sport_window);
  s_sport_window = NULL;
}

static void prv_push_sport_window(void) {
  prv_build_sport_rows();
  prv_workout_title(&s_selected, s_sport_header, sizeof(s_sport_header));
  s_sport_window = window_create();
  window_set_window_handlers(s_sport_window, (WindowHandlers){
      .load = prv_sport_load,
      .unload = prv_sport_unload,
  });
  window_stack_push(s_sport_window, true);
}

// ---------------------------------------------------------------------------
// Workout list window

static Window *s_list_window;
static MenuLayer *s_list_menu;

static void prv_reload_workouts(void) {
  s_workout_count = workouts_load(s_workouts, WORKOUT_MAX_COUNT);
  if (s_list_menu) {
    menu_layer_reload_data(s_list_menu);
  }
}

static uint16_t prv_list_rows(MenuLayer *menu, uint16_t section, void *ctx) {
  return s_workout_count > 0 ? (uint16_t)s_workout_count : 1;
}

static int16_t prv_list_header_height(MenuLayer *menu, uint16_t section, void *ctx) {
  return MENU_CELL_BASIC_HEADER_HEIGHT;
}

static void prv_list_draw_header(GContext *gctx, const Layer *cell, uint16_t section, void *ctx) {
  menu_cell_basic_header_draw(gctx, cell,
      settings_get()->strava_connected ? "Recent workouts" : "Not set up");
}

static void prv_list_draw(GContext *gctx, const Layer *cell, MenuIndex *index, void *ctx) {
  if (s_workout_count == 0) {
    menu_cell_basic_draw(gctx, cell, "No workouts", "in the last 7 days", NULL);
    return;
  }
  const Workout *w = &s_workouts[index->row];
  char title[40];
  char when[24];
  char subtitle[40];
  prv_workout_title(w, title, sizeof(title));
  strftime(when, sizeof(when), clock_is_24h_style() ? "%a %d %b %H:%M" : "%a %d %b %I:%M%p",
           localtime(&w->start));
  snprintf(subtitle, sizeof(subtitle), "%s%s", w->exported ? "Sent * " : "", when);
  menu_cell_basic_draw(gctx, cell, title, subtitle, NULL);
}

static void prv_list_select(MenuLayer *menu, MenuIndex *index, void *ctx) {
  if (s_workout_count == 0) {
    return;
  }
  s_selected = s_workouts[index->row];
  prv_push_sport_window();
}

static void prv_list_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  s_list_menu = menu_layer_create(layer_get_bounds(root));
  menu_layer_set_callbacks(s_list_menu, NULL, (MenuLayerCallbacks){
      .get_num_rows = prv_list_rows,
      .get_header_height = prv_list_header_height,
      .draw_header = prv_list_draw_header,
      .draw_row = prv_list_draw,
      .select_click = prv_list_select,
  });
#if defined(PBL_COLOR)
  menu_layer_set_highlight_colors(s_list_menu, GColorOrange, GColorWhite);
#endif
  menu_layer_set_click_config_onto_window(s_list_menu, window);
  layer_add_child(root, menu_layer_get_layer(s_list_menu));
}

static void prv_list_appear(Window *window) {
  prv_reload_workouts();
}

static void prv_list_unload(Window *window) {
  menu_layer_destroy(s_list_menu);
  s_list_menu = NULL;
  window_destroy(s_list_window);
  s_list_window = NULL;
}

static void prv_push_list_window(void) {
  s_list_window = window_create();
  window_set_window_handlers(s_list_window, (WindowHandlers){
      .load = prv_list_load,
      .appear = prv_list_appear,
      .unload = prv_list_unload,
  });
  window_stack_push(s_list_window, true);
}

static void prv_on_settings(void) {
  if (s_list_menu) {
    menu_layer_reload_data(s_list_menu);
  }
}

// ---------------------------------------------------------------------------

int main(void) {
  settings_load();
  comm_init(prv_on_settings);
  prv_push_list_window();
  app_event_loop();
  comm_cancel_upload();
}
