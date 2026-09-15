#pragma once
#include "types.h"
#include "move.h"
#include "board.h"

struct MoveList {
    Move moves[256];
    int  count = 0;

    void push(Move m)        { moves[count++] = m; }
    Move* begin()            { return moves; }
    Move* end()              { return moves + count; }
    bool  empty() const      { return count == 0; }
    int   size()  const      { return count; }
};

void gen_pseudo_legal         (const Board& b, MoveList& ml);
void gen_pseudo_legal_captures(const Board& b, MoveList& ml);

void gen_legal         (Board& b, MoveList& ml);
void gen_legal_captures(Board& b, MoveList& ml);

uint64_t perft(Board& b, int depth);
