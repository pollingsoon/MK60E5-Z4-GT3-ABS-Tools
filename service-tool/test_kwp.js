// KWP Module: MD5, M3 level-5 auth, and Enable CCP flow.  node service-tool/test_kwp.js
// MD5 and auth vectors are from the RFC and from kwp.py (computed independently of this code).
const test = require("node:test");
const assert = require("node:assert");

global.DTCMAP = {}; global.FAULTINFO = {};
global.IDENT_LEN = {}; global.IDENT_SRC = {}; global.SW_IDENT_94 = [];
const { md5, Module } = require("../assets/kwp.js");

const hex = a => Array.from(a, b => b.toString(16).padStart(2, "0")).join("");
const bytes = s => s.match(/../g).map(x => parseInt(x, 16));

test("MD5 matches the RFC test vectors", () => {
  assert.strictEqual(hex(md5([])), "d41d8cd98f00b204e9800998ecf8427e");
  assert.strictEqual(hex(md5(Array.from("abc", c => c.charCodeAt(0)))), "900150983cd24fb0d6963f7d28e17f72");
  assert.strictEqual(hex(md5(Array.from("The quick brown fox jumps over the lazy dog", c => c.charCodeAt(0)))),
    "9e107d9d372bb6826bd81d3542a419d6");
  // 56 and 64 bytes both force the length into a second padding block
  assert.strictEqual(hex(md5(Array.from("a".repeat(56), c => c.charCodeAt(0)))),
    "3b0c8ac703f828b04c6c197006d17218");
  assert.strictEqual(hex(md5(Array.from("a".repeat(64), c => c.charCodeAt(0)))),
    "014842d480b571495a4a0363793f7367");
});

test("level-5 response = MD5(key || uid||w564||zufall || key), vs kwp.py", () => {
  const key = bytes("00112233445566778899aabbccddeeff");
  const data16 = [...Array.from("273c", c => c.charCodeAt(0)), ...bytes("00b40000"), 0, 1, 2, 3, 4, 5, 6, 7];
  assert.strictEqual(hex(md5([...key, ...data16, ...key])), "829dca06a11a7f4b446c0d0e87f190a3");
});

// A fake transport that scripts a cooperative module and records every request. For 31 08
// it recomputes the expected response, so a wrong MD5 or assembly fails the test.
function fakeM3(key16, { expectW564 = [0x00, 0xB4, 0x00, 0x00], grant = true } = {}) {
  const zufall = [0, 1, 2, 3, 4, 5, 6, 7];
  const t = { kind: "can", log: [], uid: null };
  t.request = async (p) => {
    t.log.push(p.join(" "));
    const s = p[0];
    if (s === 0x10) return [0x50, p[1]];
    if (s === 0x1A && p[1] === 0x89) return [0x5A, 0x89, 0x00, 0xB4, 0x00, 0x00];
    if (s === 0x31 && p[1] === 0x07) { t.uid = p.slice(3, 7); return [0x71, 0x07, ...zufall]; }
    if (s === 0x31 && p[1] === 0x08) {
      const data16 = [...t.uid, ...expectW564, ...zufall];
      const want = Array.from(md5([...key16, ...data16, ...key16]));
      assert.deepStrictEqual(p.slice(2), want, "response bytes must be MD5(key||data16||key)");
      return grant ? [0x71, 0x08, 0x01] : [0x71, 0x08, 0x00];
    }
    if (s === 0x27 && p[1] === 0xFB) return [0x67, 0xFB, 0x12, 0x34];   // 0x7E seed
    if (s === 0x27 && p[1] === 0xFC) return [0x67, 0xFC];              // 0x7E key accepted
    if (s === 0x31 && p[1] === 0x31) return [0x71, 0x31, 0x01];        // CCP enable
    throw new Error("unexpected request " + p.join(" "));
  };
  return t;
}

test("M3 Enable CCP: auth5 then 0x7E then 31 31 01, in order", async () => {
  const key16 = bytes("00112233445566778899aabbccddeeff");
  const t = fakeM3(key16);
  const mod = new Module(t, { ccpKey: 0x070B }, "m3", { uid: null, w564: null, key16 });
  const r = await mod.enableCcp();
  assert.strictEqual(r.auth5, true);
  const services = t.log.map(l => l.split(" ").slice(0, 2).join(" "));
  assert.deepStrictEqual(services, ["16 129", "16 135", "26 137", "49 7", "49 8", "39 251", "39 252", "49 49"]);
  //  10 81      10 87      1A 89     31 07   31 08   27 FB     27 FC    31 31
});

test("M3 Enable CCP defaults UID to 273c and reads W564 from $1A 89", async () => {
  const key16 = bytes("ffeeddccbbaa99887766554433221100");
  const t = fakeM3(key16);
  const mod = new Module(t, { ccpKey: 0x070B }, "m3", { key16 });
  await mod.enableCcp();
  const auth07 = t.log.find(l => l.startsWith("49 7 3")).split(" ").map(Number);
  assert.deepStrictEqual(auth07.slice(3), [0x32, 0x37, 0x33, 0x63]);   // "273c"
  assert.ok(t.log.some(l => l === "26 137"), "reads $1A 89 for W564");
});

test("M3 Enable CCP without a key is refused before any request", async () => {
  const t = fakeM3(bytes("00112233445566778899aabbccddeeff"));
  const mod = new Module(t, { ccpKey: 0x070B }, "m3", {});
  await assert.rejects(mod.enableCcp(), /level-5 key/);
  assert.strictEqual(t.log.length, 0);
});

test("M3 Enable CCP surfaces a rejected auth", async () => {
  const key16 = bytes("00112233445566778899aabbccddeeff");
  const t = fakeM3(key16, { grant: false });
  const mod = new Module(t, { ccpKey: 0x070B }, "m3", { key16 });
  await assert.rejects(mod.enableCcp(), /auth rejected/);
  assert.ok(!t.log.some(l => l.startsWith("39 251")), "must not try the 0x7E unlock after a failed auth");
});

test("an explicit W564 override is used instead of $1A 89", async () => {
  const key16 = bytes("00112233445566778899aabbccddeeff");
  const t = fakeM3(key16, { expectW564: [0xAA, 0xBB, 0xCC, 0xDD] });
  const mod = new Module(t, { ccpKey: 0x070B }, "m3", { key16, w564: [0xAA, 0xBB, 0xCC, 0xDD] });
  await mod.enableCcp();
  assert.ok(!t.log.some(l => l === "26 137"), "override means no $1A 89 read");
});

test("Z4 Enable CCP is unchanged: 10 87, 0x7E, 31 31 01, no auth5", async () => {
  const log = [];
  const t = { kind: "serial", request: async (p) => {
    log.push(p.join(" "));
    if (p[0] === 0x10) return [0x50, p[1]];
    if (p[0] === 0x27 && p[1] === 0xFB) return [0x67, 0xFB, 0x12, 0x34];
    if (p[0] === 0x27 && p[1] === 0xFC) return [0x67, 0xFC];
    if (p[0] === 0x31) return [0x71, 0x31];
    throw new Error("unexpected " + p.join(" "));
  }};
  const mod = new Module(t, { ccpKey: 0x1D14 }, "z4");
  const r = await mod.enableCcp();
  assert.strictEqual(r.auth5, undefined);
  assert.deepStrictEqual(log.map(l => l.split(" ").slice(0, 2).join(" ")), ["16 135", "39 251", "39 252", "49 49"]);
});
