#include "search.h"
#include "movegen.h"
#include "evaluation.h"
#include <iostream>
#include <sstream>
#include <cstring>
#include <algorithm>

// Material value table for MVV-LVA (indexed by piece type)
static constexpr int MVV_VALUE[PIECE_TYPE_NB] = {
    0, 100, 320, 330, 500, 900, 20000
};

Searcher::Searcher(Board& board, TranspositionTable& tt)
    : board_(board), tt_(tt), stopped_(false),
      start_time_ms_(0), time_limit_ms_(0),
      stats_{}, best_move_root_(MOVE_NONE)
{
    memset(killer_, 0, sizeof(killer_));
    memset(history_, 0, sizeof(history_));
}

bool Searcher::time_up() const {
    return get_time_ms() - start_time_ms_ >= time_limit_ms_;
}

int Searcher::score_move(Move m, Move tt_move, int ply) const {
    if (m == tt_move) return 2000000;

    Square to   = to_sq(m);
    Square from = from_sq(m);
    Piece  cap  = board_.piece_on(to);

    if (move_type(m) == EN_PASSANT) return 1000000 + 100;

    if (cap != NO_PIECE) {
        Piece att = board_.piece_on(from);
        int   victim   = MVV_VALUE[type_of(cap)];
        int   attacker = MVV_VALUE[type_of(att)];
        int   mvvlva   = victim * 10 - attacker;
        return (victim >= attacker) ? (1000000 + mvvlva) : (-1 + mvvlva);
    }

    if (move_type(m) == PROMOTION) return 900000;

    if (ply < 64) {
        if (killer_[ply][0] == m) return 400000;
        if (killer_[ply][1] == m) return 300000;
    }

    int hist = history_[board_.side_to_move][from][to];
    return hist;
}

void Searcher::sort_moves(Move* begin, Move* end, Move tt_move, int ply) {
    int n = int(end - begin);
    // Score all moves, then selection sort (fine for 256 moves)
    static thread_local int scores[256];
    for (int i = 0; i < n; i++)
        scores[i] = score_move(begin[i], tt_move, ply);

    for (int i = 0; i < n; i++) {
        int best_idx = i;
        for (int j = i + 1; j < n; j++)
            if (scores[j] > scores[best_idx]) best_idx = j;
        if (best_idx != i) {
            std::swap(begin[i], begin[best_idx]);
            std::swap(scores[i], scores[best_idx]);
        }
    }
}

std::string Searcher::extract_pv(int depth) {
    std::string pv;
    Move pv_moves[64];
    int  count = 0;

    while (count < depth && count < 64) {
        TTEntry tte;
        if (!tt_.probe(board_.zobrist_key, tte) || tte.best_move == MOVE_NONE) break;
        Move m = tte.best_move;
        MoveList ml;
        gen_legal(board_, ml);
        bool found = false;
        for (int i = 0; i < ml.count; i++) if (ml.moves[i] == m) { found = true; break; }
        if (!found) break;
        if (!pv.empty()) pv += ' ';
        pv += move_to_uci(m);
        pv_moves[count++] = m;
        board_.make_move(m);
    }
    for (int i = count - 1; i >= 0; i--)
        board_.unmake_move(pv_moves[i]);
    return pv;
}

static std::string format_score(int score) {
    if (score > SCORE_MATE - 100) {
        int mate_in = (SCORE_MATE - score + 1) / 2;
        return "mate " + std::to_string(mate_in);
    }
    if (score < -SCORE_MATE + 100) {
        int mate_in = (SCORE_MATE + score + 1) / 2;
        return "mate -" + std::to_string(mate_in);
    }
    return "cp " + std::to_string(score);
}

void Searcher::search(const SearchLimits& limits) {
    stopped_.store(false);
    stats_ = {};
    memset(killer_, 0, sizeof(killer_));
    memset(history_, 0, sizeof(history_));

    start_time_ms_ = get_time_ms();
    time_limit_ms_ = compute_time_limit(limits, board_.side_to_move);
    best_move_root_ = MOVE_NONE;

    // Ensure we have at least one legal move
    {
        MoveList ml;
        gen_legal(board_, ml);
        if (ml.count > 0) best_move_root_ = ml.moves[0];
    }

    Move  best = best_move_root_;
    int   best_score = 0;

    for (int depth = 1; depth <= limits.depth; depth++) {
        int score = negamax(depth, -SCORE_INFINITY, SCORE_INFINITY, 0);
        if (stopped_.load()) break;

        best       = best_move_root_;
        best_score = score;

        int64_t elapsed = std::max(int64_t(1), get_time_ms() - start_time_ms_);
        int64_t nps     = (stats_.nodes * 1000) / elapsed;

        std::string pv_str = extract_pv(depth);

        std::cout << "info depth " << depth
                  << " seldepth " << stats_.seldepth
                  << " score " << format_score(best_score)
                  << " nodes " << stats_.nodes
                  << " nps " << nps
                  << " time " << elapsed
                  << " pv " << pv_str
                  << "\n";
        std::cout.flush();

        if (!limits.infinite && time_up()) break;
    }

    std::cout << "bestmove " << move_to_uci(best) << "\n";
    std::cout.flush();
}

int Searcher::negamax(int depth, int alpha, int beta, int ply, bool do_null) {
    if (stopped_.load(std::memory_order_relaxed)) return 0;
    if ((stats_.nodes & 4095) == 0 && !stopped_.load() && time_up())
        stopped_.store(true);
    if (stopped_.load()) return 0;

    stats_.nodes++;

    // Draw checks
    if (ply > 0 && board_.is_repetition()) return 0;
    if (board_.halfmove_clock >= 100) return 0;

    bool in_check = board_.in_check();
    if (in_check) depth++;  // check extension

    // Cap total depth to avoid stack overflow from check extension chains
    if (depth <= 0 || ply >= 60) return qsearch(alpha, beta, ply);

    // TT probe
    TTEntry tte;
    Move tt_move = MOVE_NONE;
    if (tt_.probe(board_.zobrist_key, tte)) {
        tt_move = tte.best_move;
        if (ply > 0 && tte.depth >= depth) {
            int tt_score = TranspositionTable::tt_to_score(int(tte.score), ply);
            if (tte.flag == TT_EXACT) return tt_score;
            if (tte.flag == TT_LOWER && tt_score >= beta)  return tt_score;
            if (tte.flag == TT_UPPER && tt_score <= alpha) return tt_score;
        }
    }

    // Null move pruning
    if (do_null && !in_check && depth >= 3 && ply > 0
        && popcount(board_.pieces(board_.side_to_move)) > 1) {
        board_.make_null_move();
        int null_score = -negamax(depth - 3, -beta, -beta + 1, ply + 1, false);
        board_.unmake_null_move();
        if (!stopped_.load() && null_score >= beta) return beta;
    }

    MoveList ml;
    gen_legal(board_, ml);

    if (ml.empty())
        return in_check ? (-SCORE_MATE + ply) : 0;

    sort_moves(ml.moves, ml.moves + ml.count, tt_move, ply);

    int   best_score = -SCORE_INFINITY;
    Move  best_move  = MOVE_NONE;
    TTFlag flag      = TT_UPPER;

    for (int i = 0; i < ml.count; i++) {
        Move m = ml.moves[i];
        board_.make_move(m);
        int score = -negamax(depth - 1, -beta, -alpha, ply + 1);
        board_.unmake_move(m);

        if (stopped_.load()) return 0;

        if (score > best_score) {
            best_score = score;
            best_move  = m;
            if (ply == 0) best_move_root_ = m;
        }
        if (score > alpha) {
            alpha = score;
            flag  = TT_EXACT;
        }
        if (score >= beta) {
            flag = TT_LOWER;
            // Update killers for quiet moves
            if (board_.piece_on(to_sq(m)) == NO_PIECE && move_type(m) != EN_PASSANT) {
                if (ply < 64 && killer_[ply][0] != m) {
                    killer_[ply][1] = killer_[ply][0];
                    killer_[ply][0] = m;
                }
                history_[board_.side_to_move][from_sq(m)][to_sq(m)] += depth * depth;
            }
            break;
        }
    }

    tt_.store(board_.zobrist_key, best_move, best_score, depth, flag, ply);
    return best_score;
}

int Searcher::qsearch(int alpha, int beta, int ply) {
    if (stopped_.load()) return 0;
    stats_.nodes++;
    if (ply > stats_.seldepth) stats_.seldepth = ply;

    // Draw checks
    if (board_.halfmove_clock >= 100) return 0;

    int stand_pat = evaluate(board_);
    if (stand_pat >= beta)  return beta;
    if (stand_pat > alpha)  alpha = stand_pat;

    MoveList ml;
    gen_legal_captures(board_, ml);
    sort_moves(ml.moves, ml.moves + ml.count, MOVE_NONE, ply);

    for (int i = 0; i < ml.count; i++) {
        board_.make_move(ml.moves[i]);
        int score = -qsearch(-beta, -alpha, ply + 1);
        board_.unmake_move(ml.moves[i]);

        if (stopped_.load()) return 0;
        if (score >= beta)  return beta;
        if (score > alpha)  alpha = score;
    }
    return alpha;
}
