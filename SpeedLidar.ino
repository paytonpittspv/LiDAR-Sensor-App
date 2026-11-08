/*
  SpeedLidar — top speed and last-5 m speed from one LiDAR on a tripod.

  Hardware
    - ESP32 dev board (classic ESP32-WROOM-32, e.g. "ESP32 DevKitC")
    - Benewake TF03-100 (standard UART/CAN version — NOT RS485/RS232/4-20mA)
      Also works unchanged with a TF02-Pro (same serial protocol, wider beam,
      shorter range — set MAX_VALID_CM to 3900).

  Wiring (confirm wire colours in the TF03 manual before powering up)
    TF03 +5V  -> ESP32 5V / VIN
    TF03 GND  -> ESP32 GND
    TF03 TX   -> ESP32 GPIO16
    TF03 RX   -> ESP32 GPIO17
    Power the ESP32 from a USB power bank.

  Use
    1. Power on. Join Wi-Fi "SpeedLidar" (password vault1234).
    2. Open http://192.168.4.1 on your phone.
    3. Aim the tripod straight down the runway at lower-back height.
    4. Tap ARM, walk to your start, run. The run stops on its own and the
       results appear. In Solo mode the phone re-arms itself and reads your
       speed out loud after every rep.

  Arduino IDE: Board = "ESP32 Dev Module". No extra libraries needed.
*/

#include <WiFi.h>
#include <WebServer.h>
#include "page.h"

// ---------------- settings ----------------
static const char*    AP_SSID       = "SpeedLidar";
static const char*    AP_PASS       = "vault1234";   // 8+ characters
static const int      PIN_LIDAR_RX  = 16;            // ESP32 receives on this pin (TF03 TX)
static const int      PIN_LIDAR_TX  = 17;            // ESP32 sends on this pin (TF03 RX)
static const uint16_t FRAME_RATE_HZ = 1000;          // readings per second
static const uint16_t MAX_VALID_CM  = 9900;          // TF03-100: 9900, TF03-180: 17900, TF02-Pro: 3900
static const uint32_t MAX_SAMPLES   = 15000;         // 15 s of running at 1000 Hz (long approach ≈ 6–7 s)
static const uint32_t STOP_WINDOW   = 1500;          // 1.5 s with no target / no movement ends a run
static const uint16_t MOVE_START_CM = 250;           // run "starts" when you gain 2.5 m...
static const uint32_t MOVE_WINDOW   = 500;           // ...within 0.5 s (5 m/s) — walking or jogging back won't trigger it
static const uint32_t PRE_ROLL      = 2000;          // keep 2 s of data before the run starts

WebServer server(80);

uint32_t* tBuf = nullptr;   // ESP32 time of each reading (microseconds)
uint16_t* dBuf = nullptr;   // distance (cm)
uint16_t* sBuf = nullptr;   // signal strength

volatile uint32_t nSamples  = 0;
volatile bool     recording = false;
volatile bool     moved     = false;
volatile bool     resetRun  = false;
volatile uint32_t stopCm    = 0;      // sprint: stop this far past the start position (0 = stop on its own)
volatile uint16_t liveDist  = 0;
volatile uint16_t liveStr   = 0;
volatile uint32_t liveRate  = 0;
volatile uint32_t badFrames = 0;

static inline bool validCm(uint16_t d) { return d > 10 && d < MAX_VALID_CM; }

// ---------------- recording ----------------
void storeSample(uint32_t now, uint16_t d, uint16_t s) {
  static uint32_t lostCount = 0;
  static uint16_t fastCount = 0;   // consecutive readings that look like sprinting
  static uint32_t stopAt    = 0;   // distance (cm) where a sprint test ends
  static uint32_t tail      = 0;   // readings kept after the target, so the finish isn't cut short

  if (resetRun) {               // new run requested from the phone
    resetRun = false;
    nSamples = 0;
    moved = false;
    lostCount = 0;
    fastCount = 0;
    stopAt = 0;
    tail = 0;
  }
  if (nSamples >= MAX_SAMPLES) { recording = false; return; }

  tBuf[nSamples] = now;
  dBuf[nSamples] = d;
  sBuf[nSamples] = s;
  nSamples++;

  if (validCm(d)) {
    lostCount = 0;
    if (!moved && nSamples > MOVE_WINDOW) {
      uint16_t back = dBuf[nSamples - 1 - MOVE_WINDOW];
      if (validCm(back) && d > back + MOVE_START_CM) {
        if (++fastCount >= 50) {
          moved = true;
          if (stopCm) {
            // start position = closest reading in the 1.5 s before the run was confirmed
            uint16_t start = 0xFFFF;
            uint32_t from = nSamples > 1500 ? nSamples - 1500 : 0;
            for (uint32_t i = from; i < nSamples; i++) if (validCm(dBuf[i]) && dBuf[i] < start) start = dBuf[i];
            stopAt = (start == 0xFFFF ? back : start) + stopCm;
          }
        }
      }
      else fastCount = 0;
    }
  } else {
    lostCount++;
  }

  if (!moved) {
    // Waiting at the start: only keep the most recent PRE_ROLL samples.
    if (nSamples >= PRE_ROLL + 1000) {
      memmove(tBuf, tBuf + 1000, PRE_ROLL * sizeof(uint32_t));
      memmove(dBuf, dBuf + 1000, PRE_ROLL * sizeof(uint16_t));
      memmove(sBuf, sBuf + 1000, PRE_ROLL * sizeof(uint16_t));
      nSamples = PRE_ROLL;
    }
    return;
  }

  // Sprint test: past the target distance → keep 0.3 s more, then stop.
  if (stopAt && validCm(d) && d >= stopAt) tail++;
  if (tail >= 300) { recording = false; return; }

  // Run in progress: stop when the target is lost or nothing moves for 1.5 s
  // (e.g. after takeoff the beam lands on the pit and stays still).
  if (lostCount >= STOP_WINDOW) { recording = false; return; }
  if (nSamples > STOP_WINDOW && nSamples % 100 == 0 && validCm(d)) {
    // "Still" = almost every reading in the last 1.5 s within 30 cm of the latest one
    // (a few stray spikes from arms or the pole are allowed).
    uint32_t off = 0;
    for (uint32_t i = nSamples - STOP_WINDOW; i < nSamples; i++) {
      uint16_t x = dBuf[i];
      if (!validCm(x) || x > d + 30 || x + 30 < d) off++;
    }
    if (off < STOP_WINDOW / 20) recording = false;
  }
}

// ---------------- LiDAR reader (own task so Wi-Fi never delays it) ----------------
void lidarTask(void*) {
  uint8_t  buf[9];
  int      idx = 0;
  uint32_t frames = 0;
  uint32_t rateT0 = micros();

  for (;;) {
    while (Serial2.available()) {
      uint8_t b = Serial2.read();
      if (idx == 0 && b != 0x59) continue;            // frame header 0x59 0x59
      if (idx == 1 && b != 0x59) { idx = 0; continue; }
      buf[idx++] = b;
      if (idx < 9) continue;
      idx = 0;

      uint8_t sum = 0;
      for (int i = 0; i < 8; i++) sum += buf[i];
      if (sum != buf[8]) { badFrames++; continue; }

      uint32_t now = micros();
      uint16_t d = buf[2] | (buf[3] << 8);
      uint16_t s = buf[4] | (buf[5] << 8);
      liveDist = d;
      liveStr  = s;
      frames++;
      if (recording) storeSample(now, d, s);
    }
    uint32_t now = micros();
    if (now - rateT0 >= 1000000) { liveRate = frames; frames = 0; rateT0 = now; }
    vTaskDelay(1);
  }
}

void configureLidar() {
  // Set frame rate: 5A 06 03 LL HH checksum (not saved to flash; sent every boot)
  uint8_t cmd[6] = {0x5A, 0x06, 0x03, (uint8_t)(FRAME_RATE_HZ & 0xFF), (uint8_t)(FRAME_RATE_HZ >> 8), 0};
  uint8_t sum = 0;
  for (int i = 0; i < 5; i++) sum += cmd[i];
  cmd[5] = sum;
  Serial2.write(cmd, sizeof(cmd));
  delay(100);
  while (Serial2.available()) Serial2.read();   // discard the reply
}

// ---------------- web ----------------
void handleRoot() {
  server.sendHeader("Cache-Control", "no-store");
  server.send_P(200, "text/html", PAGE_HTML);
}

void handleLive() {
  char json[200];
  snprintf(json, sizeof(json),
           "{\"d\":%u,\"s\":%u,\"rate\":%lu,\"rec\":%s,\"moved\":%s,\"n\":%lu,\"bad\":%lu,\"max\":%u}",
           liveDist, liveStr, (unsigned long)liveRate, recording ? "true" : "false",
           moved ? "true" : "false", (unsigned long)nSamples, (unsigned long)badFrames, MAX_VALID_CM);
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", json);
}

void handleArm() {
  recording = false;
  delay(5);
  // /arm?stop=3150 → sprint test that ends 31.5 m past the start (the app adds a small margin)
  stopCm = server.hasArg("stop") ? (uint32_t)server.arg("stop").toInt() : 0;
  resetRun = true;
  nSamples = 0;
  moved = false;
  recording = true;
  server.send(200, "text/plain", "armed");
}

void handleStop() {
  recording = false;
  server.send(200, "text/plain", "stopped");
}

void handleData() {
  recording = false;
  delay(5);
  uint32_t n = nSamples;
  server.sendHeader("Cache-Control", "no-store");
  server.setContentLength(8 + (size_t)n * 8);
  server.send(200, "application/octet-stream", "");
  uint32_t hdr[2] = {n, (uint32_t)MAX_VALID_CM};
  server.sendContent((const char*)hdr, sizeof(hdr));

  static uint8_t chunk[4096];
  uint32_t i = 0;
  while (i < n) {
    size_t len = 0;
    while (i < n && len + 8 <= sizeof(chunk)) {
      memcpy(chunk + len,     &tBuf[i], 4);
      memcpy(chunk + len + 4, &dBuf[i], 2);
      memcpy(chunk + len + 6, &sBuf[i], 2);
      len += 8;
      i++;
    }
    server.sendContent((const char*)chunk, len);
  }
}

void setup() {
  Serial.begin(115200);

  // Grab the big buffers before Wi-Fi takes its share of memory.
  tBuf = (uint32_t*)malloc(MAX_SAMPLES * sizeof(uint32_t));
  dBuf = (uint16_t*)malloc(MAX_SAMPLES * sizeof(uint16_t));
  sBuf = (uint16_t*)malloc(MAX_SAMPLES * sizeof(uint16_t));
  if (!tBuf || !dBuf || !sBuf) {
    Serial.println("Not enough memory — lower MAX_SAMPLES");
    while (true) delay(1000);
  }

  Serial2.setRxBufferSize(4096);
  Serial2.begin(115200, SERIAL_8N1, PIN_LIDAR_RX, PIN_LIDAR_TX);
  delay(500);
  configureLidar();

  WiFi.mode(WIFI_AP);
  WiFi.softAP(AP_SSID, AP_PASS);
  Serial.print("Open http://");
  Serial.println(WiFi.softAPIP());

  server.on("/", handleRoot);
  server.on("/live", handleLive);
  server.on("/arm", handleArm);
  server.on("/stop", handleStop);
  server.on("/data", handleData);
  server.begin();

  xTaskCreatePinnedToCore(lidarTask, "lidar", 4096, nullptr, 3, nullptr, 1);
}

void loop() {
  server.handleClient();
  delay(1);
}
