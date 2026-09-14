#include "bitboard.h"
#include "zobrist.h"
#include "uci.h"
#include <iostream>

int main() {
    std::ios::sync_with_stdio(false);
    std::cin.tie(nullptr);

    Zobrist::init();
    BB::init();

    UCIEngine engine;
    engine.run();

    return 0;
}
