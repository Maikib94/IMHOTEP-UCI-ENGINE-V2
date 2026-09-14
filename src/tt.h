#pragma once
#include "types.h"
#include "move.h"
#include <vector>

enum TTFlag : uint8_t {
    TT_NONE  = 0,
    TT_EXACT = 1,
    TT_LOWER = 2,
    TT_UPPER = 3
};

struct alignas(16) TTEntry {
    Key     key       = 0;
    Move    best_move = MOVE_NONE;
    int16_t score     = 0;
    int8_t  depth     = 0;
    TTFlag  flag      = TT_NONE;
};

class TranspositionTable {
public:
    explicit TranspositionTable(size_t mb = 16);

    void resize(size_t mb);
    void clear();

    void  store(Key key, Move best, int score, int depth, TTFlag flag, int ply);
    bool  probe(Key key, TTEntry& out) const;

    static int score_to_tt(int score, int ply);
    static int tt_to_score(int score, int ply);

private:
    std::vector<TTEntry> table_;
    size_t count_;
    size_t mask_;
};
