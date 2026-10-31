const DTCMAP = {
  "5D8C": ["A1000"],
  "5D8E": ["A4000"],
  "5D8F": ["A8000", "F0001", "F0002", "F0004", "F0008", "F0010", "F0020", "F0040", "F0080", "F0100", "F0200", "F0400", "F0800", "F1000", "F2000"],
  "5D90": ["20001"],
  "5D91": ["20002"],
  "5D92": ["20020"],
  "5D93": ["20008"],
  "5D94": ["20010"],
  "5D95": ["20004"],
  "5D96": ["20040"],
  "5D97": ["80020", "80040", "90400", "90800", "F4000", "F8000"],
  "5D99": ["A0200", "A0400"],
  "5D9A": ["1C0001", "1C0002", "1C0004", "1C0100", "1C0200", "1C0400"],
  "5D9B": ["1C0040", "1C0800", "1C1000"],
  "5D9C": ["1C0020"],
  "5D9D": ["1C0080"],
  "5D9E": ["1C0008"],
  "5D9F": ["1C4000"],
  "5DA0": ["30001"],
  "5DA1": ["30002"],
  "5DA2": ["30020"],
  "5DA3": ["30008"],
  "5DA4": ["30010"],
  "5DA5": ["30004"],
  "5DA6": ["30040"],
  "5DAA": ["1D0001", "1D0002", "1D0004", "1D0100", "1D0200", "1D0400"],
  "5DAB": ["1D0040", "1D0800", "1D1000"],
  "5DAC": ["1D0020"],
  "5DAD": ["1D0080"],
  "5DAE": ["1D0008"],
  "5DAF": ["1D4000"],
  "5DB0": ["40001"],
  "5DB1": ["40002"],
  "5DB2": ["40020"],
  "5DB3": ["40008"],
  "5DB4": ["40010"],
  "5DB5": ["40004"],
  "5DB6": ["40040"],
  "5DBA": ["1E0001", "1E0002", "1E0004", "1E0100", "1E0200", "1E0400"],
  "5DBB": ["1E0040", "1E0800", "1E1000"],
  "5DBC": ["1E0020"],
  "5DBD": ["1E0080"],
  "5DBE": ["1E0008"],
  "5DBF": ["1E4000"],
  "5DC0": ["50001"],
  "5DC1": ["50002"],
  "5DC2": ["50020"],
  "5DC3": ["50008"],
  "5DC4": ["50010"],
  "5DC5": ["50004"],
  "5DC6": ["50040"],
  "5DCA": ["1F0001", "1F0002", "1F0004", "1F0100", "1F0200", "1F0400"],
  "5DCB": ["1F0040", "1F0800", "1F1000"],
  "5DCC": ["1F0020"],
  "5DCD": ["1F0080"],
  "5DCE": ["1F0008"],
  "5DCF": ["1F4000"],
  "5DD0": ["88000"],
  "5DD1": ["84000"],
  "5DD2": ["150004"],
  "5DD3": ["150100", "150200", "150400", "150800", "151000", "152000", "154000"],
  "5DF0": ["60100", "60200", "60400"],
  "5DF1": ["60800"],
  "5DF2": ["10002", "10004", "10008", "10010", "10020", "10100", "A0001", "A0100"],
  "5DF4": ["80001", "A0080"],
  "5DF5": ["10001", "10080", "10200", "10400", "10800", "11000", "14000", "60001", "60002", "60004", "60008", "60010", "60020", "70001", "70002", "70004", "70008", "70010", "70020", "70040", "70080", "70100", "70200", "70400", "70800", "71000", "72000", "74000", "78000", "80004", "150080"],
  "5DF7": ["80002"],
  "5DFF": ["94000"],
  "5E00": ["140001"],
  "5E01": ["140002"],
  "5E02": ["140008"],
  "5E03": ["140010"],
  "5E04": ["140020"],
  "5E05": ["140040"],
  "5E06": ["140080"],
  "5E07": ["140100"],
  "5E08": ["140200"],
  "5E11": ["A0002", "A0004"],
  "5E14": ["A0008"],
  "5E15": ["A0010"],
  "5E16": ["B0004"],
  "5E18": ["B0010"],
  "5E19": ["B0040"],
  "5E1A": ["A0020"],
  "5E1E": ["A0040"],
  "5E1F": ["B0002", "120008", "120080"],
  "5E20": ["110001", "110002", "110004", "110100", "110200", "110400"],
  "5E24": ["110040", "110800", "111000"],
  "5E25": ["114000"],
  "5E26": ["80008", "80010"],
  "5E28": ["130400"],
  "5E29": ["131000"],
  "5E2D": ["B2000"],
  "5E2E": ["B4000"],
  "5E2F": ["90001", "90002"],
  "5E30": ["100100", "100200", "100400", "100800"],
  "5E32": ["101000", "102000"],
  "5E34": ["D0001", "D0002", "D0008"],
  "5E35": ["D0004"],
  "5E38": ["100001", "100002", "100004", "100008"],
  "5E3C": ["100010", "100020", "100040"],
  "5E40": ["120001", "120002", "120004", "120020", "120040"],
  "5E43": ["120010"],
  "5E4E": ["81000"],
  "5E4F": ["80800"],
  "5E52": ["B0800"],
  "5E53": ["B1000"],
  "5E54": ["C8000"],
  "5E58": ["C1000"],
  "5E59": ["C0001", "C0002", "C0004", "C0008", "C0010", "C0020", "C0040", "C0080"],
  "5E5B": ["91000"],
  "5E5C": ["92000"],
  "5E5D": ["90100", "90200"],
  "5E5E": ["90010", "90020"],
  "5E5F": ["C2000"]
};
const NRCN = {0x10:"generalReject",0x11:"serviceNotSupported",0x12:"subFuncNotSupported",0x13:"wrongLength",0x22:"conditionsNotCorrect",0x31:"requestOutOfRange",0x33:"securityAccessDenied",0x35:"invalidKey",0x78:"responsePending"};
const TGT=0x29, sleep=ms=>new Promise(r=>setTimeout(r,ms));
class KwpError extends Error{constructor(nrc){super(`NRC 0x${nrc.toString(16)} ${NRCN[nrc]||'?'}`);this.nrc=nrc;}}

// ---- key algorithms (ported from kwp.py / kline_ident) ----
const ror16 = (v, n) => ((v >>> n) | (v << (16 - n))) & 0xFFFF;

function bitrev16(v) {
  let r = 0;
  for (let i = 0; i < 16; i++) r |= ((v >> i) & 1) << (15 - i);
  return r & 0xFFFF;
}

const ktSeedrev = s => (bitrev16(s) ^ ror16(s, 5)) & 0xFFFF;

function ktAfb9e(seed, c) {
  const s = seed & 0xFFFF, ns = (~s) & 0xFFFF;
  let res = 0;
  for (let i = 0; i < 4; i++) {
    const b = i * 4;
    res |= ((s >> b) & 1) << (b + 2);
    res |= ((s >> (b + 2)) & 1) << b;
    res |= ((ns >> (b + 1)) & 1) << (b + 1);
    res |= ((ns >> (b + 3)) & 1) << (b + 3);
  }
  res = (res ^ ror16(s, 5)) & 0xFFFF;
  let acc = 0;
  for (let i = 0; i < 13; i++) {
    acc = (acc ^ (((res & (0xF << i)) << ((res >> i) & 0xF)) >>> 0)) >>> 0;
  }
  acc = (acc ^ (acc >>> 16)) >>> 0;
  return (res ^ acc ^ c) & 0xFFFF;
}

function ktAfb10(seed, c) {
  const X = ror16(seed, 3);
  let res = 0;
  for (let i = 0; i < 8; i++) {
    const a = 15 - i, b = 7 - i;
    if (((X >> i) & 1) ^ ((X >> (i + 8)) & 1)) {
      res |= ((X >> a) & 1) << b;
      res |= ((X >> b) & 1) << a;
    } else {
      res |= ((~X >> a) & 1) << a;
      res |= ((~X >> b) & 1) << b;
    }
  }
  return (res ^ c) & 0xFFFF;
}

// ---- Web Serial transport ----
class WebSerialKwp {
  // proto "kwp"  = K-line KWP2000* (8E1, DTR low, B8 header, XOR checksum)  -> Z4 GT3
  // proto "fast" = BMW-FAST / D-CAN (8N1, DTR high, 0x80|len header, sum)   -> M3 (to confirm on the bench)
  constructor(baud, proto) {
    this.baud = baud;
    this.proto = proto || "kwp";
    this.kind = "serial";
    this.wait = 350;
    this.rx = [];
  }

  async connect() {
    this.port = await navigator.serial.requestPort();
    const kline = this.proto === "kwp";
    await this.port.open({
      baudRate: this.baud, dataBits: 8,
      parity: kline ? "even" : "none", stopBits: 1, flowControl: "none",
    });
    try {
      // K-line holds DTR low; BMW-FAST / D-CAN holds it high
      await this.port.setSignals({ dataTerminalReady: !kline, requestToSend: false });
    } catch (e) { /* some cables ignore signal control */ }
    this._pump();
  }

  // background reader: push everything the port delivers into this.rx
  async _pump() {
    this.reader = this.port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) for (const b of value) this.rx.push(b);
      }
    } catch (e) {
      /* port closed */
    } finally {
      try { this.reader.releaseLock(); } catch (e) {}
    }
  }

  xor(a) {
    let x = 0;
    for (const b of a) x ^= b;
    return x & 0xFF;
  }

  sum(a) {
    let s = 0;
    for (const b of a) s = (s + b) & 0xFF;
    return s;
  }

  frame(p) {
    if (this.proto === "fast") {
      // BMW-FAST: [0x80|len] [tgt] [0xF1] data... [sum]
      const f = [0x80 | p.length, TGT, 0xF1, ...p];
      f.push(this.sum(f));
      return Uint8Array.from(f);
    }
    // K-line KWP2000*: [0xB8] [tgt] [0xF1] [len] data... [xor]
    const f = [0xB8, TGT, 0xF1, p.length, ...p];
    f.push(this.xor(f));
    return Uint8Array.from(f);
  }

  async request(p) {
    const req = this.frame(p);
    this.rx.length = 0;
    const w = this.port.writable.getWriter();
    await w.write(req);
    w.releaseLock();

    // wait for the response to arrive and settle (quiet gap), then parse
    const start = Date.now();
    let last = 0, stable = Date.now();
    while (Date.now() - start < this.wait + p.length * 6) {
      await sleep(20);
      if (this.rx.length !== last) {
        last = this.rx.length;
        stable = Date.now();
      } else if (this.rx.length > req.length && Date.now() - stable > 70) {
        break;
      }
    }

    let rx = this.rx.slice();
    // single-wire lines echo the request; drop it if present
    if (rx.length >= req.length && req.every((b, i) => rx[i] === b)) rx = rx.slice(req.length);
    let body;
    if (this.proto === "fast") {
      // response: [0x80|len] [0xF1] [tgt] body... [sum]
      body = rx.length >= 4 ? rx.slice(3, rx.length - 1) : rx;
    } else {
      body = (rx.length >= 5 && rx[0] === 0xB8) ? rx.slice(4, rx.length - 1) : rx;
    }
    if (body.length && body[0] === 0x7F) throw new KwpError(body[2] || 0);
    return body;
  }

  async close() {
    try { await this.reader.cancel(); } catch (e) {}
    try { await this.port.close(); } catch (e) {}
  }
}

// ---- JS mock (mirrors kwp.py MockKwp) ----
class MockKwp {
  constructor() {
    this.kind = "mock";
    this.session = 0x81;
    this.sec = 0;
    this.ee = new Uint8Array(0x400);
    this.ee[0xFA] = 0xFA;                 // bench coding checksum (test pattern)
    this.rout = {};
    this.dtcs = [[0x5E, 0x59, 0x60], [0x5E, 0x1F, 0x60], [0x5E, 0x1E, 0x60]];
  }

  async connect() {}

  async request(p) {
    const s = p[0];
    if (s === 0x10) {                     // start diagnostic session
      this.session = p[1];
      return [0x50, p[1]];
    }
    if (s === 0x27) {                     // security access
      const sub = p[1];
      if (sub === 0x03 || sub === 0xFB || sub === 0xFD) return [0x67, sub, 0x12, 0x34];  // seed
      this.sec = { 4: 0x03, 0xFC: 0x7E, 0xFE: 0x7F }[sub] || this.sec;                   // key: mock grants
      return [0x67, sub];
    }
    if (s === 0x18) {                     // read DTC by status
      const o = [0x58, this.dtcs.length];
      this.dtcs.forEach(d => o.push(...d));
      return o;
    }
    if (s === 0x14) {                     // clear DTCs
      this.dtcs = [];
      return [0x54];
    }
    if (s === 0x23) {                     // read memory by address
      const a = (p[2] << 8) | p[3], n = p[5];
      return [0x63, ...this.ee.slice(a, a + n)];
    }
    if (s === 0x3D) {                     // write memory by address
      if (this.sec !== 0x7F || this.session !== 0x87) throw new KwpError(0x33);
      this.ee[(p[2] << 8) | p[3]] = p[6];
      return [0x7D, 0, p[2], p[3], 0x03];
    }
    if (s === 0x31) {                     // start routine
      if (this.session === 0x81) throw new KwpError(0x22);
      this.rout[p[1]] = 4;
      return [0x71, p[1]];
    }
    if (s === 0x33) {                     // routine status (counts down to done)
      const r = p[1];
      if (this.rout[r] > 0) this.rout[r]--;
      const done = (this.rout[r] || 0) === 0;
      return [0x73, r, done ? 2 : 1];
    }
    if (s === 0x21) return [0x61, p[1], ...mockLive(p[1])];   // live data
    if (s === 0x3E) return [0x7E, p[1] || 0];                 // tester present
    throw new KwpError(0x11);
  }

  async close() {}
}

function mockLive(lid) {
  if (lid === 0x02) {                     // conditioned values, 16-bit BE, FFFF = invalid
    const v = [0x0190, 0, 0xFFFF, 0xFFFF, 0xFFFF, 0, 0, 0, 0, 0xFFFF], o = [];
    v.forEach(x => o.push(x >> 8, x & 0xFF));
    return o;
  }
  if (lid === 0x07) return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];  // raw wheel speeds + pad
  return [0];
}

// ---- Module (ported) ----
class Module {
  constructor(t, keys, target) {
    this.t = t;
    this.keys = keys;
    this.target = target || "z4";   // "z4" decodes DTCs via DTCMAP; "m3" shows raw codes
  }

  async session(l) {
    await this.t.request([0x10, l]);
    return { session: `0x${l.toString(16)}` };
  }

  async unlock(l) {
    const [seedSub, keySub] = { 0x03: [0x03, 0x04], 0x7E: [0xFB, 0xFC], 0x7F: [0xFD, 0xFE] }[l];
    const b = await this.t.request([0x27, seedSub]);
    if (b.length < 4 || b[0] !== 0x67) throw new KwpError(0x22);
    const seed = (b[2] << 8) | b[3];
    if (seed === 0) return { level: `0x${l.toString(16)}`, already: true };

    let key;
    if (l === 0x03) {
      key = ktSeedrev(seed);
    } else if (l === 0x7E) {
      if (!this.keys.afb9e) throw new KwpError(0x33);
      key = ktAfb9e(seed, this.keys.afb9e);
    } else {
      if (!this.keys.afb10) throw new KwpError(0x33);
      key = ktAfb10(seed, this.keys.afb10);
    }
    await this.t.request([0x27, keySub, (key >> 8) & 0xFF, key & 0xFF]);
    return { level: `0x${l.toString(16)}`, seed: `0x${seed.toString(16)}`, key: `0x${key.toString(16)}` };
  }

  async readDtcs() {
    const b = await this.t.request([0x18, 0x02, 0xFF, 0xFF]);
    if (!b.length || b[0] !== 0x58) throw new KwpError(0x10);
    const n = b[1], out = [];
    for (let i = 0; i < n; i++) {
      const o = 2 + i * 3;
      const dtc = (b[o] << 8) | b[o + 1];
      const key = dtc.toString(16).toUpperCase().padStart(4, '0');
      // DTCMAP is the Z4 GT3 fault table; the M3 has its own, so show raw codes there
      const faults = this.target === "z4" ? (DTCMAP[key] || []) : [];
      out.push({ dtc: key, status: b[o + 2], faults });
    }
    return { count: n, dtcs: out };
  }

  async clearDtcs() {
    await this.t.request([0x14, 0xFF, 0x00]);
  }

  async readCoding() {
    const b = await this.t.request([0x23, 0, 0, 0xFA, 0x03, 0x03]);
    const d = b[0] === 0x63 ? b.slice(1) : b;
    const ck = d[0], row = d[1], f1 = d[2];
    return { ck, row, f1, ok: ck === (((row ^ f1) + 1) & 0xFF) };
  }

  async writeCoding(row, f1) {
    const ck = ((row ^ f1) + 1) & 0xFF;
    const writes = [[0xFB, row], [0xFC, f1], [0xFA, ck]];
    const done = [];
    for (const [a, v] of writes) {
      await this.t.request([0x3D, 0, 0, a, 0x03, 0x01, v]);
      done.push(`0x0${a.toString(16).toUpperCase()}=0x${v.toString(16).padStart(2, '0')}`);
    }
    return done;
  }

  async routine(rid) {
    await this.t.request([0x31, rid]);
  }

  async rstatus(rid) {
    const b = await this.t.request([0x33, rid]);
    const st = b[2] || 0;
    return { st, running: st === 1, done: st === 2 };
  }

  async readMem(a, n, t) {
    let out = [];
    while (n > 0) {
      const k = Math.min(n, 0x20);
      const b = await this.t.request([0x23, 0, (a >> 8) & 0xFF, a & 0xFF, t, k]);
      out = out.concat(Array.from(b[0] === 0x63 ? b.slice(1) : b));
      a += k;
      n -= k;
    }
    return out;
  }

  async live(lid) {
    const b = await this.t.request([0x21, lid]);
    return (b.length >= 2 && b[0] === 0x61) ? b.slice(2) : b;
  }
}
