// Lab 3: parallel primitives on real hardware, measured against NVIDIA's CUB library.
//
//   A. Sum reduction of 64 Mi floats: target close to peak bandwidth.
//   B. Exclusive scan of 32 Mi ints: three-phase (reduce, scan the block sums, add), vs CUB.
//   C. 256-bin histogram of skewed bytes: privatised in shared memory vs global atomics.
#include "gw.h"

#include <cstdint>
#include <cub/cub.cuh>

constexpr int BLOCK = 256;

// Sum of the values of one block (all threads get the result). Uses shuffles within a warp,
// then shared memory across warps (Chapter 3.1).
__device__ __forceinline__ float block_sum(float v) {
  // TODO(A0): shuffle-reduce within each warp, combine the warp sums through shared memory
  return {};  // replace
}

// ---------------------------------------------------------------------------------------
// A. Reduction: each block sums a grid-stride share of x into partial[blockIdx.x]; a second
// launch with one block sums the partials. Use float4 loads and several loads in flight.
// ---------------------------------------------------------------------------------------
__global__ void reduce_partial(const float* __restrict__ x, float* __restrict__ partial, size_t n) {
  // TODO(A)
}

// ---------------------------------------------------------------------------------------
// B. Exclusive scan, three phases. Each block handles TILE = BLOCK * ITEMS consecutive ints.
// ---------------------------------------------------------------------------------------
constexpr int ITEMS = 8, TILE = BLOCK * ITEMS;

// Exclusive scan of one int per thread across the block. Returns this thread's exclusive prefix;
// every thread also gets the block total in `total`.
__device__ __forceinline__ int block_exclusive_scan(int v, int& total) {
  // TODO(B0): warp scans with __shfl_up_sync, then a scan of the warp totals by warp 0
  return {};  // replace
}

// Phase 1: the sum of each tile.
__global__ void scan_tile_sums(const int* __restrict__ in, int* __restrict__ sums, int n) {
  // TODO(B1)
}

// Phase 2: exclusive scan of the m tile sums, in place, by one block. m can be larger than one
// block's worth (16,384 tiles for 32 Mi elements): walk it in chunks, carrying the running total.
__global__ void scan_sums(int* __restrict__ sums, int m) {
  // TODO(B2)
}

// Phase 3: scan each tile and add its offset.
__global__ void scan_tiles(const int* __restrict__ in, int* __restrict__ out, const int* __restrict__ offsets, int n) {
  // TODO(B3): each thread scans ITEMS consecutive values in registers; combine across the block;
  // add offsets[blockIdx.x]. Load through shared memory so global accesses stay coalesced.
}

// ---------------------------------------------------------------------------------------
// C. Histogram of bytes into 256 bins.
// ---------------------------------------------------------------------------------------
__global__ void hist_global(const uint8_t* __restrict__ data, unsigned* __restrict__ bins, size_t n) {
  // Given: one global atomic per byte. Slow on skewed data (Chapter 3.3).
  for (size_t i = size_t(blockIdx.x) * blockDim.x + threadIdx.x; i < n; i += size_t(gridDim.x) * blockDim.x) atomicAdd(&bins[data[i]], 1u);
}

__global__ void hist_private(const uint8_t* __restrict__ data, unsigned* __restrict__ bins, size_t n) {
  // TODO(C): a private histogram per block in shared memory, then one global atomic per bin.
  // Read 4 bytes at a time (uint32 loads) to cut load instructions.
}

// ---------------------------------------------------------------------------------------
// Host code
// ---------------------------------------------------------------------------------------
int main() {
  gw::Device dev = gw::device_info();
  gw::print_device(dev);
  gw::Report r("L3");
  const int grid = dev.sms * 8;  // a few blocks per SM, grid-stride over the data

  // ---- A ----
  {
    std::printf("\nA. reduction\n");
    const size_t n = (size_t(1) << 26) + 3;  // not a multiple of 4: the tail matters
    std::vector<float> h(n);
    double exact = 0;
    for (size_t i = 0; i < n; i++) { h[i] = float(int(i % 17) - 8) * 0.125f; exact += h[i]; }
    float *x, *partial, *out;
    CUDA_CHECK(cudaMalloc(&x, n * 4)); CUDA_CHECK(cudaMalloc(&partial, grid * 4)); CUDA_CHECK(cudaMalloc(&out, 4));
    CUDA_CHECK(cudaMemcpy(x, h.data(), n * 4, cudaMemcpyHostToDevice));
    auto launch = [&] { reduce_partial<<<grid, BLOCK>>>(x, partial, n); reduce_partial<<<1, BLOCK>>>(partial, out, grid); };
    launch(); CUDA_CHECK_LAUNCH();
    float got; CUDA_CHECK(cudaMemcpy(&got, out, 4, cudaMemcpyDeviceToHost));
    r.check("reduction is correct (values are exact in binary)", double(got) == exact);
    float ms = gw::time_kernel(launch);
    r.metric("reduce_pct", 100 * gw::gbs(4.0 * n, ms) / dev.peak_gbs, "% of peak");
    // CUB for comparison
    void* tmp = nullptr; size_t tmp_bytes = 0;
    CUDA_CHECK(cub::DeviceReduce::Sum(tmp, tmp_bytes, x, out, int(n)));
    CUDA_CHECK(cudaMalloc(&tmp, tmp_bytes));
    float cub_ms = gw::time_kernel([&] { cub::DeviceReduce::Sum(tmp, tmp_bytes, x, out, int(n)); });
    r.metric("reduce_vs_cub_pct", 100 * cub_ms / ms, "% of CUB's speed");
    cudaFree(tmp); cudaFree(x); cudaFree(partial); cudaFree(out);
  }

  // ---- B ----
  {
    std::printf("\nB. exclusive scan\n");
    const int n = (1 << 25) - 5, m = (n + TILE - 1) / TILE;
    std::vector<int> h(n), got(n);
    for (int i = 0; i < n; i++) h[i] = (i * 7) % 5;  // keeps the total inside int
    int *in, *out, *sums;
    CUDA_CHECK(cudaMalloc(&in, n * 4)); CUDA_CHECK(cudaMalloc(&out, n * 4)); CUDA_CHECK(cudaMalloc(&sums, m * 4));
    CUDA_CHECK(cudaMemcpy(in, h.data(), n * 4, cudaMemcpyHostToDevice));
    auto launch = [&] {
      scan_tile_sums<<<m, BLOCK>>>(in, sums, n);
      scan_sums<<<1, BLOCK>>>(sums, m);
      scan_tiles<<<m, BLOCK>>>(in, out, sums, n);
    };
    launch(); CUDA_CHECK_LAUNCH();
    CUDA_CHECK(cudaMemcpy(got.data(), out, n * 4, cudaMemcpyDeviceToHost));
    bool ok = true; long long run = 0;
    for (int i = 0; i < n && ok; i++) { ok = got[i] == run; run += h[i]; }
    r.check("scan is correct", ok);
    float ms = gw::time_kernel(launch);
    r.metric("scan_gbs", gw::gbs(8.0 * n, ms), "GB/s (4 bytes in + 4 out per element)");
    void* tmp = nullptr; size_t tmp_bytes = 0;
    CUDA_CHECK(cub::DeviceScan::ExclusiveSum(tmp, tmp_bytes, in, out, n));
    CUDA_CHECK(cudaMalloc(&tmp, tmp_bytes));
    float cub_ms = gw::time_kernel([&] { cub::DeviceScan::ExclusiveSum(tmp, tmp_bytes, in, out, n); });
    r.metric("scan_vs_cub_pct", 100 * cub_ms / ms, "% of CUB's speed (CUB uses decoupled look-back)");
    cudaFree(tmp); cudaFree(in); cudaFree(out); cudaFree(sums);
  }

  // ---- C ----
  {
    std::printf("\nC. histogram of skewed data (60%% of bytes are 0)\n");
    const size_t n = size_t(1) << 27;
    std::vector<uint8_t> h(n);
    uint32_t s = 12345;
    for (size_t i = 0; i < n; i++) { s = s * 1664525u + 1013904223u; h[i] = (s >> 24) < 154 ? 0 : uint8_t(s >> 16); }
    std::vector<unsigned> want(256, 0), got(256);
    for (size_t i = 0; i < n; i++) want[h[i]]++;
    uint8_t* d; unsigned* bins;
    CUDA_CHECK(cudaMalloc(&d, n)); CUDA_CHECK(cudaMalloc(&bins, 256 * 4));
    CUDA_CHECK(cudaMemcpy(d, h.data(), n, cudaMemcpyHostToDevice));
    auto run_hist = [&](const char* name, void (*k)(const uint8_t*, unsigned*, size_t)) {
      CUDA_CHECK(cudaMemset(bins, 0, 256 * 4));
      k<<<grid, BLOCK>>>(d, bins, n); CUDA_CHECK_LAUNCH();
      CUDA_CHECK(cudaMemcpy(got.data(), bins, 256 * 4, cudaMemcpyDeviceToHost));
      r.check(std::string(name) + " counts every byte correctly", got == want);
      return gw::time_kernel([&] { CUDA_CHECK(cudaMemsetAsync(bins, 0, 256 * 4)); k<<<grid, BLOCK>>>(d, bins, n); });
    };
    float t_g = run_hist("hist_global", hist_global), t_p = run_hist("hist_private", hist_private);
    r.metric("hist_global_gbs", gw::gbs(double(n), t_g), "GB/s");
    r.metric("hist_private_gbs", gw::gbs(double(n), t_p), "GB/s");
    r.metric("hist_private_pct", 100 * gw::gbs(double(n), t_p) / dev.peak_gbs, "% of peak");
    r.metric("hist_speedup", t_g / t_p, "x over global atomics");
    cudaFree(d); cudaFree(bins);
  }

  r.write(dev);
  return r.all_passed() ? 0 : 1;
}
