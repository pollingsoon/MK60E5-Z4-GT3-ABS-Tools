// ---- 0x5BA message generator ----
function parseTireSize(s) {
  const dia = s.match(/^(\d+(?:\.\d+)?)(?:\s*in)?$/i);
  if (dia) return Math.round(Math.PI * parseFloat(dia[1]) * 25.4);
  const slick = s.match(/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/);
  if (slick) return Math.round(Math.PI * parseFloat(slick[1]) * 25.4);
  const street = s.match(/(\d+)\/(\d+)[\/R]?(\d+)/i);
  if (street) {
    const w = +street[1], aspect = +street[2], rim = +street[3];
    const dmm = rim * 25.4 + 2 * (w * aspect / 100);
    return Math.round(Math.PI * dmm);
  }
  return null;
}

function updateCircumference(wheel) {
  const t = document.getElementById("tire_" + wheel).value.trim();
  const c = t ? parseTireSize(t) : null;
  document.getElementById("circ_" + wheel).value = c || "";
  generateMessage();
}

function generateMessage() {
  const out = document.getElementById("output");
  const cf = parseInt(document.getElementById("circ_front").value);
  const cr = parseInt(document.getElementById("circ_rear").value);
  if (!cf || !cr) {
    out.innerHTML = '<div class="mut">Enter valid tire sizes to generate the message</div>';
    return;
  }
  for (const [c, name] of [[cf, "Front"], [cr, "Rear"]]) {
    if (c < 1500 || c > 3000) {
      out.innerHTML = `<div class="bad">${name} ${c} mm is out of range; the module accepts 1500-3000 mm</div>`;
      return;
    }
  }
  const tcs = parseInt(document.getElementById("tcs_threshold").value);
  const modus = parseInt(document.getElementById("tcs_modus").value);
  const abs = parseInt(document.getElementById("abs_mode").value);
  const gear = parseInt(document.getElementById("gear_shift").value);
  const d = [tcs & 0xFF, modus & 0xFF, cf % 256, Math.floor(cf / 256),
             cr % 256, Math.floor(cr / 256), abs & 0x0F, gear & 0x03];
  const hex = d.map(b => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
  const modusTxt = ["off", "on, high base threshold", "on, low base threshold"][modus];
  const gearTxt = ["none", "up shift", "down shift"][gear];
  const rows = [
    ["Byte 1", d[0], `TCS threshold: ${tcs}%`],
    ["Byte 2", d[1], `TCS mode: ${modusTxt}`],
    ["Byte 3", d[2], "front circumference, low byte"],
    ["Byte 4", d[3], `front circumference, high byte (${cf} mm)`],
    ["Byte 5", d[4], "rear circumference, low byte"],
    ["Byte 6", d[5], `rear circumference, high byte (${cr} mm)`],
    ["Byte 7", d[6], `ABS level: ${abs}`],
    ["Byte 8", d[7], `gear shift: ${gearTxt}`],
  ].map(([n, b, desc]) =>
    `<div class="byte-row"><span class="byte-num">${n}:</span>` +
    `<span class="byte-hex">0x${b.toString(16).toUpperCase().padStart(2, "0")}</span>` +
    `<span class="byte-desc">${desc}</span></div>`).join("");
  out.innerHTML =
    `<div class="output-label">CAN message</div><div>ID: 0x5BA&nbsp;&nbsp;Data: ${hex}</div>` +
    `<div class="output-label">Decimal (AIM RaceStudio 3)</div><div>${d.join(" ")}</div>` +
    `<div class="output-label">Breakdown</div>${rows}`;
}

window.addEventListener("load", () => {
  updateCircumference("front");
  updateCircumference("rear");
});
