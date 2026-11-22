// Lab 7: real workloads. The memory-bound operators that sit between the matmuls of every
// transformer, and the copy/compute overlap that every serving system depends on.
//
//   A. Row softmax, fused into one pass (Chapter 7.1).
//   B. LayerNorm, fused, with the statistics computed in registers (Chapter 7.1).
//   C. A host-to-device-to-host pipeline: pinned memory, streams and chunking (Chapter 7.3).
#include "gw.h"

#include <chrono>
#include <cstdint>

constexpr int ROWS = 32768, COLS = 1024;  // 128 MiB per matrix
constexpr int ROW_BLOCK = 256;            // 8 warps per block

__device__ __forceinline__ float warp_max(float v) {
  for (int o = 16; o > 0; o >>= 1) v = fmaxf(v, __shfl_xor_sync(0xffffffffu, v, o));
  return v;
}
__device__ __forceinline__ float warp_sum(float v) {
  for (int o = 16; o > 0; o >>= 1) v += __shfl_xor_sync(0xffffffffu, v, o);
  return v;
}

// ---------------------------------------------------------------------------------------
// A. Softmax of each row: y[r][c] = exp(x[r][c] - max_r) / sum_c exp(x[r][c] - max_r).
// Given: the unfused version, three kernels with a block per row: 5 passes over the matrix.
// ---------------------------------------------------------------------------------------
__device__ float block_reduce(float v, bool is_max) {
  __shared__ float part[ROW_BLOCK / 32];
  v = is_max ? warp_max(v) : warp_sum(v);
  if ((threadIdx.x & 31) == 0) part[threadIdx.x >> 5] = v;
  __syncthreads();
  v = part[0];
  for (int w = 1; w < ROW_BLOCK / 32; w++) v = is_max ? fmaxf(v, part[w]) : v + part[w];
  __syncthreads();
  return v;
}
__global__ void row_max(const float* x, float* m) {
  const float* row = x + size_t(blockIdx.x) * COLS;
  float v = -INFINITY;
  for (int c = threadIdx.x; c < COLS; c += ROW_BLOCK) v = fmaxf(v, row[c]);
  v = block_reduce(v, true);
  if (threadIdx.x == 0) m[blockIdx.x] = v;
}
__global__ void exp_sum(const float* x, const float* m, float* e, float* s) {
  size_t off = size_t(blockIdx.x) * COLS;
  float mx = m[blockIdx.x], v = 0.f;
  for (int c = threadIdx.x; c < COLS; c += ROW_BLOCK) { float t = expf(x[off + c] - mx); e[off + c] = t; v += t; }
  v = block_reduce(v, false);
  if (threadIdx.x == 0) s[blockIdx.x] = v;
}
__global__ void normalize(const float* e, const float* s, float* y) {
  size_t off = size_t(blockIdx.x) * COLS;
  float inv = 1.f / s[blockIdx.x];
  for (int c = threadIdx.x; c < COLS; c += ROW_BLOCK) y[off + c] = e[off + c] * inv;
}

// Yours: one warp per row. Each lane loads its COLS / 32 values (as float4s, strided so the
// warp's loads coalesce) into registers once, then: max, sum of exponentials, write. One read
// and one write of the matrix. Launched with ROWS / 8 blocks of ROW_BLOCK threads.
__global__ void softmax_fused(const float* __restrict__ x, float* __restrict__ y) {
  // TODO(A): warp per row, values in registers, warp_max, warp_sum, one write per value
}

// ---------------------------------------------------------------------------------------
// B. LayerNorm of each row: y = (x - mean) / sqrt(var + eps) * gamma + beta, with the
// population variance. Compute the mean first, then the variance as the mean of (x - mean)^2
// from the values in registers: the two-pass formula is accurate; E[x^2] - E[x]^2 is not.
// Launched like softmax_fused.
// ---------------------------------------------------------------------------------------
constexpr float EPS = 1e-5f;

__global__ void layernorm_fused(const float* __restrict__ x, const float* __restrict__ gamma,
                                const float* __restrict__ beta, float* __restrict__ y) {
  // TODO(B): warp per row, values in registers, mean, then variance, then the output
}

// ---------------------------------------------------------------------------------------
// C. Pipeline: out = work(in) for a large array that starts and ends in host memory.
// `work` is given: `iters` dependent FMAs per element, in place.
// ---------------------------------------------------------------------------------------
__global__ void work(float* d, size_t n, int iters) {
  size_t i = size_t(blockIdx.x) * blockDim.x + threadIdx.x;
  if (i >= n) return;
  float v = d[i];
  for (int k = 0; k < iters; k++) v = fmaf(v, 0.999f, 0.001f);
  d[i] = v;
}
inline void launch_work(float* d, size_t n, int iters, cudaStream_t s = 0) {
  work<<<unsigned((n + 255) / 256), 256, 0, s>>>(d, n, iters);
}

// Given: the serial version from ordinary (pageable) host memory.
void run_serial(const float* h_in, float* h_out, float* d, size_t n, int iters) {
  CUDA_CHECK(cudaMemcpy(d, h_in, n * 4, cudaMemcpyHostToDevice));
  launch_work(d, n, iters);
  CUDA_CHECK(cudaMemcpy(h_out, d, n * 4, cudaMemcpyDeviceToHost));
}

// Yours: the same result, from pinned host buffers (allocated by main with cudaMallocHost),
// with the array cut into CHUNKS pieces, issued round-robin over NSTREAMS streams so that one
// chunk's upload, another's kernel and a third's download run at the same time.
// Return only when everything has finished. n is a multiple of CHUNKS.
constexpr int CHUNKS = 16, NSTREAMS = 4;
void run_pipelined(const float* h_in_pinned, float* h_out_pinned, float* d, size_t n, int iters,
                   cudaStream_t* streams) {
  // TODO(C): for each chunk: cudaMemcpyAsync up, launch_work on the same stream, cudaMemcpyAsync down
}

// ---------------------------------------------------------------------------------------

static double host_ms(const std::function<void()>& f, int reps = 5) {
  f();  // warm-up
  std::vector<double> t(reps);
  for (int i = 0; i < reps; i++) {
    CUDA_CHECK(cudaDeviceSynchronize());
    auto a = std::chrono::steady_clock::now();
    f();
    CUDA_CHECK(cudaDeviceSynchronize());
    t[i] = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - a).count();
  }
  std::sort(t.begin(), t.end());
  return t[reps / 2];
}

int main() {
  gw::Device dev = gw::device_info();
  gw::print_device(dev);
  gw::Report r("L7");
  const size_t N = size_t(ROWS) * COLS;
  std::vector<float> hx(N), got(N), want(N);
  for (size_t i = 0; i < N; i++) hx[i] = float(int((uint32_t(i) * 2654435761u) >> 22) - 512) / 64.f;  // [-8, 8)
  float *x, *y, *e, *m, *s;
  CUDA_CHECK(cudaMalloc(&x, N * 4)); CUDA_CHECK(cudaMalloc(&y, N * 4)); CUDA_CHECK(cudaMalloc(&e, N * 4));
  CUDA_CHECK(cudaMalloc(&m, ROWS * 4)); CUDA_CHECK(cudaMalloc(&s, ROWS * 4));
  CUDA_CHECK(cudaMemcpy(x, hx.data(), N * 4, cudaMemcpyHostToDevice));
  const double matrix_bytes = 4.0 * N;

  // ---- A ----
  {
    std::printf("\nA. softmax\n");
    for (int rr = 0; rr < ROWS; rr++) {
      const float* row = &hx[size_t(rr) * COLS];
      double mx = row[0], sum = 0;
      for (int c = 1; c < COLS; c++) mx = std::max(mx, double(row[c]));
      for (int c = 0; c < COLS; c++) sum += std::exp(row[c] - mx);
      for (int c = 0; c < COLS; c++) want[size_t(rr) * COLS + c] = float(std::exp(row[c] - mx) / sum);
    }
    auto unfused = [&] { row_max<<<ROWS, ROW_BLOCK>>>(x, m); exp_sum<<<ROWS, ROW_BLOCK>>>(x, m, e, s); normalize<<<ROWS, ROW_BLOCK>>>(e, s, y); };
    auto fused = [&] { softmax_fused<<<ROWS / 8, ROW_BLOCK>>>(x, y); };
    unfused(); CUDA_CHECK_LAUNCH();
    CUDA_CHECK(cudaMemcpy(got.data(), y, N * 4, cudaMemcpyDeviceToHost));
    r.check("unfused softmax is correct", gw::all_close(got.data(), want.data(), N, 2e-5f, 1e-9f, "unfused"));
    CUDA_CHECK(cudaMemset(y, 0, N * 4));
    fused(); CUDA_CHECK_LAUNCH();
    CUDA_CHECK(cudaMemcpy(got.data(), y, N * 4, cudaMemcpyDeviceToHost));
    r.check("softmax_fused is correct", gw::all_close(got.data(), want.data(), N, 2e-5f, 1e-9f, "softmax_fused"));
    float tu = gw::time_kernel(unfused), tf = gw::time_kernel(fused);
    r.metric("softmax_pct", 100 * gw::gbs(2 * matrix_bytes, tf) / dev.peak_gbs, "% of peak bandwidth");
    r.metric("softmax_speedup", tu / tf, "x over unfused");
  }

  // ---- B ----
  {
    std::printf("\nB. LayerNorm\n");
    std::vector<float> hg(COLS), hb(COLS);
    for (int c = 0; c < COLS; c++) { hg[c] = 1.f + (c % 7) * 0.125f; hb[c] = (c % 5) * 0.25f - 0.5f; }
    for (int rr = 0; rr < ROWS; rr++) {
      const float* row = &hx[size_t(rr) * COLS];
      double mean = 0, var = 0;
      for (int c = 0; c < COLS; c++) mean += row[c];
      mean /= COLS;
      for (int c = 0; c < COLS; c++) var += (row[c] - mean) * (row[c] - mean);
      double rstd = 1 / std::sqrt(var / COLS + EPS);
      for (int c = 0; c < COLS; c++) want[size_t(rr) * COLS + c] = float((row[c] - mean) * rstd * hg[c] + hb[c]);
    }
    float *g, *b;
    CUDA_CHECK(cudaMalloc(&g, COLS * 4)); CUDA_CHECK(cudaMalloc(&b, COLS * 4));
    CUDA_CHECK(cudaMemcpy(g, hg.data(), COLS * 4, cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMemcpy(b, hb.data(), COLS * 4, cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMemset(y, 0, N * 4));
    auto ln = [&] { layernorm_fused<<<ROWS / 8, ROW_BLOCK>>>(x, g, b, y); };
    ln(); CUDA_CHECK_LAUNCH();
    CUDA_CHECK(cudaMemcpy(got.data(), y, N * 4, cudaMemcpyDeviceToHost));
    r.check("layernorm_fused is correct", gw::all_close(got.data(), want.data(), N, 1e-4f, 2e-5f, "layernorm"));
    float t = gw::time_kernel(ln);
    r.metric("layernorm_pct", 100 * gw::gbs(2 * matrix_bytes, t) / dev.peak_gbs, "% of peak bandwidth");
    cudaFree(g); cudaFree(b);
  }
  cudaFree(x); cudaFree(y); cudaFree(e); cudaFree(m); cudaFree(s);

  // ---- C ----
  {
    std::printf("\nC. copy/compute pipeline\n");
    int engines = 0;
    CUDA_CHECK(cudaDeviceGetAttribute(&engines, cudaDevAttrAsyncEngineCount, 0));
    std::printf("  copy engines: %d (%s)\n", engines,
                engines >= 2 ? "uploads and downloads can overlap each other" : "uploads and downloads share one engine");
    const size_t n = size_t(1) << 25;  // 128 MiB
    std::vector<float> h_in(n), h_out(n), want_out(n);
    for (size_t i = 0; i < n; i++) h_in[i] = float(i % 1000) * 1e-3f;
    float *d, *p_in, *p_out;
    CUDA_CHECK(cudaMalloc(&d, n * 4));
    CUDA_CHECK(cudaMallocHost(&p_in, n * 4));
    CUDA_CHECK(cudaMallocHost(&p_out, n * 4));
    std::copy(h_in.begin(), h_in.end(), p_in);

    // Calibrate the kernel so that it takes about as long as the upload: then overlap matters.
    double up_pageable = host_ms([&] { CUDA_CHECK(cudaMemcpy(d, h_in.data(), n * 4, cudaMemcpyHostToDevice)); });
    double up_pinned = host_ms([&] { CUDA_CHECK(cudaMemcpy(d, p_in, n * 4, cudaMemcpyHostToDevice)); });
    double k64 = host_ms([&] { launch_work(d, n, 64); });
    int iters = std::max(16, int(64 * up_pinned / k64));
    double k = host_ms([&] { launch_work(d, n, iters); });
    std::printf("  upload: pageable %.1f ms (%.1f GB/s), pinned %.1f ms (%.1f GB/s); kernel (%d FMAs/element) %.1f ms\n",
                up_pageable, gw::gbs(n * 4.0, float(up_pageable)), up_pinned, gw::gbs(n * 4.0, float(up_pinned)), iters, k);
    r.metric("pcie_pinned_gbs", gw::gbs(n * 4.0, float(up_pinned)), "GB/s");
    r.metric("pinned_vs_pageable", up_pageable / up_pinned, "x");

    run_serial(h_in.data(), want_out.data(), d, n, iters);
    CUDA_CHECK(cudaDeviceSynchronize());
    cudaStream_t st[NSTREAMS];
    for (auto& q : st) CUDA_CHECK(cudaStreamCreate(&q));
    std::fill(p_out, p_out + n, 0.f);
    run_pipelined(p_in, p_out, d, n, iters, st);
    r.check("pipelined result matches the serial one", std::equal(p_out, p_out + n, want_out.begin()));
    double ts = host_ms([&] { run_serial(h_in.data(), h_out.data(), d, n, iters); });
    double tp = host_ms([&] { run_pipelined(p_in, p_out, d, n, iters, st); });
    std::printf("  serial %.1f ms, pipelined %.1f ms\n", ts, tp);
    r.metric("overlap_speedup", ts / tp, "x");
    for (auto& q : st) cudaStreamDestroy(q);
    cudaFreeHost(p_in); cudaFreeHost(p_out); cudaFree(d);
  }

  r.write(dev);
  return r.all_passed() ? 0 : 1;
}
