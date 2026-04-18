#pragma once
#include "game/parsers.h"
#include <string>
#include <cstdint>

class TradeStore;

class MessageSink {
public:
    MessageSink(TradeStore& store, std::string world, std::string channel);
    void accept(const parsers::ChatMessage& msg, int64_t received_at);

private:
    TradeStore& store_;
    std::string world_;
    std::string channel_;
};
