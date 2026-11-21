#ifndef LANGTON_H
#define LANGTON_H

#include <stdbool.h>
#include <stdint.h>

/*
 * Classic Langton's Ant (RL rule) on a dense grid that doubles in size
 * whenever the ant is about to leave it, up to max_size. No wrap-around.
 */

/* Clockwise order. Y grows downwards (screen coordinates). */
typedef enum {
    LG_NORTH = 0,
    LG_EAST  = 1,
    LG_SOUTH = 2,
    LG_WEST  = 3
} LgDirection;

typedef enum {
    LG_STATUS_OK         = 0,
    LG_STATUS_MAX_STEPS  = 1,
    LG_STATUS_GRID_LIMIT = 2,
    LG_STATUS_OUT_OF_MEM = 3
} LgStatus;

/* Inclusive rectangle of modified cells, in grid coordinates. */
typedef struct {
    int32_t x0;
    int32_t y0;
    int32_t x1;
    int32_t y1;
    bool empty;
} LgDirtyRect;

typedef struct {
    uint8_t *cells;
    int32_t size;
    int32_t initial_size;
    int32_t max_size;
    int32_t origin_x; /* world coordinate of grid cell (0, 0) */
    int32_t origin_y;
    uint32_t generation; /* bumped whenever the grid is reallocated */

    int32_t x; /* ant position, grid coordinates */
    int32_t y;
    uint8_t dir;

    uint64_t steps;
    uint64_t max_steps;
    uint64_t black_cells;
    LgStatus status;

    LgDirtyRect dirty;

    /* Observational highway detection: once periodic, the ant moves (±2, ±2) every 104 steps. */
    uint32_t hw_countdown;
    int32_t hw_last_wx;
    int32_t hw_last_wy;
    uint32_t hw_streak;
    uint64_t hw_start_step;
} LgSim;

/* 0xFF instead of 1 so a normalized R8 texture reads 1.0 and mipmaps keep full precision. */
#define LG_CELL_ON 0xFFu

#define LG_HIGHWAY_PERIOD        104u
#define LG_HIGHWAY_CONFIRMATIONS 12u

bool lg_init(LgSim *s, int32_t initial_size, int32_t max_size, uint64_t max_steps);
void lg_free(LgSim *s);
bool lg_reset(LgSim *s);
uint32_t lg_step(LgSim *s, uint32_t n);
void lg_set_max_steps(LgSim *s, uint64_t max_steps);
void lg_clear_dirty(LgSim *s);

static inline int32_t lg_world_x(const LgSim *s) {
    return s->x + s->origin_x;
}

static inline int32_t lg_world_y(const LgSim *s) {
    return s->y + s->origin_y;
}

#endif
