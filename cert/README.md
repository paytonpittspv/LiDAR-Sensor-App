# Sensor certificate

`sensor.csr` is the sensor's certificate request (its public key, made on the ESP32; the private key
never leaves the sensor). The app sends it here once, during setup.

`sensor.pem` and `sensor.json` are written by the **Sensor certificate** GitHub job, which gets the
certificate from Let's Encrypt and renews it a month before it expires. The app downloads the newest one
whenever the phone is online and installs it on the sensor the next time it connects.

Nothing in this folder is secret.
