// Tool-less arm-ro policy. Blocks every tool call. Does not register tools.

export const POLICY_ID = "arm-ro-policy";

export function trustedToolPolicy() {
  return { block: true, blockReason: "arm-ro: no tools" };
}

export function beforeToolCall() {
  return { block: true, blockReason: "arm-ro: no tools" };
}
