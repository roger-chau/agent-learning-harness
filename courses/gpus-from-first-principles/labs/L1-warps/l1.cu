// Lab 1: warps on real hardware. Divergence costs, and Project A's imaging kernels.
//
//   A. Grayscale: interleaved RGB bytes -> one gray byte per pixel. Bandwidth-bound.
//   B. Divergence: the same arithmetic, branched four ways. Measure what Part 1 predicted.
//   C. 3x3 box blur with clamped borders, on a float image.
#include "gw.h"

#include <cstdint>

// ---------------------------------------------------------------------------------------
// A. Grayscale: gray = (77 R + 150 G + 29 B) >> 8, from rgb[3*i .. 3*i+2].
// ---------------------------------------------------------------------------------------
__global__ void grayscale(const uint8_t* __restrict__ rgb, uint8_t* __restrict__ gray, int n) {
  // TODO(A): one pixel per thread to start; then try several pixels per thread
}

// ---------------------------------------------------------------------------------------
// B. Divergence. Each kernel runs ITERS dependent FMAs per thread; the result goes to out[i]
// so the compiler can't drop the work. Two "paths" use different constants.
// ---------------------------------------------------------------------------------------
constexpr int ITERS = 4096;

__device__ __forceinline__ float path_a(float v) {
#pragma unroll 8
  for (int k = 0; k < ITERS; k++) v = fmaf(v, 0.9999f, 0.0001f);
  return v;
}
__device__ __forceinline__ float path_b(float v) {
#pragma unroll 8
  for (int k = 0; k < ITERS; k++) v = fmaf(v, 1.0001f, -0.0001f);
  return v;
}

// 1. Every thread takes path A: no divergence.
__global__ void uniform(const float* __restrict__ in, float* __restrict__ out) {
  // TODO(B1)
}
// 2. Odd lanes take path A, even lanes path B: every warp diverges.
__global__ void divergent(const float* __restrict__ in, float* __restrict__ out) {
  // TODO(B2)
}
// 3. Odd warps take path A, even warps path B: the branch is uniform within each warp.
__global__ void warp_aligned(const float* __restrict__ in, float* __restrict__ out) {
  // TODO(B3)
}
// 4. Same results as `divergent`, without a branch around the loop: select the constants,
// then run one loop. (The lanes still do different arithmetic, on different data.)
__global__ void branch_free(const float* __restrict__ in, float* __restrict__ out) {
  // TODO(B4)
}

// ---------------------------------------------------------------------------------------
// C. 3x3 box blur with clamp-to-edge: out(x,y) = mean of in(clamp(x+dx), clamp(y+dy)).
// ---------------------------------------------------------------------------------------
__global__ void blur3(const float* __restrict__ in, float* __restrict__ out, int W, int H) {
  // TODO(C): 2-D indexing (x from threadIdx.x), guard, clamp at the borders
}

// ---------------------------------------------------------------------------------------
// Host code
// ---------------------------------------------------------------------------------------
int main() {
  gw::Device dev = gw::device_info();
  gw::print_device(dev);
  gw::Report r("L1");

  // ---- A ----
  {
    std::printf("\nA. grayscale\n");
    const int W = 3840, H = 2161, n = W * H;  // a 4K frame plus one row: not a multiple of anything
    std::vector<uint8_t> rgb(3 * size_t(n)), gray(n), want(n);
    for (size_t i = 0; i < rgb.size(); i++) rgb[i] = uint8_t((i * 2654435761u) >> 24);
    for (int i = 0; i < n; i++) want[i] = uint8_t((77 * rgb[3 * i] + 150 * rgb[3 * i + 1] + 29 * rgb[3 * i + 2]) >> 8);
    uint8_t *d_rgb, *d_gray;
    CUDA_CHECK(cudaMalloc(&d_rgb, rgb.size())); CUDA_CHECK(cudaMalloc(&d_gray, n));
    CUDA_CHECK(cudaMemcpy(d_rgb, rgb.data(), rgb.size(), cudaMemcpyHostToDevice));
    auto launch = [&] { grayscale<<<(n + 255) / 256, 256>>>(d_rgb, d_gray, n); };
    launch(); CUDA_CHECK_LAUNCH();
    CUDA_CHECK(cudaMemcpy(gray.data(), d_gray, n, cudaMemcpyDeviceToHost));
    size_t bad = 0; for (int i = 0; i < n; i++) bad += gray[i] != want[i];
    r.check("grayscale matches the CPU exactly", bad == 0);
    float ms = gw::time_kernel(launch);
    double bw = gw::gbs(4.0 * n, ms);
    r.metric("gray_gbs", bw, "GB/s (3 bytes in + 1 out per pixel)");
    r.metric("gray_pct", 100 * bw / dev.peak_gbs, "% of peak");
    cudaFree(d_rgb); cudaFree(d_gray);
  }

  // ---- B ----
  {
    std::printf("\nB. divergence (%d dependent FMAs per thread)\n", ITERS);
    const int n = dev.sms * 2048;  // enough blocks to fill the GPU several times over
    std::vector<float> in(n);
    for (int i = 0; i < n; i++) in[i] = 1.0f + (i % 7) * 0.01f;
    float *d_in, *d_out;
    CUDA_CHECK(cudaMalloc(&d_in, n * 4)); CUDA_CHECK(cudaMalloc(&d_out, n * 4));
    CUDA_CHECK(cudaMemcpy(d_in, in.data(), n * 4, cudaMemcpyHostToDevice));
    auto check = [&](const char* name, auto kernel, bool odd_a, bool by_warp) {
      kernel<<<n / 256, 256>>>(d_in, d_out); CUDA_CHECK_LAUNCH();
      std::vector<float> got(n), want(n);
      CUDA_CHECK(cudaMemcpy(got.data(), d_out, n * 4, cudaMemcpyDeviceToHost));
      // in[] takes 7 distinct values and there are 2 paths: compute those 14 results once.
      float table[7][2];
      for (int q = 0; q < 7; q++)
        for (int pa = 0; pa < 2; pa++) {
          float v = 1.0f + q * 0.01f;
          for (int k = 0; k < ITERS; k++) v = pa ? std::fmaf(v, 0.9999f, 0.0001f) : std::fmaf(v, 1.0001f, -0.0001f);
          table[q][pa] = v;
        }
      for (int i = 0; i < n; i++) {
        int t = i % 256;
        bool a = !odd_a ? true : by_warp ? ((t / 32) & 1) : (t & 1);
        want[i] = table[i % 7][a ? 1 : 0];
      }
      r.check(std::string(name) + " computes the right values", gw::all_close(got.data(), want.data(), n, 1e-5f, 1e-6f, name));
      return gw::time_kernel([&] { kernel<<<n / 256, 256>>>(d_in, d_out); }, 10, 2);
    };
    float t_uni = check("uniform", uniform, false, false);
    float t_div = check("divergent", divergent, true, false);
    float t_warp = check("warp_aligned", warp_aligned, true, true);
    float t_free = check("branch_free", branch_free, true, false);
    r.metric("uniform_ms", t_uni, "ms");
    r.metric("divergent_ms", t_div, "ms");
    r.metric("warp_aligned_ms", t_warp, "ms");
    r.metric("branch_free_ms", t_free, "ms");
    r.metric("divergence_cost", t_div / t_uni, "x (divergent / uniform)");
    r.metric("warp_aligned_cost", t_warp / t_uni, "x (warp-aligned / uniform)");
    r.metric("branch_free_cost", t_free / t_uni, "x (branch-free / uniform)");
    cudaFree(d_in); cudaFree(d_out);
  }

  // ---- C ----
  {
    std::printf("\nC. 3x3 blur\n");
    const int W = 4093, H = 2311, n = W * H;  // awkward sizes on purpose
    std::vector<float> img(n), out(n), want(n);
    for (int i = 0; i < n; i++) img[i] = float((i * 37) % 251);
    for (int y = 0; y < H; y++)
      for (int x = 0; x < W; x++) {
        float s = 0;
        for (int dy = -1; dy <= 1; dy++)
          for (int dx = -1; dx <= 1; dx++) s += img[std::min(std::max(y + dy, 0), H - 1) * W + std::min(std::max(x + dx, 0), W - 1)];
        want[y * W + x] = s * (1.0f / 9.0f);
      }
    float *d_in, *d_out;
    CUDA_CHECK(cudaMalloc(&d_in, n * 4)); CUDA_CHECK(cudaMalloc(&d_out, n * 4));
    CUDA_CHECK(cudaMemcpy(d_in, img.data(), n * 4, cudaMemcpyHostToDevice));
    dim3 block(32, 8), grid((W + 31) / 32, (H + 7) / 8);
    auto launch = [&] { blur3<<<grid, block>>>(d_in, d_out, W, H); };
    launch(); CUDA_CHECK_LAUNCH();
    CUDA_CHECK(cudaMemcpy(out.data(), d_out, n * 4, cudaMemcpyDeviceToHost));
    r.check("blur matches the CPU", gw::all_close(out.data(), want.data(), n, 1e-5f, 1e-4f, "blur"));
    float ms = gw::time_kernel(launch);
    double bw = gw::gbs(8.0 * n, ms);
    r.metric("blur_gbs", bw, "GB/s (counting 4 bytes in + 4 out per pixel)");
    r.metric("blur_pct", 100 * bw / dev.peak_gbs, "% of peak");
    cudaFree(d_in); cudaFree(d_out);
  }

  r.write(dev);
  return r.all_passed() ? 0 : 1;
}
