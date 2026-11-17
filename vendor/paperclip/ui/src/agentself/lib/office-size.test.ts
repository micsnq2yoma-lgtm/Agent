import { expect, it } from "vitest";
import { fitOfficeScale } from "./office-size";

it("fits a small team inside the space below the page header and stats", () => {
  const world = { width: 240, height: 228 };
  const available = { width: 1050, height: 670 };
  const scale = fitOfficeScale(world, available);
  expect(Number.isInteger(scale)).toBe(true);
  expect(world.width * scale).toBeLessThanOrEqual(available.width);
  expect(world.height * scale).toBeLessThanOrEqual(available.height);
  expect(scale).toBeGreaterThanOrEqual(2);
});

it("responds to height as well as width without enlarging beyond four times", () => {
  const world = { width: 240, height: 228 };
  expect(fitOfficeScale(world, { width: 1200, height: 700 })).toBe(3);
  expect(fitOfficeScale(world, { width: 1200, height: 500 })).toBe(2);
  expect(fitOfficeScale(world, { width: 500, height: 1200 })).toBe(2);
  expect(fitOfficeScale(world, { width: 2400, height: 2400 })).toBe(4);
});

it("keeps narrow and large-team offices legible while allowing scrolling", () => {
  expect(fitOfficeScale({ width: 480, height: 228 }, { width: 340, height: 600 })).toBe(2);
  expect(fitOfficeScale({ width: 240, height: 528 }, { width: 1200, height: 600 })).toBe(2);
});
