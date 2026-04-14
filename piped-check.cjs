const { chromium } = require('playwright');

const targets = [
  'https://piped.kavin.rocks',
  'https://piped.video',
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const base of targets) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const mediaRequests = new Set();

    page.on('request', (req) => {
      const u = req.url();
      if (
        u.includes('googlevideo') ||
        u.includes('/videoplayback') ||
        u.includes('mime=audio') ||
        u.includes('mime=video') ||
        u.includes('/proxy/') ||
        u.includes('/api/v1/streams/')
      ) {
        mediaRequests.add(u);
      }
    });

    const out = {
      base,
      reachable: false,
      status: null,
      pageTitle: '',
      thumbnailsOnHome: 0,
      watchLinksOnHome: 0,
      firstWatchUrl: '',
      watchPageLoaded: false,
      watchTitleFound: false,
      thumbnailsOnWatch: 0,
      mediaElementsOnWatch: 0,
      mediaRequestsDetected: 0,
      error: '',
    };

    try {
      const resp = await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);

      out.reachable = !!resp;
      out.status = resp ? resp.status() : null;
      out.pageTitle = await page.title();

      out.thumbnailsOnHome = await page.locator('img').count();
      out.watchLinksOnHome = await page.locator('a[href*="/watch?v="]').count();

      const firstLink = page.locator('a[href*="/watch?v="]').first();
      if (out.watchLinksOnHome > 0 && (await firstLink.count()) > 0) {
        const href = await firstLink.getAttribute('href');
        if (href) {
          const url = new URL(href, base).toString();
          out.firstWatchUrl = url;
          const wr = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(7000);
          out.watchPageLoaded = !!wr;
          out.watchTitleFound = (await page.locator('h1').count()) > 0;
          out.thumbnailsOnWatch = await page.locator('img').count();
          out.mediaElementsOnWatch = (await page.locator('video, audio').count());
        }
      }

      out.mediaRequestsDetected = mediaRequests.size;

      const fileSafe = base.replace('https://', '').replace(/[^a-zA-Z0-9.-]/g, '_');
      await page.screenshot({ path: `${fileSafe}-check.png`, fullPage: true });
    } catch (e) {
      out.error = String(e.message || e);
    }

    results.push(out);
    await context.close();
  }

  await browser.close();

  console.log(JSON.stringify(results, null, 2));
})();
