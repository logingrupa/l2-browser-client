import { expect, type Page } from "@playwright/test";

export const desktopViewport = { width: 1440, height: 900 };
export const landscapePhone = { viewport: { width: 932, height: 430 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 };
export const desktopAndLandscapePhoneDevices = [
  { name: "desktop", use: { viewport: desktopViewport } },
  { name: "mobile", use: landscapePhone },
];
const portraitPhoneViewport = { width: 430, height: 932 };

export async function expectNoHorizontalScrollOnPortraitPhone(page: Page): Promise<void> {
  await page.setViewportSize(portraitPhoneViewport);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(portraitPhoneViewport.width);
}
