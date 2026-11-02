#!/usr/bin/env python3
"""Dump flash or RAM through the module's CCP slave on PT-CAN.

Only CCP CONNECT, SHORT_UP and DISCONNECT are sent, so nothing
is written to the module. CCP has to be enabled first over K-line (`Unlock:
Enable CCP`: 10 87, 27 FB/FC, 31 31 01); it then stays on until power-off.

    python3 ccp.py 0 0x9B5F4 app.bin             # application flash (resumable)
    python3 ccp.py 0x100000 0x4000 ram.bin       # RAM snapshot
    python3 ccp.py 0 0x9B5F4 test.bin --mock     # no hardware

Real reads need python-can (requirements.txt) and a CAN adapter on PT-CAN at 500 kbit/s.
"""
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

CRO_ID = 0x6A2  # tester -> ECU
DTO_ID = 0x6A0  # ECU -> tester
STATION = 0x0000
CMD_CONNECT, CMD_DISCONNECT, CMD_SHORT_UP = 0x01, 0x07, 0x0F

# 0x2F8-0x2FF raises a read fault; those bytes stay 0xFF in the output.
DEFAULT_SKIPS = [(0x2F8, 0x300)]
# The slave answers CCP error 0x20 around the 47th read of a session, at varying
# addresses (cause not isolated). Disconnect, counter reset and CONNECT every 32
# reads avoids it.
RECONNECT_READS = 32
READ_RETRIES = 2

REGIONS = {
    "app": (0x000000, 0x9B5F4, "application flash"),
    "ram": (0x100000, 0x4000, "main RAM (live snapshot)"),
}
class CcpError(RuntimeError):
    pass


class Frame:
    """The part of can.Message the client and the mock bus need."""

    def __init__(self, arbitration_id, data, is_extended_id=False):
        self.arbitration_id = arbitration_id
        self.data = bytes(data)
        self.is_extended_id = is_extended_id
        self.is_error_frame = False


class CcpClient:
    def __init__(self, bus, message=Frame, timeout=2.0,
                 cro_id=CRO_ID, dto_id=DTO_ID, station=STATION):
        self.bus = bus
        self.message = message
        self.timeout = timeout
        self.cro_id = cro_id
        self.dto_id = dto_id
        self.station = station
        self.counter = 0

    def _request(self, data):
        self.bus.send(self.message(arbitration_id=self.cro_id, data=data, is_extended_id=False))
        deadline = time.monotonic() + self.timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"no CCP response to {data.hex(' ')}")
            msg = self.bus.recv(remaining)
            if (msg is None or msg.is_error_frame or msg.is_extended_id
                    or msg.arbitration_id != self.dto_id):
                continue
            r = bytes(msg.data)
            if len(r) != 8 or r[0] != 0xFF:
                raise CcpError(f"unexpected CCP response: {r.hex(' ')}")
            if r[1] != 0:
                raise CcpError(f"CCP error 0x{r[1]:02X} to {data.hex(' ')}")
            if r[2] != data[1]:
                raise CcpError(f"CCP counter mismatch: sent 0x{data[1]:02X}, got 0x{r[2]:02X}")
            return r

    def _next_counter(self):
        self.counter = (self.counter + 1) & 0xFF
        return self.counter

    def connect(self):
        s = self.station
        return self._request(bytes([CMD_CONNECT, self._next_counter(), s & 0xFF, s >> 8, 0, 0, 0, 0]))

    def short_up(self, address, size):
        if not 1 <= size <= 5:
            raise ValueError("SHORT_UP size must be 1..5 bytes")
        req = bytes([CMD_SHORT_UP, self._next_counter(), size, 0]) + address.to_bytes(4, "big")
        return self._request(req)[3:3 + size]

    def disconnect(self):
        self._request(bytes([CMD_DISCONNECT, self._next_counter(), 0, 0, 0, 0, 0, 0]))

    def reconnect(self):
        """New session: drop any late replies, then CONNECT with the counter reset."""
        end = time.monotonic() + 0.05
        while time.monotonic() < end and self.bus.recv(0) is not None:
            pass
        self.counter = 0
        self.connect()


class DumpOutput:
    """Output file pre-filled with 0xFF, with a .progress.json sidecar until complete."""

    def __init__(self, path, start, size, fresh=False):
        self.path = Path(path)
        self.progress_path = self.path.with_name(self.path.name + ".progress.json")
        self.start, self.size = start, size
        self.offset = 0
        self.last_saved = -1
        if fresh or not self.path.exists():
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.file = self.path.open("w+b")
            self.file.write(b"\xFF" * size)
            self.save(force=True)
            return
        if not self.progress_path.exists():
            raise CcpError(f"{self.path} is already a finished dump; start over to overwrite it")
        progress = json.loads(self.progress_path.read_text())
        if progress.get("start") != start or progress.get("size") != size:
            raise CcpError(f"{self.path} holds a different address range; start over to overwrite it")
        self.offset = int(progress["next"])
        if not 0 <= self.offset <= size:
            raise CcpError("invalid resume offset in the progress file")
        self.file = self.path.open("r+b")

    def seek(self, offset):
        self.offset = offset
        self.save(force=True)

    def write(self, data):
        self.file.seek(self.offset)
        self.file.write(data)
        self.offset += len(data)
        self.save()

    def save(self, force=False):
        if not force and self.offset // 0x1000 == self.last_saved:
            return
        self.last_saved = self.offset // 0x1000
        self.file.flush()
        self.progress_path.write_text(
            json.dumps({"start": self.start, "size": self.size, "next": self.offset}))

    def close(self, complete):
        self.save(force=True)
        self.file.close()
        if complete:
            self.progress_path.unlink(missing_ok=True)


def dump_region(client, start, size, path, fresh=False, skips=None,
                enable=None, progress=None, cancel=None):
    """Read [start, start+size) to `path`. Returns a result dict; resumes if it can.

    enable:   called once if the first CONNECT gets no answer (turn CCP on, K-line).
    progress: called with (next_offset, bytes_per_second) about twice a second.
    cancel:   threading.Event-like; when set the dump stops and can be resumed later.
    """
    if size <= 0 or start < 0 or start + size > 1 << 32:
        raise ValueError("region must have a positive size inside the 32-bit address space")
    skips = DEFAULT_SKIPS if skips is None else skips

    # CONNECT before touching the output, so a dead bus can't wipe an earlier dump.
    try:
        client.connect()
    except TimeoutError:
        if enable is None:
            raise CcpError("no answer to CCP CONNECT: enable CCP over K-line first "
                           "(Unlock: Enable CCP), and check CAN wiring and module power")
        enable()
        try:
            client.reconnect()
        except TimeoutError:
            raise CcpError("CCP is enabled but CONNECT gets no answer on CAN: "
                           "check the PT-CAN wiring, the bitrate and module power") from None

    out = DumpOutput(path, start, size, fresh)
    resumed_at = out.offset
    started = last_report = time.monotonic()
    reads = 0
    complete = False
    try:
        while out.offset < size:
            if cancel is not None and cancel.is_set():
                return {"state": "cancelled", "next": out.offset, "path": str(out.path)}
            address = start + out.offset
            n = min(5, size - out.offset)
            gap = next(((a, b) for a, b in skips if address < b and address + n > a), None)
            if gap is not None:
                if address >= gap[0]:
                    out.seek(min(gap[1] - start, size))
                    continue
                n = gap[0] - address  # read the safe prefix before the gap
            if reads >= RECONNECT_READS:
                client.disconnect()
                client.reconnect()
                reads = 0
            for attempt in range(READ_RETRIES + 1):
                try:
                    chunk = client.short_up(address, n)
                    break
                except (TimeoutError, CcpError) as e:
                    if attempt == READ_RETRIES:
                        raise CcpError(f"read failed at 0x{address:08X}: {e}. Progress is saved; "
                                       "start again to resume, or skip this range") from e
                    try:
                        client.disconnect()
                    except (TimeoutError, CcpError):
                        pass
                    try:
                        client.reconnect()
                        reads = 0
                    except (TimeoutError, CcpError):
                        pass  # the retry reports it
            out.write(chunk)
            reads += 1
            now = time.monotonic()
            if progress is not None and now - last_report >= 0.5:
                progress(out.offset, (out.offset - resumed_at) / max(0.001, now - started))
                last_report = now
        complete = True
    finally:
        out.close(complete)
        try:
            client.disconnect()
        except (TimeoutError, CcpError):
            pass

    digest = hashlib.sha256(out.path.read_bytes()).hexdigest()
    return {"state": "done", "next": size, "path": str(out.path), "sha256": digest}


# ---- transports -------------------------------------------------------------
def open_bus(interface="pcan", channel="PCAN_USBBUS1", bitrate=500_000):
    """Return (bus, message class) for a real adapter through python-can."""
    try:
        import can
    except ImportError:
        raise CcpError("CAN dumps need python-can: pip install -r requirements.txt") from None
    bus = can.interface.Bus(interface=interface, channel=channel, bitrate=bitrate,
                            receive_own_messages=False)
    return bus, can.Message


class MockCcpBus:
    """A CCP slave behind the python-can send/recv calls the client uses.

    Serves `image` at address 0 (a synthetic pattern by default), stays silent
    until `enabled()` is true, never answers a read touching `faults`, and like
    the module answers CCP error 0x20 from the 47th read of a session.
    """

    SESSION_READS = 46

    def __init__(self, image=None, enabled=lambda: True, faults=((0x2F8, 0x300), (0x110000, 1 << 32))):
        self.image = image
        self.enabled = enabled
        self.faults = faults
        self.reply = None
        self.session_reads = 0
        self.session_errors = 0
        self.silent_reads = 0  # test hook: drop this many SHORT_UPs

    def _byte(self, a):
        if self.image is not None:
            return self.image[a] if a < len(self.image) else 0xFF
        return (a ^ (a >> 8) ^ (a >> 16)) & 0xFF

    def send(self, msg):
        d = msg.data
        self.reply = None
        if msg.arbitration_id != CRO_ID or not self.enabled():
            return
        if d[0] == CMD_SHORT_UP:
            if self.silent_reads > 0:
                self.silent_reads -= 1
                return
            a, n = int.from_bytes(d[4:8], "big"), d[2]
            if any(a < hi and a + n > lo for lo, hi in self.faults):
                return
            if self.session_reads >= self.SESSION_READS:
                self.session_errors += 1
                self.reply = Frame(DTO_ID, bytes([0xFF, 0x20, d[1], 0, 0, 0, 0, 0]))
                return
            self.session_reads += 1
            body = bytes(self._byte(a + i) for i in range(n))
        elif d[0] in (CMD_CONNECT, CMD_DISCONNECT):
            self.session_reads = 0
            body = b""
        else:
            self.reply = Frame(DTO_ID, bytes([0xFF, 0x30, d[1], 0, 0, 0, 0, 0]))
            return
        self.reply = Frame(DTO_ID, bytes([0xFF, 0, d[1]]) + body.ljust(5, b"\0"))

    def recv(self, timeout=None):
        r, self.reply = self.reply, None
        if r is None and timeout:
            time.sleep(min(timeout, 0.01))  # a silent module: let the caller's deadline run out
        return r

    def shutdown(self):
        pass


# ---- command line -----------------------------------------------------------
def _skip(text):
    a, b = (int(v, 0) for v in text.split(":", 1))
    return a, b


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("start", type=lambda v: int(v, 0))
    ap.add_argument("size", type=lambda v: int(v, 0))
    ap.add_argument("output")
    ap.add_argument("--fresh", action="store_true", help="overwrite an existing dump instead of resuming")
    ap.add_argument("--skip", type=_skip, action="append", default=[], metavar="START:END",
                    help="end-exclusive range to leave as 0xFF (repeatable)")
    ap.add_argument("--interface", default="pcan", help="python-can interface (default pcan)")
    ap.add_argument("--channel", default="PCAN_USBBUS1")
    ap.add_argument("--bitrate", type=lambda v: int(v, 0), default=500_000)
    ap.add_argument("--mock", action="store_true", help="simulated module, no hardware")
    args = ap.parse_args()

    def progress(offset, rate):
        left = (args.size - offset) / rate if rate else 0
        print(f"\r0x{args.start + offset:08X}  {offset / args.size * 100:5.1f}%  "
              f"{rate:6.0f} B/s  {left / 60:5.1f} min left ", end="", flush=True)

    bus = None
    try:
        bus, message = (MockCcpBus(), Frame) if args.mock else open_bus(args.interface, args.channel, args.bitrate)
        r = dump_region(CcpClient(bus, message), args.start, args.size, args.output,
                        fresh=args.fresh, skips=DEFAULT_SKIPS + args.skip, progress=progress)
    except KeyboardInterrupt:
        print("\ninterrupted; run the same command again to resume")
        return 130
    except Exception as e:  # python-can raises adapter errors of its own
        print(f"\nerror: {e}", file=sys.stderr)
        return 1
    finally:
        if bus is not None:
            bus.shutdown()
    print(f"\ndone: {r['path']}\nsha256 {r['sha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
