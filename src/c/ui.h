#pragma once
#include <pebble.h>

// Menu drawing with larger, bolder fonts than the system defaults.

// Row heights for rows with and without a subtitle.
int16_t ui_row_height(bool has_subtitle);
int16_t ui_header_height(void);

void ui_draw_row(GContext *gctx, const Layer *cell, const char *title, const char *subtitle);
void ui_draw_header(GContext *gctx, const Layer *cell, const char *text);

// Colors for a menu: high-contrast selection.
void ui_style_menu(MenuLayer *menu);
