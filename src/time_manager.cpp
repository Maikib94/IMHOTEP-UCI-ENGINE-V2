#include "time_manager.h"
#include <chrono>
#include <algorithm>

int64_t get_time_ms() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count();
}

int64_t compute_time_limit(const SearchLimits& limits, Color stm) {
    if (limits.infinite) return INT64_MAX / 2;
    if (limits.movetime > 0) return limits.movetime - 10;

    int time_left = (stm == WHITE) ? limits.wtime : limits.btime;
    int inc       = (stm == WHITE) ? limits.winc  : limits.binc;

    if (time_left <= 0) return 1000;

    int64_t alloc;
    if (limits.movestogo > 0)
        alloc = time_left / limits.movestogo + inc / 2;
    else
        alloc = time_left / 20 + inc / 2;

    // Cap at 80% of remaining time
    alloc = std::min(alloc, int64_t(time_left * 0.8));
    return std::max(alloc, int64_t(1));
}
