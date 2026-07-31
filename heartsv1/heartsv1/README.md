# HTTP Request Replayer (Hearts)

A high-performance, concurrent load-testing tool written in Go. This tool parses a text file containing multiple `curl` commands, extracts their headers, methods, and payloads, and replays them concurrently to simulate traffic load.

---

## Table of Contents
1. [Key Features](#key-features)
2. [Prerequisites](#prerequisites)
   - [macOS](#macos)
   - [Linux](#linux)
   - [Windows](#windows)
3. [Installation & Setup](#installation--setup)
4. [Building the Application](#building-the-application)
5. [Running the Replayer](#running-the-replayer)
6. [Input File Format (`curl.md`)](#input-file-format-curlmd)
7. [Architecture Overview](#architecture-overview)

---

## Key Features

- **Concurrent Execution**: Configurable concurrency pool to simulate thousands of simultaneous users.
- **Graceful Shutdown**: Intercepts `Ctrl+C` (SIGINT/SIGTERM) to stop workers safely and print final success/failure statistics.
- **Dynamic Stats Output**: Real-time tracking displaying requests per second (req/s), successful responses, and failures.
- **Lightweight & Dependency-Free**: Uses only the Go Standard Library for ultimate portability and zero external dependencies.

---

## Prerequisites

This tool requires Go to compile. Follow the instructions below for your operating system:

### macOS

Install Go via [Homebrew](https://brew.sh/) or [Mise](https://mise.jdx.dev/):

```bash
# Using Homebrew
brew install go

# Using Mise (uses the local mise.toml)
mise install
```

Alternatively, download the macOS package installer from the [Official Go Downloads Page](https://go.dev/dl/).

### Linux

Install Go via your system's package manager or manually extract the official tarball:

#### Ubuntu / Debian:
```bash
sudo apt update
sudo apt install golang-go
```

#### RHEL / CentOS / Fedora:
```bash
sudo dnf install golang
```

#### Manual Tarball Installation (Any Linux):
```bash
curl -LO https://go.dev/dl/go1.26.3.linux-amd64.tar.gz
sudo rm -rf /usr/local/go
sudo tar -C /usr/local -xzf go1.26.3.linux-amd64.tar.gz
export PATH=$PATH:/usr/local/go/bin
```

### Windows

Install Go via the Windows Package Manager (`winget`) or the official installer:

```powershell
# Using Winget
winget install GoLang.Go
```

Alternatively:
1. Download the MSI installer from [go.dev/dl](https://go.dev/dl/).
2. Run the installer and follow the prompt instructions.
3. Open a new Command Prompt or PowerShell window to reload your environment variables.

---

## Installation & Setup

1. Clone or navigate to the repository directory:
   ```bash
   cd heartsv1
   ```

2. Verify that Go is installed and available in your shell:
   ```bash
   go version
   ```

3. Initialize Go module workspace dependencies (none required beyond the standard library):
   ```bash
   go mod tidy
   ```

---

## Building the Application

Compiling the source code into a standalone binary ensures optimal performance:

### macOS & Linux
```bash
go build -ldflags="-s -w" -o replay main.go
```
*Note: The `-ldflags="-s -w"` option strips debugging information, reducing the final binary size significantly.*

### Windows
```powershell
go build -ldflags="-s -w" -o replay.exe main.go
```

---

## Running the Replayer

Once built, you can run the compiled binary or execute it directly using `go run`.

### Using the Compiled Binary

#### macOS & Linux:
```bash
# Run with default settings (200 workers, using curl.md)
./replay

# Run with custom concurrency and custom file path
./replay -c 500 -f my_custom_requests.md
```

#### Windows:
```powershell
# Run with default settings (200 workers, using curl.md)
.\replay.exe

# Run with custom concurrency and custom file path
.\replay.exe -c 500 -f my_custom_requests.md
```

### Using Go Run (Without Compiling)

You can run the program directly from source code:

```bash
go run main.go -c 100 -f curl.md
```

### Command-Line Arguments

| Flag | Default Value | Description |
| :--- | :--- | :--- |
| `-c` | `200` | The number of concurrent workers executing requests simultaneously. |
| `-f` | `curl.md` | Path to the file containing formatted curl commands to replay. |

---

## Input File Format (`curl.md`)

The target file must format each `curl` command block clearly. Lines starting with `curl ` mark the beginning of a request. Continuations using backslashes are supported:

```bash
curl 'https://203.0.113.1/events/messages' \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: Mozilla/5.0' \
  --data-raw '{"msgType":"EventMessages","payloads":[]}'
```

*Note: Ensure all HTTP request target URLs and personal credentials inside `curl.md` have been appropriately redacted or mocked prior to load-testing on public servers.*

---

## Architecture Overview

The tool follows an asynchronous, thread-safe architecture:
1. **Parser Engine**: Parses individual curl commands from a text file into structured in-memory `req` structures.
2. **Worker Pool (Semaphore)**: A buffered channel manages concurrency, ensuring that no more than `-c` workers run at any given time.
3. **Atomic Counters**: Standard library `sync/atomic` functions are used to safely increment success and failure counts without lock contention across goroutines.
4. **Optimized Transport**: Re-uses TCP connections via Go's HTTP Transport settings (`MaxIdleConnsPerHost` and `MaxConnsPerHost`) to prevent port exhaustion during heavy concurrency testing.
