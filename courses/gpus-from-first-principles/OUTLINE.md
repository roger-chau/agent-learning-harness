# GPUs from First Principles

*For future GPU performance and GPU compiler engineers.*

How a GPU really works and how to make code fast on it. The course starts from why throughput machines exist at all. It ends with a fused attention kernel you design, tune, profile and explain.

- **Practice environment:** a browser GPU simulator. You write CUDA-style kernels in the in-page terminal. The simulator runs them warp by warp and reports correctness, cycles, memory transactions, coalescing efficiency, divergence, bank conflicts and occupancy. An optional real-CUDA mode runs the same exercises with `nvcc` when your machine has an NVIDIA GPU.
- **Companions:**
  - *Computer Architecture: A Quantitative Approach*, 7th edition (Hennessy & Patterson). Chapter references will be added once the table of contents is confirmed.
  - *It Thinks! Build your own GPU*, for the gate-level view.

---

## Part 0: The real problem: why throughput machines exist
0.1 **Latency vs throughput.** Two ways to be fast; Little's law (concurrency = latency × throughput).
0.2 **The memory wall.** Where a CPU spends its time; why caches and out-of-order execution only go so far. *Companion: H&P memory hierarchy.*
0.3 **Hiding latency with many threads.** Cheap context switches; how many threads you need to keep a unit busy.
0.4 **The GPU in one picture.** SMs, warps, schedulers, register file, shared memory, L2, DRAM. *Companion: It Thinks!*

**Project 0: Throughput core model.** Build a cycle-level model of one latency-hiding core in the terminal. Given memory latency, issue rate and thread count, predict utilisation, then verify it against the simulator across a sweep. Gate: your predictions are within 5% on hidden configurations.

## Part 1: SIMT: one instruction, many threads
1.1 **SIMD vs SIMT.** Same hardware idea, different programming model.
1.2 **Grids, blocks, threads.** Indexing in 1D, 2D and 3D, plus bounds guards.
1.3 **Warps and lockstep execution.** What the scheduler actually issues.
1.4 **Divergence and reconvergence.** Active masks, the reconvergence point, independent thread scheduling.
1.5 **Predication and branch-free code.** When the compiler removes the branch for you.

**Project 1: Image pipeline.** Kernels for grayscale, a separable 5×5 blur, and a Sobel edge detector on a real image, with correct border handling. Gate: correct output and zero divergence in the interior tiles.

## Part 2: Memory is the whole game
2.1 **Arithmetic intensity and the roofline.** Is this kernel memory-bound or compute-bound? *Companion: H&P.*
2.2 **DRAM, transactions and sectors.** What one load instruction from a warp actually costs.
2.3 **Coalescing.** Access patterns, strides, structure-of-arrays vs array-of-structures.
2.4 **GPU caches.** L1/L2 behaviour, the read-only path, cache-line reuse.
2.5 **Shared memory and bank conflicts.** Banks, broadcast, padding and swizzling.
2.6 **Registers, spilling and occupancy.** The occupancy calculator from first principles, and why more occupancy isn't always better.

**Project 2: Matrix transpose, three ways.** Naive, then a shared-memory tiled version, then a conflict-free padded or swizzled version. Gate: at least 80% of simulated peak bandwidth, zero bank conflicts, and a short write-up of each step's metrics.

## Part 3: Parallel building blocks
3.1 **Reduction.** Tree reduction, warp shuffles, multiple elements per thread.
3.2 **Scan.** Hillis–Steele, Blelloch, and single-pass decoupled look-back.
3.3 **Atomics and histograms.** Contention, privatisation, hierarchical atomics.
3.4 **Synchronisation and the memory model.** Barriers, fences, visibility, cooperative groups.
3.5 **Compaction and sorting.** Stream compaction; radix sort from scan and histogram.

**Project 3: GPU radix sort.** Build a full LSD radix sort for 32-bit keys from your own scan and histogram kernels. Gate: correct on hidden inputs (including adversarial distributions), plus a throughput target.

## Part 4: Matrix multiply, the kernel everything depends on
4.1 **Naive GEMM and why it's slow.** Arithmetic intensity on the roofline.
4.2 **Tiling into shared memory.** Reuse, tile sizes, the occupancy trade-off.
4.3 **Register tiling and thread coarsening.** Outer products in registers.
4.4 **Vectorised loads, double buffering, async copies.** Overlapping memory with compute.
4.5 **Tensor cores and mixed precision.** MMA fragments, FP16/BF16/FP8, accumulation precision.

**Project 4: Tuned SGEMM.** Take GEMM from naive to at least 70% of the simulated roofline, keeping an optimisation log that records each change, the metric it moved, and why. Gate: the performance target, plus a correct log.

## Part 5: Measuring like a performance engineer
5.1 **Timing correctly.** Warm-up, synchronisation, variance, what not to measure.
5.2 **Profiler metrics.** Throughput, achieved occupancy, stall reasons, memory charts (Nsight Compute concepts).
5.3 **From stall reasons to bottleneck.** Latency-bound vs bandwidth-bound vs compute-bound vs launch-bound.
5.4 **Tail effects and load balance.** Waves, partial waves, grid sizing.

**Project 5: Perf detective.** Six mystery kernels, each with a hidden bottleneck (uncoalesced access, bank conflicts, register spilling, divergence, low occupancy, tail effect). Profile each, name the cause with evidence, and fix it. Gate: every diagnosis correct and every fix meets its target.

## Part 6: The compiler's view
6.1 **From CUDA C to PTX to SASS.** The compilation pipeline and what each stage decides.
6.2 **Reading PTX and SASS.** Registers, predicates, memory spaces, control flow.
6.3 **Register allocation vs occupancy.** Live ranges, pressure, spills; `launch_bounds`.
6.4 **Instruction scheduling.** Instruction-level parallelism, dependency latencies, dual issue.
6.5 **Loop transforms and fusion.** Unrolling, software pipelining, vectorisation, kernel fusion.

**Project 6: Beat the compiler.** Hand-write and schedule a kernel in the simulator's PTX-like ISA (a reduction plus a small stencil), then beat the simulator's baseline compiler output in cycles. Explain every transformation in terms of the compiler concept behind it.

## Part 7: Real workloads
7.1 **Memory-bound fused ops.** Softmax, layernorm, online normalisation.
7.2 **Attention from first principles.** Why naive attention is bound by memory traffic; tiling Q, K and V.
7.3 **Streams and overlap.** Concurrency, copy/compute overlap, multi-GPU basics.

## Part 8: Capstone: a fused attention kernel
Design, implement, tune and explain a FlashAttention-style fused attention forward pass, end to end:

- Correctness against a reference across shapes, including causal masking.
- A performance target on the simulator's roofline.
- A profiling report: bottleneck at each stage, and what you changed and why.
- A compiler-view section: register pressure, occupancy, and the instruction mix in the generated code.
- A short write-up suitable for a portfolio.

Optional: run it on a real NVIDIA GPU in real-CUDA mode and compare against the simulator's prediction.

## Part 9: Reality: where it breaks
9.1 **Numerics.** Floating-point non-associativity, reproducibility, low-precision pitfalls.
9.2 **Portability.** CUDA vs HIP/AMD (wavefront of 64, LDS) vs Apple/mobile GPUs.
9.3 **Power, clocks and thermals.** Why measured performance moves.
9.4 **What's next.** Into *GPU Compilers from First Principles* and *Build a Tiny GPU Kernel Compiler*.

---

**Size:** 10 parts, 41 chapters, 7 part projects plus 1 capstone.
