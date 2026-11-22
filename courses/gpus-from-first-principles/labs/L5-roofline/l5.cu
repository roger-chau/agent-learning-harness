// Lab 5: measuring like a performance engineer. Build your card's roofline from
// microbenchmarks, see a tail effect, and diagnose and fix a slow kernel with Nsight Compute.
//
//   A. FP32 peak: a kernel that does nothing but independent FMAs.
//   B. Arithmetic-intensity sweep: the same streaming kernel with K FMAs per element, for
//      K = 1 ... 1024. Plotting GFLOP/s against FLOP/byte traces the roofline (roofline.csv).
//   C. Tail effects: one block too many costs a whole wave; finer blocks fix it.
//   D. Diagnose and fix: a slow matrix-vector product (GEMV). Profile it, then rewrite it.
#include "gw.h"

#include <cstdint>

constexpr int BLOCK = 256;

// FP32 lanes per SM (FMAs per clock per SM): 64 on Volta, Turing and A100, 128 on consumer
// Ampere, Ada and Hopper.
inline int fp32_lanes_per_sm(const gw::Device& d) {
  int cc = d.major * 10 + d.minor;
  if (cc == 86 || cc == 87 || cc == 89 || cc >= 90) return 128;
  return 64;
}

// ---------------------------------------------------------------------------------------
// A. Peak FMA throughput. Each thread keeps CHAINS independent accumulators so that the FMA
// latency (4 cycles on Turing) is hidden by instruction-level parallelism as well as by warps.
// Each thread does CHAINS * iters FMAs; write a result so the compiler can't delete the work.
// ---------------------------------------------------------------------------------------
constexpr int CHAINS = 8;

__global__ void fma_peak(float* out, float a, float b, int iters) {
  // TODO(A): CHAINS independent accumulators, `iters` rounds of acc[c] = acc[c] * a + b
}

// ---------------------------------------------------------------------------------------
// B. Streaming kernel with tunable arithmetic intensity: y[i] = f_K(x[i]), where f_K applies
// v = v * a + b K times to each component of a float4. Grid-stride over n4 float4s.
// Per float4: 8K FLOPs, 32 bytes moved (16 read, 16 written): intensity K / 4 FLOP/byte.
// ---------------------------------------------------------------------------------------
template <int K>
__global__ void intensity(const float4* __restrict__ x, float4* __restrict__ y, size_t n4, float a, float b) {
  // TODO(B): grid-stride loop; load a float4, K rounds of FMA on each of its 4 components, store
}

// ---------------------------------------------------------------------------------------
// C. Tail effects. Every block of `busy` takes the same time: it spins on the SM's clock for
// `cycles` cycles. (Compute-bound blocks are subtler: a block left alone on an SM runs faster.
// See "Going further".) Given.
// ---------------------------------------------------------------------------------------
__global__ void busy(int* out, long long cycles) {
  long long t0 = clock64();
  while (clock64() - t0 < cycles) {}
  if (threadIdx.x == 0 && cycles < 0) out[0] = blockIdx.x;  // never true
}

// How many blocks of `busy` (BLOCK threads) fit on the whole GPU at once: one "wave".
int wave_capacity(const gw::Device& dev) {
  // TODO(C): ask the occupancy API how many blocks fit per SM, times the number of SMs
  return {};  // replace
}

// ---------------------------------------------------------------------------------------
// D. GEMV: y = A x, with A row-major rows x cols. The given kernel is slow. Profile it
// (`make ncu-gemv`) before you change anything, then write gemv_fast.
// ---------------------------------------------------------------------------------------
__global__ void gemv_slow(const float* __restrict__ A, const float* __restrict__ x, float* __restrict__ y,
                          int rows, int cols) {
  int r = blockIdx.x * blockDim.x + threadIdx.x;  // one thread per row
  if (r >= rows) return;
  float s = 0.f;
  for (int c = 0; c < cols; c++) s += A[size_t(r) * cols + c] * x[c];
  y[r] = s;
}

// Your version. Launched with GEMV_BLOCK threads per block and gemv_grid(rows) blocks: choose
// both. cols is a multiple of 128.
constexpr int GEMV_BLOCK = 256;
inline int gemv_grid(int rows) {
  // TODO(D0): the number of blocks for your mapping of rows to threads
  return {};  // replace
}

__global__ void gemv_fast(const float* __restrict__ A, const float* __restrict__ x, float* __restrict__ y,
                          int rows, int cols) {
  // TODO(D): e.g. one warp per row: lanes read consecutive float4s, then a shuffle reduction
}

// ---------------------------------------------------------------------------------------

template <int K>
double run_intensity(const float4* x, float4* y, size_t n4, int grid, FILE* csv, double peak_gbs) {
  float ms = gw::time_kernel([&] { intensity<K><<<grid, BLOCK>>>(x, y, n4, 0.999f, 0.001f); });
  double flops = 8.0 * K * n4, bytes = 32.0 * n4;
  double gf = flops / (ms * 1e-3) / 1e9, bw = gw::gbs(bytes, ms);
  std::printf("  K=%4d  intensity %7.2f FLOP/B  %9.1f GFLOP/s  %7.1f GB/s (%5.1f%% of peak)\n", K, K / 4.0, gf,
              bw, 100 * bw / peak_gbs);
  std::fprintf(csv, "%d,%.4f,%.3f,%.3f\n", K, K / 4.0, gf, bw);
  return K == 1 ? bw : gf;
}

int main() {
  gw::Device dev = gw::device_info();
  gw::print_device(dev);
  gw::Report r("L5");
  const double peak_gflops = dev.sms * fp32_lanes_per_sm(dev) * 2.0 * dev.sm_clock_mhz / 1e3;
  std::printf("  theoretical FP32 peak %.0f GFLOP/s (%d lanes per SM at the reported max clock)\n", peak_gflops,
              fp32_lanes_per_sm(dev));

  // ---- A ----
  double fma_gflops;
  {
    std::printf("\nA. FP32 peak\n");
    const int grid = dev.sms * 8, iters = 8192;
    float* out;
    CUDA_CHECK(cudaMalloc(&out, size_t(grid) * BLOCK * 4));
    fma_peak<<<1, 32>>>(out, 0.5f, 1.f, 3);
    CUDA_CHECK_LAUNCH();
    float h[32];
    CUDA_CHECK(cudaMemcpy(h, out, sizeof h, cudaMemcpyDeviceToHost));
    bool ok = true;
    for (int t = 0; t < 32; t++) {
      float s = 0;
      for (int c = 0; c < CHAINS; c++) {
        float v = float(t + c);
        for (int i = 0; i < 3; i++) v = std::fma(v, 0.5f, 1.f);
        s += v;
      }
      ok = ok && h[t] == s;
    }
    r.check("fma_peak computes CHAINS independent FMA chains", ok);
    float ms = gw::time_kernel([&] { fma_peak<<<grid, BLOCK>>>(out, 0.9999f, 0.0001f, iters); });
    fma_gflops = 2.0 * CHAINS * iters * double(grid) * BLOCK / (ms * 1e-3) / 1e9;
    r.metric("fma_gflops", fma_gflops, "GFLOP/s");
    r.metric("fma_pct", 100 * fma_gflops / peak_gflops, "% of theoretical (can exceed 100 under boost)");
    cudaFree(out);
  }

  // ---- B ----
  {
    std::printf("\nB. roofline sweep (writes roofline.csv)\n");
    const size_t n4 = size_t(1) << 24;  // 256 MiB in, 256 MiB out
    std::vector<float> h(4 * n4);
    for (size_t i = 0; i < h.size(); i++) h[i] = float(i % 1000) * 1e-3f;
    float4 *x, *y;
    CUDA_CHECK(cudaMalloc(&x, n4 * 16)); CUDA_CHECK(cudaMalloc(&y, n4 * 16));
    CUDA_CHECK(cudaMemcpy(x, h.data(), n4 * 16, cudaMemcpyHostToDevice));
    intensity<8><<<dev.sms * 8, BLOCK>>>(x, y, n4, 0.999f, 0.001f);
    CUDA_CHECK_LAUNCH();
    std::vector<float> got(4 * n4);
    CUDA_CHECK(cudaMemcpy(got.data(), y, n4 * 16, cudaMemcpyDeviceToHost));
    bool ok = true;
    for (size_t i = 0; i < got.size() && ok; i += 4099) {
      float v = h[i];
      for (int k = 0; k < 8; k++) v = std::fma(v, 0.999f, 0.001f);
      ok = got[i] == v;
    }
    r.check("intensity<K> applies K FMAs to every element", ok);
    FILE* csv = std::fopen("roofline.csv", "w");
    std::fprintf(csv, "K,flop_per_byte,gflops,gbs\n");
    const int grid = dev.sms * 16;
    double low_bw = run_intensity<1>(x, y, n4, grid, csv, dev.peak_gbs);
    run_intensity<2>(x, y, n4, grid, csv, dev.peak_gbs);
    run_intensity<4>(x, y, n4, grid, csv, dev.peak_gbs);
    run_intensity<8>(x, y, n4, grid, csv, dev.peak_gbs);
    run_intensity<16>(x, y, n4, grid, csv, dev.peak_gbs);
    run_intensity<32>(x, y, n4, grid, csv, dev.peak_gbs);
    run_intensity<64>(x, y, n4, grid, csv, dev.peak_gbs);
    run_intensity<128>(x, y, n4, grid, csv, dev.peak_gbs);
    run_intensity<256>(x, y, n4, grid, csv, dev.peak_gbs);
    run_intensity<512>(x, y, n4, grid, csv, dev.peak_gbs);
    double high_gf = run_intensity<1024>(x, y, n4, grid, csv, dev.peak_gbs);
    std::fclose(csv);
    r.metric("low_intensity_bw_pct", 100 * low_bw / dev.peak_gbs, "% of peak bandwidth at K=1");
    r.metric("high_intensity_vs_fma_pct", 100 * high_gf / fma_gflops, "% of part A's FMA rate at K=1024");
    r.metric("ridge_flop_per_byte", fma_gflops / (low_bw > 0 ? low_bw : 1), "FLOP/byte (measured peaks)");
    cudaFree(x); cudaFree(y);
  }

  // ---- C ----
  {
    std::printf("\nC. tail effects\n");
    const int cap = wave_capacity(dev);
    const long long cycles = 1 << 20;  // about 0.6 ms at 1.7 GHz
    std::printf("  one wave = %d blocks of %d threads\n", cap, BLOCK);
    int* out;
    CUDA_CHECK(cudaMalloc(&out, 4));
    r.check("wave_capacity is a whole number of blocks per SM",
            cap > 0 && cap % dev.sms == 0 && cap / dev.sms * BLOCK <= dev.max_threads_per_sm);
    auto t = [&](int blocks, long long c) { return gw::time_kernel([&] { busy<<<blocks, BLOCK>>>(out, c); }, 7, 1); };
    float full = t(cap, cycles), plus1 = t(cap + 1, cycles), two = t(2 * cap, cycles);
    float fine = t(8 * (cap + 1), cycles / 8);  // the same total work, in blocks 8x smaller
    std::printf("  %d blocks %.2f ms, %d blocks %.2f ms, %d blocks %.2f ms; %d small blocks %.2f ms\n", cap, full,
                cap + 1, plus1, 2 * cap, two, 8 * (cap + 1), fine);
    r.metric("tail_ratio", plus1 / full, "time(one wave + 1 block) / time(one wave)");
    r.metric("two_wave_ratio", two / plus1, "time(two waves) / time(one wave + 1 block)");
    r.metric("fine_ratio", fine / full, "same work in 8x smaller blocks / one wave");
    cudaFree(out);
  }

  // ---- D ----
  {
    std::printf("\nD. GEMV\n");
    const int rows = 16384, cols = 4096;
    std::vector<float> hA(size_t(rows) * cols), hx(cols), hy(rows), want(rows);
    // multiples of 1/8 in [-1, 1]: every product and partial sum is exact in FP32
    for (size_t i = 0; i < hA.size(); i++) hA[i] = float(int((uint32_t(i) * 2654435761u) >> 28) - 8) * 0.125f;
    for (int c = 0; c < cols; c++) hx[c] = float((c * 7) % 17 - 8) * 0.125f;
    for (int rr = 0; rr < rows; rr++) {
      double s = 0;
      for (int c = 0; c < cols; c++) s += double(hA[size_t(rr) * cols + c]) * hx[c];
      want[rr] = float(s);
    }
    float *A, *x, *y;
    CUDA_CHECK(cudaMalloc(&A, hA.size() * 4)); CUDA_CHECK(cudaMalloc(&x, cols * 4)); CUDA_CHECK(cudaMalloc(&y, rows * 4));
    CUDA_CHECK(cudaMemcpy(A, hA.data(), hA.size() * 4, cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMemcpy(x, hx.data(), cols * 4, cudaMemcpyHostToDevice));
    double bytes = 4.0 * (double(rows) * cols + cols + rows);

    auto slow = [&] { gemv_slow<<<(rows + BLOCK - 1) / BLOCK, BLOCK>>>(A, x, y, rows, cols); };
    slow(); CUDA_CHECK_LAUNCH();
    CUDA_CHECK(cudaMemcpy(hy.data(), y, rows * 4, cudaMemcpyDeviceToHost));
    r.check("gemv_slow is correct", gw::all_close(hy.data(), want.data(), rows, 0, 0, "gemv_slow"));
    float slow_ms = gw::time_kernel(slow, 5, 1);

    CUDA_CHECK(cudaMemset(y, 0, rows * 4));
    auto fast = [&] { gemv_fast<<<gemv_grid(rows), GEMV_BLOCK>>>(A, x, y, rows, cols); };
    fast(); CUDA_CHECK_LAUNCH();
    CUDA_CHECK(cudaMemcpy(hy.data(), y, rows * 4, cudaMemcpyDeviceToHost));
    r.check("gemv_fast is correct", gw::all_close(hy.data(), want.data(), rows, 0, 0, "gemv_fast"));
    float fast_ms = gw::time_kernel(fast);
    r.metric("gemv_slow_pct", 100 * gw::gbs(bytes, slow_ms) / dev.peak_gbs, "% of peak bandwidth");
    r.metric("gemv_fast_pct", 100 * gw::gbs(bytes, fast_ms) / dev.peak_gbs, "% of peak bandwidth");
    r.metric("gemv_speedup", slow_ms / fast_ms, "x");
    cudaFree(A); cudaFree(x); cudaFree(y);
  }

  r.write(dev);
  return r.all_passed() ? 0 : 1;
}
