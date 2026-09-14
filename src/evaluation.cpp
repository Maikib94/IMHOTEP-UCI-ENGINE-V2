#include "evaluation.h"

// Material values in centipawns
constexpr int PieceValue[PIECE_TYPE_NB] = {
    0, 100, 320, 330, 500, 900, 20000
};

// Piece-square tables (white perspective, rank 1 = index 0..7, rank 8 = index 56..63)
// Source: Simplified Evaluation Function (CPW)

static constexpr int PST_PAWN[64] = {
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0
};

static constexpr int PST_KNIGHT[64] = {
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50
};

static constexpr int PST_BISHOP[64] = {
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20
};

static constexpr int PST_ROOK[64] = {
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0
};

static constexpr int PST_QUEEN[64] = {
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20
};

static constexpr int PST_KING_MG[64] = {
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20
};

static const int* PST_TABLE[PIECE_TYPE_NB] = {
    nullptr,        // NO_PIECE_TYPE
    PST_PAWN,
    PST_KNIGHT,
    PST_BISHOP,
    PST_ROOK,
    PST_QUEEN,
    PST_KING_MG
};

int evaluate(const Board& b) {
    int score = 0;
    int material[COLOR_NB] = {0, 0};

    for (int pt_i = PAWN; pt_i <= QUEEN; pt_i++) {
        PieceType pt = PieceType(pt_i);
        Bitboard wb = b.pieces(WHITE, pt);
        Bitboard bb_b = b.pieces(BLACK, pt);
        while (wb) {
            Square s = pop_sq(wb);
            // PST indexed: rank 1 at bottom. PST arrays are rank8..rank1 top to bottom,
            // so we flip: white uses flip_rank to get index from white's perspective.
            score += PieceValue[pt] + PST_TABLE[pt][flip_rank(s)];
            material[WHITE] += PieceValue[pt];
        }
        while (bb_b) {
            Square s = pop_sq(bb_b);
            score -= PieceValue[pt] + PST_TABLE[pt][s];
            material[BLACK] += PieceValue[pt];
        }
    }

    // King PST
    score += PST_KING_MG[flip_rank(b.king_square(WHITE))];
    score -= PST_KING_MG[b.king_square(BLACK)];

    // Bishop pair bonus
    if (popcount(b.pieces(WHITE, BISHOP)) >= 2) score += 30;
    if (popcount(b.pieces(BLACK, BISHOP)) >= 2) score -= 30;

    return (b.side_to_move == WHITE) ? score : -score;
}
