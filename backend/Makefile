.PHONY: build run dev test clean

BINARY=pg-dash

build:
	go build -o bin/$(BINARY) ./cmd/server

run: build
	./bin/$(BINARY)

dev:
	@which air > /dev/null 2>&1 || go install github.com/air-verse/air@latest
	air -c .air.toml 2>/dev/null || air

test:
	go test ./...

clean:
	rm -rf bin/
