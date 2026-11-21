#include <emscripten/emscripten.h>

#include "langton.h"

/*
 * Single global simulation exposed to JavaScript.
 * 64-bit counters are returned as double (exact up to 2^53).
 */

#define INITIAL_GRID_SIZE 256

static LgSim g_sim;

EMSCRIPTEN_KEEPALIVE int ant_init(int max_grid_size, double max_steps) {
    return lg_init(&g_sim, INITIAL_GRID_SIZE, max_grid_size, (uint64_t)max_steps);
}

EMSCRIPTEN_KEEPALIVE int ant_reset(void) {
    return lg_reset(&g_sim);
}

EMSCRIPTEN_KEEPALIVE int ant_step(unsigned n) {
    return (int)lg_step(&g_sim, n);
}

EMSCRIPTEN_KEEPALIVE void ant_set_max_steps(double max_steps) {
    lg_set_max_steps(&g_sim, (uint64_t)max_steps);
}

EMSCRIPTEN_KEEPALIVE void ant_clear_dirty(void) {
    lg_clear_dirty(&g_sim);
}

EMSCRIPTEN_KEEPALIVE int ant_x(void) {
    return lg_world_x(&g_sim);
}

EMSCRIPTEN_KEEPALIVE int ant_y(void) {
    return lg_world_y(&g_sim);
}

EMSCRIPTEN_KEEPALIVE int ant_dir(void) {
    return g_sim.dir;
}

EMSCRIPTEN_KEEPALIVE double ant_steps(void) {
    return (double)g_sim.steps;
}

EMSCRIPTEN_KEEPALIVE double ant_max_steps(void) {
    return (double)g_sim.max_steps;
}

EMSCRIPTEN_KEEPALIVE double ant_black_cells(void) {
    return (double)g_sim.black_cells;
}

EMSCRIPTEN_KEEPALIVE int ant_status(void) {
    return (int)g_sim.status;
}

EMSCRIPTEN_KEEPALIVE double ant_highway_step(void) {
    return (double)g_sim.hw_start_step;
}

EMSCRIPTEN_KEEPALIVE int grid_ptr(void) {
    return (int)(uintptr_t)g_sim.cells;
}

EMSCRIPTEN_KEEPALIVE int grid_size(void) {
    return g_sim.size;
}

EMSCRIPTEN_KEEPALIVE int grid_origin_x(void) {
    return g_sim.origin_x;
}

EMSCRIPTEN_KEEPALIVE int grid_origin_y(void) {
    return g_sim.origin_y;
}

EMSCRIPTEN_KEEPALIVE unsigned grid_generation(void) {
    return g_sim.generation;
}

EMSCRIPTEN_KEEPALIVE int dirty_empty(void) {
    return g_sim.dirty.empty;
}

EMSCRIPTEN_KEEPALIVE int dirty_x0(void) {
    return g_sim.dirty.x0;
}

EMSCRIPTEN_KEEPALIVE int dirty_y0(void) {
    return g_sim.dirty.y0;
}

EMSCRIPTEN_KEEPALIVE int dirty_x1(void) {
    return g_sim.dirty.x1;
}

EMSCRIPTEN_KEEPALIVE int dirty_y1(void) {
    return g_sim.dirty.y1;
}
