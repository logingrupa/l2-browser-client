import type { Locator, Page } from "@playwright/test";

export function comboboxRowByIdentifier(page: Page, testId: string, identifier: string): Locator {
  return page.getByTestId(`${testId}-list`).locator(".dev-combobox-option")
    .filter({ has: page.locator(".dev-combobox-option-identifier").getByText(identifier, { exact: true }) });
}

export async function pickComboboxRow(page: Page, testId: string, query: string, identifier: string): Promise<void> {
  await page.getByTestId(`${testId}-input`).fill(query);
  await comboboxRowByIdentifier(page, testId, identifier).click();
  await page.getByTestId(`${testId}-pick`).click();
}
