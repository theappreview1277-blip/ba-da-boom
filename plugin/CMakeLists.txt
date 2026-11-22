# Ba-da-boom as a VST3 and CLAP plugin.
# The core (play model, scheduling, sound engine) is plain C++ so it can be tested on its own;
# the plugin wraps it with JUCE (AGPLv3) and clap-juce-extensions (MIT).
cmake_minimum_required(VERSION 3.22)
project(BadaboomPlugin VERSION 0.1.0 LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)
FetchContent_Declare(json URL https://github.com/nlohmann/json/releases/download/v3.12.0/json.tar.xz URL_HASH SHA256=42f6e95cad6ec532fd372391373363b62a14af6d771056dbfc86160e6dfff7aa)
FetchContent_MakeAvailable(json)

add_library(bdb_core STATIC core/play_model.cpp core/scheduler.cpp core/sample.cpp core/engine.cpp core/loader.cpp)
set_target_properties(bdb_core PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_include_directories(bdb_core PUBLIC core)
target_link_libraries(bdb_core PUBLIC nlohmann_json::nlohmann_json)

option(BDB_TESTS "Build the core tests" ON)
if(BDB_TESTS)
  add_executable(bdb_core_tests tests/main.cpp tests/scheduler_tests.cpp)
  target_link_libraries(bdb_core_tests PRIVATE bdb_core)
  target_compile_definitions(bdb_core_tests PRIVATE BDB_TESTS_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests")
  add_executable(bdb_render tools/bdb_render.cpp)
  target_link_libraries(bdb_render PRIVATE bdb_core)
endif()
