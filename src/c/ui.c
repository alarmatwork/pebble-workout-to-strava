#include "ui.h"

// Pebble Time 2 (emery) and Round 2 (gabbro) have larger screens.
#define UI_LARGE (PBL_DISPLAY_WIDTH >= 200)
#define UI_PAD PBL_IF_ROUND_ELSE(12, 6)
#define UI_ALIGN PBL_IF_ROUND_ELSE(GTextAlignmentCenter, GTextAlignmentLeft)

static GFont prv_title_font(void) {
  return fonts_get_system_font(UI_LARGE ? FONT_KEY_GOTHIC_28_BOLD : FONT_KEY_GOTHIC_24_BOLD);
}

static GFont prv_subtitle_font(void) {
  return fonts_get_system_font(UI_LARGE ? FONT_KEY_GOTHIC_24 : FONT_KEY_GOTHIC_18);
}

int16_t ui_row_height(bool has_subtitle) {
  if (UI_LARGE) {
    return has_subtitle ? 62 : 40;
  }
  return has_subtitle ? 50 : 34;
}

int16_t ui_header_height(void) {
  return UI_LARGE ? 28 : 24;
}

void ui_draw_row(GContext *gctx, const Layer *cell, const char *title, const char *subtitle) {
  GRect bounds = layer_get_bounds(cell);
  int16_t title_h = UI_LARGE ? 32 : 28;
  int16_t subtitle_h = UI_LARGE ? 28 : 22;
  int16_t content_h = title_h + (subtitle ? subtitle_h : 0);
  // Fonts draw a few pixels below their box top; shift up to center visually.
  int16_t y = (bounds.size.h - content_h) / 2 - (UI_LARGE ? 5 : 4);
  GRect box = GRect(UI_PAD, y, bounds.size.w - 2 * UI_PAD, title_h);
  graphics_draw_text(gctx, title, prv_title_font(), box, GTextOverflowModeTrailingEllipsis,
                     UI_ALIGN, NULL);
  if (subtitle) {
    box.origin.y += title_h - (UI_LARGE ? 2 : 1);
    box.size.h = subtitle_h;
    graphics_draw_text(gctx, subtitle, prv_subtitle_font(), box, GTextOverflowModeTrailingEllipsis,
                       UI_ALIGN, NULL);
  }
}

void ui_draw_header(GContext *gctx, const Layer *cell, const char *text) {
  GRect bounds = layer_get_bounds(cell);
  // Orange on color screens; white with a rule on black and white ones.
  graphics_context_set_fill_color(gctx, PBL_IF_COLOR_ELSE(GColorOrange, GColorWhite));
  graphics_fill_rect(gctx, bounds, 0, GCornerNone);
#ifndef PBL_COLOR
  graphics_context_set_stroke_color(gctx, GColorBlack);
  graphics_draw_line(gctx, GPoint(0, bounds.size.h - 1), GPoint(bounds.size.w, bounds.size.h - 1));
#endif
  graphics_context_set_text_color(gctx, GColorBlack);
  GRect box = GRect(UI_PAD, UI_LARGE ? -2 : -1, bounds.size.w - 2 * UI_PAD, bounds.size.h);
  graphics_draw_text(gctx, text,
                     fonts_get_system_font(UI_LARGE ? FONT_KEY_GOTHIC_24_BOLD : FONT_KEY_GOTHIC_18_BOLD),
                     box, GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
}

void ui_style_menu(MenuLayer *menu) {
  menu_layer_set_normal_colors(menu, GColorWhite, GColorBlack);
  menu_layer_set_highlight_colors(menu, GColorBlack, GColorWhite);
}
