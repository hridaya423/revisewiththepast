
import { registerHooks } from "node:module";

const STUBBED_SPECIFIERS = new Set(["server-only", "client-only"]);
const STUB_URL = new URL("empty.cjs", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBBED_SPECIFIERS.has(specifier)) {
      return { url: STUB_URL, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
