/*
  PAYTON'S LiDAR SENSOR — top speed, last-5 m speed and every left, from one LiDAR on a tripod.

  Hardware
    - ESP32 dev board (classic ESP32-WROOM-32, e.g. "ESP32 DevKitC")
    - Benewake TF03-100 (standard UART/CAN version — NOT RS485/RS232/4-20mA)

  Wiring (TF03 cable colours)
    red    +5V  -> ESP32 5V / VIN
    black  GND  -> ESP32 GND
    brown  TX   -> ESP32 GPIO16
    blue   RX   -> ESP32 GPIO17
    Power the ESP32 from a USB power bank.

  Use
    1. Power on. Join Wi-Fi "SpeedLidar" (password vault1234).
    2. Open http://192.168.4.1 on your phone.
    3. Pick sprint or vault and who's running, tap Start.
    4. The sensor only arms when an athlete STANDS STILL in front of it:
         sprint: within 5 m of the sensor for 1.5 s
         vault:  anywhere on the runway (not the last 40 ft before the box) for 2 s
       People walking past never arm it. The phone plays a chime when it's armed.
    5. Go. Recording starts on the first fast movement and stops on its own:
         sprint: just past the target distance
         vault:  after the takeoff (nothing past the box is ever used)

  Arduino IDE: Board = "ESP32 Dev Module". No extra libraries needed.
               Tools → Partition Scheme → "Huge APP (3MB No OTA/1MB SPIFFS)"
               (the phone app with its report font is built into the sketch, so give it room).
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
static const uint16_t MAX_VALID_CM  = 9900;          // TF03-100: 9900, TF03-180: 17900
static const uint32_t MAX_SAMPLES   = 15000;         // 15 s at 1000 Hz (long approach ≈ 6–7 s)
static const uint32_t STOP_WINDOW   = 1500;          // 1.5 s with no target / no movement ends a run
static const uint16_t MOVE_START_CM = 250;           // run "starts" when you gain 2.5 m...
static const uint32_t MOVE_WINDOW   = 500;           // ...within 0.5 s (5 m/s) — walking or jogging won't trigger it
static const uint32_t PRE_ROLL      = 2000;          // keep 2 s of data before the run starts
static const uint16_t STILL_CM      = 40;            // "standing still" = staying within ±40 cm
static const uint32_t STILL_GAP_MS  = 150;           // short dropouts allowed while standing (arm swing, a pole)
static const uint32_t AWAY_MS       = 1500;          // armed but nobody at the start for this long → wait again

// states the phone sees
enum { ST_IDLE = 0, ST_WAIT = 1, ST_SET = 2, ST_RUN = 3, ST_DONE = 4 };

WebServer server(80);

uint32_t* tBuf = nullptr;   // ESP32 time of each reading (microseconds)
uint16_t* dBuf = nullptr;   // distance (cm)
uint16_t* sBuf = nullptr;   // signal strength

volatile uint8_t  state     = ST_IDLE;
volatile uint32_t sets      = 0;      // how many times it has armed (the phone chimes when this goes up)
volatile uint32_t nSamples  = 0;
volatile uint32_t goIdx     = 0;      // sample index where the run was confirmed
volatile bool     recording = false;
volatile bool     moved     = false;
volatile bool     resetRun  = false;
volatile bool     resetWait = false;
volatile uint32_t stopCm    = 0;      // sprint: stop this far past the start position (0 = stop on its own)
volatile uint16_t limitCm   = MAX_VALID_CM;   // vault: nothing at or past the box is used
volatile uint16_t gateCm    = 0;      // standing only counts closer than this (0 = anywhere)
volatile uint32_t holdMs    = 1500;   // how long to stand still to arm
volatile uint16_t liveDist  = 0;
volatile uint16_t liveStr   = 0;
volatile uint32_t liveRate  = 0;
volatile uint32_t badFrames = 0;

static inline bool validCm(uint16_t d) { return d > 10 && d < limitCm; }

// ---------------- arming: an athlete has to stand still at the start ----------------
// returns true once someone has stood within the gate, still, for holdMs
bool standCheck(uint32_t nowMs, uint16_t d) {
  static uint16_t anchor = 0, off = 0;
  static uint32_t since = 0, lastOk = 0;
  if (resetWait) { resetWait = false; anchor = 0; since = 0; lastOk = 0; off = 0; }
  bool inZone = validCm(d) && (gateCm == 0 || d < gateCm);
  if (!inZone) {
    if (since && nowMs - lastOk > STILL_GAP_MS) since = 0;   // left, or someone walked through
    return false;
  }
  lastOk = nowMs;
  if (!since) { anchor = d; since = nowMs; off = 0; return false; }
  if (d > anchor + STILL_CM || d + STILL_CM < anchor) {
    // one odd reading (arm, pole, noise) doesn't count; 60 ms in a row away from the spot means they moved
    if (++off > 60) { anchor = d; since = nowMs; off = 0; }
    return false;
  }
  off = 0;
  return nowMs - since >= holdMs;
}

// ---------------- recording ----------------
void storeSample(uint32_t now, uint16_t d, uint16_t s) {
  static uint32_t lostCount = 0;
  static uint16_t fastCount = 0;   // consecutive readings that look like sprinting
  static uint32_t stopAt    = 0;   // distance (cm) where a sprint test ends
  static uint32_t tail      = 0;   // readings kept after the target, so the finish isn't cut short
  static uint32_t away      = 0;   // armed, but nobody standing at the start

  if (resetRun) {               // armed: start a fresh buffer
    resetRun = false;
    nSamples = 0; moved = false; lostCount = 0; fastCount = 0; stopAt = 0; tail = 0; away = 0; goIdx = 0;
  }
  if (nSamples >= MAX_SAMPLES) { recording = false; state = ST_DONE; return; }

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
          moved = true; state = ST_RUN; goIdx = nSamples;
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
    // Armed and waiting at the start. If the athlete walks off (or out of the zone) instead of running,
    // go back to waiting so the next person has to stand in again.
    bool atStart = validCm(d) && (gateCm == 0 || d < gateCm + 200);
    // (a stray close reading doesn't count as being back at the start: needs 30 ms in a row)
    static uint16_t backCnt = 0;
    if (atStart) { if (++backCnt > 30) away = 0; } else { backCnt = 0; away++; }
    if (away >= AWAY_MS) { recording = false; resetWait = true; state = ST_WAIT; return; }
    // only keep the most recent PRE_ROLL samples
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
  if (tail >= 300) { recording = false; state = ST_DONE; return; }

  // Run in progress: stop when the target is lost or nothing moves for 1.5 s
  // (vault: after takeoff the athlete is past the box, which counts as lost).
  if (lostCount >= STOP_WINDOW) { recording = false; state = ST_DONE; return; }
  if (nSamples > STOP_WINDOW && nSamples % 100 == 0 && validCm(d)) {
    uint32_t off = 0;
    for (uint32_t i = nSamples - STOP_WINDOW; i < nSamples; i++) {
      uint16_t x = dBuf[i];
      if (!validCm(x) || x > d + 30 || x + 30 < d) off++;
    }
    if (off < STOP_WINDOW / 20) { recording = false; state = ST_DONE; }
  }
}

// one reading from the sensor
void onFrame(uint32_t nowUs, uint16_t d, uint16_t s) {
  if (state == ST_WAIT && standCheck(nowUs / 1000, d)) {
    resetRun = true; recording = true; state = ST_SET; sets++;
  }
  if (recording) storeSample(nowUs, d, s);
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
      onFrame(now, d, s);
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

// /live            → sensor status
// /live?from=N     → also the run so far: up to 150 points (every 20th reading = 50 per second) from sample N
void handleLive() {
  static char json[3200];
  uint16_t d = liveDist;
  int len = snprintf(json, sizeof(json),
           "{\"d\":%u,\"s\":%u,\"rate\":%lu,\"rec\":%s,\"moved\":%s,\"n\":%lu,\"bad\":%lu,\"max\":%u,\"state\":%u,\"sets\":%lu,\"go\":%lu,\"in\":%s",
           d, liveStr, (unsigned long)liveRate, recording ? "true" : "false", moved ? "true" : "false",
           (unsigned long)nSamples, (unsigned long)badFrames, (unsigned)limitCm, (unsigned)state, (unsigned long)sets, (unsigned long)goIdx,
           (validCm(d) && (gateCm == 0 || d < gateCm)) ? "true" : "false");
  if (server.hasArg("from") && (state == ST_RUN || state == ST_DONE) && nSamples) {
    uint32_t from = (uint32_t)server.arg("from").toInt(), n = nSamples, i = from, k = 0;
    len += snprintf(json + len, sizeof(json) - len, ",\"t0\":%lu,\"pts\":[", (unsigned long)tBuf[0]);
    for (; i < n && k < 150 && len < (int)sizeof(json) - 40; i += 20, k++)
      len += snprintf(json + len, sizeof(json) - len, "%s[%lu,%u]", k ? "," : "", (unsigned long)((tBuf[i] - tBuf[0]) / 1000), dBuf[i]);
    len += snprintf(json + len, sizeof(json) - len, "],\"next\":%lu", (unsigned long)i);
  }
  snprintf(json + len, sizeof(json) - len, "}");
  server.sendHeader("Cache-Control", "no-store");
  server.send(200, "application/json", json);
}

// /arm?stop=3150&gate=500&hold=1500&max=9900
//   stop: sprint ends this far (cm) past the start (0 = vault, stops by itself)
//   gate: athlete must stand closer than this (cm) to arm (0 = anywhere)
//   hold: how long to stand still (ms) · max: ignore everything at or past this (cm), e.g. the box
//   now=1: skip the stand-still check and arm straight away
void handleArm() {
  recording = false;
  delay(5);
  stopCm  = server.hasArg("stop") ? (uint32_t)server.arg("stop").toInt() : 0;
  gateCm  = server.hasArg("gate") ? (uint16_t)server.arg("gate").toInt() : 0;
  holdMs  = server.hasArg("hold") ? (uint32_t)server.arg("hold").toInt() : 1500;
  uint32_t mx = server.hasArg("max") ? (uint32_t)server.arg("max").toInt() : MAX_VALID_CM;
  limitCm = (uint16_t)(mx > 10 && mx < MAX_VALID_CM ? mx : MAX_VALID_CM);
  nSamples = 0; moved = false; goIdx = 0;
  resetWait = true;
  if (server.hasArg("now")) { resetRun = true; recording = true; state = ST_SET; sets++; }
  else state = ST_WAIT;
  server.send(200, "text/plain", "waiting");
}

void handleStop() {
  recording = false;
  state = ST_IDLE;
  server.send(200, "text/plain", "stopped");
}

void handleData() {
  recording = false;
  delay(5);
  uint32_t n = nSamples;
  server.sendHeader("Cache-Control", "no-store");
  server.setContentLength(8 + (size_t)n * 8);
  server.send(200, "application/octet-stream", "");
  uint32_t hdr[2] = {n, (uint32_t)limitCm};
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
