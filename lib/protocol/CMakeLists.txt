cmake_minimum_required(VERSION 3.20)
project(tibia-protocol LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(OpenSSL REQUIRED)
find_package(CURL REQUIRED)

include(FetchContent)
FetchContent_Declare(json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3
)
if(NOT TARGET nlohmann_json::nlohmann_json)
    FetchContent_MakeAvailable(json)
endif()

# Library — start with just xtea.cpp placeholder
add_library(tibia-protocol STATIC
    src/crypto/xtea.cpp
    src/crypto/rsa.cpp
    src/network/message.cpp
    src/network/connection.cpp
    src/http_login.cpp
    src/game_login.cpp
)

target_include_directories(tibia-protocol PUBLIC include)
target_include_directories(tibia-protocol PRIVATE src)
target_link_libraries(tibia-protocol
    PRIVATE OpenSSL::Crypto
    PRIVATE CURL::libcurl
    PRIVATE nlohmann_json::nlohmann_json
)

enable_testing()
FetchContent_Declare(googletest
    GIT_REPOSITORY https://github.com/google/googletest.git
    GIT_TAG v1.14.0
)
if(NOT TARGET GTest::gtest_main)
    FetchContent_MakeAvailable(googletest)
endif()

add_executable(tibia-protocol-tests
    tests/test_xtea.cpp
    tests/test_rsa.cpp
    tests/test_message.cpp
    tests/test_connection.cpp
    tests/test_http_login.cpp
    tests/test_game_login.cpp
)
target_include_directories(tibia-protocol-tests PRIVATE src)
target_link_libraries(tibia-protocol-tests PRIVATE
    tibia-protocol
    GTest::gtest_main
)
target_compile_definitions(tibia-protocol-tests PRIVATE
    FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures"
)
add_test(NAME tibia-protocol-tests COMMAND tibia-protocol-tests)
