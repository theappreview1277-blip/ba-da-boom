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

add_library(bdb_core STATIC core/play_model.cpp core/scheduler.cpp core/sample.cpp core/engine.cpp core/loader.cpp core/player.cpp)
set_target_properties(bdb_core PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_include_directories(bdb_core PUBLIC core)
target_link_libraries(bdb_core PUBLIC nlohmann_json::nlohmann_json)

option(BDB_TESTS "Build the core tests" ON)
if(BDB_TESTS)
  add_executable(bdb_core_tests tests/main.cpp tests/scheduler_tests.cpp tests/player_tests.cpp)
  target_link_libraries(bdb_core_tests PRIVATE bdb_core)
  target_compile_definitions(bdb_core_tests PRIVATE BDB_TESTS_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests")
  add_executable(bdb_render tools/bdb_render.cpp)
  target_link_libraries(bdb_render PRIVATE bdb_core)
endif()

# --- The plugin itself (VST3 and CLAP) ---
option(BDB_PLUGIN "Build the VST3 and CLAP plugin" ON)
if(BDB_PLUGIN)
  # Pinned versions. Point FETCHCONTENT_SOURCE_DIR_JUCE / _CJE at local copies to build offline.
  FetchContent_Declare(juce GIT_REPOSITORY https://github.com/juce-framework/JUCE.git GIT_TAG 9.0.6 GIT_SHALLOW ON)
  FetchContent_Declare(cje GIT_REPOSITORY https://github.com/free-audio/clap-juce-extensions.git GIT_TAG 3837f4a6ed2ab0ba46aba69ae5b7041c7c64ce74 GIT_SUBMODULES_RECURSE ON)
  FetchContent_MakeAvailable(juce)
  FetchContent_GetProperties(cje)
  if(NOT cje_POPULATED)
    FetchContent_Populate(cje)
  endif()
  add_subdirectory(${cje_SOURCE_DIR} ${cje_BINARY_DIR} EXCLUDE_FROM_ALL)

  # The app's screen (the built renderer, without source maps) and factory samples, packed into the plugin.
  set(BDB_UI_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../dist" CACHE PATH "The built renderer (npm run build)")
  if(NOT EXISTS "${BDB_UI_DIR}/index.html")
    message(FATAL_ERROR "Build the app's screen first (npm run build): ${BDB_UI_DIR}/index.html is missing")
  endif()
  set(BDB_UI_STAGE "${CMAKE_CURRENT_BINARY_DIR}/ui")
  file(GLOB_RECURSE BDB_UI_FILES CONFIGURE_DEPENDS "${BDB_UI_DIR}/*")
  add_custom_command(OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/ui.zip"
    COMMAND ${CMAKE_COMMAND} -DSRC=${BDB_UI_DIR} -DSTAGE=${BDB_UI_STAGE} -DOUT=${CMAKE_CURRENT_BINARY_DIR}/ui.zip -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/pack-ui.cmake
    DEPENDS ${BDB_UI_FILES} ${CMAKE_CURRENT_SOURCE_DIR}/cmake/pack-ui.cmake
    COMMENT "Packing the app's screen into the plugin")
  add_custom_target(bdb_ui_zip DEPENDS "${CMAKE_CURRENT_BINARY_DIR}/ui.zip")
  juce_add_binary_data(bdb_ui_data HEADER_NAME BinaryData.h NAMESPACE BinaryData SOURCES "${CMAKE_CURRENT_BINARY_DIR}/ui.zip" "${CMAKE_CURRENT_SOURCE_DIR}/default-model.json")
  add_dependencies(bdb_ui_data bdb_ui_zip)

  juce_add_plugin(Badaboom
    PRODUCT_NAME "Ba-da-boom"
    COMPANY_NAME "Ba-da-boom"
    BUNDLE_ID com.badaboom.plugin
    PLUGIN_MANUFACTURER_CODE Bdbm
    PLUGIN_CODE Bdb1
    VERSION ${PROJECT_VERSION}
    FORMATS VST3 Standalone
    IS_SYNTH TRUE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT TRUE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    NEEDS_WEBVIEW2 TRUE
    VST3_CATEGORIES Instrument Drum
    COPY_PLUGIN_AFTER_BUILD FALSE)
  target_sources(Badaboom PRIVATE src/Processor.cpp src/Editor.cpp)
  target_compile_definitions(Badaboom PUBLIC
    JUCE_WEB_BROWSER=1 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0
    # Notes only: no 2000 hidden MIDI controller parameters for the host to list.
    JUCE_VST3_EMULATE_MIDI_CC_WITH_PARAMETERS=0 JUCE_DISPLAY_SPLASH_SCREEN=0
    JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1)
  target_link_libraries(Badaboom PRIVATE bdb_core bdb_ui_data juce::juce_audio_utils juce::juce_gui_extra juce::juce_cryptography
    PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
  if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    target_link_libraries(Badaboom PRIVATE juce::pkgconfig_JUCE_BROWSER_LINUX_DEPS)
  endif()
  clap_juce_extensions_plugin(TARGET Badaboom CLAP_ID "com.badaboom.plugin" CLAP_FEATURES instrument drum-machine sampler stereo)

  # The test host: loads the built VST3 like a DAW (tests/host/host_test.cpp).
  if(BDB_TESTS)
    juce_add_console_app(bdb_host_test PRODUCT_NAME "bdb_host_test")
    target_sources(bdb_host_test PRIVATE tests/host/host_test.cpp)
    target_compile_definitions(bdb_host_test PRIVATE JUCE_PLUGINHOST_VST3=1 JUCE_MODAL_LOOPS_PERMITTED=1 JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
    target_link_libraries(bdb_host_test PRIVATE juce::juce_audio_processors juce::juce_audio_formats juce::juce_gui_basics juce::juce_recommended_config_flags)
  endif()
endif()
