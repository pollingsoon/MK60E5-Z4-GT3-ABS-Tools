# MK60E5 Z4 GT3 service tool

A small browser diagnostic tool for the flashed MK60E5 (ZB 6769162). It reads
and clears faults, reads and writes coding, runs the valve- and sensor-offset
calibration routines, and reads live data and memory - over the module's own
KWP2000 services on K-line.

## Two ways to run

**Browser only - `standalone.html` (recommended).** Chrome/Edge can open the
K+DCAN cable directly through the Web Serial API, so the browser does all the
KWP itself; there is no backend. Web Serial needs a secure context, so serve
the file over `http://localhost` or `https://` (not `file://`):

```sh
python3 -m http.server 8000     # then open http://localhost:8000/service-tool/standalone.html
```

or host it on any https page (this repo's GitHub Pages works). It also carries
a built-in mock, so it runs in any browser with no hardware for a dry run.

**Python bridge - `server.py` + `index.html`.** Use this to script it or add a
CAN/CCP transport. Mock mode needs only Python 3; real mode needs `pyserial`
and a K+DCAN cable:

```sh
python3 service-tool/server.py                       # mock, http://127.0.0.1:8730
python3 service-tool/server.py --port /dev/cu.usbserial-XXXX --baud 9600
```

The serial transport reuses the helpers in `~/Code/mk60-patcher/tools` when
present; without them, mock mode still works.

## Features → KWP services

| Feature | Service(s) | Preconditions |
|---|---|---|
| Software ID / identification | `$1A 94` -> `5A 94` + 30 bytes from flash `0x76d4` (software ID string + binary tail); `$1A 80/8F/90/99` EEPROM ident records | none; read on connect |
| Read faults | `$18 02 FF FF` -> `58 count [hi lo status]...` | none |
| Clear faults | `$14 FF 00` | none (coding DTC returns next power-on) |
| Read coding | `$23 00 00 FA 03 03` (EEPROM 0x0FA-0x0FC) | none |
| Write coding | `$3D 00 00 FB 03 01 DD` x3 (row, field1, checksum) | `$10 87` + security `0x7F` |
| Valve calibration | `$31 0x28` inlet, `$31 0x29` USV, `$33` status | session; actuates valves |
| Sensor calibration | `$31 0x20/0x21/0x22/0x24` offsets | stationary |
| Live data | `$21 0x02/0x05/0x06/0x07` | none |
| Memory read | `$23 00 HH LL 03 NN` (type 3 = EEPROM) | none |

## Faults and the ABS lamp

A `$18` DTC is a 2-byte number that several internal fault bits can share, so
the tool lists every candidate fault behind each DTC with its meaning. The
**ABS lamp** column says whether that fault switches ABS off, which is what
drives the ABS warning lamp output (pin 44, lamp channel 2 in the firmware):

- **yes** - the fault sets the ABS-off reaction (wheel-speed sensor faults,
  ECU / valve-relay / valve-driver faults, master pressure invalid `0x150004`,
  CAN faults `0xB0002` / `0xB0004`, the CAN scan fault `0xC1000`), or requests
  the lamp directly (`0x10080`, `0x12000`).
- **no** - traced and does not. Engine-CAN loss (`0xA0008`), the coding faults
  (`0x5E59`) and the steering faults (`0x1200xx`, including "offset never
  calibrated" `0x120080`) only disable brake TCS / ASR or mark yaw, lateral
  acceleration and steering untrusted; the ABS keeps working and the lamp
  stays off.
- **depends** - the DTC is shared by faults with different verdicts.
  `0x5E1F` is the common case: `0xB0002` lights the lamp, `0x120008` /
  `0x120080` do not. To tell them apart read the fault word for that group at
  RAM `0x101f04 + 2 x group` (e.g. group `0x12` at `0x101f28`).
- **not traced** - groups whose reaction was not followed through the code.

The verdicts come from the fault-reaction functions (`0x2ad04`, `0x2b624`,
`0x2be7c`), the ABS status that feeds the lamp request (`0x99398`) and the lamp
request table at `0x7694`; the lamp also lights during the power-on self-test.
Status `0x40` in the status byte means the fault is currently present, not just
stored. The TCS/DSC indicator (lamp channel 3) is only sent on CAN (`0x1A0`)
and is not covered by the column.

## Security key

Writing coding and unlocking levels `0x7E`/`0x7F` need the per-image `$27`
constants for your unit. They are **not** stored in this repo. In
`standalone.html` you type them into the two toolbar fields; for `server.py`
put a `seedkey.json` next to the scripts (it is gitignored) with your own
values:

```json
{ "6769162": { "afb9e": "0x....", "afb10": "0x...." } }
```

Mock mode needs no key. Level `0x03` needs none (image-independent).

## Safety

Writes and valve routines are confirmed in the UI and gated by the module's own
session, security and stationary checks. Valve calibration actuates the valves
and pump - bench only. Coding writes take effect at the next power-on and the
checksum is recomputed for you.

## Files

- `standalone.html` - browser-only tool (Web Serial + built-in mock), one file.
- `server.py` - loopback HTTP + JSON bridge for the Python path.
- `kwp.py` - the KWP service layer (serial + mock transports, key algorithms).
- `index.html` - UI served by `server.py`.
- `dtcmap.json` - DTC -> internal-fault decode table.
- `faultinfo.json` - internal fault -> meaning, ABS-lamp verdict and effect (source of truth for the `FAULTINFO` table embedded in `standalone.html` and `assets/kwp.js`).
