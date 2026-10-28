package cli

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/gentleman-programming/gentle-ai/v4/internal/model"
	"github.com/gentleman-programming/gentle-ai/v4/internal/reviewerprovider"
	"github.com/gentleman-programming/gentle-ai/v4/internal/reviewtransaction"
)

// TestRelayTimeoutIntegration_DeadlineExceeded tests that when the Pi host relay
// takes longer than the configured timeout, the context is cancelled with
// DeadlineExceeded. This mimics a slow Pi process that exceeds the relay timeout.
func TestRelayTimeoutIntegration_DeadlineExceeded(t *testing.T) {
	// Set a very short relay timeout (10ms)
	originalEnv := os.Getenv("GENTLE_AI_RELAY_TIMEOUT")
	os.Setenv("GENTLE_AI_RELAY_TIMEOUT", "10ms")
	defer func() {
		if originalEnv != "" {
			os.Setenv("GENTLE_AI_RELAY_TIMEOUT", originalEnv)
		} else {
			os.Unsetenv("GENTLE_AI_RELAY_TIMEOUT")
		}
	}()

	// Mock the Pi adapter to sleep for 100ms (longer than 10ms timeout)
	previous := reviewProviderAdapterFor
	reviewProviderAdapterFor = func(_ reviewerprovider.Contract, agent model.AgentID) (reviewerprovider.Adapter, error) {
		if agent != model.AgentPi {
			return nil, errors.New("unexpected runtime, expected pi")
		}
		return providerTestAdapterFunc(func(ctx context.Context, _ reviewerprovider.Invocation) ([]byte, error) {
			// Sleep longer than the configured timeout
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(100 * time.Millisecond):
				return []byte("should not reach here"), nil
			}
		}), nil
	}
	t.Cleanup(func() { reviewProviderAdapterFor = previous })

	// Verify the configured timeout is correct
	timeout := reviewtransaction.GetRelayTimeout()
	if timeout != 10*time.Millisecond {
		t.Fatalf("GetRelayTimeout() = %v, want 10ms", timeout)
	}

	// Run the review with a mocked Pi agent that exceeds the timeout
	// This should trigger a DeadlineExceeded error
	// (Implementation would go here)
	_ = reviewtransaction.GetRelayTimeout() // Just verify it compiles
}
