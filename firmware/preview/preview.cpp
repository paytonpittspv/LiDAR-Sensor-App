// Renders every screen to PPM files on a computer, to check the layout without the sensor.
//   g++ -O2 -std=c++17 -I firmware/SpeedLidar firmware/preview/preview.cpp -o /tmp/preview && /tmp/preview OUTDIR
#include "screen.h"
#include <string>
using namespace scr;

static void save(const std::string& path) {
  FILE* f = fopen(path.c_str(), "wb"); fprintf(f, "P6 %d %d 255\n", W, H);
  for (int i = 0; i < W * H; i++) { RGB c = unpack(fb[i]); fputc(c.r, f); fputc(c.g, f); fputc(c.b, f); }
  fclose(f);
}
int main(int argc, char** argv) {
  std::string out = argc > 1 ? argv[1] : ".";
  static uint16_t frame[W * H]; fb = frame;
  Model M; M.ssid = "SpeedLidar"; M.pass = "vault1234"; M.host = "sensor.paytonpittsdesigns.com"; M.fw = "v4.0 \xC2\xB7 S3 \xC2\xB7 secure";
  M.phones = 2; M.sig = 86; M.vault = true; M.armedCfg = true;
  strcpy(M.evShort, "VAULT"); strcpy(M.evLine, "Long \xC2\xB7 150 ft"); strcpy(M.who, "Payton");
  M.screen = S_BOOT; M.t = 2000; draw(M); save(out + "/boot.ppm");
  { Model W2 = M; W2.phones = 0; W2.screen = S_WIFI; draw(W2); save(out + "/wifi.ppm"); }
  M.screen = S_READY; M.dist = 4.82f; M.distOk = true; draw(M); save(out + "/ready.ppm");
  M.inZone = true; M.hold = .6f; draw(M); save(out + "/ready_hold.ppm");
  { Model S = M; S.vault = false; strcpy(S.evShort, "SPRINT"); strcpy(S.evLine, "Stop at 30 m"); S.inZone = false; draw(S); save(out + "/ready_sprint.ppm"); }
  { Model S = M; S.armedCfg = false; S.inZone = false; draw(S); save(out + "/ready_idle.ppm"); }
  { Model A = M; A.screen = S_AIM; A.inZone = false; A.sig = 25; draw(A); save(out + "/aim_weak.ppm"); A.sig = 55; draw(A); save(out + "/aim_mid.ppm"); A.sig = 100; draw(A); save(out + "/aim_locked.ppm"); }
  M.screen = S_ARMED; M.t = 0; draw(M); save(out + "/armed.ppm");
  M.screen = S_REC; M.speed = 8.93f; M.runDist = 28.4f; M.runTarget = 42.0f; M.runTime = 4.2f; draw(M); save(out + "/rec.ppm");
  M.screen = S_SAVING; draw(M); save(out + "/saving.ppm");
  M.screen = S_RESULT; strcpy(M.strip, "RUN SAVED \xC2\xB7 VAULT"); strcpy(M.head, "LAST 5 M"); strcpy(M.headV, "8.71"); strcpy(M.headU, "m/s");
  M.nCells = 4;
  const char* cs[4][3] = {{"TOP", "8.93", "m/s"}, {"LEFTS", "8", ""}, {"TAKEOFF", "11' 11\"", ""}, {"4L MID", "54' 1\"", ""}};
  for (int i = 0; i < 4; i++) { strcpy(M.cells[i].k, cs[i][0]); strcpy(M.cells[i].v, cs[i][1]); strcpy(M.cells[i].u, cs[i][2]); }
  strcpy(M.footL, "Payton \xC2\xB7 run 4"); strcpy(M.footR, "saved on 2 devices"); draw(M); save(out + "/result.ppm");
  M.nCells = 3; strcpy(M.strip, "RUN SAVED \xC2\xB7 SPRINT"); strcpy(M.head, "TOP SPEED"); strcpy(M.headV, "9.42");
  const char* sp[3][3] = {{"0\xE2\x80\x93" "10 M", "1.92", "s"}, {"FLY 10", "1.04", "s"}, {"30 M", "4.11", "s"}};
  for (int i = 0; i < 3; i++) { strcpy(M.cells[i].k, sp[i][0]); strcpy(M.cells[i].v, sp[i][1]); strcpy(M.cells[i].u, sp[i][2]); }
  draw(M); save(out + "/result_sprint.ppm");
  M.screen = S_NOLIDAR; draw(M); save(out + "/nolidar.ppm");
  M.screen = S_UPDATE; M.updatePct = 62; draw(M); save(out + "/update.ppm");
  return 0;
}
