#include "uci.h"
#include "movegen.h"
#include "move.h"
#include <iostream>
#include <sstream>
#include <string>

// move_to_uci and parse_move implementation
std::string move_to_uci(Move m) {
    if (m == MOVE_NONE) return "0000";
    static const char* SQ_NAMES[] = {
        "a1","b1","c1","d1","e1","f1","g1","h1",
        "a2","b2","c2","d2","e2","f2","g2","h2",
        "a3","b3","c3","d3","e3","f3","g3","h3",
        "a4","b4","c4","d4","e4","f4","g4","h4",
        "a5","b5","c5","d5","e5","f5","g5","h5",
        "a6","b6","c6","d6","e6","f6","g6","h6",
        "a7","b7","c7","d7","e7","f7","g7","h7",
        "a8","b8","c8","d8","e8","f8","g8","h8"
    };
    std::string s = SQ_NAMES[from_sq(m)];
    s += SQ_NAMES[to_sq(m)];
    if (move_type(m) == PROMOTION) {
        static const char promo_ch[] = {'n','b','r','q'};
        s += promo_ch[promo_type(m) - KNIGHT];
    }
    return s;
}

Move parse_move(const std::string& s) {
    if (s.size() < 4) return MOVE_NONE;
    File from_f = File(s[0] - 'a');
    Rank from_r = Rank(s[1] - '1');
    File to_f   = File(s[2] - 'a');
    Rank to_r   = Rank(s[3] - '1');
    Square from = make_square(from_f, from_r);
    Square to   = make_square(to_f,   to_r);
    if (s.size() == 5) {
        PieceType promo = QUEEN;
        switch (s[4]) {
            case 'n': promo = KNIGHT; break;
            case 'b': promo = BISHOP; break;
            case 'r': promo = ROOK;   break;
            case 'q': promo = QUEEN;  break;
        }
        return make_promotion(from, to, promo);
    }
    return make_move(from, to);
}

UCIEngine::UCIEngine()
    : board_(), tt_(16), searcher_(board_, tt_)
{
    board_.set_startpos();
}

void UCIEngine::run() {
    std::string line;
    while (!quit_ && std::getline(std::cin, line)) {
        std::istringstream ss(line);
        std::string token;
        if (!(ss >> token)) continue;

        if      (token == "uci")        cmd_uci();
        else if (token == "isready")    cmd_isready();
        else if (token == "ucinewgame") cmd_ucinewgame();
        else if (token == "position")   cmd_position(ss);
        else if (token == "go")         cmd_go(ss);
        else if (token == "stop")       cmd_stop();
        else if (token == "quit")       cmd_quit();
        else if (token == "setoption")  cmd_setoption(ss);
        else if (token == "perft")      cmd_perft(ss);
        // Unknown tokens silently ignored per UCI spec
    }
    wait_for_search();
}

void UCIEngine::cmd_uci() {
    std::cout << "id name IMHOTEP 2.0\n"
              << "id author Maikib94\n"
              << "option name Hash type spin default 16 min 1 max 2048\n"
              << "uciok\n";
    std::cout.flush();
}

void UCIEngine::cmd_isready() {
    std::cout << "readyok\n";
    std::cout.flush();
}

void UCIEngine::cmd_ucinewgame() {
    cmd_stop();
    board_.set_startpos();
    tt_.clear();
}

void UCIEngine::cmd_position(std::istringstream& ss) {
    cmd_stop();
    std::string token;
    ss >> token;

    if (token == "startpos") {
        board_.set_startpos();
        ss >> token; // consume optional "moves"
    } else if (token == "fen") {
        std::string fen, part;
        for (int i = 0; i < 6 && ss >> part; i++) {
            if (part == "moves") { token = "moves"; break; }
            if (!fen.empty()) fen += ' ';
            fen += part;
            token = "";
        }
        if (!fen.empty()) board_.set_fen(fen);
        if (token != "moves") ss >> token;
    }

    // Parse move list
    if (token == "moves") {
        std::string mv_str;
        while (ss >> mv_str) {
            Move m = parse_move(mv_str);
            // Match against legal moves to set correct move type (castling, EP)
            MoveList ml;
            gen_legal(board_, ml);
            for (int i = 0; i < ml.count; i++) {
                if (from_sq(ml.moves[i]) == from_sq(m) && to_sq(ml.moves[i]) == to_sq(m)) {
                    if (move_type(m) != PROMOTION || promo_type(ml.moves[i]) == promo_type(m)) {
                        m = ml.moves[i];
                        break;
                    }
                }
            }
            board_.make_move(m);
        }
    }
}

void UCIEngine::cmd_go(std::istringstream& ss) {
    SearchLimits limits;
    std::string token;
    while (ss >> token) {
        if      (token == "wtime")     ss >> limits.wtime;
        else if (token == "btime")     ss >> limits.btime;
        else if (token == "winc")      ss >> limits.winc;
        else if (token == "binc")      ss >> limits.binc;
        else if (token == "movestogo") ss >> limits.movestogo;
        else if (token == "depth")     ss >> limits.depth;
        else if (token == "movetime")  ss >> limits.movetime;
        else if (token == "infinite")  limits.infinite = true;
        else if (token == "nodes")     { /* future */ }
        else if (token == "ponder")    { /* future */ }
    }
    start_search(limits);
}

void UCIEngine::cmd_stop() {
    searcher_.stop();
    wait_for_search();
}

void UCIEngine::cmd_quit() {
    cmd_stop();
    quit_ = true;
}

void UCIEngine::cmd_setoption(std::istringstream& ss) {
    std::string token, name, value;
    while (ss >> token) {
        if      (token == "name")  ss >> name;
        else if (token == "value") ss >> value;
    }
    if (name == "Hash" && !value.empty()) {
        size_t mb = std::stoul(value);
        tt_.resize(mb);
    }
}

void UCIEngine::cmd_perft(std::istringstream& ss) {
    int depth = 1;
    ss >> depth;
    uint64_t nodes = perft(board_, depth);
    std::cout << "Nodes: " << nodes << "\n";
    std::cout.flush();
}

void UCIEngine::start_search(const SearchLimits& limits) {
    wait_for_search(); // ensure previous search finished
    search_thread_ = std::thread([this, limits]() {
        searcher_.search(limits);
    });
}

void UCIEngine::wait_for_search() {
    if (search_thread_.joinable()) {
        searcher_.stop();
        search_thread_.join();
    }
}
