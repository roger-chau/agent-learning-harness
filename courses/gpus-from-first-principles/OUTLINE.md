# GPUs from First Principles

*For future GPU performance and GPU compiler engineers.*

How a GPU really works and how to make code fast on it. The course starts from why throughput machines exist at all. It ends with a fused attention kernel you design, tune, profile and explain.

- **Practice environment:** a browser GPU simulator. You write CUDA-style kernels in the in-page terminal. The simulator runs them warp by warp and reports correctness, cycles, memory transactions, coalescing efficiency, divergence, bank conflicts and occupancy. An optional real-CUDA mode runs the same work with `nvcc` when your machine has an NVIDIA GPU.
- **Companions:**
  - *Computer Architecture: A Quantitative Approach*, 7th edition (Hennessy & Patterson). Chapter references will be added once the table of contents is confirmed.
  - *It Thinks! Build your own GPU*, for the gate-level view.

## The projects

Three long-running projects grow across the course in milestones, then a capstone reuses them. Chapter exercises stay small; the projects are where the real building happens.

Every chapter ends with a graded quiz, and every Part ends with a cumulative checkpoint quiz. Both are required to move on.

| Project | Runs through | What you end up with |
|---|---|---|
| **A. Imaging kernels** | Parts 1–2 | A small image-processing library: grayscale, separable blur, Sobel and transpose. It goes from correct to bandwidth-bound-optimal. |
| **B. Parallel primitives** | Parts 3 and 5 | Your own reduce / scan / histogram / compaction / radix-sort library, profiled and tuned. |
| **C. GEMM, naive to tensor cores** | Parts 4–6 | A matrix multiply you take from naive to near-roofline, then inspect and hand-tune at the assembly level. |
| **Capstone. Fused attention** | Part 8 | A FlashAttention-style kernel built on your GEMM tiles (C) and your reductions (B). |

### Project A: Imaging kernels
- **A1** (after Part 1): grayscale, 5×5 separable blur and Sobel on a real image. Borders must be correct, with zero divergence in interior tiles.
- **A2** (after 2.3): restructure the data layout so every global access is fully coalesced. Gate: coalescing efficiency of at least 95%.
- **A3** (after Part 2): shared-memory tiled blur plus a conflict-free transpose. Gate: at least 80% of simulated peak bandwidth, zero bank conflicts, and a short metrics write-up.

### Project B: Parallel primitives
- **B1** (after 3.1): reduction using warp shuffles and multiple elements per thread. Gate: a bandwidth target.
- **B2** (after 3.2): single-pass scan with decoupled look-back.
- **B3** (after 3.3): histogram with privatisation; it must hold up under a skewed, high-contention input.
- **B4** (after Part 3): LSD radix sort for 32-bit keys, built only from your B1–B3, tested on hidden adversarial inputs.
- **B5** (after Part 5): profile your whole library, write up the bottleneck of each primitive with evidence, and fix the worst two.

### Project C: GEMM, naive to tensor cores
- **C1** (after 4.2): shared-memory tiled SGEMM.
- **C2** (after 4.3): register tiling and thread coarsening. Gate: at least 50% of the simulated roofline.
- **C3** (after 4.4): vectorised loads and double buffering. Gate: at least 70% of the simulated roofline, with an optimisation log recording each change, the metric it moved, and why.
- **C4** (after Part 4): a tensor-core path in FP16/BF16 with FP32 accumulation, and a numerical error budget.
- **C5** (after Part 6): read the generated code for your inner loop, hand-schedule it in the simulator's PTX-like ISA, and beat the baseline compiler in cycles. Explain each transformation as a compiler concept.

---

## Part 0: The real problem: why throughput machines exist
0.1 **Latency vs throughput.** Two ways to be fast; Little's law (concurrency = latency × throughput).
0.2 **The memory wall.** Where a CPU spends its time; why caches and out-of-order execution only go so far. *Companion: H&P memory hierarchy.*
0.3 **Hiding latency with many threads.** Cheap context switches; how many threads you need to keep a unit busy.
0.4 **The GPU in one picture.** SMs, warps, schedulers, register file, shared memory, L2, DRAM. *Companion: It Thinks!*

## Part 1: SIMT: one instruction, many threads
1.1 **SIMD vs SIMT.** Same hardware idea, different programming model.
1.2 **Grids, blocks, threads.** Indexing in 1D, 2D and 3D, plus bounds guards.
1.3 **Warps and lockstep execution.** What the scheduler actually issues.
1.4 **Divergence and reconvergence.** Active masks, the reconvergence point, independent thread scheduling.
1.5 **Predication and branch-free code.** When the compiler removes the branch for you.

→ **Milestone A1**

## Part 2: Memory is the whole game
2.1 **Arithmetic intensity and the roofline.** Is this kernel memory-bound or compute-bound? *Companion: H&P.*
2.2 **DRAM, transactions and sectors.** What one load instruction from a warp actually costs.
2.3 **Coalescing.** Access patterns, strides, structure-of-arrays vs array-of-structures. → **Milestone A2**
2.4 **GPU caches.** L1/L2 behaviour, the read-only path, cache-line reuse.
2.5 **Shared memory and bank conflicts.** Banks, broadcast, padding and swizzling.
2.6 **Registers, spilling and occupancy.** The occupancy calculator from first principles, and why more occupancy isn't always better.

→ **Milestone A3**: Project A complete

## Part 3: Parallel building blocks
3.1 **Reduction.** Tree reduction, warp shuffles, multiple elements per thread. → **Milestone B1**
3.2 **Scan.** Hillis–Steele, Blelloch, single-pass decoupled look-back. → **Milestone B2**
3.3 **Atomics and histograms.** Contention, privatisation, hierarchical atomics. → **Milestone B3**
3.4 **Synchronisation and the memory model.** Barriers, fences, visibility, cooperative groups.
3.5 **Compaction and sorting.** Stream compaction; radix sort from scan and histogram.

→ **Milestone B4**

## Part 4: Matrix multiply, the kernel everything depends on
4.1 **Naive GEMM and why it's slow.** Arithmetic intensity on the roofline.
4.2 **Tiling into shared memory.** Reuse, tile sizes, the occupancy trade-off. → **Milestone C1**
4.3 **Register tiling and thread coarsening.** Outer products in registers. → **Milestone C2**
4.4 **Vectorised loads, double buffering, async copies.** Overlapping memory with compute. → **Milestone C3**
4.5 **Tensor cores and mixed precision.** MMA fragments, FP16/BF16/FP8, accumulation precision.

→ **Milestone C4**

## Part 5: Measuring like a performance engineer
5.1 **Timing correctly.** Warm-up, synchronisation, variance, what not to measure.
5.2 **Profiler metrics.** Throughput, achieved occupancy, stall reasons, memory charts (Nsight Compute concepts).
5.3 **From stall reasons to bottleneck.** Latency-bound vs bandwidth-bound vs compute-bound vs launch-bound. *Exercises: diagnose mystery kernels.*
5.4 **Tail effects and load balance.** Waves, partial waves, grid sizing.

→ **Milestone B5**: Project B complete

## Part 6: The compiler's view
6.1 **From CUDA C to PTX to SASS.** The compilation pipeline and what each stage decides.
6.2 **Reading PTX and SASS.** Registers, predicates, memory spaces, control flow.
6.3 **Register allocation vs occupancy.** Live ranges, pressure, spills; `launch_bounds`.
6.4 **Instruction scheduling.** Instruction-level parallelism, dependency latencies, dual issue.
6.5 **Loop transforms and fusion.** Unrolling, software pipelining, vectorisation, kernel fusion.

→ **Milestone C5**: Project C complete

## Part 7: Real workloads
7.1 **Memory-bound fused ops.** Softmax, layernorm, online normalisation.
7.2 **Attention from first principles.** Why naive attention is bound by memory traffic; tiling Q, K and V.
7.3 **Streams and overlap.** Concurrency, copy/compute overlap, multi-GPU basics.

## Part 8: Capstone: a fused attention kernel
Design, implement, tune and explain a FlashAttention-style fused attention forward pass, reusing your GEMM tiles (Project C) and reductions (Project B):

- Correctness against a reference across shapes, including causal masking.
- A performance target on the simulator's roofline.
- A profiling report: the bottleneck at each stage, and what you changed and why.
- A compiler-view section: register pressure, occupancy, and the instruction mix in the generated code.
- A short write-up suitable for a portfolio.

Optional: run it on a real NVIDIA GPU in real-CUDA mode and compare against the simulator's prediction.

## Part 9: Reality: where it breaks
9.1 **Numerics.** Floating-point non-associativity, reproducibility, low-precision pitfalls.
9.2 **Portability.** CUDA vs HIP/AMD (wavefront of 64, LDS) vs Apple/mobile GPUs.
9.3 **Power, clocks and thermals.** Why measured performance moves.
9.4 **What's next.** Into *GPU Compilers from First Principles* and *Build a Tiny GPU Kernel Compiler*.

---

**Size:** 10 parts, 41 chapters, 3 long-term projects (13 milestones) plus 1 capstone.
