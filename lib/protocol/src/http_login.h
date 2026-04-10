#pragma once
#include <tibia/types.h>
#include <string>

LoginResult parse_login_response(const std::string& json_str);
LoginResult http_login(const std::string& email, const std::string& password,
                        const std::string& authenticator_token = "");
std::string get_login_url();
