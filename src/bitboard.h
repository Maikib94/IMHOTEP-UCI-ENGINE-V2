#pragma once
#include "types.h"

namespace BB {

extern Bitboard PawnAttacks[COLOR_NB][SQUARE_NB];
extern Bitboard KnightAttacks[SQUARE_NB];
extern Bitboard KingAttacks[SQUARE_NB];

extern Bitboard BetweenBB[SQUARE_NB][SQUARE_NB];
extern Bitboard LineBB[SQUARE_NB][SQUARE_NB];

extern Bitboard RankBB[8];
extern Bitboard FileBB[8];

struct Magic {
    Bitboard  mask;
    Bitboard  magic;
    Bitboard* attacks;
    int       shift;

    Bitboard index(Bitboard occ) const {
        return ((occ & mask) * magic) >> shift;
    }
};

extern Magic RookMagics[SQUARE_NB];
extern Magic BishopMagics[SQUARE_NB];

void init();

inline Bitboard rook_attacks(Square s, Bitboard occ) {
    const Magic& m = RookMagics[s];
    return m.attacks[m.index(occ)];
}
inline Bitboard bishop_attacks(Square s, Bitboard occ) {
    const Magic& m = BishopMagics[s];
    return m.attacks[m.index(occ)];
}
inline Bitboard queen_attacks(Square s, Bitboard occ) {
    return rook_attacks(s, occ) | bishop_attacks(s, occ);
}

} // namespace BB
