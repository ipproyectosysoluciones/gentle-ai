//go:build linux || darwin

package shellinstaller

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// userReuseTree copies one owned installation subtree into the private stage
// for a component-scoped update. The source is the recorded installation
// itself: physical directories, regular files and symlinks only, with modes
// preserved. The target must be absent or an empty physical directory (the
// stage preparation pre-creates some component directories); a non-empty or
// foreign target is refused and a partial reuse never publishes.
func userReuseTree(ctx context.Context, from, to string) error {
	if ctx == nil || ctx.Err() != nil {
		return privateError("canceled", context.Canceled)
	}
	if !privateHierarchyPath(from) || !privateHierarchyPath(to) {
		return privateError("refused", fmt.Errorf("component reuse requires owned absolute paths: %q -> %q", from, to))
	}
	if err := privateNativeDirectory(from); err != nil {
		return privateError("refused", fmt.Errorf("reusable component tree %q is absent or not owned: %w", from, err))
	}
	info, err := os.Lstat(to)
	switch {
	case errors.Is(err, os.ErrNotExist):
		if err := os.MkdirAll(filepath.Dir(to), 0700); err != nil {
			return fmt.Errorf("reuse parents %q: %w", to, err)
		}
	case err != nil:
		return fmt.Errorf("reuse target %q: %w", to, err)
	case !info.Mode().IsDir():
		return privateError("refused", fmt.Errorf("reuse target %q is not a physical directory", to))
	default:
		entries, readErr := os.ReadDir(to)
		if readErr != nil {
			return fmt.Errorf("reuse target %q: %w", to, readErr)
		}
		if len(entries) != 0 {
			return privateError("refused", fmt.Errorf("reuse target %q is not empty", to))
		}
	}
	return userReuseWalk(from, to)
}

func userReuseWalk(from, to string) error {
	entries, err := os.ReadDir(from)
	if err != nil {
		return fmt.Errorf("reuse read %q: %w", from, err)
	}
	if err := os.Mkdir(to, 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return fmt.Errorf("reuse create %q: %w", to, err)
	}
	for _, entry := range entries {
		source, target := filepath.Join(from, entry.Name()), filepath.Join(to, entry.Name())
		info, err := entry.Info()
		if err != nil {
			return fmt.Errorf("reuse stat %q: %w", source, err)
		}
		switch kind := info.Mode().Type(); {
		case kind.IsDir():
			if err := userReuseWalk(source, target); err != nil {
				return err
			}
		case kind.IsRegular():
			if err := userReuseFile(source, target, info.Mode().Perm()); err != nil {
				return err
			}
		case kind&fs.ModeSymlink != 0:
			link, err := os.Readlink(source)
			if err != nil {
				return fmt.Errorf("reuse link %q: %w", source, err)
			}
			if err := os.Symlink(link, target); err != nil {
				return fmt.Errorf("reuse link %q: %w", target, err)
			}
		default:
			return privateError("refused", fmt.Errorf("reusable tree contains non-regular entry %q: %#x", source, kind))
		}
	}
	return nil
}

func userReuseFile(from, to string, mode fs.FileMode) error {
	data, err := os.ReadFile(from)
	if err != nil {
		return fmt.Errorf("reuse read %q: %w", from, err)
	}
	if err := os.WriteFile(to, data, mode); err != nil {
		return fmt.Errorf("reuse write %q: %w", to, err)
	}
	return os.Chmod(to, mode)
}

// userReuseComponents copies the out-of-scope component trees of the recorded
// installation into the private stage before any provisioning runs. The
// reused SDK prefix/agent (separate mode) carries the installed mcp.json, so
// the deterministic Context7 entry is restaged afterwards to honor a Context7
// choice that changed without re-provisioning the SDK.
func userReuseComponents(ctx context.Context, root string, req UserInstallRequest, existing *userManifest, scope userInstallScope) error {
	if scope.reused[UserComponentNode] {
		if err := userReuseTree(ctx, filepath.Join(req.Destination, "runtime/node"), filepath.Join(root, "runtime/node")); err != nil {
			return fmt.Errorf("Node runtime reuse: %w", err)
		}
	}
	if scope.reused[UserComponentCodeGraph] && req.Experience != nil && req.Experience.CodeGraph == "on" {
		if err := userReuseTree(ctx, filepath.Join(req.Destination, "runtime/codegraph"), filepath.Join(root, "runtime/codegraph")); err != nil {
			return fmt.Errorf("CodeGraph reuse: %w", err)
		}
	}
	if scope.reused[UserComponentSDK] && req.Mode == "separate" {
		if err := userReuseTree(ctx, existing.Prefix, filepath.Join(root, "prefix")); err != nil {
			return fmt.Errorf("SDK prefix reuse: %w", err)
		}
		if err := userReuseTree(ctx, existing.Agent, filepath.Join(root, "agent")); err != nil {
			return fmt.Errorf("SDK agent reuse: %w", err)
		}
		if req.Experience != nil && req.Experience.Context7 != "" {
			if err := userStageJSON(ctx, root, "agent", "mcp.json", userContext7Update(req.Experience.Context7)); err != nil {
				return fmt.Errorf("Context7 restage: %w", err)
			}
		}
	}
	if scope.reused[UserComponentSDK] && req.Mode == "agent" {
		if err := userReuseTree(ctx, existing.Prefix, filepath.Join(root, "prefix")); err != nil {
			return fmt.Errorf("SDK prefix reuse: %w", err)
		}
	}
	return nil
}
