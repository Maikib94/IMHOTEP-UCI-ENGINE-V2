#pragma once
#include "types.h"

namespace Zobrist {

extern Key piece_square[PIECE_NB][SQUARE_NB];
extern Key side_to_move;
extern Key castling[16];
extern Key en_passant[8];

void init();

} // namespace Zobrist
