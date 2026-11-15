#include <WiFi.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <esp_https_server.h>
#include "mbedtls/pk.h"
#include "mbedtls/ecp.h"
#include "mbedtls/ctr_drbg.h"
#include "mbedtls/entropy.h"
#include "mbedtls/x509_csr.h"
#include "mbedtls/x509_crt.h"
DNSServer dns;
static esp_err_t h(httpd_req_t* r) { return httpd_resp_send(r, "ok", HTTPD_RESP_USE_STRLEN); }
void setup() {
  mbedtls_pk_context pk; mbedtls_pk_init(&pk);
  mbedtls_entropy_context e; mbedtls_entropy_init(&e);
  mbedtls_ctr_drbg_context d; mbedtls_ctr_drbg_init(&d);
  mbedtls_ctr_drbg_seed(&d, mbedtls_entropy_func, &e, nullptr, 0);
  mbedtls_pk_setup(&pk, mbedtls_pk_info_from_type(MBEDTLS_PK_ECKEY));
  mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1, mbedtls_pk_ec(pk), mbedtls_ctr_drbg_random, &d);
  mbedtls_x509write_csr csr; mbedtls_x509write_csr_init(&csr);
  mbedtls_x509write_csr_set_md_alg(&csr, MBEDTLS_MD_SHA256);
  mbedtls_x509write_csr_set_key(&csr, &pk);
  mbedtls_x509write_csr_set_subject_name(&csr, "CN=sensor.paytonpittsdesigns.com");
  static unsigned char buf[2048];
  mbedtls_x509write_csr_pem(&csr, buf, sizeof(buf), mbedtls_ctr_drbg_random, &d);
  httpd_ssl_config_t c = HTTPD_SSL_CONFIG_DEFAULT();
  c.servercert = buf; c.servercert_len = 10; c.prvtkey_pem = buf; c.prvtkey_len = 10;
  httpd_handle_t s = nullptr; httpd_ssl_start(&s, &c);
  httpd_uri_t u = { .uri = "/", .method = HTTP_GET, .handler = h, .user_ctx = nullptr };
  httpd_register_uri_handler(s, &u);
  mbedtls_x509_crt crt; mbedtls_x509_crt_init(&crt);
  Serial.println(crt.valid_to.year);
  dns.start(53, "sensor.paytonpittsdesigns.com", WiFi.softAPIP());
}
void loop() { dns.processNextRequest(); }
