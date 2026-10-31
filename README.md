# MK60E5 Z4 GT3 ABS Tools
Tools and notes to help in the diagnosis and configuration of the MK60E5 out of a BMW Z4 that has been flashed with Z4 GT3 / Motorsport software.  For diagnostics K-Line pin 2 needs to be wired to the diagnostic connector, unlike normal E1/E5.

The part number for these units is 34516769162 with the 829.3 code on the module.  They are compatible with a VW yaw sensor with the part number 7H0907652A, note that this yaw sensor is not pinned the same as the BMW yaw sensor.

## CANBUS
These units, when flashed, read tire circumference (front and rear separately), a traction-control threshold and mode, an ABS intervention level, and a gear-shift flag — all from a single CAN message, ID `0x5BA`. A small web page to generate it for your settings is at https://vesrah.github.io/MK60E5-Z4-GT3-ABS-Tools/

### ABS intervention level (`0x5BA` byte 7)
The firmware handles the level linearly. A higher level makes ABS intervene earlier (on a smaller wheel deceleration); **level 0 is the most permissive** (ABS waits the longest). This is *not* the 0-9-8-…-1 order some documentation lists. The level sets the base wheel-deceleration threshold, whichsits on top of a base calibration already roughly 0.25–0.45 g more permissive than the road car.

### Tire circumference (`0x5BA` bytes 3–6)
Front and rear circumference in mm (low byte first within each pair). The module accepts a new pair only when both values are 1500–3000 and the car is essentially stopped (reference speed < 4 km/h), so a size change takes effect at a standstill. Until the first accepted pair it uses the built-in defaults.

### Traction control (`0x5BA` bytes 1–2)
Byte 1 is a slip-threshold factor (30–250 %).
Byte 2 selects the TCS mode (0 = engine-torque cut off, 1/2 = on).
Note that brake-based traction control cannot be fully switched off by this message — "off" only disables the engine-torque request — and stability control (AYC / yaw braking) is disabled in this software regardless of these settings.

### Gear-shift flag (`0x5BA` byte 8)
0 none, 1 up, 2 down. A non-zero value suppresses rear-wheel ABS for about 150 ms to ride out the driveline disturbance of a shift.

### Steering / stability
The GT3 software runs with no steering-angle sensor by default, and treats yaw and lateral acceleration as untrusted (and keeps stability control off) until a steering zero calibration is done. A steering sensor, if fitted, lives on the main CAN bus (`0x0C2`), not the F-CAN yaw bus. The yaw sensor on F-CAN supplies yaw rate plus lateral and longitudinal acceleration.

## Wiring

##### Z4 MK60E5

| Pin | Usage | Notes |
|-----|-------|-------|
| 1 | Power | 12v 30 amps |
| 2 | K-Line |  |
| 3 | Brake Fluid Level | Splice to ground. *Not required — the GT3 software removed the fluid-level monitor; this input raises no fault or lamp and appears only in KWP live data.* |
| 4 | Brake Switch Input | Ground normally, open on pedal press. *Read, fault-monitored and reported on CAN (0x1A0); but ABS's own "brake applied" logic uses the internal master-pressure sensor, not this switch.* |
| 5 |  |  |
| 6 |  |  |
| 7 |  |  |
| 8 |  |  |
| 9 |  |  |
| 10 |  |  |
| 11 | F CAN High | Yaw sensor CAN High. *Supplies yaw rate + lateral + longitudinal acceleration (0x130/0x131). Steering angle is not on this bus.* |
| 12 |  |  |
| 13 |  |  |
| 14 |  |  |
| 15 | PT CAN Low | For Datalog |
| 16 | Ground |  |
| 17 | Switched Power | 12v 5 amps, spliced to 29 |
| 18 |  |  |
| 19 |  |  |
| 20 |  |  |
| 21 |  |  |
| 22 |  |  |
| 23 |  |  |
| 24 |  |  |
| 25 |  |  |
| 26 | F CAN Low | Yaw sensor CAN Low |
| 27 | PT CAN Ground | Yaw sensor ground |
| 28 |  |  |
| 29 | Switched Power | 12v 5 amps, wakeup, spliced to 17, can be switched for ABS on / off |
| 30 | PT CAN High | For data logging |
| 31 |  |  |
| 32 | Power | 12v 30 amps |
| 33 | FR Wheel Speed Signal |  |
| 34 | FR Wheel Speed Power |  |
| 35 |  |  |
| 36 | RL Wheel Speed Power |  |
| 37 | RL Wheel Speed Signal |  |
| 38 | Parking Brake | Splice to ground. *Not required — no parking-brake/handbrake input is read by the GT3 firmware.* |
| 39 | PT CAN Power | Yaw sensor 12v |
| 40 |  |  |
| 41 |  |  |
| 42 | RR Wheel Speed Signal |  |
| 43 | RR Wheel Speed Power |  |
| 44 | ABS Error Light | Lamp output (ABS warning lamp; also broadcast on CAN 0x1A0/0x5A0). |
| 45 | FL Wheel Speed Power |  |
| 46 | FL Wheel Speed Signal |  |
| 47 | Ground |  |

##### VW Yaw Sensor

| Pin | Usage
|-----|-------|
| 1 | 12v Power |
| 2 | CAN Low |
| 3 | Ground |
| 4 | CAN High |