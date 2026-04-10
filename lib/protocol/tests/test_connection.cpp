#include <gtest/gtest.h>
#include "network/connection.h"
#include <sys/socket.h>
#include <unistd.h>

TEST(ConnectionTest, DefaultState) {
    Connection conn;
    EXPECT_FALSE(conn.is_connected());
}

TEST(ConnectionTest, ConnectToInvalidHostFails) {
    Connection conn;
    conn.set_connect_timeout(2);
    bool ok = conn.connect("192.0.2.1", 7172);
    EXPECT_FALSE(ok);
    EXPECT_FALSE(conn.is_connected());
    EXPECT_FALSE(conn.last_error().empty());
}

TEST(ConnectionTest, DisconnectWhenNotConnectedIsNoop) {
    Connection conn;
    conn.disconnect();
    EXPECT_FALSE(conn.is_connected());
}

TEST(ConnectionTest, SendRecvViaPipe) {
    int fds[2];
    ASSERT_EQ(socketpair(AF_UNIX, SOCK_STREAM, 0, fds), 0);

    Connection conn;
    conn.set_fd(fds[0]);

    std::vector<uint8_t> payload = {0x0A, 0x0B, 0x0C};
    EXPECT_TRUE(conn.send_raw(payload.data(), payload.size()));

    uint8_t buf[3];
    ssize_t n = read(fds[1], buf, 3);
    EXPECT_EQ(n, 3);
    EXPECT_EQ(buf[0], 0x0A);

    close(fds[1]);
    conn.disconnect();
}

TEST(ConnectionTest, RecvPacketViaPipe) {
    int fds[2];
    ASSERT_EQ(socketpair(AF_UNIX, SOCK_STREAM, 0, fds), 0);

    Connection conn;
    conn.set_fd(fds[0]);
    conn.set_read_timeout(2);

    // Write a Tibia-framed packet to the other end: 2-byte LE length + payload
    uint8_t frame[] = {0x03, 0x00, 0xAA, 0xBB, 0xCC}; // length=3, payload=AA BB CC
    write(fds[1], frame, 5);

    auto packet = conn.recv_packet();
    EXPECT_EQ(packet.size(), 3u);
    EXPECT_EQ(packet[0], 0xAA);
    EXPECT_EQ(packet[1], 0xBB);
    EXPECT_EQ(packet[2], 0xCC);

    close(fds[1]);
    conn.disconnect();
}
