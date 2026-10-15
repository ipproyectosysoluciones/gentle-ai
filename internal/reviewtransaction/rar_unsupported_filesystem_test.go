package reviewtransaction

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

// #4670: the typed refusal must stay inside the #1918 fail-closed family, so
// every caller matching the generic unsafe-path sentinel keeps refusing.
func TestUnsupportedAuthorityFilesystemErrorKeepsTheUnsafePathSentinel(t *testing.T) {
	wrapped := fmt.Errorf("validate RAR Git common directory: %w",
		&UnsupportedAuthorityFilesystemError{Path: `\\server\share\repo\.git`, Remote: true})

	var unsupported *UnsupportedAuthorityFilesystemError
	if !errors.As(wrapped, &unsupported) || !unsupported.Remote {
		t.Fatalf("typed refusal not reachable through errors.As: %#v", wrapped)
	}
	if !errors.Is(wrapped, errUnsafeRARAuthorityPath) {
		t.Fatalf("typed refusal lost the unsafe-path sentinel: %v", wrapped)
	}
}

func TestUnsupportedAuthorityFilesystemErrorNamesARunnableContinuation(t *testing.T) {
	tests := []struct {
		name string
		err  *UnsupportedAuthorityFilesystemError
		want string
	}{
		{"remote share", &UnsupportedAuthorityFilesystemError{Path: `\\server\share\repo\.git`, Remote: true}, "remote"},
		{"unsupported filesystem", &UnsupportedAuthorityFilesystemError{Path: `E:\repo\.git`, Filesystem: "exFAT"}, `"exFAT"`},
		{"unknown filesystem", &UnsupportedAuthorityFilesystemError{Path: `E:\repo\.git`, Reason: "the volume information probe failed: access is denied"}, "access is denied"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			message := tt.err.Error()
			for _, want := range []string{tt.want, "gentle-ai review mode disable --scope global", "NTFS or ReFS"} {
				if !strings.Contains(message, want) {
					t.Fatalf("message %q does not contain %q", message, want)
				}
			}
			if strings.Contains(message, "check the path and rerun") {
				t.Fatalf("message %q still names a repair that cannot resolve a correct path", message)
			}
		})
	}
}
