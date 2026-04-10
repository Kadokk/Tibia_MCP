cmake_minimum_required(VERSION 3.20)
project(tibia-mcp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

include(FetchContent)

FetchContent_Declare(
    json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3
)

FetchContent_Declare(
    googletest
    GIT_REPOSITORY https://github.com/google/googletest.git
    GIT_TAG v1.14.0
)

FetchContent_MakeAvailable(json googletest)

find_package(CURL REQUIRED)
find_package(SQLite3 REQUIRED)

add_executable(tibia-mcp
    src/main.cpp
    src/cache/cache.cpp
    src/http/client.cpp
    src/mcp/transport.cpp
    src/mcp/server.cpp
    src/sources/tibiadata.cpp
)

target_include_directories(tibia-mcp PRIVATE src)
target_link_libraries(tibia-mcp PRIVATE
    nlohmann_json::nlohmann_json
    CURL::libcurl
    SQLite3::SQLite3
)

enable_testing()
add_executable(tibia-mcp-tests
    tests/test_cache.cpp
    tests/test_http_client.cpp
    tests/test_transport.cpp
    tests/test_server.cpp
    tests/test_tibiadata.cpp
    src/cache/cache.cpp
    src/http/client.cpp
    src/mcp/transport.cpp
    src/mcp/server.cpp
    src/sources/tibiadata.cpp
)
target_include_directories(tibia-mcp-tests PRIVATE src)
target_link_libraries(tibia-mcp-tests PRIVATE
    GTest::gtest_main
    nlohmann_json::nlohmann_json
    SQLite3::SQLite3
    CURL::libcurl
)
target_compile_definitions(tibia-mcp-tests PRIVATE
    FIXTURE_DIR="${CMAKE_SOURCE_DIR}/tests/fixtures"
)
add_test(NAME tibia-mcp-tests COMMAND tibia-mcp-tests)
