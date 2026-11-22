// Lab 0: hello, real GPU. Measure what Part 0 predicted.
//
//   A. Vector add: your first kernel on real hardware, checked against the CPU.
//   B. Copy bandwidth: 1, 2 and 4 elements per thread, and 16-byte vector loads. Chapter 0.4
//      predicted one load per warp can't reach peak on a 2060 Super. Does it?
//   C. Latency: one thread chasing pointers through arrays from 16 KB to 256 MB.
//      The curve shows the L1, L2 and DRAM plateaus (Chapter 0.2, the Volta paper in Part 5).
//   D. Little's law: bytes in flight your measured latency and bandwidth demand.
#include "gw.h"

#include <cstdint>
#include <random>

// ---------------------------------------------------------------------------------------
// A. Vector add
// ---------------------------------------------------------------------------------------
__global__ void add(const float* a, const float* b, float* c, int n) {
  // TODO(A): c[i] = a[i] + b[i] for your global index i, with a bounds check
}

// ---------------------------------------------------------------------------------------
// B. Copy kernels. Each copies n floats from src to dst.
// ---------------------------------------------------------------------------------------
__global__ void copy1(const float* __restrict__ src, float* __restrict__ dst, int n) {
  // TODO(B1): one element per thread
}

// K elements per thread. Keep each warp's accesses contiguous: thread t of the grid handles
// t, t + T, t + 2T, ... where T is the total number of threads. Issue all K loads before any
// store, so K loads are in flight at once (Chapter 0.1, Example 3).
template <int K>
__global__ void copyK(const float* __restrict__ src, float* __restrict__ dst, int n) {
  // TODO(B2)
}

// 16-byte loads: each thread copies one float4. n4 = n / 4 (n is a multiple of 4).
__global__ void copy_vec4(const float4* __restrict__ src, float4* __restrict__ dst, int n4) {
  // TODO(B3)
}

// ---------------------------------------------------------------------------------------
// C. Pointer chase: next[i] is the index of the next element. One thread follows the chain;
// every load depends on the previous one, so time per step is pure latency.
// ---------------------------------------------------------------------------------------
__global__ void chase(const uint32_t* __restrict__ next, int steps, uint32_t* sink, long long* cycles) {
  // TODO(C): follow the chain `steps` times starting at 0; time it with clock64();
  // write the final index to *sink (so the compiler can't remove the loop) and the cycles to *cycles.
}

// ---------------------------------------------------------------------------------------
// Host code: you don't need to change anything below, but read it.
// ---------------------------------------------------------------------------------------
static double run_copy(const char* name, const std::function<void()>& launch, float* d_dst,
                       const std::vector<float>& h_src, size_t n, double peak, gw::Report& r,
                       const char* metric) {
  CUDA_CHECK(cudaMemset(d_dst, 0, n * sizeof(float)));
  launch();
  CUDA_CHECK_LAUNCH();
  std::vector<float> got(n);
  CUDA_CHECK(cudaMemcpy(got.data(), d_dst, n * sizeof(float), cudaMemcpyDeviceToHost));
  r.check(std::string(name) + " copies correctly", gw::all_close(got.data(), h_src.data(), n, 0, 0, name));
  float ms = gw::time_kernel(launch);
  double bw = gw::gbs(2.0 * n * sizeof(float), ms);  // read + write
  r.metric(metric, bw, "GB/s");
  r.metric(std::string(metric) + "_pct", 100.0 * bw / peak, "% of peak");
  return bw;
}

int main() {
  gw::Device dev = gw::device_info();
  gw::print_device(dev);
  gw::Report r("L0");

  // ---- A ----
  {
    const int n = 1000003;  // deliberately not a multiple of the block size
    std::vector<float> a(n), b(n), c(n), want(n);
    for (int i = 0; i < n; i++) { a[i] = i * 0.5f; b[i] = 3.0f - i; want[i] = a[i] + b[i]; }
    float *da, *db, *dc;
    CUDA_CHECK(cudaMalloc(&da, n * 4)); CUDA_CHECK(cudaMalloc(&db, n * 4)); CUDA_CHECK(cudaMalloc(&dc, n * 4));
    CUDA_CHECK(cudaMemcpy(da, a.data(), n * 4, cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMemcpy(db, b.data(), n * 4, cudaMemcpyHostToDevice));
    add<<<(n + 255) / 256, 256>>>(da, db, dc, n);
    CUDA_CHECK_LAUNCH();
    CUDA_CHECK(cudaMemcpy(c.data(), dc, n * 4, cudaMemcpyDeviceToHost));
    std::printf("\nA. vector add\n");
    r.check("vector add matches the CPU", gw::all_close(c.data(), want.data(), n, 0, 0, "add"));
    cudaFree(da); cudaFree(db); cudaFree(dc);
  }

  // ---- B ----
  std::printf("\nB. copy bandwidth (peak %.1f GB/s)\n", dev.peak_gbs);
  const size_t n = size_t(1) << 26;  // 64 Mi floats = 256 MiB each way
  std::vector<float> h_src(n);
  for (size_t i = 0; i < n; i++) h_src[i] = float(i % 1000003) * 0.25f;
  float *src, *dst;
  CUDA_CHECK(cudaMalloc(&src, n * 4)); CUDA_CHECK(cudaMalloc(&dst, n * 4));
  CUDA_CHECK(cudaMemcpy(src, h_src.data(), n * 4, cudaMemcpyHostToDevice));
  const int B = 256, N = int(n);
  double best = 0;
  best = std::max(best, run_copy("copy1", [&] { copy1<<<(N + B - 1) / B, B>>>(src, dst, N); }, dst, h_src, n, dev.peak_gbs, r, "copy1_gbs"));
  best = std::max(best, run_copy("copy2", [&] { copyK<2><<<(N / 2 + B - 1) / B, B>>>(src, dst, N); }, dst, h_src, n, dev.peak_gbs, r, "copy2_gbs"));
  best = std::max(best, run_copy("copy4", [&] { copyK<4><<<(N / 4 + B - 1) / B, B>>>(src, dst, N); }, dst, h_src, n, dev.peak_gbs, r, "copy4_gbs"));
  best = std::max(best, run_copy("copy_vec4", [&] { copy_vec4<<<(N / 4 + B - 1) / B, B>>>(reinterpret_cast<const float4*>(src), reinterpret_cast<float4*>(dst), N / 4); }, dst, h_src, n, dev.peak_gbs, r, "copy_vec4_gbs"));
  float cm_ms = gw::time_kernel([&] { CUDA_CHECK(cudaMemcpyAsync(dst, src, n * 4, cudaMemcpyDeviceToDevice)); });
  double cm = gw::gbs(2.0 * n * 4, cm_ms);
  r.metric("cudaMemcpy_gbs", cm, "GB/s (reference)");
  r.metric("copy_best_pct", 100.0 * best / dev.peak_gbs, "% of peak, your best kernel");
  r.metric("copy_best_vs_memcpy_pct", 100.0 * best / cm, "% of cudaMemcpy");
  cudaFree(src); cudaFree(dst);

  // ---- C ----
  std::printf("\nC. latency: one thread chasing pointers (random order, 128-byte stride)\n");
  std::printf("  %10s %10s %10s\n", "array", "cycles", "ns");
  double lat_small_ns = 0, lat_dram_ns = 0, lat_dram_cycles = 0;
  uint32_t* d_sink; long long* d_cycles;
  CUDA_CHECK(cudaMalloc(&d_sink, 4)); CUDA_CHECK(cudaMalloc(&d_cycles, 8));
  std::mt19937 rng(42);
  for (size_t bytes = 16 << 10; bytes <= (size_t(256) << 20); bytes *= 4) {
    // One element per 128-byte line, visited in a random cyclic order so prefetchers can't help.
    const size_t stride = 32, slots = bytes / 128, len = bytes / 4;
    std::vector<uint32_t> order(slots), next(len, 0);
    for (size_t i = 0; i < slots; i++) order[i] = uint32_t(i);
    std::shuffle(order.begin() + 1, order.end(), rng);
    for (size_t i = 0; i < slots; i++) next[order[i] * stride] = uint32_t(order[(i + 1) % slots] * stride);
    uint32_t* d_next;
    CUDA_CHECK(cudaMalloc(&d_next, len * 4));
    CUDA_CHECK(cudaMemcpy(d_next, next.data(), len * 4, cudaMemcpyHostToDevice));
    const int steps = 1 << 16;
    chase<<<1, 1>>>(d_next, steps, d_sink, d_cycles);  // warm-up (TLB, caches)
    CUDA_CHECK_LAUNCH();
    chase<<<1, 1>>>(d_next, steps, d_sink, d_cycles);
    CUDA_CHECK_LAUNCH();
    long long cyc = 0;
    CUDA_CHECK(cudaMemcpy(&cyc, d_cycles, 8, cudaMemcpyDeviceToHost));
    double per = double(cyc) / steps, ns = per / (dev.sm_clock_mhz * 1e-3);
    std::printf("  %8zu KB %10.1f %10.1f\n", bytes >> 10, per, ns);
    if (bytes == (16 << 10)) lat_small_ns = ns;
    lat_dram_cycles = per; lat_dram_ns = ns;
    cudaFree(d_next);
  }
  r.metric("latency_16KB_ns", lat_small_ns, "ns (fits in L1)");
  r.metric("latency_dram_cycles", lat_dram_cycles, "cycles (256 MB: DRAM, plus TLB misses)");
  r.metric("latency_dram_ns", lat_dram_ns, "ns, at the max SM clock");
  r.check("latency curve rises from L1 to DRAM", lat_dram_ns > 2 * lat_small_ns);

  // ---- D ----
  double need = dev.peak_gbs * lat_dram_ns;  // GB/s × ns = bytes
  double warps = double(dev.sms) * dev.max_threads_per_sm / dev.warp_size;
  std::printf("\nD. Little's law: peak × DRAM latency = %.0f bytes in flight needed\n", need);
  std::printf("   one 128-byte load per resident warp supplies %.0f bytes (%.0f%% of that)\n", warps * 128, 100 * warps * 128 / need);
  r.metric("bytes_in_flight_needed", need, "bytes");
  r.metric("one_load_per_warp_supply_pct", 100 * warps * 128 / need, "%");

  r.write(dev);
  return r.all_passed() ? 0 : 1;
}
