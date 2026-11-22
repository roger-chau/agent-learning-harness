// Lab 10: parallel patterns on real hardware.
//
//   A. 2-D convolution, 5 x 5 filter in __constant__ memory: naive versus shared-memory tiles
//      with halos (Chapter 10.1).
//   B. CSR sparse matrix-vector product: one thread per row versus one warp per row
//      (Chapter 10.5).
#include "gw.h"

#include <cstdint>

// ---------------------------------------------------------------------------------------
// A. Convolution. Image W x H floats, filter radius R = 2, zero ghost cells.
// ---------------------------------------------------------------------------------------
constexpr int R = 2, FW = 2 * R + 1, T = 16;
__constant__ float c_filter[FW * FW];

// Given: one thread per output, every input read from global memory (through the caches).
__global__ void conv_naive(const float* __restrict__ in, float* __restrict__ out, int W, int H) {
  int x = blockIdx.x * T + threadIdx.x, y = blockIdx.y * T + threadIdx.y;
  if (x >= W || y >= H) return;
  float acc = 0.f;
#pragma unroll
  for (int j = -R; j <= R; j++)
#pragma unroll
    for (int i = -R; i <= R; i++) {
      int gx = x + i, gy = y + j;
      float v = (gx >= 0 && gx < W && gy >= 0 && gy < H) ? in[gy * W + gx] : 0.f;
      acc = fmaf(c_filter[(j + R) * FW + i + R], v, acc);
    }
  out[y * W + x] = acc;
}

// Yours: T x T threads per block; load the (T + 2R)^2 input tile with halo into shared memory
// (strided loop, zeros outside the image), __syncthreads(), then compute from shared memory.
__global__ void conv_tiled(const float* __restrict__ in, float* __restrict__ out, int W, int H) {
  // TODO(A)
}

// ---------------------------------------------------------------------------------------
// B. CSR SpMV, y = A x.
// ---------------------------------------------------------------------------------------
// Given: one thread per row.
__global__ void spmv_scalar(const int* __restrict__ rowPtr, const int* __restrict__ col, const float* __restrict__ val,
                            const float* __restrict__ x, float* __restrict__ y, int rows) {
  int r = blockIdx.x * blockDim.x + threadIdx.x;
  if (r >= rows) return;
  float s = 0.f;
  for (int k = rowPtr[r]; k < rowPtr[r + 1]; k++) s = fmaf(val[k], x[col[k]], s);
  y[r] = s;
}

// Yours: one warp per row, lanes stride by 32 through the row, then a shuffle reduction.
// Launched with 256-thread blocks (8 rows per block).
__global__ void spmv_vector(const int* __restrict__ rowPtr, const int* __restrict__ col, const float* __restrict__ val,
                            const float* __restrict__ x, float* __restrict__ y, int rows) {
  // TODO(B)
}

// ---------------------------------------------------------------------------------------

int main() {
  gw::Device dev = gw::device_info();
  gw::print_device(dev);
  gw::Report r("L10");

  // ---- A ----
  {
    std::printf("\nA. 5 x 5 convolution, 4096 x 4096\n");
    const int W = 4096, H = 4096;
    const size_t n = size_t(W) * H;
    std::vector<float> h(n), got(n), want(n), f(FW * FW);
    for (size_t i = 0; i < n; i++) h[i] = float(int((uint32_t(i) * 2654435761u) >> 28) - 8);  // small integers: exact sums
    for (int i = 0; i < FW * FW; i++) f[i] = float((i * 3) % 5 - 2);
    CUDA_CHECK(cudaMemcpyToSymbol(c_filter, f.data(), sizeof(float) * FW * FW));
    for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) {
      float a = 0;
      for (int j = -R; j <= R; j++) for (int i = -R; i <= R; i++) {
        int gx = x + i, gy = y + j;
        if (gx >= 0 && gx < W && gy >= 0 && gy < H) a += f[(j + R) * FW + i + R] * h[size_t(gy) * W + gx];
      }
      want[size_t(y) * W + x] = a;
    }
    float *in, *out;
    CUDA_CHECK(cudaMalloc(&in, n * 4)); CUDA_CHECK(cudaMalloc(&out, n * 4));
    CUDA_CHECK(cudaMemcpy(in, h.data(), n * 4, cudaMemcpyHostToDevice));
    dim3 grid((W + T - 1) / T, (H + T - 1) / T), block(T, T);
    auto naive = [&] { conv_naive<<<grid, block>>>(in, out, W, H); };
    auto tiled = [&] { conv_tiled<<<grid, block>>>(in, out, W, H); };
    naive(); CUDA_CHECK_LAUNCH();
    CUDA_CHECK(cudaMemcpy(got.data(), out, n * 4, cudaMemcpyDeviceToHost));
    r.check("conv_naive is correct", got == want);
    CUDA_CHECK(cudaMemset(out, 0, n * 4));
    tiled(); CUDA_CHECK_LAUNCH();
    CUDA_CHECK(cudaMemcpy(got.data(), out, n * 4, cudaMemcpyDeviceToHost));
    r.check("conv_tiled is correct (edges included)", got == want);
    float tn = gw::time_kernel(naive), tt = gw::time_kernel(tiled);
    r.metric("conv_naive_gflops", 2.0 * FW * FW * n / (tn * 1e-3) / 1e9, "GFLOP/s");
    r.metric("conv_tiled_gflops", 2.0 * FW * FW * n / (tt * 1e-3) / 1e9, "GFLOP/s");
    r.metric("conv_speedup", tn / tt, "x");
    cudaFree(in); cudaFree(out);
  }

  // ---- B ----
  {
    std::printf("\nB. CSR SpMV, 1M rows of 32-95 non-zeros\n");
    const int rows = 1 << 20, cols = 1 << 20;
    std::vector<int> rp(rows + 1), ci;
    std::vector<float> vv;
    ci.reserve(size_t(rows) * 64); vv.reserve(size_t(rows) * 64);
    for (int rr = 0; rr < rows; rr++) {
      rp[rr] = int(ci.size());
      int len = 32 + int((uint32_t(rr) * 2654435761u) >> 26);  // 32..95
      for (int k = 0; k < len; k++) {
        // columns near the diagonal plus some spread: realistic locality for x
        ci.push_back(int((uint32_t(rr) + uint32_t(k) * 97u + ((uint32_t(rr * 31 + k) * 2654435761u) >> 22)) % uint32_t(cols)));
        vv.push_back(float((rr + k) % 5 - 2));
      }
    }
    rp[rows] = int(ci.size());
    const size_t nnz = ci.size();
    std::vector<float> hx(cols), want(rows), got(rows);
    for (int i = 0; i < cols; i++) hx[i] = float(i % 7 - 3);
    for (int rr = 0; rr < rows; rr++) { double a = 0; for (int k = rp[rr]; k < rp[rr + 1]; k++) a += double(vv[k]) * hx[ci[k]]; want[rr] = float(a); }
    int *d_rp, *d_ci; float *d_v, *d_x, *d_y;
    CUDA_CHECK(cudaMalloc(&d_rp, (rows + 1) * 4)); CUDA_CHECK(cudaMalloc(&d_ci, nnz * 4)); CUDA_CHECK(cudaMalloc(&d_v, nnz * 4));
    CUDA_CHECK(cudaMalloc(&d_x, cols * 4)); CUDA_CHECK(cudaMalloc(&d_y, rows * 4));
    CUDA_CHECK(cudaMemcpy(d_rp, rp.data(), (rows + 1) * 4, cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMemcpy(d_ci, ci.data(), nnz * 4, cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMemcpy(d_v, vv.data(), nnz * 4, cudaMemcpyHostToDevice));
    CUDA_CHECK(cudaMemcpy(d_x, hx.data(), cols * 4, cudaMemcpyHostToDevice));
    auto scalar = [&] { spmv_scalar<<<(rows + 255) / 256, 256>>>(d_rp, d_ci, d_v, d_x, d_y, rows); };
    auto vector = [&] { spmv_vector<<<(rows + 7) / 8, 256>>>(d_rp, d_ci, d_v, d_x, d_y, rows); };
    scalar(); CUDA_CHECK_LAUNCH();
    CUDA_CHECK(cudaMemcpy(got.data(), d_y, rows * 4, cudaMemcpyDeviceToHost));
    r.check("spmv_scalar is correct", got == want);
    CUDA_CHECK(cudaMemset(d_y, 0, rows * 4));
    vector(); CUDA_CHECK_LAUNCH();
    CUDA_CHECK(cudaMemcpy(got.data(), d_y, rows * 4, cudaMemcpyDeviceToHost));
    r.check("spmv_vector is correct", got == want);
    float ts = gw::time_kernel(scalar), tv = gw::time_kernel(vector);
    const double bytes = 8.0 * nnz + 4.0 * (rows + 1) + 4.0 * rows;  // values, columns, rowPtr, y (x assumed cached)
    r.metric("spmv_scalar_pct", 100 * gw::gbs(bytes, ts) / dev.peak_gbs, "% of peak bandwidth");
    r.metric("spmv_vector_pct", 100 * gw::gbs(bytes, tv) / dev.peak_gbs, "% of peak bandwidth");
    r.metric("spmv_speedup", ts / tv, "x");
    cudaFree(d_rp); cudaFree(d_ci); cudaFree(d_v); cudaFree(d_x); cudaFree(d_y);
  }

  r.write(dev);
  return r.all_passed() ? 0 : 1;
}
