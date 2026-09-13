/**
 * Bundled into every generated app as the virtual module "sayship/runtime": renders the
 * generated App inside an error boundary and reports failures to the workspace.
 */
import { Component, type ComponentType, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

type BoundaryState = { error: Error | null };

class ErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    window.__sayship?.reportError(error, { componentStack: info.componentStack ?? undefined });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        style={{
          margin: 24,
          padding: "16px 20px",
          border: "1px solid #fecaca",
          borderRadius: 8,
          background: "#fef2f2",
          color: "#991b1b",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h1 style={{ fontSize: 16, margin: "0 0 8px" }}>Something went wrong</h1>
        <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontSize: 12 }}>{this.state.error.message}</pre>
      </div>
    );
  }
}

export function mount(App: ComponentType | undefined) {
  const container = document.getElementById("root");
  if (!container) return;

  if (typeof App !== "function" && (typeof App !== "object" || App === null)) {
    window.__sayship?.reportError(new Error("App.jsx must default-export a React component."));
    return;
  }

  const root = createRoot(container, {
    onUncaughtError: (error, info) =>
      window.__sayship?.reportError(error, { componentStack: info.componentStack ?? undefined }),
  });
  root.render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
  // "ready" = first render finished without errors; lets the workspace reset its auto-fix counter.
  window.setTimeout(() => window.__sayship?.ready(), 500);
}
