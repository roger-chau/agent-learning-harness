// Lab 9: reality. Where the clean model of Parts 0 to 8 breaks on a real card.
//
//   A. Determinism: a float sum with atomics gives a different answer every run. Make it
//      bit-reproducible without giving up speed (Chapter 9.1).
//   B. Accuracy: long per-thread float accumulations lose digits. Compensated (Kahan)
//      summation gets them back, nearly for free on a memory-bound kernel (Chapter 9.1).
//   C. Clocks, power and temperature under sustained load, sampled with NVML while a compute
//      kernel runs for 20 seconds (Chapter 9.3). Build with `make NVML=0` if NVML isn't
//      available; then watch `nvidia-smi dmon` in another terminal instead.
#include "gw.h"

#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <set>
#include <thread>
#ifdef GW_NVML
#include <nvml.h>
#endif

constexpr int BLOCK = 256;

__device__ __forceinline__ float block_sum(float v) {
  __shared__ float part[BLOCK / 32];
  for (int o = 16; o > 0; o >>= 1) v += __shfl_xor_sync(0xffffffffu, v, o);
  if ((threadIdx.x & 31) == 0) part[threadIdx.x >> 5] = v;
  __syncthreads();
  float t = 0.f;
  for (int w = 0; w < BLOCK / 32; w++) t += part[w];  // same order in every thread
  __syncthreads();
  return t;
}

// ---------------------------------------------------------------------------------------
// A. Given: each block reduces its grid-stride share, then adds it to *out with atomicAdd.
// Blocks finish in a different order every run, and float addition isn't associative.
// ---------------------------------------------------------------------------------------
__global__ void sum_atomic(const float* __restrict__ x, size_t n, float* out) {
  float s = 0.f;
  for (size_t i = size_t(blockIdx.x) * BLOCK + threadIdx.x; i < n; i += size_t(gridDim.x) * BLOCK) s += x[i];
  s = block_sum(s);
  if (threadIdx.x == 0) atomicAdd(out, s);
}

// Yours: the same work, bit-identical on every run. Each block writes its partial sum to
// partial[blockIdx.x]; then sum_finish adds the partials in a fixed order. (CUB does the same.
// What would make even this differ between two GPUs, or two grid sizes?)
__global__ void sum_partials(const float* __restrict__ x, size_t n, float* __restrict__ partial) {
  // TODO(A): the block's grid-stride share, block_sum, one write per block
}
__global__ void sum_finish(const float* __restrict__ partial, int m, float* out) {
  // TODO(A2): one block; a fixed order over the m partials
}

// ---------------------------------------------------------------------------------------
// B. Each thread sums a contiguous run of `per` values (as a vectorised kernel that gives
// each thread a chunk might). Given: the plain version. Yours: Kahan summation in the
// per-thread loop. (Compile with -O3 but not --use_fast_math, which would let the compiler
// cancel the compensation: check the SASS.)
// ---------------------------------------------------------------------------------------
__global__ void chunk_sum_plain(const float* __restrict__ x, int per, float* __restrict__ partial) {
  const float* p = x + (size_t(blockIdx.x) * BLOCK + threadIdx.x) * per;
  float s = 0.f;
  for (int i = 0; i < per; i++) s += p[i];
  s = block_sum(s);
  if (threadIdx.x == 0) partial[blockIdx.x] = s;
}

__global__ void chunk_sum_kahan(const float* __restrict__ x, int per, float* __restrict__ partial) {
  // TODO(B): s and a compensation c: y = v - c; t = s + y; c = (t - s) - y; s = t
}

// ---------------------------------------------------------------------------------------
// C. Given: a sustained FP32 load (Lab 5's FMA kernel).
// ---------------------------------------------------------------------------------------
__global__ void burn(float* out, int iters) {
  float a[8];
#pragma unroll
  for (int c = 0; c < 8; c++) a[c] = threadIdx.x + c;
  for (int i = 0; i < iters; i++) {
#pragma unroll
    for (int c = 0; c < 8; c++) a[c] = fmaf(a[c], 0.9999f, 0.0001f);
  }
  out[blockIdx.x * blockDim.x + threadIdx.x] = a[0] + a[1] + a[2] + a[3] + a[4] + a[5] + a[6] + a[7];
}

// ---------------------------------------------------------------------------------------

int main() {
  gw::Device dev = gw::device_info();
  gw::print_device(dev);
  gw::Report r("L9");
  const size_t n = size_t(1) << 26;
  std::vector<float> h(n);
  // Wide range of magnitudes, so that the order of additions changes the rounding.
  for (size_t i = 0; i < n; i++) {
    uint32_t u = uint32_t(i) * 2654435761u;
    h[i] = std::ldexp(float(u >> 8) / float(1 << 24), int(u % 24) - 12) * ((u >> 5) & 1 ? 1.f : -1.f) + 0.25f;
  }
  double exact = 0;
  for (float f : h) exact += f;
  float* x;
  CUDA_CHECK(cudaMalloc(&x, n * 4));
  CUDA_CHECK(cudaMemcpy(x, h.data(), n * 4, cudaMemcpyHostToDevice));

  // ---- A ----
  {
    std::printf("\nA. determinism\n");
    const int grid = dev.sms * 8;
    float *out, *partial;
    CUDA_CHECK(cudaMalloc(&out, 4)); CUDA_CHECK(cudaMalloc(&partial, grid * 4));
    auto atomic = [&] { CUDA_CHECK(cudaMemsetAsync(out, 0, 4)); sum_atomic<<<grid, BLOCK>>>(x, n, out); };
    auto det = [&] { sum_partials<<<grid, BLOCK>>>(x, n, partial); sum_finish<<<1, BLOCK>>>(partial, grid, out); };
    std::set<uint32_t> seen_atomic, seen_det;
    float any_det = 0;
    for (int run = 0; run < 30; run++) {
      float v;
      atomic(); CUDA_CHECK_LAUNCH();
      CUDA_CHECK(cudaMemcpy(&v, out, 4, cudaMemcpyDeviceToHost));
      uint32_t b; std::memcpy(&b, &v, 4); seen_atomic.insert(b);
      det(); CUDA_CHECK_LAUNCH();
      CUDA_CHECK(cudaMemcpy(&v, out, 4, cudaMemcpyDeviceToHost));
      std::memcpy(&b, &v, 4); seen_det.insert(b); any_det = v;
    }
    std::printf("  30 runs: %zu distinct atomic results, %zu distinct deterministic results\n", seen_atomic.size(),
                seen_det.size());
    r.check("the deterministic sum gives one answer in 30 runs", seen_det.size() == 1);
    r.check("the deterministic sum is accurate (relative error < 1e-5)", std::fabs(any_det - exact) < 1e-5 * std::fabs(exact));
    r.metric("atomic_distinct_results", double(seen_atomic.size()), "of 30 runs");
    float ta = gw::time_kernel(atomic), td = gw::time_kernel(det);
    r.metric("deterministic_vs_atomic", ta / td, "x speed");
    r.metric("deterministic_pct", 100 * gw::gbs(4.0 * n, td) / dev.peak_gbs, "% of peak bandwidth");
    cudaFree(out); cudaFree(partial);
  }

  // ---- B ----
  {
    std::printf("\nB. accuracy\n");
    // Values near 0.1, none exact in binary: every addition rounds.
    std::vector<float> h2(n);
    for (size_t i = 0; i < n; i++) h2[i] = 0.1f + float(i % 97) * 1e-3f;
    double exact2 = 0;
    for (float f : h2) exact2 += f;
    CUDA_CHECK(cudaMemcpy(x, h2.data(), n * 4, cudaMemcpyHostToDevice));
    const int per = 8192, blocks = int(n / (size_t(per) * BLOCK));  // 32 blocks
    float *partial;
    CUDA_CHECK(cudaMalloc(&partial, blocks * 4));
    std::vector<float> hp(blocks);
    auto total = [&] {
      CUDA_CHECK(cudaMemcpy(hp.data(), partial, blocks * 4, cudaMemcpyDeviceToHost));
      double s = 0;
      for (float f : hp) s += f;  // in double: the error measured is the kernels'
      return s;
    };
    chunk_sum_plain<<<blocks, BLOCK>>>(x, per, partial); CUDA_CHECK_LAUNCH();
    double plain = total();
    chunk_sum_kahan<<<blocks, BLOCK>>>(x, per, partial); CUDA_CHECK_LAUNCH();
    double kahan = total();
    double ep = std::fabs(plain - exact2) / exact2, ek = std::fabs(kahan - exact2) / exact2;
    std::printf("  exact %.10g, plain %.10g (rel. error %.2e), Kahan %.10g (rel. error %.2e)\n", exact2, plain, ep, kahan, ek);
    r.metric("plain_rel_error", ep);
    r.metric("kahan_rel_error", ek);
    r.metric("kahan_improvement", ep / std::max(ek, 1e-12), "x smaller error");
    float tp = gw::time_kernel([&] { chunk_sum_plain<<<blocks, BLOCK>>>(x, per, partial); });
    float tk = gw::time_kernel([&] { chunk_sum_kahan<<<blocks, BLOCK>>>(x, per, partial); });
    r.metric("kahan_cost", tk / tp, "x time");
    cudaFree(partial);
  }
  cudaFree(x);

  // ---- C ----
  {
    std::printf("\nC. 20 seconds of sustained load (writes clocks.csv)\n");
    const int grid = dev.sms * 8, iters = 1 << 14;
    float* out;
    CUDA_CHECK(cudaMalloc(&out, size_t(grid) * BLOCK * 4));
    const double flop_per_launch = 2.0 * 8 * iters * double(grid) * BLOCK;
    std::atomic<bool> done{false};
    std::vector<std::array<double, 4>> samples;  // seconds, SM MHz, watts, Celsius
    auto t0 = std::chrono::steady_clock::now();
    auto secs = [&] { return std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count(); };
#ifdef GW_NVML
    std::thread sampler([&] {
      if (nvmlInit_v2() != NVML_SUCCESS) { std::printf("  NVML unavailable: no samples\n"); return; }
      nvmlDevice_t nd;
      nvmlDeviceGetHandleByIndex_v2(0, &nd);
      while (!done) {
        unsigned mhz = 0, mw = 0, temp = 0;
        nvmlDeviceGetClockInfo(nd, NVML_CLOCK_SM, &mhz);
        nvmlDeviceGetPowerUsage(nd, &mw);
        nvmlDeviceGetTemperature(nd, NVML_TEMPERATURE_GPU, &temp);
        samples.push_back({secs(), double(mhz), mw / 1000.0, double(temp)});
        std::this_thread::sleep_for(std::chrono::milliseconds(200));
      }
      nvmlShutdown();
    });
#endif
    std::vector<std::pair<double, double>> rate;  // seconds, GFLOP/s
    cudaEvent_t a, b;
    CUDA_CHECK(cudaEventCreate(&a)); CUDA_CHECK(cudaEventCreate(&b));
    while (secs() < 20) {
      CUDA_CHECK(cudaEventRecord(a));
      for (int k = 0; k < 10; k++) burn<<<grid, BLOCK>>>(out, iters);
      CUDA_CHECK(cudaEventRecord(b));
      CUDA_CHECK(cudaEventSynchronize(b));
      CUDA_CHECK(cudaGetLastError());
      float ms; CUDA_CHECK(cudaEventElapsedTime(&ms, a, b));
      rate.push_back({secs(), 10 * flop_per_launch / (ms * 1e-3) / 1e9});
    }
    done = true;
#ifdef GW_NVML
    sampler.join();
#endif
    FILE* f = std::fopen("clocks.csv", "w");
    std::fprintf(f, "seconds,gflops,sm_mhz,watts,celsius\n");
    size_t si = 0;
    for (auto& [t, g] : rate) {
      while (si + 1 < samples.size() && samples[si + 1][0] <= t) si++;
      if (samples.empty()) std::fprintf(f, "%.2f,%.1f,,,\n", t, g);
      else std::fprintf(f, "%.2f,%.1f,%.0f,%.1f,%.0f\n", t, g, samples[si][1], samples[si][2], samples[si][3]);
    }
    std::fclose(f);
    auto avg = [&](double lo, double hi) {
      double s = 0; int c = 0;
      for (auto& [t, g] : rate) if (t >= lo && t < hi) { s += g; c++; }
      return c ? s / c : 0.0;
    };
    double first = avg(0, 2), last = avg(18, 20);
    std::vector<double> gs;
    for (auto& p : rate) gs.push_back(p.second);
    double mean = 0, var = 0;
    for (double g : gs) mean += g;
    mean /= gs.size();
    for (double g : gs) var += (g - mean) * (g - mean);
    std::printf("  first 2 s %.0f GFLOP/s, last 2 s %.0f GFLOP/s, %zu NVML samples\n", first, last, samples.size());
    if (!samples.empty())
      std::printf("  SM clock %.0f -> %.0f MHz, power %.0f -> %.0f W, temperature %.0f -> %.0f C\n", samples.front()[1],
                  samples.back()[1], samples.front()[2], samples.back()[2], samples.front()[3], samples.back()[3]);
    r.check("sustained load ran for 20 seconds", rate.size() > 10);
    r.metric("sustained_vs_initial", last / first, "throughput, last 2 s / first 2 s");
    r.metric("throughput_cv_pct", 100 * std::sqrt(var / gs.size()) / mean, "% run-to-run variation");
    if (!samples.empty()) {
      double mx = 0, mn = 1e9;
      for (auto& s : samples) { mx = std::max(mx, s[1]); mn = std::min(mn, s[1]); }
      r.metric("sm_clock_max_mhz", mx, "MHz");
      r.metric("sm_clock_min_mhz", mn, "MHz");
      r.metric("final_watts", samples.back()[2], "W");
    }
    cudaFree(out);
  }

  r.write(dev);
  return r.all_passed() ? 0 : 1;
}
