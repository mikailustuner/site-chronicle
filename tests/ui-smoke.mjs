import { chromium } from 'playwright';

const baseUrl = process.env.SITECHRONICLE_TEST_URL ?? 'http://127.0.0.1:43180';
const password = process.env.SITECHRONICLE_TEST_PASSWORD ?? process.env.ADMIN_PASSWORD;
const executablePath = process.env.CHROME_PATH;
const expectedText = process.env.SITECHRONICLE_TEST_EXPECTED_TEXT;

if (!password) throw new Error('SITECHRONICLE_TEST_PASSWORD is required');

const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ignoreHTTPSErrors: process.env.SITECHRONICLE_TEST_IGNORE_HTTPS_ERRORS === 'true' });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('heading', { name: 'Every site. One clear view.' }).waitFor();
  for (const [navigation, heading] of [
    ['Search visibility', 'Search visibility, with its context intact.'],
    ['Keywords', 'Discover, approve, then spend deliberately.'],
    ['Competitors', 'Compare what was actually observed.'],
    ['Opportunities', 'Work on what matters next.'],
    ['Technical health', 'Technical health across the portfolio.'],
    ['Public performance', 'Field, lab and uptime—never mixed.'],
    ['Changes & experiments', 'Changes and experiments.'],
    ['360° improvement', 'Improve the whole site as a system.'],
    ['Ad strategy studio', 'Build ads around evidence, not account folklore.'],
    ['Solution desk', 'Turn any problem into an evidence loop.'],
    ['AI analyst', 'Ask the evidence.'],
    ['Automations', 'Daily, quiet, outbound-only.'],
    ['Evidence archive', 'Evidence archive.'],
    ['Evidence rules', 'Know what the scanner knows.'],
    ['Settings', 'Private by construction.'],
  ]) {
    await page.getByRole('button', { name: navigation, exact: true }).click();
    await page.getByRole('heading', { name: heading }).waitFor();
  }
  await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
  await page.getByRole('heading', { name: 'Every site. One clear view.' }).waitFor();
  if (expectedText) await page.getByText(expectedText).first().waitFor();
  await page.screenshot({ path: process.env.SITECHRONICLE_SCREENSHOT ?? '/tmp/sitechronicle-dashboard.png', fullPage: true });
  console.log(JSON.stringify({ ok: true, title: await page.title(), url: page.url() }));
} finally {
  await browser.close();
}
