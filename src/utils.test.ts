import { describe, it, expect } from "vitest";
import {
  renderMarkerBlock,
  removeMarkerBlock,
  hasMarkerBlock,
} from "./utils.js";

describe("marker blocks", () => {
  it("inserts a marker block", () => {
    const result = renderMarkerBlock("# Existing", "hook:abc", "content");
    expect(result).toContain("<!-- agent-captain:hook:abc:begin -->");
    expect(result).toContain("content");
    expect(result).toContain("<!-- agent-captain:hook:abc:end -->");
    expect(result).toContain("# Existing");
  });

  it("replaces an existing marker block", () => {
    const initial = renderMarkerBlock("", "hook:abc", "old");
    const result = renderMarkerBlock(initial, "hook:abc", "new");
    expect(result).not.toContain("old");
    expect(result).toContain("new");
    const matches = result.match(/agent-captain:hook:abc:begin/g);
    expect(matches).toHaveLength(1);
  });

  it("removes a marker block", () => {
    const initial = renderMarkerBlock("header", "hook:abc", "content");
    const result = removeMarkerBlock(initial, "hook:abc");
    expect(result).not.toContain("agent-captain:hook:abc");
    expect(result).toContain("header");
  });

  it("detects marker block presence", () => {
    const content = renderMarkerBlock("", "hook:abc", "content");
    expect(hasMarkerBlock(content, "hook:abc")).toBe(true);
    expect(hasMarkerBlock(content, "hook:xyz")).toBe(false);
  });
});
