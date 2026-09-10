cmake_minimum_required(VERSION 3.16)
project(IMHOTEP
    VERSION     2.0.0
    DESCRIPTION "IMHOTEP UCI Chess Engine V2"
    LANGUAGES   CXX
)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

set(SOURCES
    src/main.cpp
    src/bitboard.cpp
    src/zobrist.cpp
    src/board.cpp
    src/movegen.cpp
    src/evaluation.cpp
    src/tt.cpp
    src/search.cpp
    src/time_manager.cpp
    src/uci.cpp
)

add_executable(imhotep ${SOURCES})
target_include_directories(imhotep PRIVATE src/)

target_compile_options(imhotep PRIVATE
    $<$<CXX_COMPILER_ID:GNU,Clang>:
        -Wall -Wextra
        $<$<CONFIG:Release>:-O3 -march=native -DNDEBUG>
        $<$<CONFIG:Debug>:  -O0 -g -fsanitize=address,undefined>
    >
    $<$<CXX_COMPILER_ID:MSVC>:
        /W4
        $<$<CONFIG:Release>:/O2 /DNDEBUG>
        $<$<CONFIG:Debug>:  /Od /Zi>
    >
)

target_link_options(imhotep PRIVATE
    $<$<AND:$<CXX_COMPILER_ID:GNU,Clang>,$<CONFIG:Debug>>:
        -fsanitize=address,undefined>
)

find_package(Threads REQUIRED)
target_link_libraries(imhotep PRIVATE Threads::Threads)

install(TARGETS imhotep RUNTIME DESTINATION bin)
