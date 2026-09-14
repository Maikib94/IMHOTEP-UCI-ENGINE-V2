#include "zobrist.h"

namespace Zobrist {

Key piece_square[PIECE_NB][SQUARE_NB];
Key side_to_move;
Key castling[16];
Key en_passant[8];

static uint64_t rng_state;

static uint64_t next_rand() {
    rng_state += 0x9e3779b97f4a7c15ULL;
    uint64_t z = rng_state;
    z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9ULL;
    z = (z ^ (z >> 27)) * 0x94d049bb133111ebULL;
    return z ^ (z >> 31);
}

void init() {
    rng_state = 0xDEADBEEFCAFEBABEULL;

    for (int p = 0; p < PIECE_NB; p++)
        for (int s = 0; s < SQUARE_NB; s++)
            piece_square[p][s] = next_rand();

    side_to_move = next_rand();

    for (int c = 0; c < 16; c++)
        castling[c] = next_rand();

    for (int f = 0; f < 8; f++)
        en_passant[f] = next_rand();
}

} // namespace Zobrist
