#pragma once
#include "board.h"
#include "tt.h"
#include "search.h"
#include <thread>

class UCIEngine {
public:
    UCIEngine();
    void run();

private:
    void cmd_uci();
    void cmd_isready();
    void cmd_ucinewgame();
    void cmd_position (std::istringstream& ss);
    void cmd_go       (std::istringstream& ss);
    void cmd_stop();
    void cmd_quit();
    void cmd_setoption(std::istringstream& ss);
    void cmd_perft    (std::istringstream& ss);

    void start_search(const SearchLimits& limits);
    void wait_for_search();

    Board              board_;
    TranspositionTable tt_;
    Searcher           searcher_;
    std::thread        search_thread_;
    bool               quit_ = false;
};
