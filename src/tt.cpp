#include "tt.h"
#include <cstring>
#include <algorithm>

TranspositionTable::TranspositionTable(size_t mb) {
    resize(mb);
}

void TranspositionTable::resize(size_t mb) {
    size_t bytes   = mb * 1024 * 1024;
    size_t entries = bytes / sizeof(TTEntry);
    // Round down to power of 2
    count_ = 1;
    while (count_ * 2 <= entries) count_ *= 2;
    mask_  = count_ - 1;
    table_.assign(count_, TTEntry{});
}

void TranspositionTable::clear() {
    std::fill(table_.begin(), table_.end(), TTEntry{});
}

int TranspositionTable::score_to_tt(int score, int ply) {
    if (score >  SCORE_MATE - 100) return score + ply;
    if (score < -SCORE_MATE + 100) return score - ply;
    return score;
}

int TranspositionTable::tt_to_score(int score, int ply) {
    if (score >  SCORE_MATE - 100) return score - ply;
    if (score < -SCORE_MATE + 100) return score + ply;
    return score;
}

void TranspositionTable::store(Key key, Move best, int score, int depth, TTFlag flag, int ply) {
    size_t idx = key & mask_;
    TTEntry& e = table_[idx];
    // Always replace, but preserve best_move if same position and no move found
    if (best == MOVE_NONE && e.key == key) best = e.best_move;
    e.key       = key;
    e.best_move = best;
    e.score     = int16_t(score_to_tt(score, ply));
    e.depth     = int8_t(depth);
    e.flag      = flag;
}

bool TranspositionTable::probe(Key key, TTEntry& out) const {
    size_t idx = key & mask_;
    const TTEntry& e = table_[idx];
    if (e.key != key || e.flag == TT_NONE) return false;
    out = e;
    return true;
}
