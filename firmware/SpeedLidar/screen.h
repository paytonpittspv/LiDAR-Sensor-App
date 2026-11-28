// The sensor's 1.9" screen: draws every screen of the Screen Lab's Bold style into a 320 × 170 frame.
// Plain C++ with no Arduino calls, so the same code can be previewed on a computer (firmware/preview).
#pragma once
#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include <math.h>
#include "fonts.h"

namespace scr {

static const int W = 320, H = 170;

// ---------- colours (the app's, as in the Screen Lab) ----------
struct RGB { uint8_t r, g, b; };
static const RGB BG = {0x0b, 0x09, 0x15}, LINE = {0x2b, 0x25, 0x46}, FG = {0xf4, 0xf1, 0xff}, DIM = {0x9c, 0x95, 0xb8},
                 PINK = {0xff, 0x2d, 0x8a}, PURPLE = {0x8b, 0x5c, 0xf6}, BLUE = {0x22, 0xb8, 0xff}, GREEN = {0x2b, 0xd4, 0x7d},
                 AMBER = {0xff, 0xb0, 0x20}, RED = {0xff, 0x4d, 0x4d}, CASE = {0x2a, 0x26, 0x36}, LOGO_LINE = {0xcf, 0xc8, 0xe6};
static inline uint16_t pack(RGB c) { return (uint16_t)(((c.r & 0xF8) << 8) | ((c.g & 0xFC) << 3) | (c.b >> 3)); }
static inline RGB unpack(uint16_t p) { uint8_t r = (p >> 11) & 31, g = (p >> 5) & 63, b = p & 31; return {(uint8_t)(r << 3 | r >> 2), (uint8_t)(g << 2 | g >> 4), (uint8_t)(b << 3 | b >> 2)}; }
static inline RGB mix(RGB a, RGB b, float k) { return {(uint8_t)(a.r + (b.r - a.r) * k), (uint8_t)(a.g + (b.g - a.g) * k), (uint8_t)(a.b + (b.b - a.b) * k)}; }
// pink → purple → blue, k = 0…1
static inline RGB grad(float k) { k = k < 0 ? 0 : k > 1 ? 1 : k; return k < .5f ? mix(PINK, PURPLE, k * 2) : mix(PURPLE, BLUE, (k - .5f) * 2); }

// ---------- the frame ----------
static uint16_t* fb = nullptr;   // W × H native RGB565, set by the firmware (lives in PSRAM)
static inline void blend(int x, int y, RGB c, float a) {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return;
  uint16_t& p = fb[y * W + x];
  p = a >= 1 ? pack(c) : pack(mix(unpack(p), c, a));
}
static void fill(RGB c) { uint16_t v = pack(c); for (int i = 0; i < W * H; i++) fb[i] = v; }
static void rect(int x, int y, int w, int h, RGB c) {
  uint16_t v = pack(c);
  for (int j = y < 0 ? 0 : y; j < y + h && j < H; j++) for (int i = x < 0 ? 0 : x; i < x + w && i < W; i++) fb[j * W + i] = v;
}
// rounded rectangle, smooth corners; gx0/gx1 >= 0 fills with the brand gradient across that x range instead
static void rrect(float x, float y, float w, float h, float r, RGB c, float gx0 = -1, float gx1 = -1) {
  if (w <= 0 || h <= 0) return;
  if (r > w / 2) r = w / 2; if (r > h / 2) r = h / 2;
  for (int j = (int)floorf(y); j < (int)ceilf(y + h); j++) for (int i = (int)floorf(x); i < (int)ceilf(x + w); i++) {
    float px = i + .5f, py = j + .5f;
    float cx = px < x + r ? x + r : px > x + w - r ? x + w - r : px, cy = py < y + r ? y + r : py > y + h - r ? y + h - r : py;
    float d = sqrtf((px - cx) * (px - cx) + (py - cy) * (py - cy));
    float a = r > 0 ? r + .5f - d : 1;
    // straight edges: partial coverage at fractional bounds
    float ex = fminf(px - x + .5f, x + w - px + .5f), ey = fminf(py - y + .5f, y + h - py + .5f);
    a = fminf(a, fminf(ex, ey)); if (a > 1) a = 1;
    blend(i, j, gx0 >= 0 ? grad((px - gx0) / (gx1 - gx0)) : c, a);
  }
}
// a thick line with round ends
static void capsule(float x0, float y0, float x1, float y1, float w, RGB c) {
  float r = w / 2, minx = fminf(x0, x1) - r - 1, maxx = fmaxf(x0, x1) + r + 1, miny = fminf(y0, y1) - r - 1, maxy = fmaxf(y0, y1) + r + 1;
  float dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy;
  for (int j = (int)miny; j <= (int)maxy; j++) for (int i = (int)minx; i <= (int)maxx; i++) {
    float px = i + .5f, py = j + .5f, t = L2 > 0 ? ((px - x0) * dx + (py - y0) * dy) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    float qx = x0 + t * dx - px, qy = y0 + t * dy - py, a = r + .5f - sqrtf(qx * qx + qy * qy);
    if (a > 0) blend(i, j, c, a > 1 ? 1 : a);
  }
}
// gauge arc from 0.8π to 2.2π (like the Screen Lab), round ends; useGrad colours it pink → blue along its length
static void arc(float cx, float cy, float r, float w, float frac, RGB c, bool useGrad = false) {
  const float A0 = 3.14159265f * .8f, SPAN = 3.14159265f * 1.4f;
  frac = frac < 0 ? 0 : frac > 1 ? 1 : frac;
  for (int pass = 0; pass < 2; pass++) {
    float a1 = A0 + SPAN * (pass ? frac : 1);
    if (pass && frac <= 0) break;
    float hx0 = cx + r * cosf(A0), hy0 = cy + r * sinf(A0), hx1 = cx + r * cosf(a1), hy1 = cy + r * sinf(a1);
    for (int j = (int)(cy - r - w); j <= (int)(cy + r + w); j++) for (int i = (int)(cx - r - w); i <= (int)(cx + r + w); i++) {
      float px = i + .5f - cx, py = j + .5f - cy, ang = atan2f(py, px); if (ang < 0) ang += 6.2831853f; if (ang < A0 - .0001f) ang += 6.2831853f;
      float d;
      if (ang <= a1) d = fabsf(sqrtf(px * px + py * py) - r);
      else { float d0 = hypotf(i + .5f - hx0, j + .5f - hy0), d1 = hypotf(i + .5f - hx1, j + .5f - hy1); d = fminf(d0, d1); }
      float a = w / 2 + .5f - d;
      if (a > 0) blend(i, j, pass ? (useGrad ? grad((ang - A0) / SPAN) : c) : LINE, a > 1 ? 1 : a);
    }
  }
}

// ---------- text ----------
static const Glyph* glyph(const Font& f, uint32_t cp) {
  int lo = 0, hi = f.n - 1;
  while (lo <= hi) { int m = (lo + hi) / 2; if (f.g[m].cp == cp) return &f.g[m]; if (f.g[m].cp < cp) lo = m + 1; else hi = m - 1; }
  return nullptr;
}
static uint32_t nextCp(const char*& s) {
  uint8_t c = (uint8_t)*s++;
  if (c < 0x80) return c;
  int n = c >= 0xF0 ? 3 : c >= 0xE0 ? 2 : 1; uint32_t cp = c & (0x3F >> n);
  while (n-- && *s) cp = (cp << 6) | ((uint8_t)*s++ & 0x3F);
  return cp;
}
static float measure(const Font& f, const char* s) {
  int adv = 0; while (*s) { const Glyph* g = glyph(f, nextCp(s)); if (!g) g = glyph(f, '?'); if (g) adv += g->adv; } return adv / 16.f;
}
enum Align { LEFT, CENTER, RIGHT };
// draws s with its baseline at y; colour c, or the brand gradient across gx0…gx1 when gx1 > gx0
static float text(const Font& f, const char* s, float x, float y, RGB c, Align al = LEFT, float gx0 = 0, float gx1 = 0) {
  float w = measure(f, s);
  if (al == CENTER) x -= w / 2; else if (al == RIGHT) x -= w;
  int pen = (int)lroundf(x * 16), by = (int)lroundf(y);
  while (*s) {
    const Glyph* g = glyph(f, nextCp(s)); if (!g) g = glyph(f, '?'); if (!g) continue;
    int gx = (pen + 8) / 16 + g->x, gy = by + g->y, rb = (g->w + 1) / 2;
    const uint8_t* p = f.bmp + g->off;
    for (int j = 0; j < g->h; j++) for (int i = 0; i < g->w; i++) {
      uint8_t v = p[j * rb + i / 2]; v = (i & 1) ? (v & 15) : (v >> 4);
      if (v) blend(gx + i, gy + j, gx1 > gx0 ? grad((gx + i - gx0) / (gx1 - gx0)) : c, v / 15.f);
    }
    pen += g->adv;
  }
  return w;
}

// a number with its unit tucked up at its top right (like a price tag). size picks the font; maxW shrinks it.
static const Font* numFonts[] = {&F_XB72, &F_XB58, &F_XB34, &F_XB24, &F_XB18};
static void bigNum(const char* v, float x, float y, int size, RGB col, const char* unit, Align al = LEFT, float maxW = 0) {
  int k = 0; while (k < 4 && numFonts[k]->size > size) k++;
  for (;;) {
    const Font* f = numFonts[k]; const Font* uf = f->size >= 50 ? &F_B20 : &F_B11;
    float w = measure(*f, v), uw = unit && *unit ? measure(*uf, unit) + 3 : 0;
    if (maxW && w + uw > maxW && k < 4) { k++; continue; }
    float x0 = al == CENTER ? x - (w + uw) / 2 : al == RIGHT ? x - w - uw : x;
    text(*f, v, x0, y, col);
    if (uw) text(*uf, unit, x0 + w + 3, y - f->size * .7f + uf->ascent, DIM);
    return;
  }
}

// ---------- what to show (filled in by the firmware) ----------
enum Screen : uint8_t { S_BOOT, S_WIFI, S_READY, S_ARMED, S_REC, S_SAVING, S_RESULT, S_NOLIDAR, S_UPDATE, S_AIM, S_ABOUT, S_LEVEL, S_JUMP, S_PAGE };
static const char* const SCREEN_NAMES[] = {"boot", "wifi", "ready", "armed", "rec", "saving", "result", "nolidar", "update", "aim", "about", "level", "jump", "page"};
struct Cell { char k[14], v[14], u[8]; };
struct Model {
  Screen screen = S_BOOT;
  uint32_t t = 0;                 // ms since this screen appeared (animations)
  int phones = 0, sig = 0;        // connected phones/iPads; beam return 0–100 %
  bool vault = true;              // distances in feet when true, metres for sprint
  bool armedCfg = false;          // a run has been set up from the app
  char evShort[24] = "";          // "VAULT" / "SPRINT"
  char evLine[32] = "";           // "Long · 150 ft" / "Stop at 30 m"
  char who[24] = "";
  float dist = 0; bool distOk = false;
  float hold = 0; bool inZone = false;
  float speed = 0, runDist = 0, runTarget = 0, runTime = 0;   // live run
  // result (sent by the app once it has worked the run out)
  char strip[28] = "RUN SAVED";
  char head[14] = "", headV[12] = "", headU[8] = "";
  Cell cells[4]; int nCells = 0;
  char footL[32] = "", footR[24] = "";
  // Wi-Fi help
  const char* ssid = ""; const char* pass = ""; const char* host = ""; const char* fw = "";
  int updatePct = 0;
  // About: how long it has been on, why it last started, how many times it has started
  uint32_t upS = 0; const char* reset = "power"; uint32_t boots = 0;
  // tilt sensor: the level, and whether the tripod was bumped since it was aimed
  bool imuOk = false, zeroed = false, bumped = false;
  float pitch = 0, roll = 0, levelAt = 30.48f, bumpDeg = 0; char bumpWhy[12] = "";
  // jump test (waist pods): who's up, which pod, their best today; live phase; the last result while the app shows it
  char jWho[24] = "", jPod[12] = "", jBest[8] = "", jNext[24] = "";
  int jPh = 0; float jV = 0; uint32_t jAirMs = 0;
  bool jRes = false; char jH[8] = "", jHs[8] = "", jHm[8] = "", jRWho[24] = "";
  // is the LiDAR sending? When it isn't, a small NO LIDAR mark sits at the right of the strip (no full-screen warning)
  bool lidar = true;
  // the app's page, mirrored in its simplest form: a title, one headline number, up to three small ones, a line of words
  char pgTitle[24] = "", pgK[24] = "", pgV[14] = "", pgU[8] = "", pgSub[44] = "";
  Cell pg[3]; int nPg = 0;
};

static void fmtFt(char* out, size_t n, float m) {
  float f = m * 3.28084f; if (f < 0) f = 0; int i = (int)f, in = (int)lroundf((f - i) * 12); if (in == 12) { i++; in = 0; }
  snprintf(out, n, "%d' %d\"", i, in);
}
static void fmtDist(const Model& M, char* out, size_t n, float m, int dp = 2) { if (M.vault) fmtFt(out, n, m); else snprintf(out, n, "%.*f", dp, m); }

// ---------- pieces ----------
static void strip(const Model& M, const char* label, RGB col) {
  rect(0, 0, W, 22, col);
  text(F_XB15, label, 8, 16, BG);
  if (!M.lidar) {   // no LiDAR: a dark pill with a red dot, like NO SENSOR in the app
    float w = measure(F_B11, "NO LIDAR") + 20, x = W - 6 - w;
    rrect(x, 3, w, 16, 8, BG); rrect(x + 5, 8, 6, 6, 3, RED); text(F_B11, "NO LIDAR", x + 14, 15, RED);
    char n[6]; snprintf(n, sizeof n, "%d", M.phones);
    text(F_B11, n, x - 15, 15, BG, RIGHT); rect(x - 12, 6, 6, 10, BG); rect(x - 11, 7, 4, 7, col);
    return;
  }
  // right: phones (number + a little phone) and the beam's signal bars
  char n[6]; snprintf(n, sizeof n, "%d", M.phones);
  text(F_B11, n, W - 50, 15, BG, RIGHT);
  rect(W - 47, 6, 6, 10, BG); rect(W - 46, 7, 4, 7, col);
  for (int i = 0; i < 4; i++) {
    int h = (i + 1) * 3; bool on = M.sig > i * 25 + 5;
    rect(W - 34 + i * 6, 16 - h, 4, h, on ? BG : mix(col, RGB{0, 0, 0}, .25f));
  }
}
static void foot(const char* l, const char* r) {
  rect(8, H - 20, W - 16, 1, LINE);
  text(F_S11, l, 8, H - 6, DIM); text(F_S11, r, W - 8, H - 6, DIM, RIGHT);
}
// the logo: the case side-on (purple lid, dark body, blue mount, speed lines)
static void logo(float x, float y, float s) {
  rrect(x, y, 54 * s, 8 * s, 3 * s, PURPLE); rrect(x, y + 10 * s, 54 * s, 22 * s, 4 * s, CASE); rrect(x + 19 * s, y + 34 * s, 16 * s, 6 * s, 1 * s, BLUE);
  const float L[3][2] = {{13, 14}, {21, 10}, {29, 14}};
  for (auto& l : L) capsule(x + 61 * s, y + l[0] * s, x + (61 + l[1]) * s, y + l[0] * s, 4 * s, LOGO_LINE);
}
static float pulse(uint32_t t, float period) { return .5f + .5f * sinf(t / period); }

// ---------- the screens ----------
static void drawBoot(const Model& M) {
  float k = M.t / 900.f; if (k > 1) k = 1;
  logo(W / 2 - 52, 30, 1.4f);
  const char* a = "PAYTON'S "; const char* b = "LiDAR "; const char* c = "SENSOR";
  float wa = measure(F_XB24, a), wb = measure(F_XB24, b), wc = measure(F_XB24, c), x = W / 2 - (wa + wb + wc) / 2;
  text(F_XB24, a, x, 116, FG); text(F_XB24, b, x + wa, 116, FG, LEFT, x + wa, x + wa + wb); text(F_XB24, c, x + wa + wb, 116, FG);
  rrect(80, 136, 160, 4, 2, LINE); rrect(80, 136, 160 * k, 4, 2, FG, 80, 240);
  text(F_S11, M.fw, W / 2, 158, DIM, CENTER);
}
static void drawWifi(const Model& M) {
  strip(M, "JOIN THE WI-FI", PURPLE);
  text(F_B11, "WI-FI", 10, 44, DIM); text(F_XB24, M.ssid, 10, 70, FG);
  text(F_B11, "PASSWORD", 170, 44, DIM); text(F_XB24, M.pass, 170, 70, FG);
  text(F_S13, "Then open the app, or", 10, 106, FG);
  text(F_S13, M.host, 10, 124, BLUE);
  foot("No phones connected yet", M.fw);
}
static void bumpNote(const Model& M, char* out, size_t n) {
  if (!strcmp(M.bumpWhy, "turned")) snprintf(out, n, "Turned %.1f\xC2\xB0 since aimed", M.bumpDeg);
  else if (!strcmp(M.bumpWhy, "leaned")) snprintf(out, n, "Leaned %.1f\xC2\xB0 since aimed", M.bumpDeg);
  else snprintf(out, n, "Nose %s %.1f\xC2\xB0 since aimed", M.bumpDeg > 0 ? "up" : "down", fabsf(M.bumpDeg));
}
static void drawReady(const Model& M) {
  strip(M, M.bumped ? "TRIPOD MOVED \xC2\xB7 CHECK AIM" : "READY", M.bumped ? AMBER : GREEN);
  char d[16]; fmtDist(M, d, sizeof d, M.dist);
  text(F_B13, "DISTANCE", 10, 44, DIM);
  bigNum(M.distOk ? d : "-", 10, 98, 64, FG, M.distOk && !M.vault ? "m" : "", LEFT, 180);
  text(F_B13, "NEXT", 200, 44, DIM);
  if (M.armedCfg) {
    text(F_XB18, M.evShort, 200, 64, FG);
    text(F_S13, M.evLine, 200, 82, DIM);
    text(F_S13, M.who, 200, 100, FG);
    if (M.inZone && M.hold > 0) {
      text(F_S13, "Hold still\xE2\x80\xA6", 10, 130, PINK);
      rrect(100, 123, 120, 6, 3, LINE); rrect(100, 123, 120 * M.hold, 6, 3, FG, 100, 220);
    } else text(F_S13, "Stand at the start to arm", 10, 130, GREEN);
  } else {
    text(F_XB18, "SET UP", 200, 64, FG);
    text(F_S13, "a run in the app", 200, 82, DIM);
    text(F_S13, "Aim at the start mark", 10, 130, DIM);
  }
  char l[40]; if (M.bumped) bumpNote(M, l, sizeof l);
  else if (M.distOk) { fmtDist(M, d, sizeof d, M.dist); snprintf(l, sizeof l, "%s%s away", d, M.vault ? "" : " m"); } else strcpy(l, "Nothing in the beam");
  char r[16]; snprintf(r, sizeof r, "%d phone%s", M.phones, M.phones == 1 ? "" : "s");
  foot(l, r);
}
static void drawArmed(const Model& M) {
  float p = pulse(M.t, 260);
  strip(M, "ARMED", PINK);
  // pulsing frame
  RGB c = mix(BG, PINK, .35f + .65f * p);
  rect(2, 24, W - 4, 4, c); rect(2, H - 6, W - 4, 4, c); rect(2, 24, 4, H - 28, c); rect(W - 6, 24, 4, H - 28, c);
  text(F_XB58, "GO WHEN", W / 2, 86, FG, CENTER); text(F_XB58, "READY", W / 2, 136, PINK, CENTER);
  char l[64]; snprintf(l, sizeof l, "%s \xC2\xB7 %s", M.evShort, M.evLine);
  text(F_S11, l, 12, H - 10, DIM); text(F_S11, M.who, W - 12, H - 10, DIM, RIGHT);
}
static void drawRec(const Model& M) {
  strip(M, "RECORDING", PURPLE);
  text(F_B13, "SPEED", 10, 42, DIM);
  char v[12]; snprintf(v, sizeof v, "%.2f", M.speed);
  bigNum(v, 10, 108, 80, FG, "m/s");
  float prog = M.runTarget > 0 ? M.runDist / M.runTarget : 0; if (prog > 1) prog = 1; if (prog < 0) prog = 0;
  rrect(10, 124, W - 20, 8, 4, LINE); rrect(10, 124, (W - 20) * prog, 8, 4, FG, 10, W - 10);
  char a[16], b[16], l[40], r[16]; fmtDist(M, a, sizeof a, M.runDist, 1); fmtDist(M, b, sizeof b, M.runTarget, 0);
  if (M.vault) snprintf(l, sizeof l, "%s of %s", a, b); else snprintf(l, sizeof l, "%s m of %s", a, b);
  snprintf(r, sizeof r, "%.1f s", M.runTime);
  foot(l, r);
}
static void drawSaving(const Model& M) {
  strip(M, "RUN DONE", BLUE);
  float p = pulse(M.t, 200);
  text(F_XB34, M.phones ? "WORKING IT OUT" : "OPEN THE APP", W / 2, 84, mix(DIM, FG, p), CENTER);
  text(F_S13, M.phones ? "The result shows here in a second." : "Connect a phone to save this run.", W / 2, 110, DIM, CENTER);
  foot(M.who, M.evShort);
}
static void drawResult(const Model& M) {
  strip(M, M.strip, BLUE);
  text(F_B13, M.head, 10, 42, DIM);
  bigNum(M.headV, 10, 100, 72, BLUE, M.headU);
  float cw = M.nCells > 3 ? 76 : 102;
  for (int i = 0; i < M.nCells; i++) {
    float x = 10 + i * cw;
    text(F_B11, M.cells[i].k, x, 120, DIM);
    bigNum(M.cells[i].v, x, 140, 18, FG, M.cells[i].u, LEFT, cw - 6);
  }
  foot(M.footL, M.footR);
}
// The app's page in its simplest form (Home, Sessions, Analytics, Settings...), so the screen follows the phone.
static bool hasAll(const Font& f, const char* s) { while (*s) if (!glyph(f, nextCp(s))) return false; return true; }
static void drawPage(const Model& M) {
  strip(M, M.pgTitle[0] ? M.pgTitle : "LiDAR SENSOR", PURPLE);
  char r[16]; snprintf(r, sizeof r, "%d phone%s", M.phones, M.phones == 1 ? "" : "s");
  const float cw = (W - 20) / 3.f, maxW = W - 20;
  auto cells = [&]() { for (int i = 0; i < M.nPg; i++) { float x = 10 + i * cw; text(F_B11, M.pg[i].k, x, 122, DIM); bigNum(M.pg[i].v, x, 145, 24, FG, M.pg[i].u, LEFT, cw - 6); } };
  if (M.pgV[0]) {   // a number page: the number as big as the result screen's, three smaller ones under it
    text(F_B13, M.pgK, 10, 40, DIM);
    bigNum(M.pgV, 10, M.nPg ? 104 : 116, 72, FG, M.pgU, LEFT, maxW);
    cells(); foot(M.pgSub, r); return;
  }
  // a words page: the words as big as they will go. One line, or two if that lets them be bigger.
  const Font* big = hasAll(F_XB58, M.pgK) ? &F_XB58 : &F_XB34;
  char l1[24], l2[24] = ""; strlcpy(l1, M.pgK, sizeof l1);
  bool two = false;
  if (measure(*big, M.pgK) > maxW) {
    // split at the space nearest the middle
    int n = strlen(M.pgK), best = -1; for (int i = 1; i < n - 1; i++) if (M.pgK[i] == ' ' && (best < 0 || abs(i - n / 2) < abs(best - n / 2))) best = i;
    if (best > 0 && !M.nPg) { strlcpy(l1, M.pgK, best + 1 < (int)sizeof l1 ? best + 1 : sizeof l1); strlcpy(l2, M.pgK + best + 1, sizeof l2); two = true;
      if (measure(*big, l1) > maxW || measure(*big, l2) > maxW) big = &F_XB34;
      if (measure(*big, l1) > maxW || measure(*big, l2) > maxW) { two = false; strlcpy(l1, M.pgK, sizeof l1); big = &F_XB24; } }
    else big = measure(F_XB34, M.pgK) > maxW ? &F_XB24 : &F_XB34;
  }
  if (two) {
    float lh = big->size * .96f, y1 = 22 + (128 - 2 * lh) / 2 + big->size * .78f;
    text(*big, l1, 10, y1, FG); text(*big, l2, 10, y1 + lh, FG);
    foot(M.pgSub, r); return;
  }
  if (M.nPg) { text(*big, l1, 10, big->size > 40 ? 74 : 62, FG); text(F_B20, M.pgSub, 10, big->size > 40 ? 100 : 88, DIM); cells(); foot("", r); }
  else { text(*big, l1, 10, big->size > 40 ? 94 : 84, FG); text(F_B20, M.pgSub, 10, big->size > 40 ? 124 : 112, DIM); foot("", r); }
}
static void drawNoLidar(const Model& M) {
  strip(M, "NO LIDAR", AMBER);
  float p = pulse(M.t, 200);
  text(F_XB34, "NO SIGNAL", W / 2, 80, mix(BG, AMBER, .4f + .6f * p), CENTER);
  text(F_S13, "The LiDAR isn't sending anything.", W / 2, 106, FG, CENTER);
  text(F_S13, "Check its cable and the power bank.", W / 2, 124, DIM, CENTER);
  foot("TF03 \xC2\xB7 115200 baud", M.fw);
}
// Aiming: bars close in from both sides toward a target in the middle; they meet (and the target lights)
// when the beam is locked on the athlete. Red when weak, amber getting there, green when locked.
static RGB aimColour(int sig) { return sig > 70 ? GREEN : sig > 35 ? AMBER : RED; }
static void drawAim(const Model& M) {
  RGB col = aimColour(M.sig);
  strip(M, "AIMING", col);
  text(F_B13, "SIGNAL", 10, 44, DIM);
  const int n = 8; const float gap = 3, cx = W / 2.f, cy = 75, inner = 16, w = (cx - inner - 10 - (n - 1) * gap) / n;
  int on = (int)lroundf(M.sig / 100.f * n);
  for (int i = 0; i < n; i++) {   // i = 0 is the outermost pair
    float h = 16 + 30.f * i / (n - 1), y = cy - h / 2; RGB c = i < on ? col : LINE;
    rrect(10 + i * (w + gap), y, w, h, 2, c); rrect(W - 10 - w - i * (w + gap), y, w, h, 2, c);
  }
  bool locked = on >= n; RGB tc = locked ? col : LINE;
  for (int j = (int)cy - 14; j <= (int)cy + 14; j++) for (int i = (int)cx - 14; i <= (int)cx + 14; i++) {
    float d = hypotf(i + .5f - cx, j + .5f - cy), a = fmaxf(2.f - fabsf(d - 11), 0) ; if (a > 0) blend(i, j, tc, a > 1 ? 1 : a);
    float b = 4.5f - d; if (b > 0) blend(i, j, tc, b > 1 ? 1 : b);
  }
  char v[8]; snprintf(v, sizeof v, "%d%%", M.sig);
  text(F_XB34, v, 10, 134, FG);
  char d[16]; if (M.distOk) { fmtDist(M, d, sizeof d, M.dist); if (!M.vault) strcat(d, " m"); } else strcpy(d, "-");
  text(F_XB18, d, W - 10, 134, DIM, RIGHT);
  foot(locked ? "Locked on" : "Turn the tripod slowly", locked ? "leave the tripod there" : "aim at athlete\xE2\x80\x99s back");
}
static void drawUpdate(const Model& M) {
  strip(M, "UPDATING", PURPLE);
  char v[8]; snprintf(v, sizeof v, "%d%%", M.updatePct);
  text(F_XB58, v, W / 2, 96, FG, CENTER);
  rrect(30, 112, W - 60, 8, 4, LINE); rrect(30, 112, (W - 60) * M.updatePct / 100.f, 8, 4, FG, 30, W - 30);
  foot("Don't switch it off", "restarts by itself");
}

// About: the logo, who made it, the specs, and how long it has been running
static void drawAbout(const Model& M) {
  strip(M, "ABOUT", LOGO_LINE);
  logo(10, 32, .62f);
  text(F_XB18, "PAYTON'S ", 66, 46, FG);
  float a = measure(F_XB18, "PAYTON'S "), b = measure(F_XB18, "LiDAR ");
  text(F_XB18, "LiDAR ", 66 + a, 46, FG, LEFT, 66 + a, 66 + a + b); text(F_XB18, "SENSOR", 66 + a + b, 46, FG);
  text(F_S11, "Designed by Payton Pitts \xC2\xB7 Tampa, FL \xC2\xB7 2026", 66, 60, DIM);
  struct KV { const char* k; char v[28]; } kv[4] = {{"SERIAL", "SL-0001"}, {"POWER", "5 V USB \xC2\xB7 0.3 A"}, {"LASER", "Class 1 \xC2\xB7 eye-safe"}, {"FIRMWARE", ""}};
  strlcpy(kv[3].v, M.fw, sizeof kv[3].v);
  for (int i = 0; i < 4; i++) { float x = i % 2 ? 166 : 10, y = i < 2 ? 86 : 122; text(F_B11, kv[i].k, x, y, DIM); text(F_XB18, kv[i].v, x, y + 18, FG); }
  char up[48]; uint32_t m = M.upS / 60;
  if (m < 60) snprintf(up, sizeof up, "on %lu min \xC2\xB7 start #%lu (%s)", (unsigned long)m, (unsigned long)M.boots, M.reset);
  else snprintf(up, sizeof up, "on %lu h %lu min \xC2\xB7 start #%lu (%s)", (unsigned long)(m / 60), (unsigned long)(m % 60), (unsigned long)M.boots, M.reset);
  foot("paytonpittsdesigns.com", up);
}

// Level: a bubble (left) that moves the way the tripod leans, and the beam's height down the runway (right).
// Green when the nose is within 0.1° of level, amber within 0.4°, red past that.
static void drawLevel(const Model& M) {
  if (!M.imuOk) {
    strip(M, "LEVEL", AMBER);
    text(F_XB34, "NO TILT SENSOR", W / 2, 84, AMBER, CENTER);
    text(F_S13, "Check the BMI160's four wires.", W / 2, 110, FG, CENTER);
    foot("SDA GPIO 4 \xC2\xB7 SCL GPIO 5", "3V3 \xC2\xB7 GND");
    return;
  }
  // green within 0.2° (10 cm at 30 m, the width of the back band), amber to 0.6°
  float ap = fabsf(M.pitch); RGB col = ap < .2f ? GREEN : ap < .6f ? AMBER : RED;
  strip(M, ap < .2f ? "LEVEL \xC2\xB7 GOOD" : "LEVEL", col);
  // bubble: 12 px per degree (was 22: too jumpy), pinned to the rim past 3°
  const float cx = 62, cy = 96, R = 46;
  for (int j = (int)(cy - R - 2); j <= (int)(cy + R + 2); j++) for (int i = (int)(cx - R - 2); i <= (int)(cx + R + 2); i++) {
    float d = hypotf(i + .5f - cx, j + .5f - cy), a = 1.6f - fabsf(d - R); if (a > 0) blend(i, j, LINE, a > 1 ? 1 : a);
    float r2 = 1.4f - fabsf(d - 6.5f); if (r2 > 0) blend(i, j, LINE, r2 > 1 ? 1 : r2);   // the target ring
  }
  rect((int)(cx - R + 4), (int)cy, (int)(2 * R - 8), 1, LINE); rect((int)cx, (int)(cy - R + 4), 1, (int)(2 * R - 8), LINE);
  float bx = M.roll * 12, by = -M.pitch * 12, L = hypotf(bx, by), lim = R - 9; if (L > lim) { bx *= lim / L; by *= lim / L; }
  for (int j = (int)(cy + by - 9); j <= (int)(cy + by + 9); j++) for (int i = (int)(cx + bx - 9); i <= (int)(cx + bx + 9); i++) {
    float a = 7.5f - hypotf(i + .5f - cx - bx, j + .5f - cy - by); if (a > 0) blend(i, j, col, a > 1 ? 1 : a);
  }
  // nose angle
  text(F_B13, "NOSE", 126, 44, DIM);
  char v[12]; snprintf(v, sizeof v, "%+.1f", M.pitch); if (ap < .05f) strcpy(v, "0.0");   // tenths: hundredths never sat still
  bigNum(v, 126, 90, 58, col, "\xC2\xB0", LEFT, 120);
  text(F_XB18, ap < .2f ? "LEVEL" : M.pitch > 0 ? "UP" : "DOWN", W - 10, 90, col, RIGHT);
  // where the beam is at the distance the app gave
  float off = M.levelAt * tanf(M.pitch * 0.01745329f) * 100;   // cm above the sensor's height
  char at[16], h[24]; if (M.vault) snprintf(at, sizeof at, "AT %.0f FT", M.levelAt * 3.28084f); else snprintf(at, sizeof at, "AT %.0f M", M.levelAt);
  off = roundf(off / 5) * 5;   // in 5 cm steps
  if (fabsf(off) < 5) strcpy(h, "on height"); else snprintf(h, sizeof h, "%.0f cm %s", fabsf(off), off > 0 ? "high" : "low");
  text(F_B11, "BEAM", 126, 116, DIM); text(F_B11, at, 160, 116, DIM);
  text(F_XB18, h, 126, 138, FG);
  foot(M.zeroed ? "Tilt the tripod head until it's green" : "Not zeroed yet: zero it in the app", M.bumped ? "moved since aimed" : "BMI160");
}

// Jump test: who's up (stand still), set (jump when ready), in the air (a bar rising with the height, from the
// takeoff speed the pod sends), then the result (takeoff to peak, big; standing to peak and what a jump mat says)
static void drawJump(const Model& M) {
  if (M.jRes) {
    strip(M, "VERTICAL JUMP", BLUE);
    text(F_B13, "TAKEOFF TO PEAK", 10, 42, DIM);
    bigNum(M.jH, 10, 100, 72, BLUE, "cm");
    if (M.jHs[0]) { text(F_B11, "STANDING TO PEAK", 10, 120, DIM); bigNum(M.jHs, 10, 140, 18, FG, "cm"); }
    if (M.jHm[0]) { text(F_B11, "JUMP MAT", 170, 120, DIM); bigNum(M.jHm, 170, 140, 18, FG, "cm"); }
    char r[40]; snprintf(r, sizeof r, M.jNext[0] ? "next: %s" : "%s", M.jNext);
    foot(M.jRWho, r);
    return;
  }
  if (M.jPh == 2 || (M.jPh == 3 && M.jV > 0)) {
    strip(M, M.jPh == 2 ? "IN THE AIR" : "LANDED", PURPLE);
    const float g = 9.80665f, t = M.jAirMs / 1000.f, tp = M.jV / g, peak = M.jV * M.jV / (2 * g);
    float h = M.jV > 0 ? (t >= tp ? peak : M.jV * t - g * t * t / 2) : 0; if (h < 0) h = 0;
    float best = atof(M.jBest) / 100.f, top = fmaxf(.7f, ceilf(fmaxf(best, peak) * 1.2f * 10) / 10);
    const float bx = 12, by = 30, bw = 34, bh = H - 30 - 28;
    rrect(bx, by, bw, bh, 8, LINE);
    float fh = bh * fminf(1.f, h / top); if (fh > 1) rrect(bx, by + bh - fh, bw, fh, 8, FG, bx, bx + bw);
    for (int c = 10; c < top * 100; c += 10) { float y = by + bh - bh * (c / 100.f) / top; rect((int)bx, (int)y, (int)bw, 1, BG); }
    if (best > 0) { float y = by + bh - bh * fminf(1.f, best / top); rect((int)bx - 4, (int)y - 1, (int)bw + 8, 3, PINK); }
    char v[8]; snprintf(v, sizeof v, "%.0f", h * 100);
    text(F_B13, "HEIGHT", 64, 44, DIM);
    bigNum(v, 64, 110, 80, FG, "cm", LEFT, W - 74);
    foot(M.jWho, t >= tp ? "peak \xC2\xB7 exact number next" : M.jPod);
    return;
  }
  if (M.jPh == 1) {
    float p = pulse(M.t, 260);
    strip(M, "SET", PINK);
    RGB c = mix(BG, PINK, .35f + .65f * p);
    rect(2, 24, W - 4, 4, c); rect(2, H - 6, W - 4, 4, c); rect(2, 24, 4, H - 28, c); rect(W - 6, 24, 4, H - 28, c);
    text(F_XB58, "JUMP WHEN", W / 2, 86, FG, CENTER); text(F_XB58, "READY", W / 2, 136, PINK, CENTER);
    text(F_S11, M.jWho, 12, H - 10, DIM); text(F_S11, M.jPod, W - 12, H - 10, DIM, RIGHT);
    return;
  }
  if (M.jPh == 3) {
    strip(M, "LANDED", PURPLE);
    text(F_XB34, "STAND STILL", W / 2, 84, FG, CENTER);
    text(F_S13, "The height shows here in a second.", W / 2, 110, DIM, CENTER);
    foot(M.jWho, M.jPod);
    return;
  }
  strip(M, "JUMP TEST", GREEN);
  text(F_B13, "UP NOW", 10, 44, DIM);
  text(F_XB34, M.jWho[0] ? M.jWho : "-", 10, 82, FG);
  text(F_S13, "Stand still, jump, land and stand still", 10, 108, GREEN);
  if (M.jBest[0]) { text(F_B11, "BEST TODAY", 10, 134, DIM); char b[16]; snprintf(b, sizeof b, "%s cm", M.jBest); text(F_XB18, b, 100, 136, FG); }
  foot("Vertical jump", M.jPod);
}

static void draw(const Model& M) {
  fill(BG);
  switch (M.screen) {
    case S_BOOT: drawBoot(M); break;
    case S_WIFI: drawWifi(M); break;
    case S_READY: drawReady(M); break;
    case S_ARMED: drawArmed(M); break;
    case S_REC: drawRec(M); break;
    case S_SAVING: drawSaving(M); break;
    case S_RESULT: drawResult(M); break;
    case S_NOLIDAR: drawNoLidar(M); break;
    case S_UPDATE: drawUpdate(M); break;
    case S_AIM: drawAim(M); break;
    case S_ABOUT: drawAbout(M); break;
    case S_LEVEL: drawLevel(M); break;
    case S_JUMP: drawJump(M); break;
    case S_PAGE: drawPage(M); break;
  }
}

}  // namespace scr
