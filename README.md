# PAYTON'S LiDAR SENSOR

Top speed, last-5 m speed and every left, measured with one LiDAR on a tripod. There are no
timing gates and no camera calibration.

**Your app:** https://paytonpittspv.github.io/LiDAR-Sensor-App/

**Install it like an app:** open the link on your phone, then
- **iPhone (Safari):** Share → **Add to Home Screen**
- **Android (Chrome):** ⋮ menu → **Install app** (or Add to Home screen)

It gets its own icon, opens full screen and works with no connection at all once it's been
opened. This is where all your runs, analytics and reports live.

**Recording:** join the sensor's Wi-Fi (`SpeedLidar`, password `vault1234`) and open
**http://192.168.4.1** in Safari. Phones only keep a web app for offline use when it comes from a
secure (https) address, and a secure app isn't allowed to talk to the sensor, so recording happens
on the sensor's page. After each session tap **Copy runs** there, open the home-screen app and tap
**Paste runs**. Runs are matched so nothing is added twice, and athletes are matched by name.
Don't add 192.168.4.1 to the home screen; it won't open off the sensor's Wi-Fi.

New run in the home-screen app plays a simulated practice run. Simulated and demo runs are
marked, never sent, and can be cleared in Settings.

## Hardware

| Part | Notes |
|---|---|
| Benewake TF03-100 | UART version, 1000 readings per second |
| ESP32 dev board (USB-C, CP2102) + screw-terminal breakout | |
| INIU 10,000 mAh power bank | powers everything over USB |
| 3D-printed case | mounts on the tripod quick-release plate |

Wiring: TF03 red → 5V, black → GND, brown (TX) → GPIO16, blue (RX) → GPIO17.

## Flashing the sensor

1. Arduino IDE → Boards Manager → install **esp32 by Espressif**.
2. Open `firmware/SpeedLidar/SpeedLidar.ino`.
3. Tools → Board → **ESP32 Dev Module**.
4. Tools → Partition Scheme → **Huge APP (3MB No OTA/1MB SPIFFS)**.
5. Upload.

## How a run works

- **Sprint:** the athlete stands still within 5 m of the sensor for 1.5 s and hears the chime.
  The clock starts once real sprinting is confirmed and stops at the set distance.
- **Vault:** the athlete stands still on the start mark for 2 s and hears the chime. Standing in
  the last 40 ft before the box never arms the sensor, and nothing past the box is used.
- After each run the results stay on screen until the next athlete steps in. With several
  athletes picked, they take turns. In Hands Free Mode every run is saved and read out on the
  speaker.

## Changing the app

The source is in `src/`. After editing, rebuild and commit both outputs:

```
python3 src/build.py      # writes index.html, manifest, sw.js, firmware/SpeedLidar/page.h and assets.h
node src/icons/make_icons.js   # only if you change src/icons/icon.svg (needs Playwright)
cd src && node test_engine.js
```

On every push, GitHub compiles the firmware for the ESP32, checks the app was rebuilt, and runs
the accuracy tests. See the **Actions** tab.

Sample reports are in `samples/`.
