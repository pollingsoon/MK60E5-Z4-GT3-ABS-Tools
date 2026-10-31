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
| Read faults | `$18 02 FF FF` -> `58 count [hi lo status]...` | none |
| Clear faults | `$14 FF 00` | none (coding DTC returns next power-on) |
| Read coding | `$23 00 00 FA 03 03` (EEPROM 0x0FA-0x0FC) | none |
| Write coding | `$3D 00 00 FB 03 01 DD` x3 (row, field1, checksum) | `$10 87` + security `0x7F` |
| Valve calibration | `$31 0x28` inlet, `$31 0x29` USV, `$33` status | session; actuates valves |
| Sensor calibration | `$31 0x20/0x21/0x22/0x24` offsets | stationary |
| Live data | `$21 0x02/0x05/0x06/0x07` | none |
| Memory read | `$23 00 HH LL 03 NN` (type 3 = EEPROM) | none |

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
