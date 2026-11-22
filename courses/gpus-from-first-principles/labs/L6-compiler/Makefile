LAB := L6
SRC := l6.cu
include ../common/lab.mk

# The SASS of one kernel, with instruction counts: make sass-poly_ilp, make sass-sort8_local, ...
sass-%: $(BIN)
	cuobjdump -sass -fun $* $(BIN) > $*.sass
	@echo "wrote $*.sass   FFMA: $$(grep -c FFMA $*.sass)   LDL: $$(grep -c LDL $*.sass)   STL: $$(grep -c STL $*.sass)"
