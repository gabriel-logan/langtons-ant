# Uses the local Emscripten SDK in ./emsdk only; nothing is installed system-wide.

EMSDK_DIR := $(CURDIR)/emsdk
EMCC      := $(EMSDK_DIR)/upstream/emscripten/emcc
CC        ?= cc
PORT      ?= 8080

SRC_CORE := src/langton.c
SRC_WASM := src/wasm_api.c
HEADERS  := src/langton.h

OUT_DIR := docs/wasm
OUT_JS  := $(OUT_DIR)/langton.mjs

EMFLAGS := \
	-std=c11 -O3 -Wall -Wextra \
	-sMODULARIZE=1 \
	-sEXPORT_ES6=1 \
	-sEXPORT_NAME=createLangtonModule \
	-sENVIRONMENT=worker \
	-sFILESYSTEM=0 \
	-sALLOW_MEMORY_GROWTH=1 \
	-sINITIAL_MEMORY=16mb \
	-sMAXIMUM_MEMORY=512mb \
	-sEXPORTED_RUNTIME_METHODS=HEAPU8 \
	-sEXPORTED_FUNCTIONS=_malloc,_free

.PHONY: all wasm test serve clean check-emsdk

all: wasm

wasm: $(OUT_JS)

$(OUT_JS): $(SRC_CORE) $(SRC_WASM) $(HEADERS) | check-emsdk
	@mkdir -p $(OUT_DIR)
	$(EMCC) $(EMFLAGS) $(SRC_CORE) $(SRC_WASM) -o $@
	@echo "WebAssembly written to $(OUT_DIR)/"

check-emsdk:
	@test -x "$(EMCC)" || { \
		echo "emcc not found at $(EMCC)"; \
		echo "See README: clone emsdk into ./emsdk, then run ./emsdk install latest && ./emsdk activate latest"; \
		exit 1; \
	}

build/test_langton: tests/test_langton.c $(SRC_CORE) $(HEADERS)
	@mkdir -p build
	$(CC) -std=c11 -O2 -Wall -Wextra -o $@ tests/test_langton.c $(SRC_CORE)

test: build/test_langton
	./build/test_langton

serve: wasm
	@echo "http://localhost:$(PORT)"
	python3 -m http.server $(PORT) --directory docs

clean:
	rm -rf build $(OUT_DIR)
