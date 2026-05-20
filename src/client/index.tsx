import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { context, getWebViewMode } from "@devvit/web/client";
import { App } from "./App.tsx";
import { ApiEndpoint, type ClientErrorReport } from "../shared/api.ts";

function reportBootError(report: Partial<ClientErrorReport> & { message: string }): void {
  try {
    fetch(ApiEndpoint.LogClientError, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...report, userAgent: navigator.userAgent }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    reportBootError({
      context: "react-error-boundary",
      message: error.message,
      stack: error.stack,
      source: info.componentStack ?? undefined,
    });
  }
  override render(): ReactNode {
    return this.state.failed
      ? <div className="status">Something went wrong. Error reported.</div>
      : this.props.children;
  }
}

try {
  const container = document.getElementById("root");
  if (!container) throw new Error("#root not found");

  const mode = getWebViewMode();
  const cacheKey = "pp_post_data:" + context.postId;
  let cacheHit = false;
  try { cacheHit = !!localStorage.getItem(cacheKey); } catch {}
  reportBootError({
    context: "boot-info",
    message: `mode=${mode} vis=${document.visibilityState} cache=${cacheHit} postId=${context.postId} mobile=${context.client != null}`,
  });

  // Apply the expanded class before React mounts so there is no first-paint
  // flash where the body clips content with overflow:hidden. Apply to both
  // html and body — both need overflow:visible for touch events to route
  // correctly to #root on Android WebView.
  if (mode === "expanded") {
    document.documentElement.classList.add("pp-expanded");
    document.body.classList.add("pp-expanded");
  }

  createRoot(container).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
} catch (err) {
  reportBootError({
    context: "boot-throw",
    message: String((err as Error)?.message ?? err),
    stack: (err as Error)?.stack,
  });
  throw err;
}
