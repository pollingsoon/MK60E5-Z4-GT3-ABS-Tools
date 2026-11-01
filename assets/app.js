// ---- UI glue ----
let mod = null;
const $ = s => document.querySelector(s);
const hx = v => v ? parseInt(v.replace(/^0x/i, ''), 16) : 0;
const fmt = a => Array.from(a, b => b.toString(16).padStart(2, '0')).join(' ');

function log(m, c) {
  const d = $("#log"), t = new Date().toLocaleTimeString();
  d.innerHTML += `<div class="${c || ''}">[${t}] ${m}</div>`;
  d.scrollTop = d.scrollHeight;
}

document.querySelectorAll(".tab").forEach(t => t.onclick = () => {
  document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
  document.querySelectorAll("section").forEach(x => x.classList.remove("active"));
  t.classList.add("active");
  $("#" + t.dataset.t).classList.add("active");
});

if (!("serial" in navigator)) {
  $("#unsupported").textContent =
    "Web Serial not available in this browser (use Chrome/Edge over https or localhost). Mock mode still works.";
}

// Per-target transport defaults. Z4 GT3 = K-line KWP; M3 = D-CAN (BMW-FAST).
const TARGETS = {
  z4: { label: "Z4 GT3", proto: "kwp",  baud: 9600 },
  m3: { label: "M3",     proto: "fast", baud: 115200 },
};

// When the target changes, preset the baud to that target's default.
if ($("#target")) {
  $("#target").onchange = e => {
    const cfg = TARGETS[e.target.value];
    if (cfg) $("#baud").value = String(cfg.baud);
    log(`target: ${cfg.label} (${cfg.proto === "kwp" ? "K-line KWP" : "D-CAN"})`);
  };
}

// Every action button except Connect is disabled until a connection is made,
// so clicking one before connecting simply does nothing.
const actionButtons = Array.from(document.querySelectorAll("button"))
  .filter(b => !/connect\(\)/.test(b.getAttribute("onclick") || ""));
function setConnected(on) {
  actionButtons.forEach(b => { b.disabled = !on; });
}
setConnected(false);

// The $27 constants are read from the toolbar fields whenever they are needed, so they
// can be typed or corrected after connecting.
function readKeys() {
  const keys = {};
  if ($("#k9e").value.trim()) keys.afb9e = hx($("#k9e").value.trim());
  if ($("#k10").value.trim()) keys.afb10 = hx($("#k10").value.trim());
  return keys;
}

async function connect() {
  const keys = readKeys();
  const target = $("#target") ? $("#target").value : "z4";
  const cfg = TARGETS[target] || TARGETS.z4;
  const t = $("#mode").value === "serial"
    ? new WebSerialKwp(parseInt($("#baud").value), cfg.proto)
    : new MockKwp();
  try {
    await t.connect();
  } catch (e) {
    // user dismissed the port picker, or no device: do nothing
    if (e && (e.name === "NotFoundError" || /No port selected/i.test(e.message || ""))) return;
    log("connect: " + e.message, "bad");
    return;
  }
  mod = new Module(t, keys, target);
  setConnected(true);
  $("#conn").textContent = t.kind === "mock" ? "mock" : `${cfg.label} (${cfg.proto === "kwp" ? "K-line" : "D-CAN"})`;
  $("#conn").className = "pill on";
  log(`connected to ${cfg.label} (${t.kind}); keys: ${Object.keys(keys).join(", ") || "none"}`, "ok");
  await readIdent(0x80, true);   // ZB (part number)
  await readIdent(0x94, true);   // software ID
}

function setSess(t) { $("#sess").textContent = t; $("#sess").className = "pill on"; }
function setSec(t) { $("#sec").textContent = t; $("#sec").className = "pill on"; }

// Both unlock buttons run the whole sequence themselves (10 87, seed, key, ...), so nothing
// has to be clicked in a particular order first.
async function enableCodingWrite() {
  try {
    mod.keys = readKeys();
    const j = await mod.enableCodingWrite();
    setSess("session 0x87");
    setSec("coding write (0x7F)");
    log(`coding write enabled: 10 87 + level ${j.level} seed ${j.seed || '-'} key ${j.key || '-'}${j.already ? ' (already open)' : ''}`, "ok");
  } catch (e) {
    log("enable coding write: " + e.message, "bad");
  }
}

async function enableCcp() {
  try {
    mod.keys = readKeys();
    const j = await mod.enableCcp();
    setSess("session 0x87");
    setSec("CCP (0x7E) + 31 31 01");
    log(`CCP enabled: 10 87 + level ${j.level} seed ${j.seed || '-'} key ${j.key || '-'}${j.already ? ' (already open)' : ''} + 31 31 01`, "ok");
  } catch (e) {
    log("enable CCP: " + e.message, "bad");
  }
}

const LAMP_TXT = { yes: ["ABS lamp ON", "bad"], no: ["no ABS lamp", "ok"], depends: ["depends on fault", "warn"], "?": ["not traced", "mut"] };

async function readDtcs() {
  try {
    const j = await mod.readDtcs();
    let h = `<table><tr><th>DTC</th><th>status</th><th>ABS lamp</th><th>internal fault(s) and meaning</th></tr>`;
    j.dtcs.forEach(d => {
      const [lt, lc] = LAMP_TXT[d.lamp] || LAMP_TXT["?"];
      const st = (d.status & 0x40) ? "present" : "stored";
      const rows = d.faults.length
        ? d.faults.map((f, i) => {
            const inf = d.info[i] || [];
            return `<div><b>0x${f}</b> ${inf[0] || ''}${inf[2] ? ` <span class="mut">- ${inf[2]}</span>` : ''}</div>`;
          }).join('')
        : '<span class="mut">no decode table for this target</span>';
      h += `<tr><td>0x${d.dtc}</td><td>0x${d.status.toString(16)} ${st}</td><td class="${lc}">${lt}</td><td>${rows}</td></tr>`;
    });
    h += `</table><div class="note" style="color:var(--mut)">status 0x40 = fault currently present; "depends" = the DTC is shared by several internal faults and only some of them switch ABS off (read fault_flags at RAM 0x101f04 to tell them apart).</div>`;
    if (!j.count) h = `<p class="ok">no stored faults</p>`;
    $("#dtcs").innerHTML = h;
    log(`read ${j.count} DTC(s)`);
  } catch (e) {
    log("read_dtcs: " + e.message, "bad");
  }
}

async function readIdent(id, quiet) {
  try {
    const j = await mod.readIdent(id);
    const hid = "0x" + id.toString(16).toUpperCase();
    let h = `<table><tr><th>$1A id</th><th>source</th><th>decoded</th><th>bytes</th></tr>`;
    if (j.zb !== undefined) {
      h += `<tr><td>${hid}</td><td>${j.source}</td><td class="ok">ZB ${j.zb}</td><td>${fmt(j.bytes)}</td></tr></table>`;
      $("#zb").textContent = "ZB " + j.zb;
      $("#zb").className = "pill on";
      log(`part number ZB ${j.zb}`, "ok");
    } else if (j.swId !== undefined) {
      h += `<tr><td>${hid}</td><td>${j.source}</td><td class="ok">${j.swId}</td><td>${fmt(j.bytes)}</td></tr></table>` +
           `<div class="note" style="color:var(--mut)">tail (version/date block, not parsed by the firmware): ${fmt(j.tail)}</div>`;
      $("#swid").textContent = "SW " + j.swId;
      $("#swid").className = "pill on";
      log(`software id ${j.swId}`, "ok");
    } else {
      h += `<tr><td>${hid}</td><td>${j.source}</td><td>${j.ascii}</td><td>${fmt(j.bytes)}</td></tr></table>`;
      log(`$1A ${hid}: ${j.bytes.length} bytes`);
    }
    $("#ident-out").innerHTML = h;
  } catch (e) {
    log("read_ident: " + e.message, quiet ? "" : "bad");
  }
}

async function clearDtcs() {
  if (!confirm("Clear all stored fault memory?")) return;
  try {
    await mod.clearDtcs();
    log("faults cleared", "ok");
    readDtcs();
  } catch (e) {
    log("clear: " + e.message, "bad");
  }
}

async function readCoding() {
  try {
    const j = await mod.readCoding();
    $("#coding-out").innerHTML =
      `<table><tr><th>checksum</th><th>row</th><th>field1</th><th>cksum</th></tr>` +
      `<tr><td>0x${j.ck.toString(16)}</td><td>${j.row}</td><td>${j.f1}</td>` +
      `<td class="${j.ok ? 'ok' : 'bad'}">${j.ok ? 'valid' : 'BAD'}</td></tr></table>`;
    $("#row").value = j.row;
    $("#field1").value = j.f1;
    log(`coding row ${j.row} field1 ${j.f1}`);
  } catch (e) {
    log("read_coding: " + e.message, "bad");
  }
}

async function writeCoding() {
  const row = +$("#row").value, f1 = +$("#field1").value;
  if (!confirm(`Write coding row=${row} field1=${f1}? Session and unlock are done automatically. Effective next power-on.`)) return;
  try {
    const done = await mod.writeCoding(row, f1);
    log("coding written: " + done.join(' '), "ok");
  } catch (e) {
    log("write_coding: " + e.message, "bad");
  }
}

async function routine(rid, name) {
  try {
    await mod.routine(rid);
    log(`routine 0x${rid.toString(16)} (${name}) started`, "ok");
    rstatus(rid);
  } catch (e) {
    log("routine: " + e.message, "bad");
  }
}

async function rstatus(rid) {
  try {
    const j = await mod.rstatus(rid);
    const el = $("#" + ($("#valve").classList.contains("active") ? "valve" : "sensor") + "-out");
    const state = j.done ? 'done' : j.running ? 'running' : 'idle';
    el.innerHTML = `routine 0x${rid.toString(16)}: <span class="${j.done ? 'ok' : 'warn'}">0x${j.st.toString(16)} ${state}</span>`;
    log(`routine 0x${rid.toString(16)} status 0x${j.st.toString(16)}`);
  } catch (e) {
    log("status: " + e.message, "bad");
  }
}

async function live(lid) {
  try {
    const b = await mod.live(lid);
    $("#live-out").innerHTML =
      `<table><tr><th>$21 id</th><th>bytes</th></tr><tr><td>0x${lid.toString(16)}</td><td>${fmt(b)}</td></tr></table>`;
    log(`$21 0x${lid.toString(16)}: ${b.length} bytes`);
  } catch (e) {
    log("live: " + e.message, "bad");
  }
}

async function readMem() {
  try {
    const b = await mod.readMem(hx($("#maddr").value), +$("#mlen").value, +$("#mtype").value);
    $("#mem-out").innerHTML =
      `<table><tr><th>len</th><th>bytes</th></tr><tr><td>${b.length}</td><td>${fmt(b)}</td></tr></table>`;
    log(`$23 read ${b.length} bytes`);
  } catch (e) {
    log("read_mem: " + e.message, "bad");
  }
}
