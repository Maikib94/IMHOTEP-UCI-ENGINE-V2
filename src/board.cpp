#include "board.h"
#include <sstream>
#include <cctype>
#include <cstring>

Board::Board() {
    memset(bb_pieces, 0, sizeof(bb_pieces));
    memset(bb_colors, 0, sizeof(bb_colors));
    memset(mailbox,   0, sizeof(mailbox));
    side_to_move    = WHITE;
    ep_square       = SQ_NONE;
    castling_rights = NO_CASTLING;
    halfmove_clock  = 0;
    fullmove_number = 1;
    zobrist_key     = 0;
    ply             = 0;
}

void Board::put_piece(Piece p, Square s) {
    bb_pieces[type_of(p)] |= sq_bb(s);
    bb_colors[color_of(p)] |= sq_bb(s);
    mailbox[s] = p;
    zobrist_key ^= Zobrist::piece_square[p][s];
}

void Board::remove_piece(Square s) {
    Piece p = mailbox[s];
    bb_pieces[type_of(p)] &= ~sq_bb(s);
    bb_colors[color_of(p)] &= ~sq_bb(s);
    mailbox[s] = NO_PIECE;
    zobrist_key ^= Zobrist::piece_square[p][s];
}

void Board::move_piece(Square from, Square to) {
    Piece p = mailbox[from];
    bb_pieces[type_of(p)] ^= sq_bb(from) | sq_bb(to);
    bb_colors[color_of(p)] ^= sq_bb(from) | sq_bb(to);
    mailbox[from] = NO_PIECE;
    mailbox[to]   = p;
    zobrist_key ^= Zobrist::piece_square[p][from] ^ Zobrist::piece_square[p][to];
}

void Board::set_startpos() {
    set_fen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
}

void Board::set_fen(const std::string& fen) {
    // Reset
    memset(bb_pieces, 0, sizeof(bb_pieces));
    memset(bb_colors, 0, sizeof(bb_colors));
    for (int i = 0; i < SQUARE_NB; i++) mailbox[i] = NO_PIECE;
    zobrist_key     = 0;
    ply             = 0;
    ep_square       = SQ_NONE;
    castling_rights = NO_CASTLING;
    halfmove_clock  = 0;
    fullmove_number = 1;

    std::istringstream ss(fen);
    std::string board_str, stm_str, castle_str, ep_str;
    int hmove = 0, fmove = 1;
    ss >> board_str >> stm_str >> castle_str >> ep_str >> hmove >> fmove;

    static const std::string PIECE_CHARS = "PNBRQK  pnbrqk";
    int sq = A8;
    for (char c : board_str) {
        if (c == '/') { sq -= 16; continue; }
        if (isdigit(c)) { sq += c - '0'; continue; }
        size_t idx = PIECE_CHARS.find(c);
        if (idx != std::string::npos && idx < 14) {
            Color    col = (idx < 6) ? WHITE : BLACK;
            PieceType pt = PieceType(idx < 6 ? idx + 1 : idx - 7);
            put_piece(make_piece(col, pt), Square(sq));
        }
        sq++;
    }

    side_to_move = (stm_str == "b") ? BLACK : WHITE;
    if (side_to_move == BLACK) zobrist_key ^= Zobrist::side_to_move;

    if (castle_str.find('K') != std::string::npos) castling_rights |= WHITE_OO;
    if (castle_str.find('Q') != std::string::npos) castling_rights |= WHITE_OOO;
    if (castle_str.find('k') != std::string::npos) castling_rights |= BLACK_OO;
    if (castle_str.find('q') != std::string::npos) castling_rights |= BLACK_OOO;
    zobrist_key ^= Zobrist::castling[castling_rights];

    if (ep_str != "-" && ep_str.size() >= 2) {
        ep_square = make_square(File(ep_str[0] - 'a'), Rank(ep_str[1] - '1'));
        zobrist_key ^= Zobrist::en_passant[file_of(ep_square)];
    }

    halfmove_clock  = hmove;
    fullmove_number = fmove;
}

std::string Board::to_fen() const {
    static const char PIECE_CH[] = " PNBRQK  pnbrqk ";
    std::string result;
    for (int r = RANK_8; r >= RANK_1; r--) {
        int empty = 0;
        for (int f = FILE_A; f <= FILE_H; f++) {
            Square s = make_square(File(f), Rank(r));
            Piece  p = mailbox[s];
            if (p == NO_PIECE) { empty++; continue; }
            if (empty) { result += char('0' + empty); empty = 0; }
            result += PIECE_CH[p];
        }
        if (empty) result += char('0' + empty);
        if (r != RANK_1) result += '/';
    }
    result += ' ';
    result += (side_to_move == WHITE) ? 'w' : 'b';
    result += ' ';
    std::string cr;
    if (castling_rights & WHITE_OO)  cr += 'K';
    if (castling_rights & WHITE_OOO) cr += 'Q';
    if (castling_rights & BLACK_OO)  cr += 'k';
    if (castling_rights & BLACK_OOO) cr += 'q';
    result += cr.empty() ? "-" : cr;
    result += ' ';
    if (ep_square == SQ_NONE) result += '-';
    else { result += char('a' + file_of(ep_square)); result += char('1' + rank_of(ep_square)); }
    result += ' '; result += std::to_string(halfmove_clock);
    result += ' '; result += std::to_string(fullmove_number);
    return result;
}

void Board::make_move(Move m) {
    BoardState& st = history[ply++];
    st.zobrist_key    = zobrist_key;
    st.ep_square      = ep_square;
    st.castling_rights= castling_rights;
    st.halfmove_clock = halfmove_clock;

    Square from = from_sq(m);
    Square to   = to_sq(m);
    MoveType mt = move_type(m);
    Piece    pc = mailbox[from];

    // Update Zobrist: remove old ep/castling contributions
    zobrist_key ^= Zobrist::castling[castling_rights];
    if (ep_square != SQ_NONE)
        zobrist_key ^= Zobrist::en_passant[file_of(ep_square)];

    ep_square = SQ_NONE;
    halfmove_clock++;

    st.captured = mailbox[to];

    if (mt == NORMAL) {
        if (mailbox[to] != NO_PIECE) { remove_piece(to); halfmove_clock = 0; }
        if (type_of(pc) == PAWN) {
            halfmove_clock = 0;
            if (abs(int(to) - int(from)) == 16)
                ep_square = Square((int(from) + int(to)) / 2);
        }
        move_piece(from, to);
    } else if (mt == EN_PASSANT) {
        Square victim = Square(int(to) + (side_to_move == WHITE ? -8 : 8));
        st.captured = mailbox[victim];
        remove_piece(victim);
        move_piece(from, to);
        halfmove_clock = 0;
    } else if (mt == CASTLING) {
        Square rook_from, rook_to;
        if (to == G1) { rook_from = H1; rook_to = F1; }
        else if (to == C1) { rook_from = A1; rook_to = D1; }
        else if (to == G8) { rook_from = H8; rook_to = F8; }
        else               { rook_from = A8; rook_to = D8; }
        move_piece(from, to);
        move_piece(rook_from, rook_to);
    } else { // PROMOTION
        PieceType promo = promo_type(m);
        if (mailbox[to] != NO_PIECE) { remove_piece(to); }
        remove_piece(from);
        put_piece(make_piece(side_to_move, promo), to);
        halfmove_clock = 0;
        st.captured = history[ply-1].captured; // was already captured above
    }

    castling_rights &= CASTLING_RIGHTS_MASK[from] & CASTLING_RIGHTS_MASK[to];
    zobrist_key ^= Zobrist::castling[castling_rights];
    if (ep_square != SQ_NONE)
        zobrist_key ^= Zobrist::en_passant[file_of(ep_square)];

    zobrist_key ^= Zobrist::side_to_move;
    if (side_to_move == BLACK) fullmove_number++;
    side_to_move = ~side_to_move;
}

void Board::unmake_move(Move m) {
    side_to_move = ~side_to_move;
    if (side_to_move == BLACK) fullmove_number--;

    Square from = from_sq(m);
    Square to   = to_sq(m);
    MoveType mt = move_type(m);

    BoardState& st = history[--ply];
    // Restore Zobrist key from saved state (no recomputation)
    zobrist_key     = st.zobrist_key;
    ep_square       = st.ep_square;
    castling_rights = st.castling_rights;
    halfmove_clock  = st.halfmove_clock;

    // Helper: move piece without touching Zobrist (key already restored from saved state)
    auto move_piece_no_hash = [&](Square from_s, Square to_s) {
        Piece p = mailbox[from_s];
        bb_pieces[type_of(p)] ^= sq_bb(from_s) | sq_bb(to_s);
        bb_colors[color_of(p)] ^= sq_bb(from_s) | sq_bb(to_s);
        mailbox[from_s] = NO_PIECE;
        mailbox[to_s]   = p;
    };

    if (mt == NORMAL) {
        move_piece_no_hash(to, from);
        if (st.captured != NO_PIECE) {
            bb_pieces[type_of(st.captured)] |= sq_bb(to);
            bb_colors[color_of(st.captured)] |= sq_bb(to);
            mailbox[to] = st.captured;
        }
    } else if (mt == EN_PASSANT) {
        move_piece_no_hash(to, from);
        Square victim = Square(int(to) + (side_to_move == WHITE ? -8 : 8));
        bb_pieces[type_of(st.captured)] |= sq_bb(victim);
        bb_colors[color_of(st.captured)] |= sq_bb(victim);
        mailbox[victim] = st.captured;
    } else if (mt == CASTLING) {
        Square rook_from, rook_to;
        if (to == G1) { rook_from = H1; rook_to = F1; }
        else if (to == C1) { rook_from = A1; rook_to = D1; }
        else if (to == G8) { rook_from = H8; rook_to = F8; }
        else               { rook_from = A8; rook_to = D8; }
        // Move king back, rook back (update bb/mailbox only, key restored)
        Piece king = mailbox[to]; mailbox[to] = NO_PIECE;
        bb_pieces[KING] ^= sq_bb(to) | sq_bb(from);
        bb_colors[side_to_move] ^= sq_bb(to) | sq_bb(from);
        mailbox[from] = king;

        Piece rook = mailbox[rook_to]; mailbox[rook_to] = NO_PIECE;
        bb_pieces[ROOK] ^= sq_bb(rook_to) | sq_bb(rook_from);
        bb_colors[side_to_move] ^= sq_bb(rook_to) | sq_bb(rook_from);
        mailbox[rook_from] = rook;
    } else { // PROMOTION
        // Remove promo piece from 'to', restore pawn at 'from'
        Piece promo_piece = mailbox[to];
        bb_pieces[type_of(promo_piece)] &= ~sq_bb(to);
        bb_colors[color_of(promo_piece)] &= ~sq_bb(to);
        mailbox[to] = NO_PIECE;

        Piece pawn = make_piece(side_to_move, PAWN);
        bb_pieces[PAWN] |= sq_bb(from);
        bb_colors[side_to_move] |= sq_bb(from);
        mailbox[from] = pawn;

        if (st.captured != NO_PIECE) {
            bb_pieces[type_of(st.captured)] |= sq_bb(to);
            bb_colors[color_of(st.captured)] |= sq_bb(to);
            mailbox[to] = st.captured;
        }
    }
}

void Board::make_null_move() {
    BoardState& st = history[ply++];
    st.zobrist_key     = zobrist_key;
    st.ep_square       = ep_square;
    st.castling_rights = castling_rights;
    st.halfmove_clock  = halfmove_clock;
    st.captured        = NO_PIECE;

    if (ep_square != SQ_NONE)
        zobrist_key ^= Zobrist::en_passant[file_of(ep_square)];
    ep_square = SQ_NONE;
    zobrist_key ^= Zobrist::side_to_move;
    side_to_move = ~side_to_move;
    halfmove_clock++;
}

void Board::unmake_null_move() {
    side_to_move = ~side_to_move;
    BoardState& st = history[--ply];
    zobrist_key     = st.zobrist_key;
    ep_square       = st.ep_square;
    castling_rights = st.castling_rights;
    halfmove_clock  = st.halfmove_clock;
}

bool Board::square_attacked(Square s, Color by, Bitboard occ) const {
    return (BB::PawnAttacks[~by][s]        & pieces(by, PAWN))
         | (BB::KnightAttacks[s]           & pieces(by, KNIGHT))
         | (BB::KingAttacks[s]             & pieces(by, KING))
         | (BB::bishop_attacks(s, occ)     & (pieces(by, BISHOP) | pieces(by, QUEEN)))
         | (BB::rook_attacks(s, occ)       & (pieces(by, ROOK)   | pieces(by, QUEEN)));
}

Bitboard Board::attackers_to(Square s, Bitboard occ) const {
    return (BB::PawnAttacks[BLACK][s]      & pieces(WHITE, PAWN))
         | (BB::PawnAttacks[WHITE][s]      & pieces(BLACK, PAWN))
         | (BB::KnightAttacks[s]           & pieces(KNIGHT))
         | (BB::KingAttacks[s]             & pieces(KING))
         | (BB::bishop_attacks(s, occ)     & (pieces(BISHOP) | pieces(QUEEN)))
         | (BB::rook_attacks(s, occ)       & (pieces(ROOK)   | pieces(QUEEN)));
}

bool Board::in_check() const {
    return square_attacked(king_square(side_to_move), ~side_to_move, occupied());
}

bool Board::is_repetition() const {
    for (int i = ply - 2; i >= ply - halfmove_clock && i >= 0; i -= 2)
        if (history[i].zobrist_key == zobrist_key) return true;
    return false;
}
