#pragma once
#include <cstdint>
#include <cassert>

using Bitboard = uint64_t;
using Move     = uint32_t;
using Key      = uint64_t;

enum Color : int { WHITE = 0, BLACK = 1, COLOR_NB = 2 };

enum PieceType : int {
    NO_PIECE_TYPE = 0,
    PAWN = 1, KNIGHT = 2, BISHOP = 3,
    ROOK = 4, QUEEN  = 5, KING   = 6,
    PIECE_TYPE_NB = 7
};

enum Piece : int {
    NO_PIECE   = 0,
    W_PAWN=1, W_KNIGHT=2, W_BISHOP=3, W_ROOK=4, W_QUEEN=5, W_KING=6,
    B_PAWN=9, B_KNIGHT=10,B_BISHOP=11,B_ROOK=12,B_QUEEN=13,B_KING=14,
    PIECE_NB   = 16
};

enum Square : int {
    A1=0,B1,C1,D1,E1,F1,G1,H1,
    A2,B2,C2,D2,E2,F2,G2,H2,
    A3,B3,C3,D3,E3,F3,G3,H3,
    A4,B4,C4,D4,E4,F4,G4,H4,
    A5,B5,C5,D5,E5,F5,G5,H5,
    A6,B6,C6,D6,E6,F6,G6,H6,
    A7,B7,C7,D7,E7,F7,G7,H7,
    A8,B8,C8,D8,E8,F8,G8,H8,
    SQ_NONE = 64, SQUARE_NB = 64
};

enum File : int { FILE_A=0,FILE_B,FILE_C,FILE_D,FILE_E,FILE_F,FILE_G,FILE_H };
enum Rank : int { RANK_1=0,RANK_2,RANK_3,RANK_4,RANK_5,RANK_6,RANK_7,RANK_8 };

enum CastlingRight : int {
    NO_CASTLING  = 0,
    WHITE_OO     = 1,
    WHITE_OOO    = 2,
    BLACK_OO     = 4,
    BLACK_OOO    = 8,
    ANY_CASTLING = 15
};

constexpr int SCORE_INFINITY = 30001;
constexpr int SCORE_MATE     = 30000;
constexpr int SCORE_NONE     = -30002;

inline Color     operator~(Color c)              { return Color(c ^ 1); }
inline Square    make_square(File f, Rank r)     { return Square((r << 3) | f); }
inline File      file_of(Square s)               { return File(s & 7); }
inline Rank      rank_of(Square s)               { return Rank(s >> 3); }
inline Square    flip_rank(Square s)             { return Square(s ^ 56); }
inline Piece     make_piece(Color c, PieceType pt){ return Piece((c << 3) | pt); }
inline Color     color_of(Piece p)               { return Color(p >> 3); }
inline PieceType type_of(Piece p)                { return PieceType(p & 7); }
inline Bitboard  sq_bb(Square s)                 { return Bitboard(1) << s; }

inline int popcount(Bitboard b) { return __builtin_popcountll(b); }
inline int lsb(Bitboard b)      { return __builtin_ctzll(b); }
inline int msb(Bitboard b)      { return 63 ^ __builtin_clzll(b); }
inline Bitboard pop_lsb(Bitboard& b) { Bitboard r = b & -b; b &= b - 1; return r; }
inline Square   pop_sq (Bitboard& b) { Square s = Square(lsb(b)); b &= b - 1; return s; }
