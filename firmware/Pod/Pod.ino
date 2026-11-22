/*
  PAYTON'S LiDAR SENSOR: the waist pod. Seeed XIAO ESP32-S3 + BMI160, on a 1" strap.

  It records motion and hands each jump to the LiDAR sensor; the app works out the height (src/pod.js).
    - reads the BMI160 1600 times a second through its FIFO, averages each 4 (an average keeps the exact change in
      speed, so sharp landings add up right), applies the 6-side calibration, keeps the last 20 s in memory (400/s)
    - a jump is "in the air, then still for 1 s": it sends the last 14 s to the sensor (POST /pod/push)
    - checks in with the sensor every second (/pod/hello) and picks up commands from the app: calibrate a side,
      send now, update its own firmware
    - sleeps after 10 minutes without moving; moving it wakes it (BMI160 any-motion on INT1)

  Wiring (BMI160 7-pin row → XIAO)
    3V3 → 3V3 · GND → GND · SDA → D4 · SCL → D5 · CS → 3V3 (I2C mode) · SAO → GND (address 0x68) · INT1 → D2
  Battery: the EEMB cell to the BAT+ / BAT- pads under the XIAO (it charges through the USB-C).

  Arduino IDE: board "XIAO_ESP32S3", PSRAM "OPI PSRAM". After the first USB flash, update from the app
  (Settings → Waist pod → Update) or from the IDE over Wi-Fi (network port "speedpod", password vault1234).
*/
#include <WiFi.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <ArduinoOTA.h>
#include <Wire.h>
#include <Preferences.h>
#include <esp_sleep.h>

static const char* FW = "pod-1.1";
static const char* SSID = "SpeedLidar";
static const char* PASS = "vault1234";
static const char* SENSOR = "http://192.168.4.1";
static const int PIN_SDA = 5, PIN_SCL = 6;   // D4, D5
static const int PIN_INT = 3;                // D2 (RTC pin: wakes it from sleep)
static const int PIN_LED = 21;               // the XIAO's yellow LED, on when LOW
static const int HZ = 400, OVER = 4;         // samples kept per second; chip readings averaged into each
static const int RING_S = 20, SEND_S = 14;   // seconds kept; seconds sent with each jump
static const uint32_t SLEEP_MS = 10UL * 60 * 1000;

// one kept sample: calibrated, in the chip's own units (accel 1/2048 g at ±16 g, gyro 1/16.4 °/s at ±2000 °/s)
struct Sample { int16_t a[3], g[3]; };
static const float ACC_LSB = 9.80665f / 2048.f, GYR_LSB = (3.14159265f / 180.f) / 16.4f;   // → m/s², rad/s
static const int RING = HZ * RING_S;
Sample* ring = nullptr;
volatile uint32_t head = 0;                   // total samples ever written (ring index = head % RING)

Preferences prefs;
uint8_t addr = 0x68;
volatile bool imuOk = false;
// calibration: per axis, raw offset and gain (from the 6 sides)
float calOff[3] = {0, 0, 0}, calGain[3] = {1, 1, 1};
bool calibrated = false;
float sideMean[6][3]; uint8_t sidesDone = 0;  // the 6-side readings so far (bit per side)

// ---------------- BMI160 ----------------
static bool wr(uint8_t r, uint8_t v) { Wire.beginTransmission(addr); Wire.write(r); Wire.write(v); return Wire.endTransmission() == 0; }
static bool rd(uint8_t r, uint8_t* b, size_t n) {
  Wire.beginTransmission(addr); Wire.write(r); if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((int)addr, (int)n) != (int)n) return false;
  for (size_t i = 0; i < n; i++) b[i] = Wire.read();
  return true;
}
bool imuBegin() {
  for (uint8_t a : {(uint8_t)0x68, (uint8_t)0x69}) {
    addr = a; uint8_t id = 0;
    if (!rd(0x00, &id, 1) || id != 0xD1) continue;
    wr(0x7E, 0xB6); delay(30);                 // soft reset
    wr(0x7E, 0x11); delay(10);                 // accelerometer on
    wr(0x7E, 0x15); delay(90);                 // gyro on
    wr(0x40, 0x2C); wr(0x41, 0x0C);            // accel 1600 Hz, normal filter, ±16 g
    wr(0x42, 0x2C); wr(0x43, 0x00);            // gyro 1600 Hz, normal filter, ±2000 °/s
    wr(0x47, 0xC0);                            // FIFO: gyro + accel frames, no headers
    // any-motion on INT1 (latched): wakes the pod from sleep
    wr(0x5F, 0x01); wr(0x60, 0x08);            // 2 samples over 0.25 g
    wr(0x53, 0x0A); wr(0x54, 0x0F);            // INT1 on, active high, push-pull; latched
    wr(0x55, 0x04); wr(0x50, 0x07);            // any-motion → INT1; enable on x, y, z
    wr(0x7E, 0xB1);                            // clear the interrupt (it woke us)
    wr(0x7E, 0xB0); delay(5);                  // empty the FIFO
    return true;
  }
  return false;
}
// before sleeping: accel in low power at 25 Hz (any-motion keeps working), gyro off
void imuSleep() { wr(0x7E, 0xB1); wr(0x40, 0x86); wr(0x7E, 0x12); delay(5); wr(0x7E, 0x14); delay(5); }

// ---------------- reading: FIFO → averages of 4 → ring ----------------
volatile uint32_t lastMove = 0;               // millis() of the last sample that wasn't still
volatile uint32_t flightAt = 0;               // head when the last flight started (0 = none waiting)
volatile uint32_t stillRun = 0, ffRun = 0;    // consecutive still / free-fall samples
volatile bool sendNow = false;
volatile int calSide = -1;                    // a side being measured (0..5), or -1
float calAcc[3]; int calN = 0;

void onSample(const int32_t acc[3], const int32_t gyr[3]) {   // sums of OVER raw readings
  Sample s; float af[3], gm = 0, am;
  for (int k = 0; k < 3; k++) {
    float raw = acc[k] / (float)OVER;
    if (calSide >= 0) calAcc[k] += raw;
    float c = (raw - calOff[k]) * calGain[k];
    af[k] = c; s.a[k] = (int16_t)lrintf(fmaxf(-32768.f, fminf(32767.f, c)));
    float g = gyr[k] / (float)OVER; s.g[k] = (int16_t)lrintf(g); gm += g * g;
  }
  if (calSide >= 0) calN++;
  ring[head % RING] = s; head = head + 1;
  // still / free fall, on the same lines as the app's math
  am = sqrtf(af[0] * af[0] + af[1] * af[1] + af[2] * af[2]) / 2048.f;   // in g
  float wdps = sqrtf(gm) / 16.4f;
  bool still = wdps < 14.f && fabsf(am - 1.f) < 0.08f;
  bool ff = am < 0.3f;
  stillRun = still ? stillRun + 1 : 0;
  ffRun = ff ? ffRun + 1 : 0;
  if (!still) lastMove = millis();
  if (ffRun == 32) flightAt = head - 32;          // 80 ms in the air: a flight
  if (flightAt && stillRun >= (uint32_t)HZ) {     // then 1 s still: send it
    sendNow = true; flightAt = 0;
  }
}
void readerTask(void*) {
  static uint8_t buf[240];
  int32_t acc[3] = {0, 0, 0}, gyr[3] = {0, 0, 0}; int n = 0;
  for (;;) {
    if (!imuOk) { vTaskDelay(pdMS_TO_TICKS(200)); continue; }
    uint8_t lb[2];
    if (!rd(0x22, lb, 2)) { vTaskDelay(pdMS_TO_TICKS(5)); continue; }
    int len = (lb[0] | (lb[1] & 0x07) << 8);
    if (len >= 1000) { wr(0x7E, 0xB0); n = 0; continue; }   // overflowed: start clean
    len -= len % 12;
    while (len > 0) {
      int take = len > (int)sizeof buf ? (int)sizeof buf - (int)sizeof buf % 12 : len;
      if (!rd(0x24, buf, take)) break;
      for (int i = 0; i < take; i += 12) {
        // headerless frame: gyro x y z, then accel x y z (little-endian int16)
        for (int k = 0; k < 3; k++) { gyr[k] += (int16_t)(buf[i + 2 * k] | buf[i + 2 * k + 1] << 8); acc[k] += (int16_t)(buf[i + 6 + 2 * k] | buf[i + 7 + 2 * k] << 8); }
        if (++n == OVER) { onSample(acc, gyr); acc[0] = acc[1] = acc[2] = gyr[0] = gyr[1] = gyr[2] = 0; n = 0; }
      }
      len -= take;
    }
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

// ---------------- 6-side calibration ----------------
// Set the pod on each of its 6 sides in turn (any order). For each axis, the side where it points up and the side
// where it points down give its offset (the middle) and gain (1 g each way).
const char* calibrateSide(int side) {
  calAcc[0] = calAcc[1] = calAcc[2] = 0; calN = 0; calSide = side;
  uint32_t t0 = millis(); bool moved = false;
  while (millis() - t0 < 1500) { if (stillRun == 0 && millis() - t0 > 200) moved = true; delay(10); }
  calSide = -1;
  if (moved || calN < 200) return "moved";
  for (int k = 0; k < 3; k++) sideMean[side][k] = calAcc[k] / calN;
  sidesDone |= 1 << side;
  if (sidesDone != 0x3F) return "ok";
  // all 6: find, for each axis, its most positive and most negative reading
  float off[3], gain[3];
  for (int k = 0; k < 3; k++) {
    float hi = -1e9, lo = 1e9;
    for (int s = 0; s < 6; s++) { hi = fmaxf(hi, sideMean[s][k]); lo = fminf(lo, sideMean[s][k]); }
    if (hi < 1600 || lo > -1600) { sidesDone = 0; return "sides"; }   // some axis never pointed up or down: redo
    off[k] = (hi + lo) / 2; gain[k] = 2 * 2048.f / (hi - lo);
  }
  memcpy(calOff, off, sizeof off); memcpy(calGain, gain, sizeof gain); calibrated = true;
  prefs.putBytes("off", calOff, sizeof calOff); prefs.putBytes("gain", calGain, sizeof calGain); prefs.putBool("cal", true);
  sidesDone = 0;
  return "done";
}

// ---------------- talking to the sensor ----------------
uint32_t seq = 0; String lastMsg = "";
// the last SEND_S seconds as one message: a 32-byte header, then the samples
bool pushCapture() {
  uint32_t h = head, count = min<uint32_t>(h, (uint32_t)HZ * SEND_S);
  size_t len = 32 + count * sizeof(Sample);
  uint8_t* buf = (uint8_t*)ps_malloc(len); if (!buf) return false;
  struct __attribute__((packed)) { char magic[4]; uint16_t ver, hz; uint32_t count, seq, flags; float accLsb, gyrLsb; uint32_t pad; } hd =
    {{'P', 'O', 'D', '1'}, 1, (uint16_t)HZ, count, ++seq, (uint32_t)((calibrated ? 1 : 0) | 2 /* averaged */), ACC_LSB, GYR_LSB, 0};
  memcpy(buf, &hd, 32);
  for (uint32_t i = 0; i < count; i++) ((Sample*)(buf + 32))[i] = ring[(h - count + i) % RING];
  HTTPClient http; http.begin(String(SENSOR) + "/pod/push"); http.addHeader("Content-Type", "application/octet-stream"); http.setTimeout(8000);
  int code = http.POST(buf, len); http.end(); free(buf);
  return code == 200;
}
// what the jumper is doing, for the app's live screen: 0 moving · 1 standing still (ready) · 2 in the air · 3 landed
uint8_t phaseNow() {
  if (flightAt) return ffRun > 0 ? 2 : 3;
  return stillRun >= (uint32_t)(HZ / 2) ? 1 : 0;
}
void hello() {
  HTTPClient http; http.setTimeout(1500);
  char q[200];
  snprintf(q, sizeof q, "%s/pod/hello?fw=%s&imu=%d&cal=%d&sides=%u&rssi=%d&still=%d&ph=%u&up=%lu&msg=%s", SENSOR, FW, imuOk ? 1 : 0, calibrated ? 1 : 0,
           (unsigned)sidesDone, WiFi.RSSI(), stillRun >= (uint32_t)HZ ? 1 : 0, (unsigned)phaseNow(), (unsigned long)(millis() / 1000), lastMsg.c_str());
  http.begin(q);
  if (http.GET() != 200) { http.end(); return; }
  String r = http.getString(); http.end();
  lastMsg = "";
  // commands: {"cmd":"cal","side":3} · {"cmd":"send"} · {"cmd":"update"} · {"cmd":"uncal"}
  if (r.indexOf("\"cal\"") >= 0) { int i = r.indexOf("\"side\":"); int side = i >= 0 ? r.substring(i + 7).toInt() : -1; if (side >= 0 && side < 6) lastMsg = String("cal") + side + ":" + calibrateSide(side); }
  else if (r.indexOf("\"send\"") >= 0) sendNow = true;
  else if (r.indexOf("\"uncal\"") >= 0) { calibrated = false; for (int k = 0; k < 3; k++) { calOff[k] = 0; calGain[k] = 1; } prefs.putBool("cal", false); sidesDone = 0; lastMsg = "uncal:ok"; }
  else if (r.indexOf("\"update\"") >= 0) {
    digitalWrite(PIN_LED, LOW);
    WiFiClient c; httpUpdate.rebootOnUpdate(true);
    t_httpUpdate_return res = httpUpdate.update(c, String(SENSOR) + "/pod/fw.bin");
    lastMsg = res == HTTP_UPDATE_OK ? "update:ok" : "update:failed";
  }
}

void goToSleep() {
  digitalWrite(PIN_LED, HIGH);
  imuSleep();
  esp_sleep_enable_ext0_wakeup((gpio_num_t)PIN_INT, 1);
  esp_deep_sleep_start();
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT); digitalWrite(PIN_LED, LOW);
  pinMode(PIN_INT, INPUT);
  ring = (Sample*)ps_malloc(RING * sizeof(Sample));
  if (!ring) ring = (Sample*)malloc(RING * sizeof(Sample));   // PSRAM off in the IDE: still works, from RAM
  prefs.begin("pod", false);
  if (prefs.getBool("cal", false) && prefs.getBytesLength("off") == sizeof calOff) {
    prefs.getBytes("off", calOff, sizeof calOff); prefs.getBytes("gain", calGain, sizeof calGain); calibrated = true;
  }
  Wire.setBufferSize(256);
  Wire.begin(PIN_SDA, PIN_SCL, 1000000);       // the BMI160 does 1 MHz
  imuOk = imuBegin();
  if (!imuOk) Serial.println("No BMI160: check its wires");
  lastMove = millis();
  xTaskCreatePinnedToCore(readerTask, "imu", 4096, nullptr, 5, nullptr, 1);
  WiFi.mode(WIFI_STA); WiFi.setHostname("speedpod"); WiFi.begin(SSID, PASS);
  ArduinoOTA.setHostname("speedpod"); ArduinoOTA.setPassword(PASS); ArduinoOTA.begin();
}

void loop() {
  static uint32_t helloAt = 0, ledAt = 0;
  uint32_t now = millis();
  ArduinoOTA.handle();
  bool up = WiFi.status() == WL_CONNECTED;
  // LED: slow blink looking for the sensor; a short blip every 2 s once connected
  if (!up) digitalWrite(PIN_LED, (now / 500) % 2 ? HIGH : LOW);
  else { if (now - ledAt > 2000) ledAt = now; digitalWrite(PIN_LED, now - ledAt < 60 ? LOW : HIGH); }
  if (up && sendNow) { sendNow = false; digitalWrite(PIN_LED, LOW); bool ok = pushCapture(); lastMsg = ok ? "sent" : "send:failed"; helloAt = 0; }
  // check in every second, and straight away when the jumper's phase changes (the app's live screen)
  static uint8_t lastPh = 255; uint8_t ph = phaseNow();
  if (up && (now - helloAt > 1000 || (ph != lastPh && now - helloAt > 40))) { helloAt = now; lastPh = ph; hello(); }
  if (!up && now % 10000 < 20) WiFi.reconnect();
  if (now - lastMove > SLEEP_MS) goToSleep();
  delay(10);
}
