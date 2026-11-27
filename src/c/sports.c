#include <pebble.h>
#include "sports.h"
#include "sport_types.auto.h"  // defines SPORT_TYPES[]

int sports_count(void) {
  return (int)ARRAY_LENGTH(SPORT_TYPES);
}

const SportType *sports_get(int index) {
  if (index < 0 || index >= sports_count()) {
    return NULL;
  }
  return &SPORT_TYPES[index];
}

int sports_find(const char *id) {
  if (!id) {
    return -1;
  }
  for (int i = 0; i < sports_count(); i++) {
    if (strcmp(SPORT_TYPES[i].id, id) == 0) {
      return i;
    }
  }
  return -1;
}
