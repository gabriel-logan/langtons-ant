#include "langton.h"

#include <stdlib.h>
#include <string.h>

static const int8_t DX[4] = { 0, 1, 0, -1 };
static const int8_t DY[4] = { -1, 0, 1, 0 };

static void dirty_mark_all(LgSim *s) {
    s->dirty.x0 = 0;
    s->dirty.y0 = 0;
    s->dirty.x1 = s->size - 1;
    s->dirty.y1 = s->size - 1;
    s->dirty.empty = false;
}

static void highway_reset(LgSim *s) {
    s->hw_countdown = LG_HIGHWAY_PERIOD;
    s->hw_last_wx = lg_world_x(s);
    s->hw_last_wy = lg_world_y(s);
    s->hw_streak = 0;
    s->hw_start_step = 0;
}

static void highway_checkpoint(LgSim *s) {
    const int32_t wx = lg_world_x(s);
    const int32_t wy = lg_world_y(s);
    const int32_t dx = wx - s->hw_last_wx;
    const int32_t dy = wy - s->hw_last_wy;

    if ((dx == 2 || dx == -2) && (dy == 2 || dy == -2)) {
        s->hw_streak++;
        if (s->hw_start_step == 0 && s->hw_streak >= LG_HIGHWAY_CONFIRMATIONS) {
            s->hw_start_step = s->steps - (uint64_t)s->hw_streak * LG_HIGHWAY_PERIOD;
        }
    } else {
        s->hw_streak = 0;
    }

    s->hw_last_wx = wx;
    s->hw_last_wy = wy;
}

/*
 * Offset of the old grid inside the doubled one, for a single axis.
 * The free space is placed on the side the ant is heading to: since the
 * highway is diagonal, this almost doubles the reach for the same memory.
 */
static int32_t grow_offset(int32_t next, int32_t current, int32_t old_size, int32_t extra) {
    if (next >= old_size) {
        return 0;
    }
    if (next < 0) {
        return extra;
    }
    if (current >= old_size / 2) {
        return 0;
    }
    return extra;
}

static bool grid_grow(LgSim *s, int32_t nx, int32_t ny) {
    if (s->size >= s->max_size) {
        s->status = LG_STATUS_GRID_LIMIT;
        return false;
    }

    const int32_t old_size = s->size;
    const int32_t new_size = old_size * 2;
    const int32_t extra = new_size - old_size;

    uint8_t *cells = calloc((size_t)new_size * (size_t)new_size, 1);
    if (!cells) {
        s->status = LG_STATUS_OUT_OF_MEM;
        return false;
    }

    const int32_t sx = grow_offset(nx, s->x, old_size, extra);
    const int32_t sy = grow_offset(ny, s->y, old_size, extra);

    for (int32_t row = 0; row < old_size; ++row) {
        memcpy(cells + (size_t)(row + sy) * (size_t)new_size + (size_t)sx,
               s->cells + (size_t)row * (size_t)old_size,
               (size_t)old_size);
    }

    free(s->cells);
    s->cells = cells;
    s->size = new_size;
    s->origin_x -= sx;
    s->origin_y -= sy;
    s->x += sx;
    s->y += sy;
    s->generation++;
    dirty_mark_all(s);
    return true;
}

bool lg_init(LgSim *s, int32_t initial_size, int32_t max_size, uint64_t max_steps) {
    memset(s, 0, sizeof *s);

    if (initial_size < 4) {
        initial_size = 4;
    }
    if (max_size < initial_size) {
        max_size = initial_size;
    }

    s->initial_size = initial_size;
    s->max_size = max_size;
    s->max_steps = max_steps;
    return lg_reset(s);
}

void lg_free(LgSim *s) {
    free(s->cells);
    s->cells = NULL;
}

bool lg_reset(LgSim *s) {
    const int32_t size = s->initial_size;

    free(s->cells);
    s->cells = calloc((size_t)size * (size_t)size, 1);
    if (!s->cells) {
        s->status = LG_STATUS_OUT_OF_MEM;
        return false;
    }

    s->size = size;
    s->origin_x = -size / 2;
    s->origin_y = -size / 2;
    s->x = size / 2;
    s->y = size / 2;
    s->dir = LG_NORTH;
    s->steps = 0;
    s->black_cells = 0;
    s->status = LG_STATUS_OK;
    if (s->max_steps == 0) {
        s->status = LG_STATUS_MAX_STEPS;
    }
    s->generation++;
    dirty_mark_all(s);
    highway_reset(s);
    return true;
}

void lg_set_max_steps(LgSim *s, uint64_t max_steps) {
    s->max_steps = max_steps;

    if (s->status != LG_STATUS_OK && s->status != LG_STATUS_MAX_STEPS) {
        return;
    }

    if (s->steps >= max_steps) {
        s->status = LG_STATUS_MAX_STEPS;
    } else {
        s->status = LG_STATUS_OK;
    }
}

void lg_clear_dirty(LgSim *s) {
    s->dirty.empty = true;
    s->dirty.x0 = INT32_MAX;
    s->dirty.y0 = INT32_MAX;
    s->dirty.x1 = INT32_MIN;
    s->dirty.y1 = INT32_MIN;
}

uint32_t lg_step(LgSim *s, uint32_t n) {
    if (s->status != LG_STATUS_OK) {
        return 0;
    }

    const uint64_t remaining = s->max_steps - s->steps;
    if ((uint64_t)n > remaining) {
        n = (uint32_t)remaining;
    }

    /* Hot loop works on locals so they stay in registers. */
    uint8_t *cells = s->cells;
    int32_t size = s->size;
    int32_t x = s->x;
    int32_t y = s->y;
    uint32_t dir = s->dir;
    int64_t black = (int64_t)s->black_cells;
    uint32_t hw_countdown = s->hw_countdown;
    int32_t dx0 = s->dirty.x0;
    int32_t dy0 = s->dirty.y0;
    int32_t dx1 = s->dirty.x1;
    int32_t dy1 = s->dirty.y1;
    const uint64_t steps_base = s->steps;
    uint32_t done = 0;

#define SYNC_OUT()                          \
    do {                                    \
        s->x = x;                           \
        s->y = y;                           \
        s->dir = (uint8_t)dir;              \
        s->black_cells = (uint64_t)black;   \
        s->hw_countdown = hw_countdown;     \
        s->dirty.x0 = dx0;                  \
        s->dirty.y0 = dy0;                  \
        s->dirty.x1 = dx1;                  \
        s->dirty.y1 = dy1;                  \
        s->dirty.empty = (dx1 < dx0);       \
        s->steps = steps_base + done;       \
    } while (0)

    while (done < n) {
        const size_t idx = (size_t)y * (size_t)size + (size_t)x;
        const uint8_t cell = cells[idx];

        /* White turns right (+1), black turns left (+3 == -1 mod 4). */
        uint32_t ndir = (dir + 1u) & 3u;
        if (cell) {
            ndir = (dir + 3u) & 3u;
        }

        const int32_t nx = x + DX[ndir];
        const int32_t ny = y + DY[ndir];

        if ((uint32_t)nx >= (uint32_t)size || (uint32_t)ny >= (uint32_t)size) {
            /* Grow before executing the step, so a failure leaves a consistent state. */
            SYNC_OUT();
            if (!grid_grow(s, nx, ny)) {
                return done;
            }
            cells = s->cells;
            size = s->size;
            x = s->x;
            y = s->y;
            dx0 = s->dirty.x0;
            dy0 = s->dirty.y0;
            dx1 = s->dirty.x1;
            dy1 = s->dirty.y1;
            continue;
        }

        cells[idx] = (uint8_t)(cell ^ LG_CELL_ON);
        if (cell) {
            black--;
        } else {
            black++;
        }

        if (x < dx0) {
            dx0 = x;
        }
        if (x > dx1) {
            dx1 = x;
        }
        if (y < dy0) {
            dy0 = y;
        }
        if (y > dy1) {
            dy1 = y;
        }

        dir = ndir;
        x = nx;
        y = ny;
        ++done;

        if (--hw_countdown == 0) {
            hw_countdown = LG_HIGHWAY_PERIOD;
            SYNC_OUT();
            highway_checkpoint(s);
        }
    }

    SYNC_OUT();
#undef SYNC_OUT

    if (s->steps >= s->max_steps) {
        s->status = LG_STATUS_MAX_STEPS;
    }
    return done;
}
