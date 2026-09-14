#pragma once
#include "types.h"
#include <string>

enum MoveType : int {
    NORMAL     = 0,
    CASTLING   = 1 << 14,
    EN_PASSANT = 2 << 14,
    PROMOTION  = 3 << 14
};

constexpr Move MOVE_NONE = 0;

inline Move make_move(Square from, Square to) {
    return Move(int(from) | (int(to) << 6));
}
inline Move make_castling(Square from, Square to) {
    return Move(int(from) | (int(to) << 6) | CASTLING);
}
inline Move make_en_passant(Square from, Square to) {
    return Move(int(from) | (int(to) << 6) | EN_PASSANT);
}
inline Move make_promotion(Square from, Square to, PieceType promo) {
    return Move(int(from) | (int(to) << 6) | ((int(promo) - int(KNIGHT)) << 12) | PROMOTION);
}

inline Square    from_sq   (Move m) { return Square(m & 0x3F); }
inline Square    to_sq     (Move m) { return Square((m >> 6) & 0x3F); }
inline MoveType  move_type (Move m) { return MoveType(m & (3 << 14)); }
inline PieceType promo_type(Move m) { return PieceType(((m >> 12) & 3) + int(KNIGHT)); }

std::string move_to_uci(Move m);
Move        parse_move(const std::string& s);
