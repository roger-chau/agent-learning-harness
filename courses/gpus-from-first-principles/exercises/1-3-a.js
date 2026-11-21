GW.exercise({
  id: "1-3-a",
  title: "Which warp am I?",
  file: "warps.js",
  prompt: `
<p>Implement the warp rules, then check them against the simulator from inside a kernel.</p>
<ol>
<li><code>linearTid(tx, ty, tz, bx, by)</code>: a thread's linear index in its block, given its <code>threadIdx</code> and the block's x and y sizes.</li>
<li><code>warpsPerBlock(bx, by, bz)</code> and <code>idleLanes(bx, by, bz)</code>, assuming warps of 32.</li>
<li>Kernel <code>whoAmI(warpOut, laneOut)</code>: every thread writes its warp number (within its block) and its lane to slot <code>blockLinear × threadsPerBlock + t</code>, where <code>t</code> is its linear index and <code>blockLinear = blockIdx.x + blockIdx.y·gridDim.x</code>. Use <code>warpSize</code>, not 32.</li>
</ol>
<p>The checks launch <code>whoAmI</code> themselves with several block shapes and compare against the rules.</p>`,
  starter: `
function linearTid(tx, ty, tz, bx, by) {
  // TODO
}

function warpsPerBlock(bx, by, bz) {
  // TODO
}

function idleLanes(bx, by, bz) {
  // TODO
}

function whoAmI(warpOut, laneOut) {
  // TODO
}

function main() {
  print(warpsPerBlock(100, 1, 1), idleLanes(100, 1, 1)); // 4 28
  const n = 2 * 20 * 3;
  const w = gpu.alloc(n, "i32"), l = gpu.alloc(n, "i32");
  gpu.launch(whoAmI, { grid: 2, block: { x: 20, y: 3 } }, w, l);
  print(w.toArray().slice(0, 40));
}
`,
  tests(t) {
    const lt = t.fn("linearTid"), wpb = t.fn("warpsPerBlock"), il = t.fn("idleLanes"), k = t.fn("whoAmI");
    t.check("linearTid(3, 2, 0, 16, 8) = 35", lt(3, 2, 0, 16, 8) === 35, `got ${lt(3, 2, 0, 16, 8)}`);
    t.check("linearTid(1, 1, 1, 4, 4) = 21", lt(1, 1, 1, 4, 4) === 21, `got ${lt(1, 1, 1, 4, 4)}`);
    for (const [bx, by, bz, w, idle] of [[100, 1, 1, 4, 28], [16, 16, 1, 8, 0], [20, 3, 1, 2, 4], [7, 7, 7, 11, 9], [1, 1, 1, 1, 31]]) {
      t.check(`warpsPerBlock(${bx}, ${by}, ${bz}) = ${w}`, wpb(bx, by, bz) === w, `got ${wpb(bx, by, bz)}`);
      t.check(`idleLanes(${bx}, ${by}, ${bz}) = ${idle}`, il(bx, by, bz) === idle, `got ${il(bx, by, bz)}`);
    }
    for (const [grid, block] of [[{ x: 2 }, { x: 20, y: 3 }], [{ x: 3, y: 2 }, { x: 16, y: 4 }], [{ x: 1 }, { x: 8, y: 2, z: 3 }]]) {
      const g = { x: 1, y: 1, ...grid }, b = { y: 1, z: 1, ...block };
      const per = b.x * b.y * b.z, blocks = g.x * g.y;
      const wo = t.gpu.alloc(per * blocks, "i32"), lo = t.gpu.alloc(per * blocks, "i32");
      wo.data.fill(-1); lo.data.fill(-1);
      t.gpu.launch(k, { grid: g, block: b }, wo, lo);
      let bad = null;
      for (let i = 0; i < per * blocks && !bad; i++) {
        const tid = i % per;
        if (wo.data[i] !== Math.floor(tid / 32) || lo.data[i] !== tid % 32) bad = `slot ${i}: warp ${wo.data[i]}, lane ${lo.data[i]}`;
      }
      t.check(`whoAmI with block ${b.x}×${b.y}×${b.z} on grid ${g.x}×${g.y}`, !bad, bad || "");
    }
  },
});
