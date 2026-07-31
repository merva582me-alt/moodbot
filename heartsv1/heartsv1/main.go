// Package main implements a high-performance, concurrent HTTP request replayer.
// It parses a file containing multiple curl commands, extracts the URLs, headers,
// and raw payloads, and replays them concurrently to simulate a heavy traffic load.
package main

import (
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
)

// req represents the structured fields of a parsed curl request.
type req struct {
	url     string       // The destination HTTP/HTTPS URL.
	method  string       // The HTTP method (e.g., GET, POST, PUT).
	headers [][2]string  // The HTTP request headers as key-value pairs.
	body    string       // The raw request payload body.
}

// parseCurlFile reads the specified file and parses all curl commands within it.
// It returns a slice of parsed req structures or an error if the file cannot be read.
func parseCurlFile(path string) ([]req, error) {
	// Read the entire contents of the file
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	// Split file content into individual lines
	lines := strings.Split(string(data), "\n")

	var reqs []req
	var cur []string

	// flush is a helper function that processes the collected lines of a single curl command,
	// parses it, appends the result to reqs, and resets the cur slice.
	flush := func() {
		if len(cur) == 0 {
			return
		}
		if r := parseCmd(cur); r != nil {
			reqs = append(reqs, *r)
		}
		cur = nil
	}

	// Group lines together starting with "curl "
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "curl ") {
			// Flush the previous command before starting a new one
			flush()
			cur = []string{trimmed}
		} else if len(cur) > 0 {
			// Append continuing arguments of the current curl command
			cur = append(cur, trimmed)
		}
	}
	// Flush the final collected command
	flush()

	return reqs, nil
}

// parseCmd parses the lines comprising a single curl command and extracts
// the target URL, HTTP method, headers, and request body.
func parseCmd(lines []string) *req {
	// Default HTTP method is GET unless overridden by body or specific flags
	r := &req{method: "GET"}

	// Extract the URL from the first line which is in the format: curl 'URL'
	first := lines[0]
	start := strings.Index(first, "'")
	if start < 0 {
		return nil
	}
	rest := first[start+1:]
	end := strings.Index(rest, "'")
	if end < 0 {
		return nil
	}
	r.url = rest[:end]

	// Process subsequent lines (headers, payload body, method modifications)
	for _, line := range lines[1:] {
		// Strip trailing backslashes and semicolons commonly used for shell continuation
		line = strings.TrimRight(strings.TrimSpace(line), "\\ ;")
		line = strings.TrimSpace(line)

		if strings.HasPrefix(line, "-H ") {
			// Extract request header key and value
			hdr := extractQuoted(line[3:])
			if idx := strings.Index(hdr, ": "); idx > 0 {
				r.headers = append(r.headers, [2]string{hdr[:idx], hdr[idx+2:]})
			}
		} else if strings.HasPrefix(line, "--data-raw ") {
			// Extract raw payload data
			after := strings.TrimSpace(line[len("--data-raw "):])
			// Strip surrounding single quotes if present
			if len(after) >= 2 && after[0] == '\'' {
				after = after[1:]
				if last := strings.LastIndex(after, "'"); last >= 0 {
					after = after[:last]
				}
			}
			r.body = after
			// Presence of --data-raw implies a POST request by default
			r.method = "POST"
		} else if strings.HasPrefix(line, "-X ") {
			// Explicitly set the HTTP method
			r.method = strings.TrimSpace(line[3:])
		}
	}

	return r
}

// extractQuoted retrieves the substring situated between the first and last single quote characters.
func extractQuoted(s string) string {
	start := strings.Index(s, "'")
	if start < 0 {
		return ""
	}
	rest := s[start+1:]
	end := strings.LastIndex(rest, "'")
	if end < 0 {
		return ""
	}
	return rest[:end]
}

// result tracks execution metrics and status of a replayed HTTP request.
type result struct {
	idx    int           // Index of the request in the loaded sequence
	url    string        // The request URL
	status int           // The HTTP response status code
	dur    time.Duration // Time elapsed during execution
	err    error         // Errors encountered during execution (if any)
}

// send constructs and fires a single HTTP request using the provided HTTP client,
// and submits the execution metrics to the out channel.
func send(client *http.Client, idx int, r req, out chan<- result) {
	start := time.Now()

	var body io.Reader
	if r.body != "" {
		body = strings.NewReader(r.body)
	}

	// Create a new standard HTTP request
	httpReq, err := http.NewRequest(r.method, r.url, body)
	if err != nil {
		out <- result{idx, r.url, 0, time.Since(start), err}
		return
	}

	// Set headers on the constructed request
	for _, h := range r.headers {
		httpReq.Header.Set(h[0], h[1])
	}

	// Execute the HTTP request
	resp, err := client.Do(httpReq)
	if err != nil {
		out <- result{idx, r.url, 0, time.Since(start), err}
		return
	}
	// Fully discard the body and close it to allow TCP connection reuse
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()

	out <- result{idx, r.url, resp.StatusCode, time.Since(start), nil}
}

func main() {
	// Parse command line configuration flags
	concurrency := flag.Int("c", 200, "number of concurrent workers")
	path := flag.String("f", "curl.md", "curl file to replay")
	flag.Parse()

	// Parse the curl specifications
	reqs, err := parseCurlFile(*path)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}

	n := int64(len(reqs))
	fmt.Printf("loaded %d requests, running with %d workers — Ctrl+C to stop\n", n, *concurrency)

	// Configure optimized HTTP client settings to handle highly concurrent requests
	client := &http.Client{
		Transport: &http.Transport{
			MaxIdleConnsPerHost: *concurrency,
			MaxConnsPerHost:     *concurrency,
		},
		Timeout: 30 * time.Second,
	}

	var totalOk, totalFail int64
	var idx int64
	stop := make(chan struct{})

	// Statistics printer goroutine: outputs throughput details (req/s) periodically
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		var lastOk, lastFail int64
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				ok := atomic.LoadInt64(&totalOk)
				fail := atomic.LoadInt64(&totalFail)
				rps := (ok + fail) - (lastOk + lastFail)
				fmt.Printf("req/s: %-6d  ok: %-8d  fail: %d\n", rps, ok, fail)
				lastOk, lastFail = ok, fail
			}
		}
	}()

	// Signal handler goroutine: ensures graceful exit and prints summary on Ctrl+C
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sig
		close(stop)
		ok := atomic.LoadInt64(&totalOk)
		fail := atomic.LoadInt64(&totalFail)
		fmt.Printf("\nstopped — total ok: %d  fail: %d\n", ok, fail)
		os.Exit(0)
	}()

	// Worker pool engine: uses a buffered channel to limit active concurrent workers
	sem := make(chan struct{}, *concurrency)
	for {
		select {
		case <-stop:
			return
		default:
		}

		// Acquire slot in concurrency semaphore
		sem <- struct{}{}
		
		// Atomically fetch the next request index to replay (cycles through the sequence)
		i := atomic.AddInt64(&idx, 1) % n
		r := reqs[i]

		// Execute replayed request asynchronously
		go func(r req) {
			// Release semaphore slot upon worker completion
			defer func() { <-sem }()
			results := make(chan result, 1)
			send(client, 0, r, results)
			res := <-results
			// Thread-safe update of total counters
			if res.err != nil || res.status >= 400 {
				atomic.AddInt64(&totalFail, 1)
			} else {
				atomic.AddInt64(&totalOk, 1)
			}
		}(r)
	}
}
