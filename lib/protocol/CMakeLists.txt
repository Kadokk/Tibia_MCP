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
)

target_include_directories(tibia-protocol PUBLIC include)
target_include_directories(tibia-protocol PRIVATE src)
target_link_libraries(tibia-protocol
    PRIVATE OpenSSL::Crypto
    PRIVATE CURL::libcurl
    PRIVATE nlohmann_json::nlohmann_json
)

# Tests — placeholder, uncommented in Task 2
# enable_testing()
