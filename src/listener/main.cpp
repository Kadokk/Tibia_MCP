#include "log.h"
#include "store/trade_store.h"
#include "listener/channel_joiner.h"
#include "listener/anti_idle.h"
#include "listener/message_sink.h"
#include "game/packets.h"
#include "game/parsers.h"
#include "game/opcodes.h"
#include <tibia/client.h>
#include <csignal>
#include <cstdlib>
#include <ctime>
#include <string>

static volatile std::sig_atomic_t g_shutdown = 0;
static void on_signal(int) { g_shutdown = 1; }

static const char* getenv_or(const char* name, const char* fallback) {
    const char* v = std::getenv(name);
    return v ? v : fallback;
}

int main() {
    std::signal(SIGTERM, on_signal);
    std::signal(SIGINT, on_signal);

    const char* email = std::getenv("TIBIA_LISTENER_EMAIL");
    if (!email) email = std::getenv("TIBIA_TEST_EMAIL");
    const char* password = std::getenv("TIBIA_LISTENER_PASSWORD");
    if (!password) password = std::getenv("TIBIA_TEST_PASSWORD");
    if (!email || !password) {
        LOG(ERROR, "Missing credentials: set TIBIA_LISTENER_EMAIL/PASSWORD");
        return 2;
    }

    std::string world_name   = getenv_or("TIBIA_LISTENER_WORLD", "Antica");
    std::string channel_name = getenv_or("TIBIA_LISTENER_CHANNEL", "Trade");
    std::string db_path      = getenv_or("TIBIA_LISTENER_DB", "tibia_mcp_cache.db");
    const char* char_env     = std::getenv("TIBIA_LISTENER_CHARACTER");
    int client_version       = std::atoi(getenv_or("TIBIA_LISTENER_CLIENT_VERSION",   "1321"));
    int protocol_version     = std::atoi(getenv_or("TIBIA_LISTENER_PROTOCOL_VERSION", "1321"));

    LOG(INFO, "tibia-listener starting (world=" << world_name
              << ", channel=" << channel_name << ", db=" << db_path << ")");

    TibiaClient client;
    client.set_client_version(client_version);
    client.set_protocol_version(static_cast<uint16_t>(protocol_version));
    client.set_read_timeout(1);

    auto login = client.login(email, password);
    if (!login.success) {
        LOG(ERROR, "Login failed: " << login.error);
        return 3;
    }
    LOG(INFO, "Login successful");

    const Character* target_char = nullptr;
    const World* target_world = nullptr;
    for (const auto& w : login.worlds) {
        if (w.name != world_name) continue;
        target_world = &w;
        for (const auto& c : login.characters) {
            if (c.world_id != w.id) continue;
            if (char_env && c.name != char_env) continue;
            target_char = &c;
            break;
        }
        break;
    }
    if (!target_char || !target_world) {
        LOG(ERROR, "No matching character on world " << world_name);
        return 4;
    }

    LOG(INFO, "Selecting " << target_char->name << " on " << target_world->name);
    auto connect = client.select_character(target_char->name, *target_world);
    if (!connect.success) {
        LOG(ERROR, "Connect failed: " << connect.error);
        return 5;
    }

    TradeStore store(db_path);
    MessageSink sink(store, world_name, "trade");
    ChannelJoiner joiner(channel_name);
    AntiIdle idle(std::time(nullptr));

    for (auto& m : joiner.start()) {
        if (!client.send_packet(m)) {
            LOG(ERROR, "Failed to send initial request_channels");
            return 6;
        }
    }

    while (!g_shutdown && client.is_alive()) {
        int64_t now = std::time(nullptr);

        auto opt_msg = client.recv_packet(1000);
        if (opt_msg) {
            Message& msg = *opt_msg;
            uint8_t op;
            try { op = msg.read_u8(); }
            catch (...) { continue; }

            if (op == ServerOpcode::PING) {
                client.send_packet(packets::build_pong());
            } else if (op == ServerOpcode::CHANNEL_LIST) {
                auto list = parsers::parse_channel_list(msg);
                for (auto& out : joiner.handle_channel_list(list)) {
                    client.send_packet(out);
                }
            } else if (op == ServerOpcode::OPEN_CHANNEL) {
                auto id = parsers::parse_open_channel_response(msg);
                if (id) {
                    joiner.handle_open_channel_response(*id);
                    LOG(INFO, "Trade channel joined (id=" << *id << ")");
                }
            } else if (op == ServerOpcode::CREATURE_SPEAK) {
                auto chat = parsers::parse_chat_message(msg);
                auto trade_id = joiner.trade_channel_id();
                if (chat && trade_id && chat->channel_id == *trade_id) {
                    sink.accept(*chat, now);
                }
            } else if (op == ServerOpcode::KICK) {
                LOG(WARN, "Received KICK opcode; exiting");
                break;
            }
            // Ignore all other opcodes (we don't decode game state in MVP).
        }

        if (idle.should_turn(now) && joiner.trade_channel_id()) {
            auto turn = idle.next_turn_packet(now);
            if (!client.send_packet(turn)) {
                LOG(WARN, "Turn send failed; treating as disconnect");
                break;
            }
        }
    }

    if (!client.is_alive()) {
        LOG(WARN, "Connection lost");
    } else {
        client.send_packet(packets::build_logout());
    }
    client.disconnect();
    store.close();
    LOG(INFO, "tibia-listener exited");
    return g_shutdown ? 0 : 1;  // nonzero = supervisor should restart
}
