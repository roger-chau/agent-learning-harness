LAB := L9
SRC := l9.cu

# NVML (the library behind nvidia-smi) samples clocks, power and temperature in part C.
# It ships with the driver; if linking fails, build with `make NVML=0`.
NVML ?= 1
ifeq ($(NVML),1)
EXTRA_FLAGS += -DGW_NVML
LIBS += -lnvidia-ml
endif

include ../common/lab.mk
