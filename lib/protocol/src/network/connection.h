#pragma once
#include <string>
#include <cstdint>
#include <vector>

class Connection {
public:
    Connection();
    ~Connection();
    Connection(const Connection&) = delete;
    Connection& operator=(const Connection&) = delete;

    bool connect(const std::string& host, int port);
    void disconnect();
    bool is_connected() const;

    bool send_raw(const uint8_t* data, size_t len);

    // Read a Tibia packet: 2-byte length prefix, then that many bytes
    std::vector<uint8_t> recv_packet();

    std::string last_error() const;

    void set_connect_timeout(int seconds);
    void set_read_timeout(int seconds);

    // For testing: inject an existing file descriptor
    void set_fd(int fd);

private:
    int fd_ = -1;
    int connect_timeout_ = 10;
    int read_timeout_ = 30;
    std::string last_error_;
    bool recv_exact(uint8_t* buf, size_t len);
};
