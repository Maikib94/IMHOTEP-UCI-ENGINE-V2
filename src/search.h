#pragma once
#include "types.h"
#include "move.h"
#include "board.h"
#include "tt.h"
#include "time_manager.h"
#include <atomic>
#include <cstdint>

struct SearchStats {
    uint64_t nodes    = 0;
    int      seldepth = 0;
};

class Searcher {
public:
    Searcher(Board& board, TranspositionTable& tt);

    void search(const SearchLimits& limits);
    void stop()  { stopped_.store(true, std::memory_order_relaxed); }
    bool is_stopped() const { return stopped_.load(std::memory_order_relaxed); }

private:
    int  negamax(int depth, int alpha, int beta, int ply, bool do_null = true);
    int  qsearch(int alpha, int beta, int ply);

    int  score_move(Move m, Move tt_move, int ply) const;
    void sort_moves(Move* begin, Move* end, Move tt_move, int ply);

    bool time_up() const;
    std::string extract_pv(int depth);

    Board&              board_;
    TranspositionTable& tt_;
    std::atomic<bool>   stopped_;

    int64_t  start_time_ms_;
    int64_t  time_limit_ms_;
    SearchStats stats_;
    Move     best_move_root_;

    Move killer_[64][2];
    int  history_[COLOR_NB][SQUARE_NB][SQUARE_NB];
};
