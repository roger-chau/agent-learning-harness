// Lab 6: the compiler's view. Three things the compiler does or can't do for you, each
// visible in the PTX and SASS (`make ptx`, `make sass`, `make regs`) and in the timings.
//
//   A. ILP versus occupancy: with only 4 warps per SM, one dependent FMA chain per thread
//      can't keep the FP32 pipes busy. Independent chains can (Volkov; Chapters 6.3 and 6.4).
//   B. Local memory: an array indexed with run-time values can't live in registers. A
//      sorting network with compile-time indices can (Chapter 6.3).
//   C. Fusion: three memory-bound passes become one (Chapter 6.5).
#include "gw.h"

#include <cstdint>

// FP32 lanes per SM (see Lab 5).
inline int fp32_lanes_per_sm(const gw::Device& d) {
  int cc = d.major * 10 + d.minor;
  return (cc == 86 || cc == 87 || cc == 89 || cc >= 90) ? 128 : 64;
}

// ---------------------------------------------------------------------------------------
// A. Polynomial evaluation: x <- p(x), ROUNDS times, with p of degree DEG by Horner's rule.
// Both kernels run with 128 threads per block and enough dynamic shared memory that only one
// block fits on an SM, as if the kernel needed a large table there: 4 warps per SM.
// ---------------------------------------------------------------------------------------
constexpr int DEG = 32, ROUNDS = 16, POLY_BLOCK = 128;
__constant__ float coef[DEG + 1];

__device__ __forceinline__ float horner(float x) {
  float p = coef[DEG];
#pragma unroll
  for (int k = DEG - 1; k >= 0; k--) p = fmaf(p, x, coef[k]);
  return p;
}

// Given: one element per thread per grid-stride step. Each element is one long dependent chain.
__global__ void poly_naive(const float* __restrict__ x, float* __restrict__ y, size_t n) {
  extern __shared__ float table[];  // reserved only, to limit occupancy
  if (n == 0) table[threadIdx.x] = 0;
  size_t stride = size_t(gridDim.x) * blockDim.x;
  for (size_t i = size_t(blockIdx.x) * blockDim.x + threadIdx.x; i < n; i += stride) {
    float v = x[i];
    for (int r = 0; r < ROUNDS; r++) v = horner(v);
    y[i] = v;
  }
}

// Yours: the same result, with ILP independent chains per thread. Each grid-stride step
// handles ILP elements, i, i + stride, i + 2 stride, ... so loads stay coalesced. Interleave
// the chains so the FMAs of different elements alternate. n is a multiple of ILP * stride.
constexpr int ILP = 4;
__global__ void poly_ilp(const float* __restrict__ x, float* __restrict__ y, size_t n) {
  // TODO(A): ILP elements per step, evaluated in lockstep (an array v[ILP] with #pragma unroll)
}

// ---------------------------------------------------------------------------------------
// B. Sort 8 floats per thread (each thread owns 8 consecutive floats: two float4s).
// ---------------------------------------------------------------------------------------

// Given: a generic insertion sort of the first k <= 8 values, called with k = 8. Since k is
// only known at run time the loops can't be unrolled, so the indices into `a` are run-time
// values and `a` can't be kept in registers: look for the stack frame in `make regs` and for
// LDL/STL (local loads and stores) in `make sass`.
__global__ void sort8_local(const float4* __restrict__ in, float4* __restrict__ out, size_t m, int k) {
  size_t t = size_t(blockIdx.x) * blockDim.x + threadIdx.x;
  if (t >= m) return;
  float4 lo = in[2 * t], hi = in[2 * t + 1];
  float a[8] = {lo.x, lo.y, lo.z, lo.w, hi.x, hi.y, hi.z, hi.w};
  for (int i = 1; i < k; i++) {
    float v = a[i];
    int j = i - 1;
    while (j >= 0 && a[j] > v) { a[j + 1] = a[j]; j--; }
    a[j + 1] = v;
  }
  out[2 * t] = make_float4(a[0], a[1], a[2], a[3]);
  out[2 * t + 1] = make_float4(a[4], a[5], a[6], a[7]);
}

// Yours, for exactly 8 values: the same result with every array index a compile-time constant, so the whole array
// lives in registers (`make regs` must show no stack frame). A sorting network does this:
// compare-exchange pairs fixed in advance, e.g. odd-even transposition sort (8 rounds), fully
// unrolled, or Batcher's 19-comparator network for 8 inputs.
__device__ __forceinline__ void cmp_swap(float& a, float& b) {
  float lo = fminf(a, b), hi = fmaxf(a, b);
  a = lo; b = hi;
}

__global__ void sort8_regs(const float4* __restrict__ in, float4* __restrict__ out, size_t m) {
  // TODO(B): load, sort with a fixed network of cmp_swap calls (constant indices), store
}

// ---------------------------------------------------------------------------------------
// C. Fusion. Three elementwise passes, each its own kernel (given), and your fused one:
//   y = a x + b,   z = max(y, 0),   w = z * z        (w is the output; y and z are temporaries)
// ---------------------------------------------------------------------------------------
__global__ void affine(const float* __restrict__ x, float* __restrict__ y, size_t n, float a, float b) {
  size_t i = size_t(blockIdx.x) * blockDim.x + threadIdx.x;
  if (i < n) y[i] = fmaf(a, x[i], b);
}
__global__ void relu(const float* __restrict__ y, float* __restrict__ z, size_t n) {
  size_t i = size_t(blockIdx.x) * blockDim.x + threadIdx.x;
  if (i < n) z[i] = fmaxf(y[i], 0.f);
}
__global__ void square(const float* __restrict__ z, float* __restrict__ w, size_t n) {
  size_t i = size_t(blockIdx.x) * blockDim.x + threadIdx.x;
  if (i < n) w[i] = z[i] * z[i];
}

// n is a multiple of 4; launched with fused_grid(n) blocks of 256 threads.
inline int fused_grid(size_t n) {
  // TODO(C0): blocks for your fused kernel
  return {};  // replace
}

__global__ void fused(const float* __restrict__ x, float* __restrict__ w, size_t n, float a, float b) {
  // TODO(C): one pass, same arithmetic as the three kernels (fmaf, then fmaxf, then a product)
}

// ---------------------------------------------------------------------------------------

int main() {
  gw::Device dev = gw::device_info();
  gw::print_device(dev);
  gw::Report r("L6");
  const double peak_gflops = dev.sms * fp32_lanes_per_sm(dev) * 2.0 * dev.sm_clock_mhz / 1e3;

  // ---- A ----
  {
    std::printf("\nA. ILP versus occupancy\n");
    float hc[DEG + 1];
    for (int k = 0; k <= DEG; k++) hc[k] = (k % 2 ? -1.f : 1.f) * std::ldexp(1.f, -(k + 1)) * (1 + (k % 3) * 0.25f);
    CUDA_CHECK(cudaMemcpyToSymbol(coef, hc, sizeof hc));
    const int grid = dev.sms;  // one block per SM (the shared memory request allows no more)
    const size_t smem = 40 * 1024;
    const size_t n = size_t(1) << 22;  // rounded down to a multiple of one grid-stride step of poly_ilp
    size_t step = size_t(ILP) * grid * POLY_BLOCK, nn = n / step * step;
    std::vector<float> hx(nn), hy(nn);
    for (size_t i = 0; i < nn; i++) hx[i] = float(i % 2001) / 1000.f - 1.f;
    float *x, *y;
    CUDA_CHECK(cudaMalloc(&x, nn * 4)); CUDA_CHECK(cudaMalloc(&y, nn * 4));
    CUDA_CHECK(cudaMemcpy(x, hx.data(), nn * 4, cudaMemcpyHostToDevice));
    int per_sm = 0;
    CUDA_CHECK(cudaOccupancyMaxActiveBlocksPerMultiprocessor(&per_sm, poly_naive, POLY_BLOCK, smem));
    std::printf("  %d block(s) of %d threads per SM\n", per_sm, POLY_BLOCK);
    auto check = [&](const char* name) {
      CUDA_CHECK(cudaMemcpy(hy.data(), y, nn * 4, cudaMemcpyDeviceToHost));
      bool ok = true;
      for (size_t i = 0; i < nn && ok; i += 997) {
        float v = hx[i];
        for (int rr = 0; rr < ROUNDS; rr++) {
          float p = hc[DEG];
          for (int k = DEG - 1; k >= 0; k--) p = std::fma(p, v, hc[k]);
          v = p;
        }
        ok = hy[i] == v;
      }
      r.check(name, ok);
    };
    auto naive = [&] { poly_naive<<<grid, POLY_BLOCK, smem>>>(x, y, nn); };
    auto ilp = [&] { poly_ilp<<<grid, POLY_BLOCK, smem>>>(x, y, nn); };
    naive(); CUDA_CHECK_LAUNCH(); check("poly_naive is correct");
    CUDA_CHECK(cudaMemset(y, 0, nn * 4));
    ilp(); CUDA_CHECK_LAUNCH(); check("poly_ilp is correct (bit-exact: same FMAs in the same order)");
    double flops = 2.0 * DEG * ROUNDS * nn;
    float tn = gw::time_kernel(naive), ti = gw::time_kernel(ilp);
    r.metric("poly_naive_pct", 100 * flops / (tn * 1e-3) / 1e9 / peak_gflops, "% of FP32 peak");
    r.metric("poly_ilp_pct", 100 * flops / (ti * 1e-3) / 1e9 / peak_gflops, "% of FP32 peak");
    r.metric("ilp_speedup", tn / ti, "x");
    cudaFree(x); cudaFree(y);
  }

  // ---- B ----
  {
    std::printf("\nB. local memory\n");
    const size_t m = size_t(1) << 22, n = 8 * m;  // 4 Mi threads, 128 MiB
    std::vector<float> h(n), got(n);
    for (size_t i = 0; i < n; i++) h[i] = float((uint32_t(i) * 2654435761u) >> 20);
    float4 *in, *out;
    CUDA_CHECK(cudaMalloc(&in, n * 4)); CUDA_CHECK(cudaMalloc(&out, n * 4));
    CUDA_CHECK(cudaMemcpy(in, h.data(), n * 4, cudaMemcpyHostToDevice));
    std::vector<float> want(h);
    for (size_t t = 0; t < m; t++) std::sort(want.begin() + 8 * t, want.begin() + 8 * t + 8);
    auto local = [&] { sort8_local<<<(m + 255) / 256, 256>>>(in, out, m, 8); };
    auto regs = [&] { sort8_regs<<<(m + 255) / 256, 256>>>(in, out, m); };
    local(); CUDA_CHECK_LAUNCH();
    CUDA_CHECK(cudaMemcpy(got.data(), out, n * 4, cudaMemcpyDeviceToHost));
    r.check("sort8_local is correct", got == want);
    CUDA_CHECK(cudaMemset(out, 0, n * 4));
    regs(); CUDA_CHECK_LAUNCH();
    CUDA_CHECK(cudaMemcpy(got.data(), out, n * 4, cudaMemcpyDeviceToHost));
    r.check("sort8_regs is correct", got == want);
    cudaFuncAttributes fl, fr;
    CUDA_CHECK(cudaFuncGetAttributes(&fl, sort8_local));
    CUDA_CHECK(cudaFuncGetAttributes(&fr, sort8_regs));
    std::printf("  sort8_local: %d registers, %zu bytes local; sort8_regs: %d registers, %zu bytes local\n",
                fl.numRegs, fl.localSizeBytes, fr.numRegs, fr.localSizeBytes);
    r.check("sort8_regs uses no local memory", fr.localSizeBytes == 0);
    float tl = gw::time_kernel(local), tr = gw::time_kernel(regs);
    r.metric("sort_local_pct", 100 * gw::gbs(8.0 * n, tl) / dev.peak_gbs, "% of peak bandwidth");
    r.metric("sort_regs_pct", 100 * gw::gbs(8.0 * n, tr) / dev.peak_gbs, "% of peak bandwidth");
    r.metric("sort_speedup", tl / tr, "x");
    cudaFree(in); cudaFree(out);
  }

  // ---- C ----
  {
    std::printf("\nC. fusion\n");
    const size_t n = size_t(1) << 26;
    const float a = 1.5f, b = -0.25f;
    std::vector<float> h(n), got(n);
    for (size_t i = 0; i < n; i++) h[i] = float(int(i % 4001) - 2000) / 1024.f;
    float *x, *y, *z, *w;
    CUDA_CHECK(cudaMalloc(&x, n * 4)); CUDA_CHECK(cudaMalloc(&y, n * 4));
    CUDA_CHECK(cudaMalloc(&z, n * 4)); CUDA_CHECK(cudaMalloc(&w, n * 4));
    CUDA_CHECK(cudaMemcpy(x, h.data(), n * 4, cudaMemcpyHostToDevice));
    const int g = int((n + 255) / 256);
    auto three = [&] {
      affine<<<g, 256>>>(x, y, n, a, b); relu<<<g, 256>>>(y, z, n); square<<<g, 256>>>(z, w, n);
    };
    auto one = [&] { fused<<<fused_grid(n), 256>>>(x, w, n, a, b); };
    three(); CUDA_CHECK_LAUNCH();
    std::vector<float> want(n);
    CUDA_CHECK(cudaMemcpy(want.data(), w, n * 4, cudaMemcpyDeviceToHost));
    CUDA_CHECK(cudaMemset(w, 0, n * 4));
    one(); CUDA_CHECK_LAUNCH();
    CUDA_CHECK(cudaMemcpy(got.data(), w, n * 4, cudaMemcpyDeviceToHost));
    r.check("fused matches the three kernels bit for bit", got == want);
    float t3 = gw::time_kernel(three), t1 = gw::time_kernel(one);
    r.metric("fused_pct", 100 * gw::gbs(8.0 * n, t1) / dev.peak_gbs, "% of peak bandwidth");
    r.metric("fusion_speedup", t3 / t1, "x");
    cudaFree(x); cudaFree(y); cudaFree(z); cudaFree(w);
  }

  r.write(dev);
  return r.all_passed() ? 0 : 1;
}
