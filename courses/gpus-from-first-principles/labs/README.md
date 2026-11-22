# Real-GPU labs

CUDA labs that run on your own NVIDIA GPU, one per Part of *GPUs from First Principles*.
Each lab page in Groundwork explains the goal, what to predict, and the targets.

```
cd labs/L0-hello
make run      # build, check correctness, measure; writes results.json
make submit   # record the results in your local Groundwork (run `groundwork` first)
```

Other targets: `make regs` (registers, spills, shared memory per kernel), `make ptx`,
`make sass`, `make ncu` (Nsight Compute), `make nsys` (Nsight Systems). The default
architecture is `sm_75` (RTX 20-series); set `ARCH=sm_86`, `sm_89`, `sm_80` or `sm_90` for
other GPUs. Set `GW_PEAK_GBS` if the reported peak bandwidth looks wrong for your card.

| Lab | Part | Topic |
|---|---|---|
| L0-hello | 0 | Vector add, copy bandwidth, pointer-chase latency, Little's law |
| L1-warps | 1 | Divergence costs; grayscale and blur |
| L2-memory | 2 | Sectors, transpose and bank conflicts, AoS vs SoA, Nsight counters |
| L3-primitives | 3 | Reduction, scan and histogram against CUB |
| L4-gemm | 4 | Naive, tiled, register-tiled and WMMA tensor-core GEMM against cuBLAS |
| L5-roofline | 5 | Measured FP32 and bandwidth ceilings, a roofline sweep, tail effects, and a profile-driven GEMV fix |
| L6-compiler | 6 | ILP versus occupancy, local memory from run-time indexing, and fusion, read from the SASS |
| L7-workloads | 7 | Fused softmax and LayerNorm, and a pinned-memory stream pipeline |
| L8-attention | 8 | Capstone: FlashAttention-style fused attention with WMMA, against a cuBLAS reference |

`common/gw.h` is the shared harness: error checking, device info, event timing with warm-up
and median, exactness checks, and `results.json`.
