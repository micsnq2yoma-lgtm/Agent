import { describe, expect, it } from "vitest";
import { __test, translateText } from "./dom-translate";

describe("Agentself zh-CN DOM translation", () => {
  it("translates dictionary entries and keeps surrounding whitespace", () => {
    __test.DICT.set("Settings", "设置");
    expect(translateText("Settings")).toBe("设置");
    expect(translateText("  Settings ")).toBe("  设置 ");
  });
  it("handles dynamic patterns", () => {
    expect(translateText("5m ago")).toBe("5 分钟前");
    expect(translateText("3 issues")).toBe("3 个任务");
    expect(translateText("1 agent")).toBe("1 个智能体");
    expect(translateText("Page 2 of 7")).toBe("第 2 / 7 页");
    expect(translateText("just now")).toBe("刚刚");
  });
  it("translates a known label followed by a colon", () => {
    __test.DICT.set("Status", "状态");
    expect(translateText("Status:")).toBe("状态：");
  });
  it("leaves unknown text, numbers and Chinese alone", () => {
    expect(translateText("My custom issue title")).toBe("My custom issue title");
    expect(translateText("42")).toBe("42");
    expect(translateText("已经是中文")).toBe("已经是中文");
  });
});
