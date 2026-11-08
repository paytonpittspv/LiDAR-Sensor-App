# PAYTON'S LiDAR SENSOR

Top speed, last-5 m speed and every left, measured with one LiDAR on a tripod. There are no
timing gates and no camera calibration.

**Practice app:** https://paytonpittspv.github.io/LiDAR-Sensor-App/

The practice website runs the full app with simulated runs. You can add athletes, try sprint
and vault sessions, Hands Free Mode and the reports. To record for real, join the sensor's
Wi-Fi (`SpeedLidar`, password `vault1234`) and open **http://192.168.4.1**. Browsers block a
secure website from talking to the sensor, so recording only works from the copy the sensor
serves. Move athletes and runs between the two with **Settings → Export / Import backup**.

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
python3 src/build.py      # writes index.html and firmware/SpeedLidar/page.h
cd src && node test_engine.js
```

On every push, GitHub compiles the firmware for the ESP32, checks the app was rebuilt, and runs
the accuracy tests. See the **Actions** tab.

Sample reports are in `samples/`.
