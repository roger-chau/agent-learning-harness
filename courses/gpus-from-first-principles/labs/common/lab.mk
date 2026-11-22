# Shared build rules for the Groundwork CUDA labs. Each lab's Makefile sets LAB and SRC,
# then includes this file.
#
#   make            build
#   make run        build and run (writes results.json)
#   make submit     send results.json to your local Groundwork server
#   make ptx        write the PTX for each kernel to $(LAB).ptx
#   make sass       disassemble the machine code (SASS) to $(LAB).sass
#   make regs       registers, spills and shared memory per kernel (ptxas -v)
#   make ncu        profile with Nsight Compute (details: the lab page)
#   make nsys       timeline with Nsight Systems
#
# ARCH defaults to sm_75 (RTX 20-series, Turing). Use ARCH=sm_86 for an RTX 30-series,
# sm_80 for an A100, sm_89 for an RTX 40-series or L4, sm_90 for an H100.

ARCH        ?= sm_75
NVCC        ?= nvcc
NVCCFLAGS   ?= -O3 -std=c++17 -lineinfo
GROUNDWORK  ?= http://127.0.0.1:8765
COMMON      := $(dir $(lastword $(MAKEFILE_LIST)))
BIN         := $(LAB)

.PHONY: all run submit ptx sass regs ncu nsys clean
all: $(BIN)

$(BIN): $(SRC) $(COMMON)gw.h
	$(NVCC) $(NVCCFLAGS) -arch=$(ARCH) -I$(COMMON) $(EXTRA_FLAGS) -o $@ $(SRC) $(LIBS)

run: $(BIN)
	./$(BIN) $(ARGS)

submit: results.json
	python3 $(COMMON)submit.py results.json --server $(GROUNDWORK)

ptx: $(SRC)
	$(NVCC) $(NVCCFLAGS) -arch=$(ARCH) -I$(COMMON) $(EXTRA_FLAGS) -ptx -o $(LAB).ptx $(SRC)

sass: $(BIN)
	cuobjdump -sass $(BIN) > $(LAB).sass && echo "wrote $(LAB).sass"

regs: $(SRC)
	$(NVCC) $(NVCCFLAGS) -arch=$(ARCH) -I$(COMMON) $(EXTRA_FLAGS) -Xptxas -v -c -o /dev/null $(SRC)

ncu: $(BIN)
	ncu --set full -o $(LAB)-profile -f ./$(BIN) $(ARGS)
	@echo "open $(LAB)-profile.ncu-rep in Nsight Compute"

nsys: $(BIN)
	nsys profile -o $(LAB)-timeline -f true ./$(BIN) $(ARGS)
	@echo "open $(LAB)-timeline.nsys-rep in Nsight Systems"

clean:
	rm -f $(BIN) $(LAB).ptx $(LAB).sass results.json *.ncu-rep *.nsys-rep
