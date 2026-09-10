#pragma once
#include "types.h"
#include "move.h"
#include "bitboard.h"
#include "zobrist.h"
#include <string>

struct BoardState {
    Key    zobrist_key;
    Square ep_square;
    int    castling_rights;
    int    halfmove_clock;
    Piece  captured;
};

class Board {
public:
    static constexpr int MAX_PLY = 1024;

    Bitboard   bb_pieces[PIECE_TYPE_NB];
    Bitboard   bb_colors[COLOR_NB];
    Piece      mailbox[SQUARE_NB];

    Color      side_to_move;
    Square     ep_square;
    int        castling_rights;
    int        halfmove_clock;
    int        fullmove_number;
    Key        zobrist_key;

    BoardState history[MAX_PLY];
    int        ply;

    Board();
    void set_startpos();
    void set_fen(const std::string& fen);
    std::string to_fen() const;

    void make_move  (Move m);
    void unmake_move(Move m);

    // Null move for search pruning
    void make_null_move();
    void unmake_null_move();

    Bitboard pieces(PieceType pt)                const { return bb_pieces[pt]; }
    Bitboard pieces(Color c)                     const { return bb_colors[c]; }
    Bitboard pieces(Color c, PieceType pt)       const { return bb_colors[c] & bb_pieces[pt]; }
    Bitboard occupied()                          const { return bb_colors[WHITE] | bb_colors[BLACK]; }
    Piece    piece_on(Square s)                  const { return mailbox[s]; }
    bool     empty(Square s)                     const { return mailbox[s] == NO_PIECE; }
    Square   king_square(Color c)                const { return Square(lsb(pieces(c, KING))); }

    bool in_check() const;
    bool square_attacked(Square s, Color by, Bitboard occ) const;
    Bitboard attackers_to(Square s, Bitboard occ)          const;

    bool is_repetition() const;

private:
    void put_piece   (Piece p, Square s);
    void remove_piece(Square s);
    void move_piece  (Square from, Square to);
};

// Castling rights update mask per square
static constexpr int CASTLING_RIGHTS_MASK[64] = {
    ~WHITE_OOO, 15, 15, 15, ~(WHITE_OO|WHITE_OOO), 15, 15, ~WHITE_OO,
    15,15,15,15,15,15,15,15,
    15,15,15,15,15,15,15,15,
    15,15,15,15,15,15,15,15,
    15,15,15,15,15,15,15,15,
    15,15,15,15,15,15,15,15,
    15,15,15,15,15,15,15,15,
    ~BLACK_OOO, 15, 15, 15, ~(BLACK_OO|BLACK_OOO), 15, 15, ~BLACK_OO
};
