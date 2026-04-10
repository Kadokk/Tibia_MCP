#include "crypto/rsa.h"

#include <openssl/opensslv.h>
#include <openssl/bn.h>
#include <openssl/evp.h>

#if defined(OPENSSL_VERSION_NUMBER) && OPENSSL_VERSION_NUMBER >= 0x30000000L && !defined(LIBRESSL_VERSION_NUMBER)
// OpenSSL 3.0+ EVP API
#include <openssl/param_build.h>
#include <openssl/core_names.h>
#include <openssl/rsa.h>

std::optional<std::vector<uint8_t>> rsa_encrypt(
    const uint8_t* data, size_t len,
    const std::string& modulus_decimal,
    const std::string& exponent_decimal)
{
    if (len != 128) return std::nullopt;

    // Parse modulus and exponent
    BIGNUM* bn_n = nullptr;
    BIGNUM* bn_e = nullptr;
    if (BN_dec2bn(&bn_n, modulus_decimal.c_str()) == 0 || bn_n == nullptr) {
        return std::nullopt;
    }
    if (BN_dec2bn(&bn_e, exponent_decimal.c_str()) == 0 || bn_e == nullptr) {
        BN_free(bn_n);
        return std::nullopt;
    }

    // Verify modulus is 1024 bits (128 bytes)
    if (BN_num_bytes(bn_n) != 128) {
        BN_free(bn_n);
        BN_free(bn_e);
        return std::nullopt;
    }

    // Build parameters
    OSSL_PARAM_BLD* bld = OSSL_PARAM_BLD_new();
    if (!bld) {
        BN_free(bn_n);
        BN_free(bn_e);
        return std::nullopt;
    }

    std::optional<std::vector<uint8_t>> result;

    if (OSSL_PARAM_BLD_push_BN(bld, OSSL_PKEY_PARAM_RSA_N, bn_n) &&
        OSSL_PARAM_BLD_push_BN(bld, OSSL_PKEY_PARAM_RSA_E, bn_e))
    {
        OSSL_PARAM* params = OSSL_PARAM_BLD_to_param(bld);
        if (params) {
            EVP_PKEY_CTX* key_ctx = EVP_PKEY_CTX_new_from_name(nullptr, "RSA", nullptr);
            if (key_ctx) {
                EVP_PKEY* pkey = nullptr;
                if (EVP_PKEY_fromdata_init(key_ctx) > 0 &&
                    EVP_PKEY_fromdata(key_ctx, &pkey, EVP_PKEY_PUBLIC_KEY, params) > 0 &&
                    pkey != nullptr)
                {
                    EVP_PKEY_CTX* enc_ctx = EVP_PKEY_CTX_new(pkey, nullptr);
                    if (enc_ctx) {
                        if (EVP_PKEY_encrypt_init(enc_ctx) > 0 &&
                            EVP_PKEY_CTX_set_rsa_padding(enc_ctx, RSA_NO_PADDING) > 0)
                        {
                            size_t outlen = 0;
                            if (EVP_PKEY_encrypt(enc_ctx, nullptr, &outlen, data, len) > 0) {
                                std::vector<uint8_t> out(outlen);
                                if (EVP_PKEY_encrypt(enc_ctx, out.data(), &outlen, data, len) > 0) {
                                    out.resize(outlen);
                                    result = std::move(out);
                                }
                            }
                        }
                        EVP_PKEY_CTX_free(enc_ctx);
                    }
                    EVP_PKEY_free(pkey);
                }
                EVP_PKEY_CTX_free(key_ctx);
            }
            OSSL_PARAM_free(params);
        }
    }

    OSSL_PARAM_BLD_free(bld);
    BN_free(bn_n);
    BN_free(bn_e);
    return result;
}

#else
// Legacy RSA API (LibreSSL or older OpenSSL)
#include <openssl/rsa.h>

std::optional<std::vector<uint8_t>> rsa_encrypt(
    const uint8_t* data, size_t len,
    const std::string& modulus_decimal,
    const std::string& exponent_decimal)
{
    if (len != 128) return std::nullopt;

    BIGNUM* bn_n = nullptr;
    BIGNUM* bn_e = nullptr;
    if (BN_dec2bn(&bn_n, modulus_decimal.c_str()) == 0 || bn_n == nullptr) {
        return std::nullopt;
    }
    if (BN_dec2bn(&bn_e, exponent_decimal.c_str()) == 0 || bn_e == nullptr) {
        BN_free(bn_n);
        return std::nullopt;
    }

    if (BN_num_bytes(bn_n) != 128) {
        BN_free(bn_n);
        BN_free(bn_e);
        return std::nullopt;
    }

    RSA* rsa = RSA_new();
    if (!rsa) {
        BN_free(bn_n);
        BN_free(bn_e);
        return std::nullopt;
    }

    // RSA_set0_key takes ownership of bn_n and bn_e on success
    if (RSA_set0_key(rsa, bn_n, bn_e, nullptr) != 1) {
        RSA_free(rsa);
        BN_free(bn_n);
        BN_free(bn_e);
        return std::nullopt;
    }

    std::vector<uint8_t> out(128);
    int ret = RSA_public_encrypt(
        static_cast<int>(len), data, out.data(), rsa, RSA_NO_PADDING);

    RSA_free(rsa);

    if (ret != 128) return std::nullopt;
    return out;
}

#endif
