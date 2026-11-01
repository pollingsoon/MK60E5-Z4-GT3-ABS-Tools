#!/usr/bin/env python3
"""KWP2000 service layer for the Z4 GT3 (DSC60, ZB 6769162) web tool.

Two transports with the same .request(payload) -> body contract:

  RealKwp  - drives a K+DCAN cable through the bench-proven kline_ident
             (mk60-patcher/tools). Target 0x29, KWP2000* framing.
  MockKwp  - simulates the module from the documented service behaviour and
             the bench dumps, so the UI runs with no hardware attached.

Module wraps either transport with the high-level operations the UI calls:
read/clear faults, read/write coding, valve- and sensor-calibration routines,
memory and live-data reads, session and security.

Everything here is grounded in docs/kwp-services.md, docs/dtc.md and
docs/coding.md. Security constants are loaded at runtime from the gitignored
reference/seedkey.json; they are never embedded in this file.
"""
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))  # private analysis repo, when run from there
TGT = 0x29  # DSC diagnostic address


class KwpError(Exception):
    def __init__(self, nrc, name):
        self.nrc = nrc
        self.name = name
        super().__init__(f"NRC 0x{nrc:02X} {name}")


NRC = {0x10: "generalReject", 0x11: "serviceNotSupported", 0x12: "subFuncNotSupported",
       0x13: "wrongLength", 0x22: "conditionsNotCorrect", 0x31: "requestOutOfRange",
       0x33: "securityAccessDenied", 0x35: "invalidKey", 0x78: "responsePending"}

# $1A identification blocks (Z4 GT3 firmware): id -> (length, where it lives)
IDENT_BLOCKS = {0x80: (29, "EEPROM block 10 +0x1A"), 0x8F: (30, "EEPROM block 0 +0"),
                0x90: (7, "EEPROM block 10 +0x37"), 0x94: (30, "flash 0x76d4 (fixed)"),
                0x99: (4, "EEPROM block 10 +0x16")}

# The fixed 30-byte software-identification block the Z4 GT3 firmware copies verbatim
# for `$1A 94` (kwp_1a_read_ecu_id 0x27fac, source pointer 0x28dc0 -> flash 0x76d4):
# length byte, the 12-character software ID string, then a `90 00 0E` tag + 14-byte binary tail.
SW_IDENT_0x94 = bytes.fromhex("0c414e5f42424630303033382090000e001d07140a1d0003000000820101")


# ---- key algorithms (self-contained copies of the kline_ident versions) ----
def _ror16(v, n):
    v &= 0xFFFF
    return ((v >> n) | (v << (16 - n))) & 0xFFFF


def _bitrev16(v):
    r = 0
    for i in range(16):
        r |= ((v >> i) & 1) << (15 - i)
    return r & 0xFFFF


def kt_seedrev(seed, state=4):
    return (_bitrev16(seed) ^ _ror16(seed, state + 1)) & 0xFFFF


def kt_afb9e(seed, const):
    s = seed & 0xFFFF
    ns = (~s) & 0xFFFF
    res = 0
    for i in range(4):
        base = i * 4
        res |= ((s >> base) & 1) << (base + 2)
        res |= ((s >> (base + 2)) & 1) << base
        res |= ((ns >> (base + 1)) & 1) << (base + 1)
        res |= ((ns >> (base + 3)) & 1) << (base + 3)
    res = (res ^ _ror16(s, 5)) & 0xFFFF
    acc = 0
    for i in range(13):
        acc = (acc ^ ((res & (0xF << i)) << ((res >> i) & 0xF))) & 0xFFFFFFFF
    acc ^= (acc >> 16)
    return (res ^ acc ^ const) & 0xFFFF


def kt_afb10(seed, const):
    X = _ror16(seed, 3)
    res = 0
    for i in range(8):
        a, b = 15 - i, 7 - i
        if ((X >> i) & 1) ^ ((X >> (i + 8)) & 1):
            res |= ((X >> a) & 1) << b
            res |= ((X >> b) & 1) << a
        else:
            res |= ((~X >> a) & 1) << a
            res |= ((~X >> b) & 1) << b
    return (res ^ const) & 0xFFFF


def load_seedkey(zb="6769162"):
    """Return {'afb9e': int, 'afb10': int} from a local seedkey.json, or {}.

    Looked up next to this file first, then the private repo's reference/. The
    file holds the per-image security constants; it is gitignored and never
    committed. Without it, mock mode still works and real unlock reports a
    missing-constant error (you can also type the constants into standalone.html).
    """
    path = next((p for p in (os.path.join(HERE, "seedkey.json"),
                             os.path.join(REPO, "reference", "seedkey.json"))
                 if os.path.exists(p)), None)
    if not path:
        return {}
    # tolerate the // comments the file uses
    raw = "\n".join(l for l in open(path) if not l.lstrip().startswith("//"))
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    e = data.get(zb) or data.get(zb[:7]) or {}
    return {k: int(v, 16) for k, v in e.items() if k in ("afb9e", "afb10")}


# ---- transports -------------------------------------------------------------
class RealKwp:
    """K-line transport via the proven kline_ident helpers."""

    def __init__(self, port, baud=9600, wait=0.3, tgt=TGT):
        sys.path.insert(0, os.path.expanduser("~/Code/mk60-patcher/tools"))
        import kline_ident  # noqa
        self._ki = kline_ident
        self._ser = kline_ident.open_port(port, "kwp", baud)
        self.wait = wait
        self.tgt = tgt
        self.kind = "serial"

    def request(self, payload):
        raw, _ = self._ki.send(self._ser, self.tgt, list(payload), self.wait)
        body = raw[4:-1] if (len(raw) >= 5 and raw[0] == 0xB8) else raw
        if body and body[0] == 0x7F:
            nrc = body[2] if len(body) > 2 else 0
            raise KwpError(nrc, NRC.get(nrc, "?"))
        return bytes(body)

    def close(self):
        try:
            self._ser.close()
        except Exception:
            pass


class MockKwp:
    """Simulates the module from documented behaviour + the bench dumps."""

    def __init__(self, tgt=TGT):
        self.tgt = tgt
        self.kind = "mock"
        self.session = 0x81
        self.sec_level = 0
        self._seed = 0
        self.routine = {}  # id -> remaining ticks
        # bench coding: checksum 0xFA, row 0, field 0 (from docs/coding.md)
        self.eeprom = bytearray(0x400)
        self.eeprom[0xFA] = 0xFA
        self.eeprom[0xFB] = 0x00
        self.eeprom[0xFC] = 0x00
        # bench DTCs (triples: hi, lo, status) from docs/abs-fault.md
        self.dtcs = [(0x5E, 0x59, 0x60), (0x5E, 0x1F, 0x60), (0x5E, 0x1E, 0x60)]

    def request(self, payload):
        p = list(payload)
        s = p[0]
        if s == 0x10:  # session
            self.session = p[1]
            return bytes([0x50, p[1]])
        if s == 0x27:  # security
            sub = p[1]
            if sub in (0x03, 0xFB, 0xFD):  # seed request
                self._seed = 0x1234
                return bytes([0x67, sub, self._seed >> 8, self._seed & 0xFF])
            # key submit: mock always grants
            self.sec_level = {0x04: 0x03, 0xFC: 0x7E, 0xFE: 0x7F}.get(sub, self.sec_level)
            return bytes([0x67, sub])
        if s == 0x1A:  # read ECU identification
            iid = p[1] if len(p) > 1 else 0
            if iid == 0x94:
                return bytes([0x5A, 0x94]) + SW_IDENT_0x94
            if iid in IDENT_BLOCKS:  # EEPROM-backed blocks: content not on file, zero-filled
                blk = bytearray(IDENT_BLOCKS[iid][0])
                if iid == 0x80:
                    blk[2:6] = bytes.fromhex("06769162")  # part number 6769162, packed BCD at bytes 2..5
                return bytes([0x5A, iid]) + bytes(blk)
            raise KwpError(0x12, NRC[0x12])
        if s == 0x18:  # read DTC by status
            out = bytearray([0x58, len(self.dtcs)])
            for hi, lo, st in self.dtcs:
                out += bytes([hi, lo, st])
            return bytes(out)
        if s == 0x14:  # clear
            self.dtcs = []
            return bytes([0x54])
        if s == 0x23:  # read memory by address: 23 00 HH LL TT NN
            addr = (p[2] << 8) | p[3]
            n = p[5]
            return bytes([0x63]) + bytes(self.eeprom[addr:addr + n])
        if s == 0x3D:  # write memory by address: 3D 00 HH LL 03 01 DD
            if self.sec_level != 0x7F or self.session != 0x87:
                raise KwpError(0x33, NRC[0x33])
            addr = (p[2] << 8) | p[3]
            self.eeprom[addr] = p[6]
            return bytes([0x7D, 0x00, p[2], p[3], 0x03])
        if s == 0x31:  # start routine
            rid = p[1]
            if self.session == 0x81:
                raise KwpError(0x22, NRC[0x22])
            self.routine[rid] = 5
            return bytes([0x71, rid])
        if s == 0x33:  # routine status
            rid = p[1]
            left = self.routine.get(rid, 0)
            if left > 0:
                self.routine[rid] = left - 1
            done = self.routine.get(rid, 0) == 0
            return bytes([0x73, rid, 0x02 if done else 0x01])
        if s == 0x21:  # live data by local id
            lid = p[1]
            return bytes([0x61, lid]) + _mock_live(lid)
        if s == 0x3E:
            return bytes([0x7E, p[1] if len(p) > 1 else 0])
        raise KwpError(0x11, NRC[0x11])

    def close(self):
        pass


def _mock_live(lid):
    if lid == 0x02:  # conditioned values, 16-bit BE, FFFF = invalid
        vals = [0x0190, 0x0000, 0xFFFF, 0xFFFF, 0xFFFF, 0x0000, 0x0000, 0x0000, 0x0000, 0xFFFF]
        out = bytearray()
        for v in vals:
            out += bytes([v >> 8, v & 0xFF])
        return bytes(out)
    if lid == 0x05:
        return bytes([0x00])
    if lid == 0x07:  # four raw wheel speeds (0.01 km/h), then 5 zero
        return bytes([0, 0, 0, 0, 0, 0, 0, 0]) + bytes(5)
    return bytes([0x00])


# ---- DTC decode -------------------------------------------------------------
def load_dtc_names():
    """dtc number -> list of internal fault codes.

    Prefers the bundled dtcmap.json (dtc hex -> [fault hex,...]); falls back to
    the private repo's analysis/dtc_map.tsv when run from there.
    """
    jpath = os.path.join(HERE, "dtcmap.json")
    if os.path.exists(jpath):
        try:
            raw = json.load(open(jpath))
            return {int(k, 16): [int(f, 16) for f in v] for k, v in raw.items()}
        except (ValueError, json.JSONDecodeError):
            pass
    path = os.path.join(REPO, "analysis", "dtc_map.tsv")
    m = {}
    if not os.path.exists(path):
        return m
    for line in open(path):
        parts = line.rstrip("\n").split("\t")
        if len(parts) < 3 or parts[0] == "fault":
            continue
        try:
            fault = int(parts[0], 16)
            dtc = int(parts[2], 16)
        except ValueError:
            continue
        m.setdefault(dtc, []).append(fault)
    return m


def load_fault_info():
    """fault code -> {d, lamp, eff} from the bundled faultinfo.json (see README), or {}."""
    path = os.path.join(HERE, "faultinfo.json")
    if not os.path.exists(path):
        return {}
    try:
        raw = json.load(open(path))
    except (ValueError, json.JSONDecodeError):
        return {}
    return {int(k, 16): v for k, v in raw.items()}


def dtc_lamp(infos):
    """Per-DTC ABS-lamp verdict from its candidate faults: yes / no / depends / ?."""
    v = [i.get("lamp", "?") for i in infos]
    if not v:
        return "?"
    if all(x == "yes" for x in v):
        return "yes"
    if all(x == "no" for x in v):
        return "no"
    if "yes" in v:
        return "depends"
    return "no" if "no" in v else "?"


def decode_status(b):
    """A compact decode of the $18 status byte (see docs/dtc.md)."""
    bits = []
    if b & 0x80:
        bits.append("warning-lamp")
    if b & 0x40:
        bits.append("confirmed")
    if b & 0x20:
        bits.append("pending")
    if b & 0x01:
        bits.append("present")
    return bits


# ---- high-level module operations ------------------------------------------
class Module:
    def __init__(self, transport, zb="6769162"):
        self.t = transport
        self.zb = zb
        self.keys = load_seedkey(zb)
        self.dtc_names = load_dtc_names()
        self.fault_info = load_fault_info()

    # session / security
    def enter_session(self, level):
        self.t.request([0x10, level])
        return {"session": f"0x{level:02X}"}

    def tester_present(self):
        self.t.request([0x3E, 0x01])
        return {"ok": True}

    def unlock(self, level):
        """level: 0x03 (seedrev), 0x7E (afb9e/CCP), 0x7F (afb10/write)."""
        seed_sub, key_sub = {0x03: (0x03, 0x04), 0x7E: (0xFB, 0xFC),
                             0x7F: (0xFD, 0xFE)}[level]
        body = self.t.request([0x27, seed_sub])
        if len(body) < 4 or body[0] != 0x67:
            raise KwpError(0x22, "no seed")
        seed = (body[2] << 8) | body[3]
        if seed == 0:
            return {"level": f"0x{level:02X}", "already": True}
        if level == 0x03:
            key = kt_seedrev(seed)
        elif level == 0x7E:
            if "afb9e" not in self.keys:
                raise KwpError(0x33, "no afb9e constant in seedkey.json")
            key = kt_afb9e(seed, self.keys["afb9e"])
        else:
            if "afb10" not in self.keys:
                raise KwpError(0x33, "no afb10 constant in seedkey.json")
            key = kt_afb10(seed, self.keys["afb10"])
        self.t.request([0x27, key_sub, (key >> 8) & 0xFF, key & 0xFF])
        return {"level": f"0x{level:02X}", "seed": f"0x{seed:04X}", "key": f"0x{key:04X}"}

    # identification
    def read_ident(self, iid=0x94):
        """$1A <id>. For 0x94 decode the software-identification string."""
        body = self.t.request([0x1A, iid])
        data = body[2:] if len(body) >= 2 and body[0] == 0x5A else body
        out = {"id": f"0x{iid:02X}", "bytes": data.hex(), "len": len(data),
               "source": IDENT_BLOCKS.get(iid, (0, "?"))[1]}
        if iid == 0x80 and len(data) >= 6:
            # BMW part number (ZB): packed BCD in bytes 2..5 of the 0x80 block (5A 80 00 00 <ZB:4> ...)
            bcd = data[2:6]
            if all((b >> 4) <= 9 and (b & 0xF) <= 9 for b in bcd):
                out["zb"] = bcd.hex().lstrip("0") or "0"
        n = data[0] if data else 0
        s = data[1:1 + n]
        if iid == 0x94 and 0 < n < len(data) and all(0x20 <= b < 0x7F for b in s):
            out["sw_id"] = s.decode("ascii").strip()
            out["tail"] = data[1 + n:].hex()
            if len(data) > 0x15:
                out["keys"] = {"afb9e": (data[0x11] << 8) | data[0x13],
                               "afb10": (data[0x14] << 8) | data[0x15]}
        else:
            out["ascii"] = "".join(chr(b) if 0x20 <= b < 0x7F else "." for b in data)
        return out

    # one-click sequences, order-independent: adjustment session, then unlock
    def enable_coding_write(self):
        self.enter_session(0x87)
        return self.unlock(0x7F)

    def enable_ccp(self):
        self.enter_session(0x87)
        u = self.unlock(0x7E)
        self.t.request([0x31, 0x31, 0x01])  # diagnostic state 4: CCP served on CAN (bench-proven bytes)
        return u

    # faults
    def read_dtcs(self):
        body = self.t.request([0x18, 0x02, 0xFF, 0xFF])
        if not body or body[0] != 0x58:
            raise KwpError(0x10, "bad $18 reply")
        count = body[1]
        out = []
        for i in range(count):
            off = 2 + i * 3
            hi, lo, st = body[off], body[off + 1], body[off + 2]
            dtc = (hi << 8) | lo
            faults = self.dtc_names.get(dtc, [])
            infos = [self.fault_info.get(f, {"d": "(no entry)", "lamp": "?", "eff": ""}) for f in faults]
            out.append({
                "dtc": f"0x{dtc:04X}",
                "status": f"0x{st:02X}",
                "status_bits": decode_status(st),
                "faults": [f"0x{f:05X}" for f in faults],
                "info": infos,
                "lamp": dtc_lamp(infos),
            })
        return {"count": count, "dtcs": out}

    def clear_dtcs(self):
        self.t.request([0x14, 0xFF, 0x00])
        return {"cleared": True}

    # coding
    def read_coding(self):
        body = self.t.request([0x23, 0x00, 0x00, 0xFA, 0x03, 0x03])
        data = body[1:] if body and body[0] == 0x63 else body
        cksum, row, field1 = data[0], data[1], data[2]
        ok = cksum == ((row ^ field1) + 1) & 0xFF
        return {"checksum": f"0x{cksum:02X}", "row": row, "field1": field1,
                "checksum_ok": ok, "raw": data.hex()}

    def write_coding(self, row, field1=0):
        """Write row/field1 and the checksum; opens $10 87 + 0x7F itself."""
        self.enable_coding_write()
        cksum = ((row ^ field1) + 1) & 0xFF
        writes = [(0x00FB, row), (0x00FC, field1), (0x00FA, cksum)]
        done = []
        for addr, val in writes:
            self.t.request([0x3D, 0x00, (addr >> 8) & 0xFF, addr & 0xFF, 0x03, 0x01, val])
            done.append({"addr": f"0x{addr:03X}", "value": f"0x{val:02X}"})
        return {"written": done, "note": "takes effect at next power-on"}

    # routines (valve + sensor calibration)
    def run_routine(self, rid, args=None):
        self.enter_session(0x87)  # routines need the adjustment session
        payload = [0x31, rid] + list(args or [])
        self.t.request(payload)
        return {"started": f"0x{rid:02X}"}

    def routine_status(self, rid):
        body = self.t.request([0x33, rid])
        st = body[2] if len(body) > 2 else 0
        return {"routine": f"0x{rid:02X}", "status": f"0x{st:02X}",
                "running": st == 0x01, "done": st == 0x02}

    # memory / live data
    def read_memory(self, addr, length, mtype=0x03):
        out = bytearray()
        while length > 0:
            n = min(length, 0x20)
            body = self.t.request([0x23, 0x00, (addr >> 8) & 0xFF, addr & 0xFF, mtype, n])
            out += body[1:] if body and body[0] == 0x63 else body
            addr += n
            length -= n
        return {"bytes": out.hex(), "len": len(out)}

    def read_live(self, lid):
        body = self.t.request([0x21, lid])
        data = body[2:] if len(body) >= 2 and body[0] == 0x61 else body
        return {"lid": f"0x{lid:02X}", "bytes": data.hex(), "len": len(data)}


def make_transport(mock=True, port=None, baud=9600):
    if mock or not port:
        return MockKwp()
    return RealKwp(port, baud=baud)
