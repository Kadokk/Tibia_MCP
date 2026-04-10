#include <gtest/gtest.h>
#include "crypto/rsa.h"
#include <vector>

static const char* CIPSOFT_RSA_N =
    "109120132967399429278860960508995541528237502902798129123468757937266291492576"
    "446330739696001110603907230888610072655818825358503429057592827629436413108566"
    "029093628212635953836686562675849720620786279431090218017681061521755056710823"
    "876476444260558147179707119674283982419152118103759076030616683978566631413";
static const char* CIPSOFT_RSA_E = "65537";

TEST(RsaTest, EncryptProduces128Bytes) {
    std::vector<uint8_t> plaintext(128, 0);
    plaintext[0] = 0x00;
    auto result = rsa_encrypt(plaintext.data(), plaintext.size(), CIPSOFT_RSA_N, CIPSOFT_RSA_E);
    ASSERT_TRUE(result.has_value());
    EXPECT_EQ(result->size(), 128u);
}

TEST(RsaTest, EncryptChangesData) {
    std::vector<uint8_t> plaintext(128, 0);
    plaintext[0] = 0x00;
    plaintext[1] = 0xDE;
    plaintext[2] = 0xAD;
    auto result = rsa_encrypt(plaintext.data(), plaintext.size(), CIPSOFT_RSA_N, CIPSOFT_RSA_E);
    ASSERT_TRUE(result.has_value());
    EXPECT_NE(*result, plaintext);
}

TEST(RsaTest, DifferentPlaintextDifferentCiphertext) {
    std::vector<uint8_t> pt1(128, 0);
    std::vector<uint8_t> pt2(128, 0);
    pt1[1] = 0x01;
    pt2[1] = 0x02;
    auto r1 = rsa_encrypt(pt1.data(), pt1.size(), CIPSOFT_RSA_N, CIPSOFT_RSA_E);
    auto r2 = rsa_encrypt(pt2.data(), pt2.size(), CIPSOFT_RSA_N, CIPSOFT_RSA_E);
    ASSERT_TRUE(r1.has_value());
    ASSERT_TRUE(r2.has_value());
    EXPECT_NE(*r1, *r2);
}

TEST(RsaTest, InvalidKeyReturnsNullopt) {
    std::vector<uint8_t> plaintext(128, 0);
    auto result = rsa_encrypt(plaintext.data(), plaintext.size(), "invalid", "65537");
    EXPECT_FALSE(result.has_value());
}

TEST(RsaTest, WrongSizeReturnsNullopt) {
    std::vector<uint8_t> plaintext(64, 0);
    auto result = rsa_encrypt(plaintext.data(), plaintext.size(), CIPSOFT_RSA_N, CIPSOFT_RSA_E);
    EXPECT_FALSE(result.has_value());
}
