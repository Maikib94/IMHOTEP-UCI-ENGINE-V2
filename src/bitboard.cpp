#include "bitboard.h"
#include <cstring>

namespace BB {

Bitboard PawnAttacks[COLOR_NB][SQUARE_NB];
Bitboard KnightAttacks[SQUARE_NB];
Bitboard KingAttacks[SQUARE_NB];

Bitboard BetweenBB[SQUARE_NB][SQUARE_NB];
Bitboard LineBB[SQUARE_NB][SQUARE_NB];

Bitboard RankBB[8];
Bitboard FileBB[8];

Magic RookMagics[SQUARE_NB];
Magic BishopMagics[SQUARE_NB];

// Flat attack storage
static Bitboard RookTable  [0x19000]; // 102400 entries
static Bitboard BishopTable[0x1480];  //  5248 entries

// Well-known magic numbers (public domain, from Tord Romstad / CPW)
static const Bitboard RookMagicNumbers[64] = {
    0xa8002c000108020ULL,  0x6c00049b0002001ULL,  0x100200010090040ULL,  0x2480041000800801ULL,
    0x280028004000800ULL,  0x900410008040022ULL,  0x280020001001080ULL,  0x2880002041000080ULL,
    0xa000800080400034ULL, 0x4808020004000ULL,    0x2290802004801000ULL, 0x411000d00100020ULL,
    0x402800800040080ULL,  0xb000401004208ULL,    0x2409000100040200ULL, 0x1002100004082ULL,
    0x22878001e24000ULL,   0x1090810021004010ULL, 0x801030040200012ULL,  0x500808008001000ULL,
    0xa08018014000880ULL,  0x8000808004000200ULL, 0x201008080010200ULL,  0x801020000441091ULL,
    0x800080204005ULL,     0x1040200040100048ULL, 0x120200402082ULL,     0xd14880480100080ULL,
    0x12040280080080ULL,   0x100040080020080ULL,  0x9020010080800200ULL, 0x813241200148449ULL,
    0x491604001800080ULL,  0x100401000402001ULL,  0x4820010021001040ULL, 0x400402202000812ULL,
    0x209009005000802ULL,  0x810800601800400ULL,  0x4301083214000150ULL, 0x204026458e001401ULL,
    0x40204000808000ULL,   0x8001008040010020ULL, 0x8410820820420010ULL, 0x1003001000090020ULL,
    0x804040008008080ULL,  0x12000810020004ULL,   0x1000100200040208ULL, 0x430000a044020001ULL,
    0x280009023410300ULL,  0xe0100040002240ULL,   0x200100401700ULL,     0x2244100408008080ULL,
    0x8000400801980ULL,    0x2000810040200ULL,    0x8010100228810400ULL, 0x2000009044210200ULL,
    0x4080008040102101ULL, 0x40002080411d01ULL,   0x2005524060000901ULL, 0x502001008400422ULL,
    0x489a000810200402ULL, 0x1004400080106ULL,    0x4010011412B3080ULL,  0x8094004002004100ULL
};

static const Bitboard BishopMagicNumbers[64] = {
    0x89a1121896040240ULL, 0x2004844802002010ULL, 0x2068080051921000ULL, 0x62880a0220200808ULL,
    0x4042004000000ULL,    0x100822020200011ULL,  0xc00444222012000aULL, 0x28808801216001ULL,
    0x400492088408100ULL,  0x201c401040c0084ULL,  0x840800910a0010ULL,   0x82080240060ULL,
    0x2000840504006000ULL, 0x30010c4108405004ULL, 0x1008005410080802ULL, 0x8144042209100900ULL,
    0x208081020014400ULL,  0x4800201208ca00ULL,   0xf18140408012008ULL,  0x1004002802102001ULL,
    0x841000820080811ULL,  0x40200200a42008ULL,   0x800054042000ULL,     0x88010400410c9000ULL,
    0x520040470104290ULL,  0x1004040051500081ULL, 0x2002081833080021ULL, 0x400c00c010142ULL,
    0x941408200c002000ULL, 0x658810000806011ULL,  0x188071040440a00ULL,  0x4800404002011c00ULL,
    0x104442040404200ULL,  0x511080202091021ULL,  0x4022401120400ULL,    0x80c0040400080120ULL,
    0x8040010040820802ULL, 0x480810700020090ULL,  0x102008e00040242ULL,  0x809005202050100ULL,
    0x8002024220104080ULL, 0x431008804142000ULL,  0x19001802081400ULL,   0x200014208040080ULL,
    0x3308082008200100ULL, 0x41010500040c020ULL,  0x4012020c04210308ULL, 0x208220a202004080ULL,
    0x111040120082000ULL,  0x6803040141280a00ULL, 0x2101004202410000ULL, 0x8200000041108022ULL,
    0x21082088000ULL,      0x2410204010040ULL,    0x40100400809000ULL,   0x822088220820214ULL,
    0x40808090012004ULL,   0x910224040218c9ULL,   0x402814422015008ULL,  0x90014004842410ULL,
    0x1000042304105ULL,    0x10008830412a00ULL,   0x2520081090008908ULL, 0x40102000a0a60140ULL
};

static Bitboard compute_rook_attacks(Square s, Bitboard occ) {
    Bitboard result = 0;
    int r = rank_of(s), f = file_of(s);
    for (int i = r + 1; i <= 7; i++) { result |= sq_bb(make_square(File(f), Rank(i))); if (occ & sq_bb(make_square(File(f), Rank(i)))) break; }
    for (int i = r - 1; i >= 0; i--) { result |= sq_bb(make_square(File(f), Rank(i))); if (occ & sq_bb(make_square(File(f), Rank(i)))) break; }
    for (int i = f + 1; i <= 7; i++) { result |= sq_bb(make_square(File(i), Rank(r))); if (occ & sq_bb(make_square(File(i), Rank(r)))) break; }
    for (int i = f - 1; i >= 0; i--) { result |= sq_bb(make_square(File(i), Rank(r))); if (occ & sq_bb(make_square(File(i), Rank(r)))) break; }
    return result;
}

static Bitboard compute_bishop_attacks(Square s, Bitboard occ) {
    Bitboard result = 0;
    int r = rank_of(s), f = file_of(s);
    for (int dr = 1, df = 1; r + dr <= 7 && f + df <= 7; dr++, df++) { result |= sq_bb(make_square(File(f+df), Rank(r+dr))); if (occ & sq_bb(make_square(File(f+df), Rank(r+dr)))) break; }
    for (int dr = 1, df =-1; r + dr <= 7 && f + df >= 0; dr++, df--) { result |= sq_bb(make_square(File(f+df), Rank(r+dr))); if (occ & sq_bb(make_square(File(f+df), Rank(r+dr)))) break; }
    for (int dr =-1, df = 1; r + dr >= 0 && f + df <= 7; dr--, df++) { result |= sq_bb(make_square(File(f+df), Rank(r+dr))); if (occ & sq_bb(make_square(File(f+df), Rank(r+dr)))) break; }
    for (int dr =-1, df =-1; r + dr >= 0 && f + df >= 0; dr--, df--) { result |= sq_bb(make_square(File(f+df), Rank(r+dr))); if (occ & sq_bb(make_square(File(f+df), Rank(r+dr)))) break; }
    return result;
}

static void init_magics(PieceType pt, Magic* magics, const Bitboard* magic_numbers,
                         Bitboard* table, int& offset) {
    static const Bitboard EdgeBB =
        (RankBB[RANK_1] | RankBB[RANK_8] | FileBB[FILE_A] | FileBB[FILE_H]);

    for (int s = 0; s < SQUARE_NB; s++) {
        Bitboard edges = ((RankBB[RANK_1] | RankBB[RANK_8]) & ~RankBB[rank_of(Square(s))])
                       | ((FileBB[FILE_A] | FileBB[FILE_H]) & ~FileBB[file_of(Square(s))]);

        Magic& m = magics[s];
        if (pt == ROOK)   m.mask = compute_rook_attacks  (Square(s), 0) & ~edges;
        else              m.mask = compute_bishop_attacks (Square(s), 0) & ~edges;
        m.magic   = magic_numbers[s];
        m.shift   = 64 - popcount(m.mask);
        m.attacks = table + offset;

        Bitboard occ = 0;
        do {
            Bitboard idx = m.index(occ);
            if (pt == ROOK) m.attacks[idx] = compute_rook_attacks  (Square(s), occ);
            else            m.attacks[idx] = compute_bishop_attacks (Square(s), occ);
            occ = (occ - m.mask) & m.mask; // Carry-Rippler
        } while (occ);

        offset += (1 << popcount(m.mask));
    }
    (void)EdgeBB;
}

void init() {
    for (int i = 0; i < 8; i++) {
        RankBB[i] = Bitboard(0xFFULL) << (i * 8);
        FileBB[i] = Bitboard(0x0101010101010101ULL) << i;
    }

    // Pawn attacks
    for (int s = 0; s < SQUARE_NB; s++) {
        Bitboard b = sq_bb(Square(s));
        PawnAttacks[WHITE][s] = ((b & ~FileBB[FILE_A]) << 7) | ((b & ~FileBB[FILE_H]) << 9);
        PawnAttacks[BLACK][s] = ((b & ~FileBB[FILE_H]) >> 7) | ((b & ~FileBB[FILE_A]) >> 9);
    }

    // Knight attacks
    for (int s = 0; s < SQUARE_NB; s++) {
        Bitboard b = sq_bb(Square(s));
        KnightAttacks[s] =
            ((b & ~FileBB[FILE_A] & ~FileBB[FILE_B]) << 6)  |
            ((b & ~FileBB[FILE_G] & ~FileBB[FILE_H]) << 10) |
            ((b & ~FileBB[FILE_A])                   << 15) |
            ((b & ~FileBB[FILE_H])                   << 17) |
            ((b & ~FileBB[FILE_G] & ~FileBB[FILE_H]) >> 6)  |
            ((b & ~FileBB[FILE_A] & ~FileBB[FILE_B]) >> 10) |
            ((b & ~FileBB[FILE_H])                   >> 15) |
            ((b & ~FileBB[FILE_A])                   >> 17);
    }

    // King attacks
    for (int s = 0; s < SQUARE_NB; s++) {
        Bitboard b = sq_bb(Square(s));
        KingAttacks[s] =
            ((b & ~FileBB[FILE_A]) >> 1) | ((b & ~FileBB[FILE_H]) << 1) |
            (b >> 8) | (b << 8) |
            ((b & ~FileBB[FILE_A]) << 7) | ((b & ~FileBB[FILE_H]) << 9) |
            ((b & ~FileBB[FILE_H]) >> 7) | ((b & ~FileBB[FILE_A]) >> 9);
    }

    // Magic tables
    int rook_offset = 0, bishop_offset = 0;
    init_magics(ROOK,   RookMagics,   RookMagicNumbers,   RookTable,   rook_offset);
    init_magics(BISHOP, BishopMagics, BishopMagicNumbers, BishopTable, bishop_offset);

    // Between and Line tables
    for (int s1 = 0; s1 < SQUARE_NB; s1++) {
        for (int s2 = 0; s2 < SQUARE_NB; s2++) {
            BetweenBB[s1][s2] = 0;
            LineBB[s1][s2]    = 0;
            if (s1 == s2) continue;

            Bitboard r1 = rook_attacks(Square(s1), sq_bb(Square(s2)));
            Bitboard r2 = rook_attacks(Square(s2), sq_bb(Square(s1)));
            Bitboard b1 = bishop_attacks(Square(s1), sq_bb(Square(s2)));
            Bitboard b2 = bishop_attacks(Square(s2), sq_bb(Square(s1)));

            if (r1 & sq_bb(Square(s2))) {
                BetweenBB[s1][s2] = r1 & r2;
                LineBB[s1][s2]    = (rook_attacks(Square(s1), 0) & rook_attacks(Square(s2), 0))
                                    | sq_bb(Square(s1)) | sq_bb(Square(s2));
            } else if (b1 & sq_bb(Square(s2))) {
                BetweenBB[s1][s2] = b1 & b2;
                LineBB[s1][s2]    = (bishop_attacks(Square(s1), 0) & bishop_attacks(Square(s2), 0))
                                    | sq_bb(Square(s1)) | sq_bb(Square(s2));
            }
        }
    }
}

} // namespace BB
