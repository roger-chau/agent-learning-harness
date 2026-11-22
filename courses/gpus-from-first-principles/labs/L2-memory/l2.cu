// Lab 2: the memory system on real hardware.
//
//   A. Stride sweep: useful bandwidth when each lane reads every s-th float.
//   B. Transpose: naive -> shared-memory tiles -> padded tiles (no bank conflicts).
//   C. Array of structs vs structure of arrays for a particle update.
#include "gw.h"

// ---------------------------------------------------------------------------------------
// A. y[i] = x[i * s] for i < n (x has n * s elements). Useful bytes: 8 per element.
// ---------------------------------------------------------------------------------------
__global__ void strided_read(const float* __restrict__ x, float* __restrict__ y, int n, int s) {
  // TODO(A)
}

// ---------------------------------------------------------------------------------------
// B. Transpose an N x N row-major matrix: out[c * N + r] = in[r * N + c]. N is a multiple of 32.
// Launch: 32 x 8 threads per block, one block per 32 x 32 tile; each thread handles 4 rows.
// ---------------------------------------------------------------------------------------
constexpr int TILE = 32, ROWS = 8;

// Reads are coalesced (consecutive threads read consecutive columns); writes are strided.
__global__ void transpose_naive(const float* __restrict__ in, float* __restrict__ out, int N) {
  // TODO(B1)
}

// Stage the tile in shared memory so both the read and the write are coalesced.
__global__ void transpose_shared(const float* __restrict__ in, float* __restrict__ out, int N) {
  // TODO(B2): __shared__ float tile[TILE][TILE]; read a tile row-wise, __syncthreads(),
  // write it out transposed so that consecutive threads write consecutive addresses.
}

// The same, with one column of padding: tile[TILE][TILE + 1]. Why does that matter?
__global__ void transpose_padded(const float* __restrict__ in, float* __restrict__ out, int N) {
  // TODO(B3)
}

// ---------------------------------------------------------------------------------------
// C. Particles: advance positions by velocity * dt.
// ---------------------------------------------------------------------------------------
struct Particle { float x, y, z, vx, vy, vz, mass, charge; };  // 32 bytes

__global__ void step_aos(Particle* __restrict__ p, int n, float dt) {
  // TODO(C1): p[i].x += p[i].vx * dt; same for y and z
}

__global__ void step_soa(float* __restrict__ x, float* __restrict__ y, float* __restrict__ z,
                         const float* __restrict__ vx, const float* __restrict__ vy, const float* __restrict__ vz,
                         int n, float dt) {
  // TODO(C2)
}

// ---------------------------------------------------------------------------------------
// Host code
// ---------------------------------------------------------------------------------------
int main() {
  gw::Device dev = gw::device_info();
  gw::print_device(dev);
  gw::Report r("L2");

  // ---- A ----
  {
    std::printf("\nA. stride sweep (useful bandwidth: 4 bytes read + 4 written per element)\n");
    const int n = 1 << 22, maxs = 32;
    std::vector<float> hx(size_t(n) * maxs);
    for (size_t i = 0; i < hx.size(); i++) hx[i] = float(i % 9973);
    float *x, *y;
    CUDA_CHECK(cudaMalloc(&x, hx.size() * 4)); CUDA_CHECK(cudaMalloc(&y, n * 4));
    CUDA_CHECK(cudaMemcpy(x, hx.data(), hx.size() * 4, cudaMemcpyHostToDevice));
    bool ok = true;
    for (int s = 1; s <= maxs; s *= 2) {
      auto launch = [&] { strided_read<<<n / 256, 256>>>(x, y, n, s); };
      launch(); CUDA_CHECK_LAUNCH();
      std::vector<float> got(n);
      CUDA_CHECK(cudaMemcpy(got.data(), y, n * 4, cudaMemcpyDeviceToHost));
      for (int i = 0; i < n && ok; i += 4099) ok = got[i] == hx[size_t(i) * s];
      double bw = gw::gbs(8.0 * n, gw::time_kernel(launch));
      std::printf("  stride %2d: %8.1f GB/s useful\n", s, bw);
      if (s == 1) r.metric("stride1_gbs", bw, "GB/s");
      if (s == 8) r.metric("stride8_gbs", bw, "GB/s");
      if (s == 32) r.metric("stride32_gbs", bw, "GB/s");
    }
    r.check("strided reads are correct", ok);
    cudaFree(x); cudaFree(y);
  }

  // ---- B ----
  {
    std::printf("\nB. transpose\n");
    const int N = 4096;
    std::vector<float> h(size_t(N) * N), got(size_t(N) * N);
    for (size_t i = 0; i < h.size(); i++) h[i] = float(i % 65521);
    float *in, *out;
    CUDA_CHECK(cudaMalloc(&in, h.size() * 4)); CUDA_CHECK(cudaMalloc(&out, h.size() * 4));
    CUDA_CHECK(cudaMemcpy(in, h.data(), h.size() * 4, cudaMemcpyHostToDevice));
    dim3 grid(N / TILE, N / TILE), block(TILE, ROWS);
    auto run = [&](const char* name, void (*k)(const float*, float*, int)) {
      CUDA_CHECK(cudaMemset(out, 0, h.size() * 4));
      k<<<grid, block>>>(in, out, N); CUDA_CHECK_LAUNCH();
      CUDA_CHECK(cudaMemcpy(got.data(), out, h.size() * 4, cudaMemcpyDeviceToHost));
      bool ok = true;
      for (int rr = 0; rr < N && ok; rr += 7) for (int c = 0; c < N && ok; c += 13) ok = got[size_t(c) * N + rr] == h[size_t(rr) * N + c];
      r.check(std::string(name) + " transposes correctly", ok);
      double bw = gw::gbs(8.0 * N * N, gw::time_kernel([&] { k<<<grid, block>>>(in, out, N); }));
      r.metric(std::string(name) + "_pct", 100 * bw / dev.peak_gbs, "% of peak");
      return bw;
    };
    double nv = run("transpose_naive", transpose_naive);
    double sh = run("transpose_shared", transpose_shared);
    double pd = run("transpose_padded", transpose_padded);
    r.metric("padded_vs_naive", pd / nv, "x");
    r.metric("padded_vs_shared", pd / sh, "x (the bank-conflict effect)");
    cudaFree(in); cudaFree(out);
  }

  // ---- C ----
  {
    std::printf("\nC. array of structs vs structure of arrays\n");
    const int n = 1 << 23;
    const float dt = 0.01f;
    std::vector<Particle> hp(n);
    for (int i = 0; i < n; i++) hp[i] = {float(i % 100), float(i % 37), float(i % 11), 1.f, -2.f, 0.5f, 1.f, 0.f};
    Particle* dp;
    CUDA_CHECK(cudaMalloc(&dp, n * sizeof(Particle)));
    CUDA_CHECK(cudaMemcpy(dp, hp.data(), n * sizeof(Particle), cudaMemcpyHostToDevice));
    step_aos<<<n / 256, 256>>>(dp, n, dt); CUDA_CHECK_LAUNCH();
    std::vector<Particle> gp(n);
    CUDA_CHECK(cudaMemcpy(gp.data(), dp, n * sizeof(Particle), cudaMemcpyDeviceToHost));
    // The GPU fuses x + vx*dt into one FMA (one rounding); the CPU may not: compare with a tolerance.
    auto near = [](float a, float b) { return std::fabs(a - b) <= 1e-5f * std::fabs(b) + 1e-6f; };
    bool ok = true;
    for (int i = 0; i < n && ok; i += 997) ok = near(gp[i].x, hp[i].x + hp[i].vx * dt) && near(gp[i].z, hp[i].z + hp[i].vz * dt) && gp[i].mass == hp[i].mass;
    r.check("AoS step is correct", ok);
    float t_aos = gw::time_kernel([&] { step_aos<<<n / 256, 256>>>(dp, n, dt); });

    std::vector<float> c(n);
    float* f[6];
    for (int k = 0; k < 6; k++) {
      CUDA_CHECK(cudaMalloc(&f[k], n * 4));
      for (int i = 0; i < n; i++) c[i] = (&hp[i].x)[k];
      CUDA_CHECK(cudaMemcpy(f[k], c.data(), n * 4, cudaMemcpyHostToDevice));
    }
    step_soa<<<n / 256, 256>>>(f[0], f[1], f[2], f[3], f[4], f[5], n, dt); CUDA_CHECK_LAUNCH();
    CUDA_CHECK(cudaMemcpy(c.data(), f[1], n * 4, cudaMemcpyDeviceToHost));
    ok = true;
    for (int i = 0; i < n && ok; i += 997) ok = near(c[i], hp[i].y + hp[i].vy * dt);
    r.check("SoA step is correct", ok);
    float t_soa = gw::time_kernel([&] { step_soa<<<n / 256, 256>>>(f[0], f[1], f[2], f[3], f[4], f[5], n, dt); });
    r.metric("aos_ms", t_aos, "ms");
    r.metric("soa_ms", t_soa, "ms");
    r.metric("soa_speedup", t_aos / t_soa, "x");
    cudaFree(dp);
    for (auto p : f) cudaFree(p);
  }

  r.write(dev);
  return r.all_passed() ? 0 : 1;
}
