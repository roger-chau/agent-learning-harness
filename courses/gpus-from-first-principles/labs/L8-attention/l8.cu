// Lab 8, the capstone: fused attention on your card's tensor cores.
//
//   O = softmax(Q K^T / sqrt(d)) V     for 16 heads, sequence length 4096, head dimension 64.
//
// The given reference materialises the 4096 x 4096 score matrix of every head (1 GiB in FP32)
// with cuBLAS, as an unfused framework would. Yours never writes it: FlashAttention's tiling
// with an online softmax (Part 8), on WMMA tensor-core fragments (Chapter 4.5, Lab 4).
#include "gw.h"

#include <cstdint>
#include <cublas_v2.h>
#include <cuda_fp16.h>
#include <mma.h>

using namespace nvcuda;

#define CUBLAS_CHECK(call)                                                              \
  do {                                                                                  \
    cublasStatus_t st__ = (call);                                                       \
    if (st__ != CUBLAS_STATUS_SUCCESS) {                                                \
      std::fprintf(stderr, "cuBLAS error %d at %s:%d\n", int(st__), __FILE__, __LINE__); \
      std::exit(2);                                                                     \
    }                                                                                   \
  } while (0)

constexpr int HEADS = 16, SEQ = 4096, D = 64;

// ---------------------------------------------------------------------------------------
// Given: the reference's softmax over rows of S (FP32), writing P in FP16 for the second GEMM.
// ---------------------------------------------------------------------------------------
__global__ void softmax_rows(const float* __restrict__ S, half* __restrict__ P, int n) {
  __shared__ float red[8];
  const float* row = S + size_t(blockIdx.x) * n;
  half* prow = P + size_t(blockIdx.x) * n;
  float mx = -INFINITY;
  for (int c = threadIdx.x; c < n; c += 256) mx = fmaxf(mx, row[c]);
  for (int o = 16; o > 0; o >>= 1) mx = fmaxf(mx, __shfl_xor_sync(0xffffffffu, mx, o));
  if ((threadIdx.x & 31) == 0) red[threadIdx.x >> 5] = mx;
  __syncthreads();
  mx = red[0];
  for (int w = 1; w < 8; w++) mx = fmaxf(mx, red[w]);
  __syncthreads();
  float s = 0.f;
  for (int c = threadIdx.x; c < n; c += 256) s += expf(row[c] - mx);
  for (int o = 16; o > 0; o >>= 1) s += __shfl_xor_sync(0xffffffffu, s, o);
  if ((threadIdx.x & 31) == 0) red[threadIdx.x >> 5] = s;
  __syncthreads();
  s = 0.f;
  for (int w = 0; w < 8; w++) s += red[w];
  float inv = 1.f / s;
  for (int c = threadIdx.x; c < n; c += 256) prow[c] = __float2half(expf(row[c] - mx) * inv);
}

// ---------------------------------------------------------------------------------------
// Yours: fused attention.
//
// Grid (SEQ / BQ, HEADS), 128 threads. A block owns BQ = 64 query rows of one head; warp w
// owns 16 of them. Lane l works on row l / 2 of its warp's 16. Per K/V tile of BK = 32 keys:
//   1. the block copies the K and V tiles (32 x 64 halves each) into shared memory;
//   2. each warp computes its 16 x 32 score tile S = Q K^T with WMMA (Q's fragments stay in
//      registers for the whole kernel) and stores it to its own shared scratch;
//   3. online softmax: each row is handled by 2 lanes, 16 scores each. New running max m,
//      rescale factor alpha = exp(m_old - m_new), P = exp(S * scale - m_new) rounded to FP16
//      and written over S in the scratch, running sum l = l * alpha + rowsum(P), o[] *= alpha;
//   4. P V (16 x 64) with WMMA, one 16 x 16 output fragment at a time through the scratch:
//      each lane adds its 8 values of the fragment into o[].
// At the end, O = o / l. Accumulator fragments have an unspecified element layout, so the
// per-row rescaling is done on o[] in registers, through the scratch.
//
// Lane l's 32 outputs: row l / 2, columns 16 j + 8 (l % 2) + c for fragment j < 4, c < 8.
// Shared memory: 18 KB per block, so 3 blocks (12 warps) fit on a Turing SM.
// ---------------------------------------------------------------------------------------
constexpr int BQ = 64, BK = 32, WARPS = 4;
constexpr int LDH = D + 8;   // K and V tile row stride, in halves (padded against bank conflicts)
constexpr int LDS = BK + 4;  // scratch row stride, in floats; as halves (P), 2 * LDS

__global__ void __launch_bounds__(128) flash_attn(const half* __restrict__ Q, const half* __restrict__ K,
                                                  const half* __restrict__ V, float* __restrict__ O, float scale) {
  // TODO(1): shared tiles and scratch (__align__(32): WMMA pointers must be 32-byte aligned),
  //          this warp's Q fragments (loaded once from global memory), m, l and o[32]

  for (int k0 = 0; k0 < SEQ; k0 += BK) {
    // TODO(2): copy the K and V tiles to shared memory (16-byte vectors), with barriers

    // TODO(3): S = Q K^T for this warp's 16 rows, into the scratch (which layout is K^T?)

    // TODO(4): online softmax on this lane's 16 scores; P over S in the scratch; m, l, o[]

    // TODO(5): load P's fragments, then P V one output fragment at a time, added into o[]
  }

  // TODO(6): write O = o / l
}

// ---------------------------------------------------------------------------------------

int main() {
  gw::Device dev = gw::device_info();
  gw::print_device(dev);
  gw::Report r("L8");
  const size_t per_head = size_t(SEQ) * D, nqkv = HEADS * per_head;
  const float scale = 1.f / std::sqrt(float(D));

  std::vector<half> hq(nqkv), hk(nqkv), hv(nqkv);
  auto val = [](size_t i, uint32_t salt) {  // in [-1, 1), multiples of 1/128: exact in FP16
    return float(int(((uint32_t(i) ^ salt) * 2654435761u) >> 24) - 128) / 128.f;
  };
  for (size_t i = 0; i < nqkv; i++) {
    hq[i] = __float2half(2.f * val(i, 0x1234u));  // larger Q makes the softmax less flat
    hk[i] = __float2half(val(i, 0xabcdu));
    hv[i] = __float2half(val(i, 0x7777u));
  }
  half *q, *k, *v, *p;
  float *s, *o_ref, *o;
  CUDA_CHECK(cudaMalloc(&q, nqkv * 2)); CUDA_CHECK(cudaMalloc(&k, nqkv * 2)); CUDA_CHECK(cudaMalloc(&v, nqkv * 2));
  CUDA_CHECK(cudaMalloc(&o_ref, nqkv * 4)); CUDA_CHECK(cudaMalloc(&o, nqkv * 4));
  CUDA_CHECK(cudaMalloc(&s, size_t(HEADS) * SEQ * SEQ * 4)); CUDA_CHECK(cudaMalloc(&p, size_t(HEADS) * SEQ * SEQ * 2));
  CUDA_CHECK(cudaMemcpy(q, hq.data(), nqkv * 2, cudaMemcpyHostToDevice));
  CUDA_CHECK(cudaMemcpy(k, hk.data(), nqkv * 2, cudaMemcpyHostToDevice));
  CUDA_CHECK(cudaMemcpy(v, hv.data(), nqkv * 2, cudaMemcpyHostToDevice));

  // Reference: S = scale Q K^T and O = P V as strided-batched cuBLAS GEMMs (FP16 in, FP32
  // compute), softmax in between. Row-major matrices are column-major transposes, hence the
  // argument order (Lab 4).
  cublasHandle_t h;
  CUBLAS_CHECK(cublasCreate(&h));
  const float one = 1.f, zero = 0.f;
  auto reference = [&] {
    CUBLAS_CHECK(cublasGemmStridedBatchedEx(h, CUBLAS_OP_T, CUBLAS_OP_N, SEQ, SEQ, D, &scale, k, CUDA_R_16F, D,
                                            per_head, q, CUDA_R_16F, D, per_head, &zero, s, CUDA_R_32F, SEQ,
                                            size_t(SEQ) * SEQ, HEADS, CUBLAS_COMPUTE_32F, CUBLAS_GEMM_DEFAULT));
    softmax_rows<<<HEADS * SEQ, 256>>>(s, p, SEQ);
    CUBLAS_CHECK(cublasGemmStridedBatchedEx(h, CUBLAS_OP_N, CUBLAS_OP_N, D, SEQ, SEQ, &one, v, CUDA_R_16F, D,
                                            per_head, p, CUDA_R_16F, SEQ, size_t(SEQ) * SEQ, &zero, o_ref,
                                            CUDA_R_32F, D, per_head, HEADS, CUBLAS_COMPUTE_32F, CUBLAS_GEMM_DEFAULT));
  };
  auto fused = [&] { flash_attn<<<dim3(SEQ / BQ, HEADS), 128>>>(q, k, v, o, scale); };

  reference(); CUDA_CHECK_LAUNCH();
  fused(); CUDA_CHECK_LAUNCH();
  std::vector<float> got(nqkv), want(nqkv);
  CUDA_CHECK(cudaMemcpy(want.data(), o_ref, nqkv * 4, cudaMemcpyDeviceToHost));
  CUDA_CHECK(cudaMemcpy(got.data(), o, nqkv * 4, cudaMemcpyDeviceToHost));

  // Both against an exact (double precision) computation for a sample of rows.
  bool ref_ok = true, fused_ok = true;
  double worst_ref = 0, worst_fused = 0;
  for (int hh = 0; hh < HEADS; hh += 5) {
    for (int qi = 0; qi < SEQ; qi += 331) {
      std::vector<double> sc(SEQ);
      double mx = -1e300, sum = 0;
      for (int j = 0; j < SEQ; j++) {
        double t = 0;
        for (int dd = 0; dd < D; dd++)
          t += double(__half2float(hq[hh * per_head + size_t(qi) * D + dd])) * __half2float(hk[hh * per_head + size_t(j) * D + dd]);
        sc[j] = t * scale;
        mx = std::max(mx, sc[j]);
      }
      for (int j = 0; j < SEQ; j++) { sc[j] = std::exp(sc[j] - mx); sum += sc[j]; }
      for (int dd = 0; dd < D; dd++) {
        double t = 0;
        for (int j = 0; j < SEQ; j++) t += sc[j] * __half2float(hv[hh * per_head + size_t(j) * D + dd]);
        t /= sum;
        size_t idx = hh * per_head + size_t(qi) * D + dd;
        worst_ref = std::max(worst_ref, std::fabs(want[idx] - t));
        worst_fused = std::max(worst_fused, std::fabs(got[idx] - t));
      }
    }
  }
  ref_ok = worst_ref < 2e-3;
  fused_ok = worst_fused < 2e-3;
  std::printf("  worst error against exact: reference %.2e, fused %.2e (limit 2e-3)\n", worst_ref, worst_fused);
  r.check("cuBLAS reference matches exact attention", ref_ok);
  r.check("flash_attn matches exact attention", fused_ok);
  r.check("flash_attn matches the reference everywhere",
          gw::all_close(got.data(), want.data(), nqkv, 1e-2f, 2e-3f, "flash_attn vs reference"));

  float t_ref = gw::time_kernel(reference, 5, 1), t_fused = gw::time_kernel(fused, 10, 2);
  const double flops = 4.0 * HEADS * double(SEQ) * SEQ * D;
  r.metric("reference_tflops", flops / (t_ref * 1e-3) / 1e12, "TFLOP/s");
  r.metric("flash_tflops", flops / (t_fused * 1e-3) / 1e12, "TFLOP/s");
  r.metric("flash_vs_reference", t_ref / t_fused, "x");
  r.metric("reference_extra_mib", (size_t(HEADS) * SEQ * SEQ * 6.0) / (1 << 20), "MiB of S and P the fused kernel never allocates");

  cublasDestroy(h);
  cudaFree(q); cudaFree(k); cudaFree(v); cudaFree(p); cudaFree(s); cudaFree(o_ref); cudaFree(o);
  r.write(dev);
  return r.all_passed() ? 0 : 1;
}
