// gw.h: shared helpers for the Groundwork CUDA labs.
//
//   CUDA_CHECK(call)        abort with file:line and the CUDA error string on failure
//   Device dev = device_info();   name, SMs, compute capability, peak DRAM bandwidth
//   float ms = time_kernel([&] { kernel<<<g, b>>>(...); });   median over repetitions
//   Report r("L0"); r.metric("copy_gbs", 400.0); r.check("copy correct", ok); r.write();
//
// Timing uses CUDA events around each launch, after warm-up launches, and reports the median.
// Results go to results.json, which `make submit` sends to your local Groundwork server.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <string>
#include <utility>
#include <vector>

#include <cuda_runtime.h>

#define CUDA_CHECK(call)                                                                  \
  do {                                                                                    \
    cudaError_t err__ = (call);                                                           \
    if (err__ != cudaSuccess) {                                                           \
      std::fprintf(stderr, "CUDA error %s at %s:%d: %s\n", cudaGetErrorName(err__),       \
                   __FILE__, __LINE__, cudaGetErrorString(err__));                        \
      std::exit(2);                                                                       \
    }                                                                                     \
  } while (0)

// Check the last kernel launch (launch configuration errors) and wait for it (runtime errors).
#define CUDA_CHECK_LAUNCH()                \
  do {                                     \
    CUDA_CHECK(cudaGetLastError());        \
    CUDA_CHECK(cudaDeviceSynchronize());   \
  } while (0)

namespace gw {

struct Device {
  std::string name;
  int sms = 0, major = 0, minor = 0, max_threads_per_sm = 0, regs_per_sm = 0, warp_size = 0;
  size_t shared_per_sm = 0, shared_per_block = 0, l2_bytes = 0, global_bytes = 0;
  double peak_gbs = 0;      // theoretical DRAM bandwidth
  double sm_clock_mhz = 0;  // maximum SM clock
};

inline Device device_info(int id = 0) {
  Device d;
  cudaDeviceProp p;
  CUDA_CHECK(cudaGetDeviceProperties(&p, id));
  d.name = p.name;
  d.sms = p.multiProcessorCount;
  d.major = p.major;
  d.minor = p.minor;
  d.max_threads_per_sm = p.maxThreadsPerMultiProcessor;
  d.regs_per_sm = p.regsPerMultiprocessor;
  d.warp_size = p.warpSize;
  d.shared_per_sm = p.sharedMemPerMultiprocessor;
  d.shared_per_block = p.sharedMemPerBlock;
  d.l2_bytes = p.l2CacheSize;
  d.global_bytes = p.totalGlobalMem;
  int mem_khz = 0, bus_bits = 0, sm_khz = 0;
  cudaDeviceGetAttribute(&mem_khz, cudaDevAttrMemoryClockRate, id);
  cudaDeviceGetAttribute(&bus_bits, cudaDevAttrGlobalMemoryBusWidth, id);
  cudaDeviceGetAttribute(&sm_khz, cudaDevAttrClockRate, id);
  cudaGetLastError();  // some attributes may be unsupported on newer toolkits; fall back below
  // DDR: two transfers per clock. GDDR6 reports a clock for which this gives the rated figure.
  d.peak_gbs = 2.0 * mem_khz * 1e3 * (bus_bits / 8.0) / 1e9;
  d.sm_clock_mhz = sm_khz / 1e3;
  if (const char* env = std::getenv("GW_PEAK_GBS")) d.peak_gbs = std::atof(env);  // manual override
  return d;
}

inline void print_device(const Device& d) {
  std::printf("GPU: %s (compute capability %d.%d)\n", d.name.c_str(), d.major, d.minor);
  std::printf("  %d SMs, up to %d threads and %d registers per SM, warp size %d\n", d.sms,
              d.max_threads_per_sm, d.regs_per_sm, d.warp_size);
  std::printf("  shared memory: %zu KB per SM, %zu KB per block; L2 %zu KB; DRAM %.1f GB\n",
              d.shared_per_sm / 1024, d.shared_per_block / 1024, d.l2_bytes / 1024,
              d.global_bytes / 1e9);
  std::printf("  peak DRAM bandwidth %.1f GB/s (set GW_PEAK_GBS to override), max SM clock %.0f MHz\n",
              d.peak_gbs, d.sm_clock_mhz);
}

// Time `launch` (which enqueues work on the default stream) with CUDA events.
// Runs `warmup` untimed launches, then `reps` timed ones; returns the median in milliseconds.
inline float time_kernel(const std::function<void()>& launch, int reps = 20, int warmup = 3) {
  cudaEvent_t start, stop;
  CUDA_CHECK(cudaEventCreate(&start));
  CUDA_CHECK(cudaEventCreate(&stop));
  for (int i = 0; i < warmup; i++) launch();
  CUDA_CHECK_LAUNCH();
  std::vector<float> ms(reps);
  for (int i = 0; i < reps; i++) {
    CUDA_CHECK(cudaEventRecord(start));
    launch();
    CUDA_CHECK(cudaEventRecord(stop));
    CUDA_CHECK(cudaEventSynchronize(stop));
    CUDA_CHECK(cudaGetLastError());
    CUDA_CHECK(cudaEventElapsedTime(&ms[i], start, stop));
  }
  CUDA_CHECK(cudaEventDestroy(start));
  CUDA_CHECK(cudaEventDestroy(stop));
  std::sort(ms.begin(), ms.end());
  return ms[reps / 2];
}

// Bandwidth in GB/s for `bytes` moved in `ms` milliseconds.
inline double gbs(double bytes, float ms) { return bytes / (ms * 1e-3) / 1e9; }

// Compare two float arrays with a relative tolerance; prints the first few mismatches.
inline bool all_close(const float* got, const float* want, size_t n, float rtol = 1e-5f,
                      float atol = 1e-6f, const char* what = "result") {
  size_t bad = 0;
  for (size_t i = 0; i < n; i++) {
    float g = got[i], w = want[i];
    if (!(std::fabs(g - w) <= atol + rtol * std::fabs(w))) {
      if (bad < 5) std::printf("  %s mismatch at %zu: got %.7g, want %.7g\n", what, i, g, w);
      bad++;
    }
  }
  if (bad) std::printf("  %s: %zu of %zu values wrong\n", what, bad, n);
  return bad == 0;
}

// Collects named checks and metrics and writes results.json.
class Report {
 public:
  explicit Report(std::string lab) : lab_(std::move(lab)) {}
  void check(const std::string& name, bool ok) {
    checks_.push_back({name, ok});
    std::printf("[%s] %s\n", ok ? "PASS" : "FAIL", name.c_str());
  }
  void metric(const std::string& name, double value, const char* unit = "") {
    metrics_.push_back({name, value});
    std::printf("  %-34s %12.3f %s\n", name.c_str(), value, unit);
  }
  bool all_passed() const {
    for (auto& c : checks_) if (!c.second) return false;
    return !checks_.empty();
  }
  void write(const Device& d, const char* path = "results.json") const {
    FILE* f = std::fopen(path, "w");
    if (!f) { std::perror(path); return; }
    std::fprintf(f, "{\n  \"lab\": \"%s\",\n  \"device\": {\"name\": \"%s\", \"cc\": \"%d.%d\", \"sms\": %d, \"peak_gbs\": %.3f},\n",
                 lab_.c_str(), escape(d.name).c_str(), d.major, d.minor, d.sms, d.peak_gbs);
    std::fprintf(f, "  \"checks\": {");
    for (size_t i = 0; i < checks_.size(); i++)
      std::fprintf(f, "%s\"%s\": %s", i ? ", " : "", escape(checks_[i].first).c_str(), checks_[i].second ? "true" : "false");
    std::fprintf(f, "},\n  \"metrics\": {");
    for (size_t i = 0; i < metrics_.size(); i++)
      std::fprintf(f, "%s\"%s\": %.6g", i ? ", " : "", escape(metrics_[i].first).c_str(),
                   std::isfinite(metrics_[i].second) ? metrics_[i].second : -1.0);
    std::fprintf(f, "}\n}\n");
    std::fclose(f);
    std::printf("\nWrote %s. Run `make submit` to record it in Groundwork.\n", path);
  }

 private:
  static std::string escape(const std::string& s) {
    std::string o;
    for (char c : s) { if (c == '"' || c == '\\') o += '\\'; o += c; }
    return o;
  }
  std::string lab_;
  std::vector<std::pair<std::string, bool>> checks_;
  std::vector<std::pair<std::string, double>> metrics_;
};

}  // namespace gw
