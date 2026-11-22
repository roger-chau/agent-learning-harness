// Lab 4: GEMM on real hardware, from naive to tensor cores, measured against cuBLAS.
//
// C = A B for row-major A (M x K), B (K x N), C (M x N). M, N, K are multiples of 128.
//   1. naive          one thread per output
//   2. tiled          32 x 32 shared-memory tiles (Chapter 4.2)
//   3. register-tiled 128 x 128 block tile, 8 x 8 per thread, float4 loads (Chapters 4.3-4.4)
//   4. tensor cores   WMMA: FP16 inputs, FP32 accumulation (Chapter 4.5)
#include "gw.h"

#include <cublas_v2.h>
#include <cuda_fp16.h>
#include <mma.h>

#define CUBLAS_CHECK(call)                                                          \
  do {                                                                              \
    cublasStatus_t s__ = (call);                                                    \
    if (s__ != CUBLAS_STATUS_SUCCESS) {                                             \
      std::fprintf(stderr, "cuBLAS error %d at %s:%d\n", int(s__), __FILE__, __LINE__); \
      std::exit(2);                                                                 \
    }                                                                               \
  } while (0)

// ---------------------------------------------------------------------------------------
// 1. Naive: 16 x 16 threads per block, one output each.
// ---------------------------------------------------------------------------------------
__global__ void sgemm_naive(int M, int N, int K, const float* __restrict__ A, const float* __restrict__ B, float* __restrict__ C) {
  // TODO(1)
}

// ---------------------------------------------------------------------------------------
// 2. Tiled: 32 x 32 threads per block, one output each, 32 x 32 tiles of A and B in shared memory.
// ---------------------------------------------------------------------------------------
constexpr int T = 32;
__global__ void sgemm_tiled(int M, int N, int K, const float* __restrict__ A, const float* __restrict__ B, float* __restrict__ C) {
  // TODO(2)
}

// ---------------------------------------------------------------------------------------
// 3. Register-tiled: 256 threads per block compute a 128 x 128 tile of C, 8 x 8 outputs each,
// with K-steps of 8. A's tile is stored transposed in shared memory (As[k][m]) so each thread
// reads its 8 values of A's column k contiguously.
// ---------------------------------------------------------------------------------------
constexpr int BM = 128, BN = 128, BK = 8, TM = 8, TN = 8;
__global__ void __launch_bounds__(256) sgemm_reg(int M, int N, int K, const float* __restrict__ A, const float* __restrict__ B, float* __restrict__ C) {
  // TODO(3)
}

// ---------------------------------------------------------------------------------------
// 4. Tensor cores with WMMA. 128 threads (4 warps) per block compute a 64 x 64 tile of C; each
// warp owns a 32 x 32 sub-tile = 2 x 2 fragments of 16 x 16. K-steps of 16, FP16 inputs staged
// in shared memory (padded rows: the leading dimension must be a multiple of 8 halves).
// ---------------------------------------------------------------------------------------
using namespace nvcuda;
constexpr int WBM = 64, WBN = 64, WBK = 16, APAD = WBK + 8, BPAD = WBN + 8;
__global__ void hgemm_wmma(int M, int N, int K, const __half* __restrict__ A, const __half* __restrict__ B, float* __restrict__ C) {
  // TODO(4)
  // load_matrix_sync needs 32-byte-aligned pointers: rows of 24 and 72 halves keep every fragment
  // start a multiple of 32 bytes from the base, and the base itself must be aligned.
}

// ---------------------------------------------------------------------------------------
// Host code
// ---------------------------------------------------------------------------------------
static double tflops(int M, int N, int K, float ms) { return 2.0 * M * N * K / (ms * 1e-3) / 1e12; }

int main() {
  gw::Device dev = gw::device_info();
  gw::print_device(dev);
  gw::Report r("L4");
  const int M = 2048, N = 2048, K = 2048;
  const size_t sa = size_t(M) * K, sb = size_t(K) * N, sc = size_t(M) * N;
  std::vector<float> hA(sa), hB(sb), ref(sc), got(sc);
  // Multiples of 1/64 in [-0.5, 0.5): exact in FP16, products exact in FP32, and every partial sum
  // stays a multiple of 1/4096 well below 2^12, so FP32 sums are exact in any order. Results must
  // match cuBLAS to the bit (the tolerance below is only a safety margin).
  for (size_t i = 0; i < sa; i++) hA[i] = float(int(uint32_t(uint32_t(i) * 2654435761u) >> 26) - 32) / 64.f;
  for (size_t i = 0; i < sb; i++) hB[i] = float(int((uint32_t(i) * 40503u + 17u) >> 10 & 63u) - 32) / 64.f;
  float *A, *B, *C;
  CUDA_CHECK(cudaMalloc(&A, sa * 4)); CUDA_CHECK(cudaMalloc(&B, sb * 4)); CUDA_CHECK(cudaMalloc(&C, sc * 4));
  CUDA_CHECK(cudaMemcpy(A, hA.data(), sa * 4, cudaMemcpyHostToDevice));
  CUDA_CHECK(cudaMemcpy(B, hB.data(), sb * 4, cudaMemcpyHostToDevice));

  cublasHandle_t h;
  CUBLAS_CHECK(cublasCreate(&h));
  const float one = 1.f, zero = 0.f;
  // Row-major C = A B is column-major C^T = B^T A^T: swap the operands.
  auto cublas_sgemm = [&] { CUBLAS_CHECK(cublasSgemm(h, CUBLAS_OP_N, CUBLAS_OP_N, N, M, K, &one, B, N, A, K, &zero, C, N)); };
  cublas_sgemm(); CUDA_CHECK_LAUNCH();
  CUDA_CHECK(cudaMemcpy(ref.data(), C, sc * 4, cudaMemcpyDeviceToHost));
  float t_cublas = gw::time_kernel(cublas_sgemm, 10, 2);
  std::printf("\ncuBLAS SGEMM: %.2f TFLOP/s\n", tflops(M, N, K, t_cublas));
  r.metric("cublas_sgemm_tflops", tflops(M, N, K, t_cublas), "TFLOP/s");

  auto run = [&](const char* name, const std::function<void()>& launch, float rtol) {
    CUDA_CHECK(cudaMemset(C, 0, sc * 4));
    launch(); CUDA_CHECK_LAUNCH();
    CUDA_CHECK(cudaMemcpy(got.data(), C, sc * 4, cudaMemcpyDeviceToHost));
    r.check(std::string(name) + " matches cuBLAS", gw::all_close(got.data(), ref.data(), sc, rtol, 1e-3f, name));
    float ms = gw::time_kernel(launch, 10, 2);
    r.metric(std::string(name) + "_tflops", tflops(M, N, K, ms), "TFLOP/s");
    r.metric(std::string(name) + "_vs_cublas_pct", 100 * t_cublas / ms, "% of cuBLAS SGEMM");
    return ms;
  };
  float t_naive = run("naive", [&] { sgemm_naive<<<dim3(N / 16, M / 16), dim3(16, 16)>>>(M, N, K, A, B, C); }, 1e-4f);
  float t_tiled = run("tiled", [&] { sgemm_tiled<<<dim3(N / T, M / T), dim3(T, T)>>>(M, N, K, A, B, C); }, 1e-4f);
  float t_reg = run("reg", [&] { sgemm_reg<<<dim3(N / BN, M / BM), 256>>>(M, N, K, A, B, C); }, 1e-4f);
  r.metric("tiled_vs_naive", t_naive / t_tiled, "x");

  // Tensor cores: FP16 copies of A and B; FP32 output compared with cuBLAS's own FP16 GEMM.
  std::vector<__half> hAh(sa), hBh(sb);
  for (size_t i = 0; i < sa; i++) hAh[i] = __float2half(hA[i]);  // these inputs are exact in FP16
  for (size_t i = 0; i < sb; i++) hBh[i] = __float2half(hB[i]);
  __half *Ah, *Bh;
  CUDA_CHECK(cudaMalloc(&Ah, sa * 2)); CUDA_CHECK(cudaMalloc(&Bh, sb * 2));
  CUDA_CHECK(cudaMemcpy(Ah, hAh.data(), sa * 2, cudaMemcpyHostToDevice));
  CUDA_CHECK(cudaMemcpy(Bh, hBh.data(), sb * 2, cudaMemcpyHostToDevice));
  auto cublas_hgemm = [&] {
    CUBLAS_CHECK(cublasGemmEx(h, CUBLAS_OP_N, CUBLAS_OP_N, N, M, K, &one, Bh, CUDA_R_16F, N, Ah, CUDA_R_16F, K, &zero, C,
                              CUDA_R_32F, N, CUBLAS_COMPUTE_32F, CUBLAS_GEMM_DEFAULT));
  };
  float t_hgemm = gw::time_kernel(cublas_hgemm, 10, 2);
  r.metric("cublas_hgemm_tflops", tflops(M, N, K, t_hgemm), "TFLOP/s (FP16 in, FP32 accumulate)");
  CUDA_CHECK(cudaMemset(C, 0, sc * 4));
  auto wmma_launch = [&] { hgemm_wmma<<<dim3(N / WBN, M / WBM), 128>>>(M, N, K, Ah, Bh, C); };
  wmma_launch(); CUDA_CHECK_LAUNCH();
  CUDA_CHECK(cudaMemcpy(got.data(), C, sc * 4, cudaMemcpyDeviceToHost));
  // Inputs are exact in FP16 and products exact in FP32, so only the FP32 summation order differs.
  r.check("wmma matches the FP32 result", gw::all_close(got.data(), ref.data(), sc, 1e-4f, 1e-3f, "wmma"));
  float t_wmma = gw::time_kernel(wmma_launch, 10, 2);
  r.metric("wmma_tflops", tflops(M, N, K, t_wmma), "TFLOP/s");
  r.metric("wmma_vs_cublas_hgemm_pct", 100 * t_hgemm / t_wmma, "% of cuBLAS FP16 GEMM");
  r.metric("wmma_vs_reg", t_reg / t_wmma, "x over your FP32 register-tiled kernel");

  cublasDestroy(h);
  cudaFree(A); cudaFree(B); cudaFree(C); cudaFree(Ah); cudaFree(Bh);
  r.write(dev);
  return r.all_passed() ? 0 : 1;
}
