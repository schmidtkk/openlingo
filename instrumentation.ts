export async function register() {
  // Only the Node.js runtime needs (and supports) the undici proxy agent.
  // The dynamic import is dead-code-eliminated in the Edge bundle because
  // Next.js inlines NEXT_RUNTIME per build target.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { setupProxy } = await import("./instrumentation-node");
    setupProxy();
  }
}
