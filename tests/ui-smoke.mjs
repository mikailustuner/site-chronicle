import { chromium } from 'playwright';

const baseUrl = process.env.SITECHRONICLE_TEST_URL ?? 'http://127.0.0.1:43180';
const password = process.env.SITECHRONICLE_TEST_PASSWORD;
const executablePath = process.env.CHROME_PATH;

if (!password) throw new Error('SITECHRONICLE_TEST_PASSWORD is required');

const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Evidence, not guesses.' }).waitFor();
  await page.getByText('Fixture Store').first().waitFor();
  await page.screenshot({ path: process.env.SITECHRONICLE_SCREENSHOT ?? '/tmp/sitechronicle-dashboard.png', fullPage: true });
  console.log(JSON.stringify({ ok: true, title: await page.title(), url: page.url() }));
} finally {
  await browser.close();
}
