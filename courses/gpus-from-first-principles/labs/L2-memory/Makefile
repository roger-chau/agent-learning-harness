LAB := L2
SRC := l2.cu
include ../common/lab.mk

# Just the counters this lab is about: sectors per request, shared-memory bank conflicts,
# DRAM throughput. (Metric names are for Nsight Compute on Turing and later.)
METRICS := l1tex__t_sectors_pipe_lsu_mem_global_op_ld.sum,l1tex__t_requests_pipe_lsu_mem_global_op_ld.sum,l1tex__t_sectors_pipe_lsu_mem_global_op_st.sum,l1tex__t_requests_pipe_lsu_mem_global_op_st.sum,l1tex__data_bank_conflicts_pipe_lsu_mem_shared_op_ld.sum,l1tex__data_bank_conflicts_pipe_lsu_mem_shared_op_st.sum,dram__throughput.avg.pct_of_peak_sustained_elapsed

.PHONY: metrics
metrics: $(BIN)
	ncu --metrics $(METRICS) -k regex:transpose ./$(BIN)
