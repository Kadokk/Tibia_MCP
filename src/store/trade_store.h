#pragma once
#include <string>
#include <vector>
#include <cstdint>

struct RawMessage {
    std::string world;
    std::string channel;
    std::string sender_name;
    uint32_t sender_level = 0;     // 0 = not present
    std::string text;
    int64_t received_at = 0;       // unix timestamp
    int64_t id = 0;                // populated after insert/select
    std::string parse_method;      // populated on select; may be empty
};

struct TradeOffer {
    int64_t raw_message_id = 0;
    std::string world;
    std::string offer_type;        // 'sell' | 'buy' | 'trade'
    std::string item_canonical;
    std::string item_raw;
    int64_t quantity = 1;
    int64_t price_gold = 0;        // 0 for barter
    std::string sender_name;
    uint32_t sender_level = 0;
    int64_t offered_at = 0;
    std::string parse_method;      // 'regex' | 'llm' | 'llm_unresolved' | 'llm_failed'
    double confidence = 0.0;       // 0 for regex
};

class TradeStore {
public:
    explicit TradeStore(const std::string& db_path);
    ~TradeStore();
    TradeStore(const TradeStore&) = delete;
    TradeStore& operator=(const TradeStore&) = delete;

    int64_t insert_raw_message(const RawMessage& m);
    void mark_parsed(int64_t raw_message_id, const std::string& parse_method);
    std::vector<RawMessage> select_unparsed_messages(int limit);

    void insert_trade_offer(const TradeOffer& o);
    std::vector<TradeOffer> select_offers_by_item(const std::string& item_canonical,
                                                   const std::string& world,
                                                   int64_t since_unix,
                                                   int limit);
    std::vector<TradeOffer> select_offers_by_sender(const std::string& sender_name,
                                                    int64_t since_unix,
                                                    int limit);

    void close();

private:
    struct Impl;
    Impl* impl_;
};
