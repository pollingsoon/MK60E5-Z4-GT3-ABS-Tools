// PEAK PCAN-USB (classic, USB 0C72:000C) driver for Chrome/Edge over WebUSB.
//
// Protocol as implemented by the Linux driver drivers/net/can/usb/peak_usb/pcan_usb.c
// (GPL-2.0-only, PEAK-System). PCAN-USB FD and Pro use different protocols and are
// not supported. WebUSB needs https or localhost, and a click to pick the device.
//
//   const can = await PcanUsb.request();          // from a click handler
//   await can.start({ bitrate: 500000, listenOnly: false, onFrame: f => ... });
//   await can.send(0x6A2, [1, 1, 0, 0, 0, 0, 0, 0]);
//   const frame = await can.recv(2000);           // null on timeout
//   await can.close();
//
// A frame is { id, ext, rtr, data: Uint8Array, ts }; ts is the adapter's 16-bit
// tick counter (42.666 us per tick, wraps).

const PCAN_USB = {
  VENDOR: 0x0C72, PRODUCT: 0x000C,
  EP_CMD: 1, EP_MSG: 2,
  CMD_LEN: 16, MSG_LEN: 64,
  GET: 1, SET: 2,
  CMD_BITRATE: 1, CMD_SET_BUS: 3, CMD_SN: 6, CMD_REGISTER: 9, CMD_EXT_VCC: 10, CMD_ERR_FR: 11,
  BUS_XCVER: 2, BUS_SILENT: 3,
  SJA1000_INIT: 0x01,
  BERR_MASK: 0x06,           // report rx/tx error counters on each bus state change
  CLOCK_HZ: 8000000,         // half the 16 MHz crystal
  TX_CAN: 2,
  SL_TIMESTAMP: 0x80, SL_INTERNAL: 0x40, SL_EXT: 0x20, SL_RTR: 0x10, SL_DLC: 0x0F,
  TX_SRR: 0x01,
  REC_ERROR: 1, REC_ANALOG: 2, REC_BUSLOAD: 3, REC_TS: 4, REC_BUSEVT: 5,
  ERR_RXQOVR: 0x02, ERR_BUS_LIGHT: 0x04, ERR_BUS_HEAVY: 0x08, ERR_BUS_OFF: 0x10, ERR_QOVR: 0x40,
  RX_TRANSFERS: 4,           // transfers kept queued, as the Linux driver does
  QUEUE_MAX: 4096,
};

// BTR0/BTR1 for 16 time quanta at an 87.5% sample point (500k = 0x00 0x1C).
function pcanBtr(bitrate) {
  const brp = PCAN_USB.CLOCK_HZ / 16 / bitrate;
  if (!Number.isInteger(brp) || brp < 1 || brp > 64) throw new Error(`unsupported CAN bitrate ${bitrate}`);
  return [brp - 1, 0x1C];
}

// Decode one bulk-in buffer: [?, record count, records...]. Timestamps run across the
// buffer: the first is 16 bits, later ones are the low 8 bits. Stops at the first bad record.
function pcanDecodeBuffer(buf) {
  const P = PCAN_USB, out = { frames: [], errors: [], counters: null, sawTs: false, bad: null };
  if (buf.length <= 2) {
    if (buf.length > 0) out.bad = `short buffer (${buf.length} bytes)`;
    return out;
  }
  const count = buf[1];
  let p = 2, ts = 0, prev8 = 0, tsSeen = false;

  const fits = n => p + n <= buf.length;
  const readTs = () => {
    if (!tsSeen) {
      if (!fits(2)) return false;
      ts = buf[p] | (buf[p + 1] << 8);
      prev8 = ts & 0xFF;
      p += 2;
      tsSeen = true;
    } else {
      if (!fits(1)) return false;
      const t8 = buf[p++];
      if (t8 < prev8) ts = (ts + 0x100) & 0xFFFF;
      ts = (ts & 0xFF00) | t8;
      prev8 = t8;
    }
    return true;
  };

  for (let i = 0; i < count; i++) {
    if (!fits(1)) { out.bad = `record ${i} of ${count} past the end`; return out; }
    const sl = buf[p++];
    let len = sl & P.SL_DLC;

    if (sl & P.SL_INTERNAL) {                 // status record
      if (!fits(2)) { out.bad = "truncated status record"; return out; }
      const f = buf[p], n = buf[p + 1];
      p += 2;
      if ((sl & P.SL_TIMESTAMP) && !readTs()) { out.bad = "truncated status timestamp"; return out; }
      if (f === P.REC_ERROR) {
        out.errors.push(n);
      } else if (f === P.REC_ANALOG) {
        len = 2;
      } else if (f === P.REC_BUSLOAD) {
        len = 1;
      } else if (f === P.REC_TS) {
        if (!fits(2)) { out.bad = "truncated timestamp record"; return out; }
        out.sawTs = true;
      } else if (f === P.REC_BUSEVT && (n === 0x00 || n === 0x80) && fits(3)) {
        out.counters = { rx: buf[p + 1], tx: buf[p + 2] };
      }
      if (!fits(len)) { out.bad = "truncated status data"; return out; }
      p += len;
      continue;
    }

    const ext = !!(sl & P.SL_EXT), rtr = !!(sl & P.SL_RTR);   // CAN frame
    let id, flags;
    if (ext) {
      if (!fits(4)) { out.bad = "truncated extended id"; return out; }
      const v = (buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24)) >>> 0;
      id = v >>> 3;
      flags = v & 0x07;
      p += 4;
    } else {
      if (!fits(2)) { out.bad = "truncated id"; return out; }
      const v = buf[p] | (buf[p + 1] << 8);
      id = v >> 5;
      flags = v & 0x1F;
      p += 2;
    }
    if (!readTs()) { out.bad = "truncated frame timestamp"; return out; }
    let data = new Uint8Array(0);
    if (!rtr) {
      if (!fits(len)) { out.bad = "truncated frame data"; return out; }
      data = buf.slice(p, p + Math.min(len, 8));    // DLC 9..15 still means 8 bytes of payload
      p += len;
      if (flags & P.TX_SRR) p++;                    // a client id byte follows self-reception frames
    }
    out.frames.push({ id, ext, rtr, data, ts });
  }
  return out;
}

// One bulk-out buffer holding one classic CAN frame.
function pcanEncodeFrame(id, data, { ext = false, rtr = false, counter = 0 } = {}) {
  const P = PCAN_USB, d = Array.from(data || []);
  if (d.length > 8) throw new Error("a CAN frame carries at most 8 bytes");
  if (!Number.isInteger(id) || id < 0 || id > (ext ? 0x1FFFFFFF : 0x7FF)) throw new Error(`bad CAN id ${id}`);
  const b = new Uint8Array(P.MSG_LEN);
  b[0] = P.TX_CAN;
  b[1] = 1;
  b[2] = d.length | (rtr ? P.SL_RTR : 0) | (ext ? P.SL_EXT : 0);
  let p = 3;
  if (ext) {
    const v = (id * 8) >>> 0;
    b[p++] = v & 0xFF; b[p++] = (v >>> 8) & 0xFF; b[p++] = (v >>> 16) & 0xFF; b[p++] = v >>> 24;
  } else {
    const v = id << 5;
    b[p++] = v & 0xFF; b[p++] = v >> 8;
  }
  if (!rtr) b.set(d, p);
  b[P.MSG_LEN - 1] = counter & 0xFF;
  return b;
}

class PcanUsb {
  // Must be called from a click: Chrome shows its device picker.
  static async request(usb) {
    const u = usb || navigator.usb;
    if (!u) throw new Error("WebUSB is not available: use Chrome or Edge over https or localhost");
    return new PcanUsb(await u.requestDevice({ filters: [{ vendorId: PCAN_USB.VENDOR, productId: PCAN_USB.PRODUCT }] }));
  }

  // The adapter this page already has permission for, else the picker (needs a click).
  static async open(usb) {
    const u = usb || navigator.usb;
    if (!u) throw new Error("WebUSB is not available: use Chrome or Edge over https or localhost");
    const known = (await u.getDevices()).filter(d => d.vendorId === PCAN_USB.VENDOR && d.productId === PCAN_USB.PRODUCT);
    return known.length === 1 ? new PcanUsb(known[0]) : PcanUsb.request(u);
  }

  constructor(device) {
    this.device = device;
    this.running = false;
    this.listenOnly = false;
    this.state = "closed";      // closed / active / warning / passive / bus-off
    this.counters = { rx: 0, tx: 0 };
    this.stats = { frames: 0, dropped: 0, badBuffers: 0, overruns: 0 };
    this.queue = [];
    this.waiter = null;
    this.txCounter = 0;
    this.sawTs = false;
    this.onFrame = null;
    this.onStatus = null;       // ({ state, counters, overrun, fatal, bad })
  }

  async _cmd(f, n, args) {
    const b = new Uint8Array(PCAN_USB.CMD_LEN);
    b[0] = f;
    b[1] = n;
    if (args) b.set(args, 2);
    const r = await this.device.transferOut(PCAN_USB.EP_CMD, b);
    if (r.status !== "ok") throw new Error(`PCAN-USB command ${f}/${n}: ${r.status}`);
  }

  async _open() {
    const d = this.device;
    try {
      await d.open();
      if (d.configuration === null) await d.selectConfiguration(1);
      await d.claimInterface(0);
    } catch (e) {
      if (e.name === "SecurityError" || e.name === "NetworkError") {
        throw new Error(`can't claim the PCAN-USB (${e.message}). Close PCAN-View and any Python tool using it; ` +
                        "on Linux unbind peak_usb, and on Windows the device needs the WinUSB driver");
      }
      throw e;
    }
  }

  // Opens the adapter and goes on the bus. listenOnly keeps the adapter fully silent:
  // it won't even ACK, so on a bus with no other receiver the sender repeats its frames.
  async start({ bitrate = 500000, listenOnly = true, onFrame = null, onStatus = null } = {}) {
    const P = PCAN_USB, btr = pcanBtr(bitrate);
    // The driver only uses silent mode above hardware revision 3.
    const canSilence = this.device.deviceVersionMajor > 3;
    if (listenOnly && !canSilence) throw new Error("this PCAN-USB revision has no listen-only mode");
    this.onFrame = onFrame;
    this.onStatus = onStatus;
    this.listenOnly = listenOnly;
    await this._open();
    try {
      await this._cmd(P.CMD_SET_BUS, P.BUS_XCVER, [0]);                       // off the bus to configure
      await this._cmd(P.CMD_REGISTER, P.SET, [0, P.SJA1000_INIT]);
      await this._cmd(P.CMD_BITRATE, P.SET, [btr[1], btr[0]]);                // BTR1 then BTR0
      this.running = true;
      for (let i = 0; i < P.RX_TRANSFERS; i++) this._rxLoop();
      await this._cmd(P.CMD_ERR_FR, P.SET, [P.BERR_MASK]);
      if (canSilence) await this._cmd(P.CMD_SET_BUS, P.BUS_SILENT, [listenOnly ? 1 : 0]);
      await this._cmd(P.CMD_EXT_VCC, P.SET, [0]);                             // no 5 V on the D-sub
      await this._cmd(P.CMD_SET_BUS, P.BUS_XCVER, [1]);
      await new Promise(r => setTimeout(r, 10));                              // needs time to init
      this.state = "active";
    } catch (e) {
      await this.close().catch(() => {});
      throw e;
    }
  }

  async _rxLoop() {
    const P = PCAN_USB;
    while (this.running) {
      let r;
      try {
        r = await this.device.transferIn(P.EP_MSG, P.MSG_LEN);
      } catch (e) {
        if (this.running) this._fatal(`USB read failed: ${e.message}`);   // e.g. unplugged
        return;
      }
      if (r.status === "stall") {
        try { await this.device.clearHalt("in", P.EP_MSG); } catch (e) { this._fatal(`USB stall: ${e.message}`); return; }
        continue;
      }
      if (r.data && r.data.byteLength) {
        this._handle(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength));
      }
    }
  }

  _fatal(message) {
    this.running = false;
    this.state = "closed";
    this._report({ fatal: message });
  }

  _report(extra) {
    if (this.onStatus) this.onStatus({ state: this.state, counters: this.counters, ...extra });
  }

  _handle(buf) {
    const P = PCAN_USB, d = pcanDecodeBuffer(buf);
    if (d.sawTs) this.sawTs = true;
    if (d.counters) this.counters = d.counters;
    for (const n of d.errors) {
      if (n === P.ERR_QOVR && !this.sawTs) continue;   // stale until the first timestamp
      const overrun = !!(n & P.ERR_RXQOVR);
      if (overrun) this.stats.overruns++;
      const hot = this.counters.rx >= 128 || this.counters.tx >= 128;
      const state = (n & P.ERR_BUS_OFF) ? "bus-off" : (n & P.ERR_BUS_HEAVY) ? (hot ? "passive" : "warning") : "active";
      const changed = state !== this.state;
      this.state = state;
      if (changed || overrun) this._report({ overrun });
    }
    for (const f of d.frames) this._push(f);
    if (d.bad) {
      this.stats.badBuffers++;
      this._report({ bad: d.bad });
    }
  }

  _push(frame) {
    this.stats.frames++;
    if (this.onFrame) this.onFrame(frame);
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      clearTimeout(w.timer);
      w.resolve(frame);
      return;
    }
    this.queue.push(frame);
    if (this.queue.length > PCAN_USB.QUEUE_MAX) {
      this.queue.shift();
      this.stats.dropped++;
    }
  }

  flush() {
    this.queue.length = 0;
  }

  // Next received frame, or null after timeoutMs. One caller at a time.
  recv(timeoutMs = 0) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (!timeoutMs || !this.running) return Promise.resolve(null);
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.waiter = null; resolve(null); }, timeoutMs);
      this.waiter = { resolve, timer };
    });
  }

  async send(id, data, opts = {}) {
    if (!this.running) throw new Error("PCAN-USB is not running");
    if (this.listenOnly) throw new Error("PCAN-USB is in listen-only mode");
    const b = pcanEncodeFrame(id, data, { ...opts, counter: this.txCounter });
    this.txCounter = (this.txCounter + 1) & 0xFF;
    const r = await this.device.transferOut(PCAN_USB.EP_MSG, b);
    if (r.status !== "ok") throw new Error(`PCAN-USB send: ${r.status}`);
  }

  async close() {
    const P = PCAN_USB, wasRunning = this.running, d = this.device;
    this.running = false;
    this.state = "closed";
    if (this.waiter) {
      clearTimeout(this.waiter.timer);
      this.waiter.resolve(null);
      this.waiter = null;
    }
    try {
      if (wasRunning) {
        await this._cmd(P.CMD_SET_BUS, P.BUS_XCVER, [0]);
        await this._cmd(P.CMD_REGISTER, P.SET, [0, P.SJA1000_INIT]);
      }
    } finally {
      if (d.opened) {
        try { await d.releaseInterface(0); } catch (e) { /* closing anyway */ }
        await d.close();
      }
    }
  }
}

// KWP2000 over BMW diagnostic CAN: ISO-TP with the target address in byte 0 of each frame,
// tester 0xF1 sends on 0x6F1, the DSC (0x29) answers on 0x629. Same request(payload) -> body
// contract as WebSerialKwp, so Module runs over it unchanged. Used for the M3.
const PCAN_KWP = { REQ_ID: 0x6F1, RESP_ID: 0x629, ECU: 0x29, TESTER: 0xF1, BITRATE: 500000,
                   TIMEOUT_MS: 2000, PENDING_MS: 5000, FC_MS: 1500 };

class PcanKwp {
  constructor(can) {
    this.kind = "can";
    this.can = can || null;     // a PcanUsb; connect() finds one if not given
    this.onStatus = null;       // bus state and adapter faults from PcanUsb
    this.chain = Promise.resolve();
  }

  async connect() {
    if (!this.can) this.can = await PcanUsb.open();
    await this.can.start({ bitrate: PCAN_KWP.BITRATE, listenOnly: false,
                           onStatus: s => { if (this.onStatus) this.onStatus(s); } });
  }

  async _tx(bytes) {
    const K = PCAN_KWP, f = new Array(8).fill(0);
    f[0] = K.ECU;
    bytes.forEach((b, i) => { f[i + 1] = b; });
    await this.can.send(K.REQ_ID, f);
  }

  // The next ISO-TP payload addressed to the tester, or null on timeout. Everything else
  // on the bus (the module's broadcasts) is skipped.
  async _rx(timeoutMs) {
    const K = PCAN_KWP, end = Date.now() + timeoutMs;
    for (;;) {
      const left = end - Date.now();
      if (left <= 0) return null;
      const f = await this.can.recv(left);
      if (!f) return null;
      if (!f.ext && f.id === K.RESP_ID && f.data.length >= 1 && f.data[0] === K.TESTER) return Array.from(f.data.slice(1));
    }
  }

  async _send(p) {
    const K = PCAN_KWP;
    if (p.length <= 6) return this._tx([p.length, ...p]);
    if (p.length > 0xFFF) throw new Error("request too long for ISO-TP");
    await this._tx([0x10 | (p.length >> 8), p.length & 0xFF, ...p.slice(0, 5)]);
    let fc = await this._rx(K.FC_MS);
    if (!fc || (fc[0] & 0xF0) !== 0x30) throw new Error("no ISO-TP flow control from the module");
    let bs = fc[1], st = fc[2], sn = 1, inBlock = 0;
    for (let i = 5; i < p.length; i += 6) {
      await this._tx([0x20 | sn, ...p.slice(i, i + 6)]);
      sn = (sn + 1) & 0x0F;
      inBlock++;
      if (bs && inBlock === bs && i + 6 < p.length) {
        fc = await this._rx(K.TIMEOUT_MS);
        if (!fc || (fc[0] & 0xF0) !== 0x30) throw new Error("no ISO-TP flow control from the module");
        bs = fc[1];
        st = fc[2];
        inBlock = 0;
      } else if (st >= 1 && st <= 0x7F) {
        await new Promise(r => setTimeout(r, st));   // STmin in ms; the microsecond range needs no wait here
      }
    }
  }

  async _recv(timeoutMs) {
    const K = PCAN_KWP, first = await this._rx(timeoutMs);
    if (!first) throw new Error("no response from the module on CAN");
    const pci = first[0] & 0xF0;
    if (pci === 0x00) return first.slice(1, 1 + (first[0] & 0x0F));
    if (pci !== 0x10) throw new Error(`unexpected ISO-TP frame type 0x${first[0].toString(16)}`);
    const total = ((first[0] & 0x0F) << 8) | first[1];
    const buf = first.slice(2);
    await this._tx([0x30, 0, 0]);                    // clear to send, no block limit, no gap
    let sn = 1;
    while (buf.length < total) {
      const cf = await this._rx(K.TIMEOUT_MS);
      if (!cf) throw new Error("module stopped mid-response (ISO-TP timeout)");
      if ((cf[0] & 0xF0) !== 0x20) continue;
      if ((cf[0] & 0x0F) !== sn) throw new Error(`ISO-TP sequence error: expected ${sn}, got ${cf[0] & 0x0F}`);
      buf.push(...cf.slice(1));
      sn = (sn + 1) & 0x0F;
    }
    return buf.slice(0, total);
  }

  async _exchange(p) {
    const K = PCAN_KWP;
    this.can.flush();                                // drop broadcasts queued since the last request
    await this._send(p);
    let timeout = K.TIMEOUT_MS;
    for (;;) {
      const r = await this._recv(timeout);
      if (r[0] === 0x7F && r[2] === 0x78) {          // responsePending: the module needs longer
        timeout = Math.max(timeout, K.PENDING_MS);
        continue;
      }
      if (r[0] === 0x7F) throw new KwpError(r[2] || 0);
      if (r[0] !== (p[0] | 0x40)) throw new Error(`mismatched response 0x${r[0].toString(16)} to service 0x${p[0].toString(16)}`);
      return r;
    }
  }

  // One exchange at a time: replies are matched by order, not by an id.
  request(p) {
    const run = this.chain.then(() => this._exchange(Array.from(p)));
    this.chain = run.catch(() => {});
    return run;
  }

  async close() {
    if (this.can) await this.can.close();
  }
}

if (typeof module !== "undefined") module.exports = { PCAN_USB, PcanUsb, PcanKwp, PCAN_KWP, pcanBtr, pcanDecodeBuffer, pcanEncodeFrame };
