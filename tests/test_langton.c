#include <stdio.h>
#include <stdlib.h>

#include "../src/langton.h"

static int g_failures = 0;

static void check(bool ok, const char *message) {
    if (ok) {
        printf("  ok   %s\n", message);
    } else {
        printf("  FAIL %s\n", message);
        g_failures++;
    }
}

static uint64_t count_black(const LgSim *s) {
    const size_t total = (size_t)s->size * (size_t)s->size;
    uint64_t n = 0;

    for (size_t i = 0; i < total; ++i) {
        if (s->cells[i] != 0) {
            n++;
        }
    }
    return n;
}

static uint8_t world_cell(const LgSim *s, int32_t wx, int32_t wy) {
    const int32_t gx = wx - s->origin_x;
    const int32_t gy = wy - s->origin_y;

    if (gx < 0 || gy < 0 || gx >= s->size || gy >= s->size) {
        return 0;
    }
    return s->cells[(size_t)gy * (size_t)s->size + (size_t)gx];
}

static void test_first_steps(void) {
    LgSim s;

    puts("first steps");
    lg_init(&s, 16, 16, 1000);

    lg_step(&s, 1);
    check(lg_world_x(&s) == 1 && lg_world_y(&s) == 0, "step 1 moves to (1, 0)");
    check(s.dir == LG_EAST, "facing east after step 1");

    lg_step(&s, 3);
    check(lg_world_x(&s) == 0 && lg_world_y(&s) == 0, "back at origin after 4 steps");
    check(s.black_cells == 4, "4 black cells after 4 steps");

    lg_step(&s, 1);
    check(s.black_cells == 3, "step 5 clears a black cell");

    lg_free(&s);
}

static void test_max_steps(void) {
    LgSim s;

    puts("step limit");
    lg_init(&s, 256, 256, 500);

    check(lg_step(&s, 10000) == 500 && s.steps == 500, "stops exactly at 500 steps");
    check(s.status == LG_STATUS_MAX_STEPS, "status is MAX_STEPS");
    check(lg_step(&s, 10) == 0, "does not go past the limit");

    lg_set_max_steps(&s, 600);
    check(s.status == LG_STATUS_OK, "raising the limit resumes the simulation");
    check(lg_step(&s, 10000) == 100, "runs the remaining 100 steps");

    lg_free(&s);
}

static void test_growth_is_exact(void) {
    const uint64_t n = 30000;
    LgSim grow;
    LgSim big;
    int diffs = 0;

    puts("grid growth is exact");
    lg_init(&grow, 8, 4096, n);
    lg_init(&big, 1024, 1024, n);
    lg_step(&grow, (uint32_t)n);
    lg_step(&big, (uint32_t)n);

    check(grow.generation > 1, "grid has grown");
    check(lg_world_x(&grow) == lg_world_x(&big) && lg_world_y(&grow) == lg_world_y(&big),
          "same final position");
    check(grow.dir == big.dir, "same final direction");
    check(grow.black_cells == big.black_cells && count_black(&grow) == grow.black_cells,
          "same black cell count");

    for (int32_t y = 0; y < big.size; ++y) {
        for (int32_t x = 0; x < big.size; ++x) {
            const int32_t wx = x + big.origin_x;
            const int32_t wy = y + big.origin_y;

            if (world_cell(&grow, wx, wy) != world_cell(&big, wx, wy)) {
                diffs++;
            }
        }
    }
    check(diffs == 0, "grids are identical cell by cell");

    lg_free(&grow);
    lg_free(&big);
}

static void test_highway_emerges(void) {
    LgSim s;

    puts("highway emerges on its own");
    lg_init(&s, 256, 8192, 20000);
    lg_step(&s, 20000);

    printf("       detected at step %llu\n", (unsigned long long)s.hw_start_step);
    check(s.hw_start_step > 9000 && s.hw_start_step < 11000, "highway starts around step 10000");

    const int32_t x0 = lg_world_x(&s);
    const int32_t y0 = lg_world_y(&s);
    lg_set_max_steps(&s, 20104);
    lg_step(&s, 104);
    check(abs(lg_world_x(&s) - x0) == 2 && abs(lg_world_y(&s) - y0) == 2,
          "one 104-step period moves the ant by (±2, ±2)");

    lg_free(&s);
}

static void test_grid_limit(void) {
    LgSim s;

    puts("grid limit (8192)");
    lg_init(&s, 256, 8192, UINT64_MAX);
    while (lg_step(&s, 1u << 20) > 0) {
    }

    check(s.status == LG_STATUS_GRID_LIMIT, "stops at the grid limit");
    check(count_black(&s) == s.black_cells, "black cell count is consistent");
    printf("       reach: %llu steps on a %dx%d grid\n", (unsigned long long)s.steps, s.size, s.size);

    lg_free(&s);
}

int main(void) {
    test_first_steps();
    test_max_steps();
    test_growth_is_exact();
    test_highway_emerges();
    test_grid_limit();

    if (g_failures > 0) {
        printf("\n%d failure(s)\n", g_failures);
        return EXIT_FAILURE;
    }

    puts("\nall tests passed");
    return EXIT_SUCCESS;
}
