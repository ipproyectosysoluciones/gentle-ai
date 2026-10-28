package reviewtransaction

import (
	"os"
	"testing"
	"time"
)

func TestGetRelayTimeoutDefault(t *testing.T) {
	// unset env -> default 10 minutes
	if v := os.Getenv("GENTLE_AI_RELAY_TIMEOUT"); v != "" {
		os.Unsetenv("GENTLE_AI_RELAY_TIMEOUT")
	}
	if got := GetRelayTimeout(); got != 10*time.Minute {
		t.Errorf("GetRelayTimeout() = %v, want 10m", got)
	}
}

func TestGetRelayTimeoutValid(t *testing.T) {
	os.Setenv("GENTLE_AI_RELAY_TIMEOUT", "30s")
	defer os.Unsetenv("GENTLE_AI_RELAY_TIMEOUT")
	if got := GetRelayTimeout(); got != 30*time.Second {
		t.Errorf("GetRelayTimeout() = %v, want 30s", got)
	}
}
