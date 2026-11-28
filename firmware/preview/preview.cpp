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
  { Model P = M; P.screen = S_PAGE; P.lidar = false; P.phones = 1;
    strcpy(P.pgTitle, "ANALYTICS"); strcpy(P.pgK, "LAST 5 M"); strcpy(P.pgV, "7.72"); strcpy(P.pgU, "m/s"); strcpy(P.pgSub, "PAYTON PITTS \xC2\xB7 Short approach");
    P.nPg = 3; strcpy(P.pg[0].k, "TOP SPEED"); strcpy(P.pg[0].v, "7.74"); strcpy(P.pg[0].u, "m/s"); strcpy(P.pg[1].k, "DIFFERENCE"); strcpy(P.pg[1].v, "-0.03"); strcpy(P.pg[1].u, "m/s"); strcpy(P.pg[2].k, "JUMPS"); strcpy(P.pg[2].v, "1"); strcpy(P.pg[2].u, "");
    draw(P); save(out + "/page_analytics.ppm");
    strcpy(P.pgTitle, "SETTINGS"); strcpy(P.pgK, "SOUND AND HANDS FREE"); P.pgV[0] = 0; strcpy(P.pgSub, "Firmware v4.16"); P.nPg = 0; draw(P); save(out + "/page_settings.ppm");
    strcpy(P.pgTitle, "HOME"); strcpy(P.pgK, "RUNS TODAY"); strcpy(P.pgV, "12"); P.pgU[0] = 0; strcpy(P.pgSub, "3 athletes"); P.lidar = true; P.sig = 80;
    P.nPg = 3; strcpy(P.pg[0].k, "THIS WEEK"); strcpy(P.pg[0].v, "24"); strcpy(P.pg[0].u, "runs"); strcpy(P.pg[1].k, "JUMPS"); strcpy(P.pg[1].v, "18"); strcpy(P.pg[1].u, "wk"); strcpy(P.pg[2].k, "SAVED"); strcpy(P.pg[2].v, "60"); strcpy(P.pg[2].u, "");
    draw(P); save(out + "/page_home.ppm");
    { Model N = P; N.lidar = false; strcpy(N.pgTitle, "NEW SESSION"); strcpy(N.pgK, "VAULT"); N.pgV[0] = 0; strcpy(N.pgSub, "PAYTON PITTS");
      N.nPg = 3; strcpy(N.pg[0].k, "SETUP"); strcpy(N.pg[0].v, "100 FT"); N.pg[0].u[0] = 0; strcpy(N.pg[1].k, "LINEUP"); strcpy(N.pg[1].v, "3"); N.pg[1].u[0] = 0; strcpy(N.pg[2].k, "STEP"); strcpy(N.pg[2].v, "2 OF 3"); N.pg[2].u[0] = 0;
      draw(N); save(out + "/page_new.ppm");
      N.nPg = 0; strcpy(N.pgTitle, "SETTINGS"); strcpy(N.pgK, "SETTINGS"); strcpy(N.pgSub, "Firmware v4.18"); draw(N); save(out + "/page_set.ppm");
      strcpy(N.pgK, "LOOK AND UNITS"); draw(N); save(out + "/page_set3.ppm"); }
    Model R = M; R.screen = S_READY; R.lidar = false; R.distOk = false; R.phones = 1; draw(R); save(out + "/ready_nolidar.ppm");
    Model Wf = M; Wf.screen = S_WIFI; Wf.lidar = false; Wf.phones = 0; draw(Wf); save(out + "/wifi_nolidar.ppm"); }
  M.screen = S_UPDATE; M.updatePct = 62; draw(M); save(out + "/update.ppm");
  { Model A = M; A.screen = S_ABOUT; A.fw = "v4.5 \xC2\xB7 S3 \xC2\xB7 secure"; A.upS = 754; A.boots = 7; A.reset = "power"; draw(A); save(out + "/about.ppm"); }
  { Model L = M; L.screen = S_LEVEL; L.imuOk = true; L.zeroed = true; L.pitch = .42f; L.roll = -.6f; draw(L); save(out + "/level_off.ppm");
    L.pitch = -.18f; L.roll = .2f; draw(L); save(out + "/level_close.ppm");
    L.pitch = .03f; L.roll = .05f; draw(L); save(out + "/level_good.ppm");
    L.imuOk = false; draw(L); save(out + "/level_none.ppm"); }
  { Model J = M; J.screen = S_JUMP; strcpy(J.jWho, "Jordan Lee"); strcpy(J.jPod, "Blue pod"); strcpy(J.jBest, "48.0");
    J.jPh = 0; draw(J); save(out + "/jump_ready.ppm");
    J.jPh = 1; J.t = 0; draw(J); save(out + "/jump_set.ppm");
    J.jPh = 2; J.jV = 2.9f; J.jAirMs = 180; draw(J); save(out + "/jump_air.ppm");
    J.jAirMs = 400; draw(J); save(out + "/jump_peak.ppm");
    J.jRes = true; strcpy(J.jH, "42.8"); strcpy(J.jHs, "51.9"); strcpy(J.jHm, "44.1"); strcpy(J.jRWho, "Jordan Lee"); strcpy(J.jNext, "Sam Ortiz"); draw(J); save(out + "/jump_result.ppm"); }
  { Model B = M; B.screen = S_READY; B.inZone = false; B.hold = 0; B.bumped = true; B.bumpDeg = -.6f; strcpy(B.bumpWhy, "tilted"); draw(B); save(out + "/ready_bumped.ppm"); }
  return 0;
}
