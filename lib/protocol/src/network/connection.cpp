#include "network/connection.h"

#include <cerrno>
#include <cstring>
#include <stdexcept>

#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <unistd.h>
#include <fcntl.h>
#include <poll.h>

Connection::Connection() = default;

Connection::~Connection() {
    disconnect();
}

bool Connection::connect(const std::string& host, int port) {
    last_error_.clear();

    struct addrinfo hints{};
    hints.ai_family = AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;

    struct addrinfo* res = nullptr;
    std::string port_str = std::to_string(port);
    int rc = getaddrinfo(host.c_str(), port_str.c_str(), &hints, &res);
    if (rc != 0) {
        last_error_ = std::string("getaddrinfo: ") + gai_strerror(rc);
        return false;
    }

    int sock = -1;
    for (struct addrinfo* p = res; p != nullptr; p = p->ai_next) {
        sock = ::socket(p->ai_family, p->ai_socktype, p->ai_protocol);
        if (sock < 0) continue;

        // Set non-blocking for connection with timeout
        int flags = fcntl(sock, F_GETFL, 0);
        if (flags < 0 || fcntl(sock, F_SETFL, flags | O_NONBLOCK) < 0) {
            ::close(sock);
            sock = -1;
            continue;
        }

        int ret = ::connect(sock, p->ai_addr, p->ai_addrlen);
        if (ret == 0) {
            // Connected immediately
        } else if (errno == EINPROGRESS) {
            struct pollfd pfd{};
            pfd.fd = sock;
            pfd.events = POLLOUT;
            int poll_ret = ::poll(&pfd, 1, connect_timeout_ * 1000);
            if (poll_ret <= 0) {
                // Timeout or error
                ::close(sock);
                sock = -1;
                last_error_ = (poll_ret == 0) ? "connect timed out" : std::string("poll: ") + strerror(errno);
                continue;
            }
            // Check SO_ERROR to confirm connection success
            int so_error = 0;
            socklen_t so_len = sizeof(so_error);
            if (getsockopt(sock, SOL_SOCKET, SO_ERROR, &so_error, &so_len) < 0 || so_error != 0) {
                ::close(sock);
                sock = -1;
                last_error_ = std::string("connect: ") + strerror(so_error != 0 ? so_error : errno);
                continue;
            }
        } else {
            last_error_ = std::string("connect: ") + strerror(errno);
            ::close(sock);
            sock = -1;
            continue;
        }

        // Restore to blocking
        flags = fcntl(sock, F_GETFL, 0);
        if (flags >= 0) {
            fcntl(sock, F_SETFL, flags & ~O_NONBLOCK);
        }

        // Set read timeout via SO_RCVTIMEO
        struct timeval tv{};
        tv.tv_sec = read_timeout_;
        tv.tv_usec = 0;
        setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

        fd_ = sock;
        freeaddrinfo(res);
        return true;
    }

    freeaddrinfo(res);
    if (last_error_.empty()) {
        last_error_ = "could not connect to host";
    }
    return false;
}

void Connection::disconnect() {
    if (fd_ >= 0) {
        ::close(fd_);
        fd_ = -1;
    }
}

bool Connection::is_connected() const {
    return fd_ >= 0;
}

bool Connection::send_raw(const uint8_t* data, size_t len) {
    if (fd_ < 0) {
        last_error_ = "not connected";
        return false;
    }
    size_t sent = 0;
    while (sent < len) {
        ssize_t n = ::send(fd_, data + sent, len - sent, 0);
        if (n < 0) {
            last_error_ = std::string("send: ") + strerror(errno);
            return false;
        }
        sent += static_cast<size_t>(n);
    }
    return true;
}

std::vector<uint8_t> Connection::recv_packet() {
    last_error_.clear();

    uint8_t len_buf[2];
    if (!recv_exact(len_buf, 2)) {
        return {};
    }

    uint16_t payload_len = static_cast<uint16_t>(len_buf[0]) |
                           (static_cast<uint16_t>(len_buf[1]) << 8);

    if (payload_len == 0) {
        return {};
    }

    std::vector<uint8_t> payload(payload_len);
    if (!recv_exact(payload.data(), payload_len)) {
        return {};
    }

    return payload;
}

std::string Connection::last_error() const {
    return last_error_;
}

void Connection::set_connect_timeout(int seconds) {
    connect_timeout_ = seconds;
}

void Connection::set_read_timeout(int seconds) {
    read_timeout_ = seconds;
    if (fd_ >= 0) {
        struct timeval tv{};
        tv.tv_sec = read_timeout_;
        tv.tv_usec = 0;
        setsockopt(fd_, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    }
}

void Connection::set_fd(int fd) {
    if (fd_ >= 0) {
        ::close(fd_);
    }
    fd_ = fd;
}

bool Connection::recv_exact(uint8_t* buf, size_t len) {
    if (fd_ < 0) {
        last_error_ = "not connected";
        return false;
    }
    size_t received = 0;
    while (received < len) {
        ssize_t n = ::recv(fd_, buf + received, len - received, 0);
        if (n < 0) {
            last_error_ = std::string("recv: ") + strerror(errno);
            return false;
        }
        if (n == 0) {
            last_error_ = "connection closed by peer";
            return false;
        }
        received += static_cast<size_t>(n);
    }
    return true;
}
