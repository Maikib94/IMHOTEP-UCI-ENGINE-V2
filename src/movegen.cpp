#include "movegen.h"

static void gen_pawn_moves(const Board& b, MoveList& ml, bool captures_only) {
    Color us    = b.side_to_move;
    Color them  = ~us;
    Bitboard pawns  = b.pieces(us, PAWN);
    Bitboard enemy  = b.pieces(them);
    Bitboard occ    = b.occupied();

    if (us == WHITE) {
        // Single and double pushes
        if (!captures_only) {
            Bitboard push1 = (pawns << 8) & ~occ;
            Bitboard push2 = ((push1 & BB::RankBB[RANK_3]) << 8) & ~occ;
            Bitboard promo = push1 & BB::RankBB[RANK_8];
            push1 &= ~BB::RankBB[RANK_8];

            Bitboard tmp = push1;
            while (tmp) { Square to = pop_sq(tmp); ml.push(make_move(Square(to - 8), to)); }
            tmp = push2;
            while (tmp) { Square to = pop_sq(tmp); ml.push(make_move(Square(to - 16), to)); }
            tmp = promo;
            while (tmp) {
                Square to = pop_sq(tmp); Square from = Square(to - 8);
                ml.push(make_promotion(from, to, QUEEN));
                ml.push(make_promotion(from, to, ROOK));
                ml.push(make_promotion(from, to, BISHOP));
                ml.push(make_promotion(from, to, KNIGHT));
            }
        }
        // Captures
        Bitboard cap_l = ((pawns & ~BB::FileBB[FILE_A]) << 7) & enemy;
        Bitboard cap_r = ((pawns & ~BB::FileBB[FILE_H]) << 9) & enemy;
        Bitboard promo_l = cap_l & BB::RankBB[RANK_8];
        Bitboard promo_r = cap_r & BB::RankBB[RANK_8];
        cap_l &= ~BB::RankBB[RANK_8];
        cap_r &= ~BB::RankBB[RANK_8];

        Bitboard tmp = cap_l;
        while (tmp) { Square to = pop_sq(tmp); ml.push(make_move(Square(to - 7), to)); }
        tmp = cap_r;
        while (tmp) { Square to = pop_sq(tmp); ml.push(make_move(Square(to - 9), to)); }
        tmp = promo_l;
        while (tmp) {
            Square to = pop_sq(tmp); Square from = Square(to - 7);
            ml.push(make_promotion(from, to, QUEEN));
            ml.push(make_promotion(from, to, ROOK));
            ml.push(make_promotion(from, to, BISHOP));
            ml.push(make_promotion(from, to, KNIGHT));
        }
        tmp = promo_r;
        while (tmp) {
            Square to = pop_sq(tmp); Square from = Square(to - 9);
            ml.push(make_promotion(from, to, QUEEN));
            ml.push(make_promotion(from, to, ROOK));
            ml.push(make_promotion(from, to, BISHOP));
            ml.push(make_promotion(from, to, KNIGHT));
        }
        // En passant
        if (b.ep_square != SQ_NONE) {
            Bitboard ep_atk = BB::PawnAttacks[BLACK][b.ep_square] & pawns;
            while (ep_atk) { Square from = pop_sq(ep_atk); ml.push(make_en_passant(from, b.ep_square)); }
        }
    } else {
        // Black
        if (!captures_only) {
            Bitboard push1 = (pawns >> 8) & ~occ;
            Bitboard push2 = ((push1 & BB::RankBB[RANK_6]) >> 8) & ~occ;
            Bitboard promo = push1 & BB::RankBB[RANK_1];
            push1 &= ~BB::RankBB[RANK_1];

            Bitboard tmp = push1;
            while (tmp) { Square to = pop_sq(tmp); ml.push(make_move(Square(to + 8), to)); }
            tmp = push2;
            while (tmp) { Square to = pop_sq(tmp); ml.push(make_move(Square(to + 16), to)); }
            tmp = promo;
            while (tmp) {
                Square to = pop_sq(tmp); Square from = Square(to + 8);
                ml.push(make_promotion(from, to, QUEEN));
                ml.push(make_promotion(from, to, ROOK));
                ml.push(make_promotion(from, to, BISHOP));
                ml.push(make_promotion(from, to, KNIGHT));
            }
        }
        Bitboard cap_l = ((pawns & ~BB::FileBB[FILE_H]) >> 7) & enemy;
        Bitboard cap_r = ((pawns & ~BB::FileBB[FILE_A]) >> 9) & enemy;
        Bitboard promo_l = cap_l & BB::RankBB[RANK_1];
        Bitboard promo_r = cap_r & BB::RankBB[RANK_1];
        cap_l &= ~BB::RankBB[RANK_1];
        cap_r &= ~BB::RankBB[RANK_1];

        Bitboard tmp = cap_l;
        while (tmp) { Square to = pop_sq(tmp); ml.push(make_move(Square(to + 7), to)); }
        tmp = cap_r;
        while (tmp) { Square to = pop_sq(tmp); ml.push(make_move(Square(to + 9), to)); }
        tmp = promo_l;
        while (tmp) {
            Square to = pop_sq(tmp); Square from = Square(to + 7);
            ml.push(make_promotion(from, to, QUEEN));
            ml.push(make_promotion(from, to, ROOK));
            ml.push(make_promotion(from, to, BISHOP));
            ml.push(make_promotion(from, to, KNIGHT));
        }
        tmp = promo_r;
        while (tmp) {
            Square to = pop_sq(tmp); Square from = Square(to + 9);
            ml.push(make_promotion(from, to, QUEEN));
            ml.push(make_promotion(from, to, ROOK));
            ml.push(make_promotion(from, to, BISHOP));
            ml.push(make_promotion(from, to, KNIGHT));
        }
        if (b.ep_square != SQ_NONE) {
            Bitboard ep_atk = BB::PawnAttacks[WHITE][b.ep_square] & pawns;
            while (ep_atk) { Square from = pop_sq(ep_atk); ml.push(make_en_passant(from, b.ep_square)); }
        }
    }
}

static void gen_piece_moves(const Board& b, MoveList& ml, bool captures_only) {
    Color us   = b.side_to_move;
    Color them = ~us;
    Bitboard own    = b.pieces(us);
    Bitboard enemy  = b.pieces(them);
    Bitboard occ    = b.occupied();
    Bitboard target = captures_only ? enemy : ~own;

    // Knights
    Bitboard knights = b.pieces(us, KNIGHT);
    while (knights) {
        Square from = pop_sq(knights);
        Bitboard attacks = BB::KnightAttacks[from] & target;
        while (attacks) { Square to = pop_sq(attacks); ml.push(make_move(from, to)); }
    }

    // Bishops
    Bitboard bishops = b.pieces(us, BISHOP);
    while (bishops) {
        Square from = pop_sq(bishops);
        Bitboard attacks = BB::bishop_attacks(from, occ) & target;
        while (attacks) { Square to = pop_sq(attacks); ml.push(make_move(from, to)); }
    }

    // Rooks
    Bitboard rooks = b.pieces(us, ROOK);
    while (rooks) {
        Square from = pop_sq(rooks);
        Bitboard attacks = BB::rook_attacks(from, occ) & target;
        while (attacks) { Square to = pop_sq(attacks); ml.push(make_move(from, to)); }
    }

    // Queens
    Bitboard queens = b.pieces(us, QUEEN);
    while (queens) {
        Square from = pop_sq(queens);
        Bitboard attacks = BB::queen_attacks(from, occ) & target;
        while (attacks) { Square to = pop_sq(attacks); ml.push(make_move(from, to)); }
    }

    // King
    Square king_sq = b.king_square(us);
    Bitboard king_attacks = BB::KingAttacks[king_sq] & target;
    while (king_attacks) { Square to = pop_sq(king_attacks); ml.push(make_move(king_sq, to)); }

    // Castling (only when not captures_only)
    if (!captures_only) {
        if (us == WHITE) {
            if ((b.castling_rights & WHITE_OO) &&
                b.empty(F1) && b.empty(G1) &&
                !b.square_attacked(E1, BLACK, occ) &&
                !b.square_attacked(F1, BLACK, occ) &&
                !b.square_attacked(G1, BLACK, occ))
                ml.push(make_castling(E1, G1));

            if ((b.castling_rights & WHITE_OOO) &&
                b.empty(B1) && b.empty(C1) && b.empty(D1) &&
                !b.square_attacked(E1, BLACK, occ) &&
                !b.square_attacked(D1, BLACK, occ) &&
                !b.square_attacked(C1, BLACK, occ))
                ml.push(make_castling(E1, C1));
        } else {
            if ((b.castling_rights & BLACK_OO) &&
                b.empty(F8) && b.empty(G8) &&
                !b.square_attacked(E8, WHITE, occ) &&
                !b.square_attacked(F8, WHITE, occ) &&
                !b.square_attacked(G8, WHITE, occ))
                ml.push(make_castling(E8, G8));

            if ((b.castling_rights & BLACK_OOO) &&
                b.empty(B8) && b.empty(C8) && b.empty(D8) &&
                !b.square_attacked(E8, WHITE, occ) &&
                !b.square_attacked(D8, WHITE, occ) &&
                !b.square_attacked(C8, WHITE, occ))
                ml.push(make_castling(E8, C8));
        }
    }
}

void gen_pseudo_legal(const Board& b, MoveList& ml) {
    gen_pawn_moves (b, ml, false);
    gen_piece_moves(b, ml, false);
}

void gen_pseudo_legal_captures(const Board& b, MoveList& ml) {
    gen_pawn_moves (b, ml, true);
    gen_piece_moves(b, ml, true);
}

static bool is_legal(Board& b, Move m) {
    b.make_move(m);
    bool legal = !b.square_attacked(b.king_square(~b.side_to_move), b.side_to_move, b.occupied());
    b.unmake_move(m);
    return legal;
}

void gen_legal(Board& b, MoveList& ml) {
    MoveList pseudo;
    gen_pseudo_legal(b, pseudo);
    for (int i = 0; i < pseudo.count; i++)
        if (is_legal(b, pseudo.moves[i]))
            ml.push(pseudo.moves[i]);
}

void gen_legal_captures(Board& b, MoveList& ml) {
    MoveList pseudo;
    gen_pseudo_legal_captures(b, pseudo);
    for (int i = 0; i < pseudo.count; i++)
        if (is_legal(b, pseudo.moves[i]))
            ml.push(pseudo.moves[i]);
}

uint64_t perft(Board& b, int depth) {
    if (depth == 0) return 1;
    MoveList ml;
    gen_legal(b, ml);
    if (depth == 1) return ml.count;
    uint64_t nodes = 0;
    for (int i = 0; i < ml.count; i++) {
        b.make_move(ml.moves[i]);
        nodes += perft(b, depth - 1);
        b.unmake_move(ml.moves[i]);
    }
    return nodes;
}
