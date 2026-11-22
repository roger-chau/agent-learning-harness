# Real-GPU labs

CUDA labs that run on your own NVIDIA GPU, one per Part of *GPUs from First Principles*.
Each lab page in Groundwork explains the goal, what to predict, and the targets.

## Setup

- **Linux**, or **Windows with WSL2** (Ubuntu): install the NVIDIA driver on Windows, then the
  CUDA Toolkit 12.x for WSL inside Ubuntu (it gives `nvcc`, cuBLAS, CUB and the Nsight
  command-line tools). Check with `nvidia-smi` and `nvcc --version`.
- Nsight Compute may need permission to read performance counters: on Linux, run `make ncu`
  with `sudo`, or allow it for all users (NVIDIA's "ERR_NVGPUCTRPERM" page); on WSL, enable
  GPU performance counters for all users in the NVIDIA Control Panel on Windows.
- **Renting a GPU**: any cloud Linux machine with an NVIDIA GPU and the CUDA Toolkit works.
  Pass the right `ARCH`, and send the results to your Groundwork with
  `python3 common/submit.py results.json --server http://<your machine>:8765`, or copy
  `results.json` back and run `make submit` locally.

## Running a lab

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
| L9-reality | 9 | Deterministic reductions, compensated summation, and clocks and power under sustained load (NVML) |
| L10-patterns | 10 | Tiled convolution with constant memory, and scalar versus vector CSR SpMV |

`common/gw.h` is the shared harness: error checking, device info, event timing with warm-up
and median, exactness checks, and `results.json`.
