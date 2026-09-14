#pragma once
#include "types.h"
#include <cstdint>

struct SearchLimits {
    int  wtime     = 0;
    int  btime     = 0;
    int  winc      = 0;
    int  binc      = 0;
    int  movestogo = 0;
    int  movetime  = 0;
    int  depth     = 64;
    bool infinite  = false;
};

int64_t get_time_ms();
int64_t compute_time_limit(const SearchLimits& limits, Color stm);
