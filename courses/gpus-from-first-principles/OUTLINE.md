# GPUs from First Principles

*For future GPU performance and GPU compiler engineers.*

How a GPU really works and how to make code fast on it. The course starts from why throughput machines exist at all. It ends with a fused attention kernel you design, tune, profile and explain.

- **Practice environment:** a browser GPU simulator. You write CUDA-style kernels in the in-page terminal. The simulator runs them warp by warp and reports correctness, cycles, memory transactions, coalescing efficiency, divergence, bank conflicts and occupancy. An optional real-CUDA mode runs the same work with `nvcc` when your machine has an NVIDIA GPU.
- **Companions:**
  - *Computer Architecture: A Quantitative Approach*, 7th edition (Hennessy & Patterson). See the mapping below.
  - *It Thinks! Build your own GPU*, for the gate-level view.

## The projects

Three long-running projects grow across the course in milestones, then a capstone reuses them. Chapter exercises stay small; the projects are where the real building happens.

Every chapter ends with a graded quiz, and every Part ends with a cumulative checkpoint quiz. Both are required to move on.

Every Part also has a **real-world scenario**: an open-ended brief (e.g. "this particle step is too slow, make it 2× faster", "fit this camera ISP stage into a frame budget on an embedded GPU"), graded on a measured outcome plus a design write-up.

| Project | Runs through | What you end up with |
|---|---|---|
| **A. Imaging kernels** | Parts 1–2 | A small image-processing library: grayscale, separable blur, Sobel and transpose. It goes from correct to bandwidth-bound-optimal. |
| **B. Parallel primitives** | Parts 3 and 5 | Your own reduce / scan / histogram / compaction / radix-sort library, profiled and tuned. |
| **C. GEMM, naive to tensor cores** | Parts 4–6 | A matrix multiply you take from naive to near-roofline, then inspect and hand-tune at the assembly level. |
| **Capstone. Fused attention** | Part 8 | A FlashAttention-style kernel built on your GEMM tiles (C) and your reductions (B). |

### Project A: Imaging kernels
- **A1** (after Part 1): grayscale, 5×5 separable blur and Sobel on a real image. Borders must be correct, with zero divergence in interior tiles.
- **A2** (after 2.5): coalesce the whole pipeline. Grayscale's interleaved RGB read is staged through shared memory (≥95% coalescing); the stencils use warp-wide rows (≥80%).
- **A3** (after Part 2): naive, tiled and conflict-free transposes plus a shared-memory tiled blur, on 512×512. Gate: the conflict-free transpose at ≥80% of simulated peak bandwidth with zero bank conflicts, and the tiled blur at ≥95% coalescing.

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

## Companion: Hennessy & Patterson, 7th edition

| Part | Chapters and appendices |
|---|---|
| 0. Why throughput machines | Ch 1 Fundamentals of Quantitative Design and Analysis · Ch 2 Memory Hierarchy Design · App B Review of Memory Hierarchy |
| 1. SIMT | Ch 4 Data-Level Parallelism in Vector, SIMD and GPU Architectures · App G Vector Processors in More Depth |
| 2. Memory | Ch 2 · Ch 4 (GPU memory) · App B · App L Advanced Concepts on Address Translation |
| 3. Parallel building blocks | Ch 5 Thread-Level Parallelism (synchronisation, memory consistency) |
| 4. Matrix multiply | Ch 7 Domain-Specific Architectures (systolic arrays, TPU) · Ch 4 |
| 5. Measuring | Ch 1 (measuring, reporting and summarising performance) |
| 6. The compiler's view | Ch 3 Instruction-Level Parallelism · App C Pipelining · App H VLIW and EPIC · App A Instruction Set Principles · App K Survey of ISAs |
| 7. Real workloads | Ch 6 Warehouse-Scale Computers · App F Interconnection Networks |
| 9. Reality | App J Computer Arithmetic |

App E (Embedded Systems) belongs to the *Embedded GPUs & Accelerators* course.

## Paper chapters

Each paper chapter rebuilds the paper's key idea from first principles, gives a guided reading (what to read closely, what to skim), reproduces the core result in the simulator, and ends with a quiz and "what happened next". Papers are linked, not reproduced. ★ = also has a paper project.

| Part | Paper | Practice |
|---|---|---|
| 1 | Lindholm et al., *NVIDIA Tesla: A Unified Graphics and Computing Architecture* (IEEE Micro, 2008) | Quantitative questions on the G80 design |
| 1 | Fung et al., *Dynamic Warp Formation and Scheduling for Efficient GPU Control Flow* (MICRO, 2007) | Measure SIMD efficiency with and without regrouping |
| 2 | Williams, Waterman & Patterson, *Roofline* (CACM, 2009) | Roofline for the GW-1 with your Project A kernels |
| 2 | Volkov, *Understanding Latency Hiding on GPUs* (PhD thesis, 2016) | Lower occupancy, higher speed |
| 3 | Merrill & Garland, *Single-pass Parallel Prefix Scan with Decoupled Look-back* (2016) | Theory for milestone B2 |
| 3 | Adinets & Merrill, *Onesweep* (2022) | Milestone B4 builds it |
| 4 ★ | Jouppi et al., *In-Datacenter Performance Analysis of a Tensor Processing Unit* (ISCA, 2017) | Project: a systolic array |
| 5 ★ | Jia et al., *Dissecting the NVIDIA Volta GPU Architecture via Microbenchmarking* (2018) | Project: dissect the GW-1 |
| 5 ★ | Osama et al., *Stream-K* (PPoPP, 2023) | Project: Stream-K GEMM (extends Project C) |
| 6 ★ | Tillet, Kung & Cox, *Triton* (MAPL, 2019) | Project: a mini tile compiler |
| 7 | Micikevicius et al., *Mixed Precision Training* (ICLR, 2018) | Numerics exercises |
| 7 ★ | Kwon et al., *Efficient Memory Management for LLM Serving with PagedAttention* (SOSP, 2023) | Project: a paged KV cache |
| 8 | Dao et al., *FlashAttention* 1–3 (2022–2024) | Required reading for the capstone |

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
2.3 **Coalescing.** Access patterns, strides, structure-of-arrays vs array-of-structures.
2.4 **GPU caches.** L1/L2 behaviour, the read-only path, cache-line reuse.
2.5 **Shared memory and bank conflicts.** Banks, broadcast, padding and swizzling. → **Milestone A2** (interleaved RGB can only be coalesced by staging through shared memory)
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

**Size:** 10 parts, 41 chapters, 13 paper chapters, 3 long-term projects (13 milestones), 4 paper projects plus a Stream-K extension, and 1 capstone.
