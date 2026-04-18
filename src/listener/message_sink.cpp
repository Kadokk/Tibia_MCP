#include "listener/message_sink.h"
#include "store/trade_store.h"

MessageSink::MessageSink(TradeStore& store, std::string world, std::string channel)
    : store_(store), world_(std::move(world)), channel_(std::move(channel)) {}

void MessageSink::accept(const parsers::ChatMessage& msg, int64_t received_at) {
    RawMessage r;
    r.world = world_;
    r.channel = channel_;
    r.sender_name = msg.sender_name;
    r.sender_level = msg.sender_level;
    r.text = msg.text;
    r.received_at = received_at;
    store_.insert_raw_message(r);
}
