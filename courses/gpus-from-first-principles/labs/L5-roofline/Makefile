LAB := L5
SRC := l5.cu
include ../common/lab.mk

# Profile just the two GEMV kernels, with the sections that diagnose them: memory workload
# (sectors per request, L1/L2 hit rates), occupancy, launch statistics and warp stall reasons.
.PHONY: ncu-gemv roofline
ncu-gemv: $(BIN)
	ncu --section SpeedOfLight --section MemoryWorkloadAnalysis --section Occupancy \
	    --section LaunchStats --section WarpStateStats --section SourceCounters \
	    -k regex:gemv -c 2 -o L5-gemv -f ./$(BIN)
	@echo "open L5-gemv.ncu-rep in Nsight Compute"

# Nsight Compute's own roofline chart for every kernel in part B.
roofline: $(BIN)
	ncu --section SpeedOfLight_RooflineChart -k regex:intensity -o L5-roofline -f ./$(BIN)
	@echo "open L5-roofline.ncu-rep in Nsight Compute (Details page, roofline chart)"
