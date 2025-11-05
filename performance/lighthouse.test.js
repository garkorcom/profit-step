/**
 * TEST CASE #13: Lighthouse Performance Test
 *
 * Проверяет frontend performance метрики
 */

const lighthouse = require('lighthouse');
const chromeLauncher = require('chrome-launcher');
const fs = require('fs');
const path = require('path');

async function runLighthouse(url, name) {
  const chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless', '--disable-gpu'],
  });

  const options = {
    logLevel: 'info',
    output: ['html', 'json'],
    port: chrome.port,
    onlyCategories: ['performance', 'accessibility', 'best-practices'],
  };

  const runnerResult = await lighthouse(url, options);

  // Generate report
  const reportHtml = runnerResult.report[0];
  const reportJson = runnerResult.report[1];

  // Save reports
  const reportsDir = path.join(__dirname, '..', 'reports', 'lighthouse');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/:/g, '-');
  fs.writeFileSync(
    path.join(reportsDir, `${name}-${timestamp}.html`),
    reportHtml
  );
  fs.writeFileSync(
    path.join(reportsDir, `${name}-${timestamp}.json`),
    reportJson
  );

  await chrome.kill();

  return runnerResult.lhr;
}

async function main() {
  console.log('🚀 Running Lighthouse Performance Tests...\n');

  const tests = [
    {
      url: 'https://profit-step-staging.web.app',
      name: 'homepage',
    },
    {
      url: 'https://profit-step-staging.web.app/admin/dashboard',
      name: 'company-admin-dashboard',
    },
    {
      url: 'https://profit-step-staging.web.app/superadmin/dashboard',
      name: 'super-admin-dashboard',
    },
  ];

  const results = [];

  for (const test of tests) {
    console.log(`📊 Testing: ${test.url}`);
    const report = await runLighthouse(test.url, test.name);

    const performance = report.categories.performance.score * 100;
    const accessibility = report.categories.accessibility.score * 100;
    const bestPractices = report.categories['best-practices'].score * 100;

    const fcp = report.audits['first-contentful-paint'].numericValue;
    const lcp = report.audits['largest-contentful-paint'].numericValue;
    const tbt = report.audits['total-blocking-time'].numericValue;
    const cls = report.audits['cumulative-layout-shift'].numericValue;

    results.push({
      name: test.name,
      url: test.url,
      scores: {
        performance,
        accessibility,
        bestPractices,
      },
      metrics: {
        fcp,
        lcp,
        tbt,
        cls,
      },
    });

    console.log(`  ✅ Performance: ${performance}%`);
    console.log(`  ✅ Accessibility: ${accessibility}%`);
    console.log(`  ✅ Best Practices: ${bestPractices}%`);
    console.log(`  📈 FCP: ${fcp}ms`);
    console.log(`  📈 LCP: ${lcp}ms`);
    console.log(`  📈 TBT: ${tbt}ms`);
    console.log(`  📈 CLS: ${cls}\n`);
  }

  // Check thresholds
  console.log('🎯 Checking Performance Thresholds...\n');
  let allPassed = true;

  for (const result of results) {
    const failures = [];

    if (result.scores.performance < 90) {
      failures.push(`Performance score ${result.scores.performance}% < 90%`);
    }
    if (result.metrics.fcp > 1500) {
      failures.push(`FCP ${result.metrics.fcp}ms > 1500ms`);
    }
    if (result.metrics.lcp > 2500) {
      failures.push(`LCP ${result.metrics.lcp}ms > 2500ms`);
    }
    if (result.metrics.tbt > 200) {
      failures.push(`TBT ${result.metrics.tbt}ms > 200ms`);
    }

    if (failures.length > 0) {
      console.log(`❌ ${result.name} FAILED:`);
      failures.forEach((f) => console.log(`   - ${f}`));
      allPassed = false;
    } else {
      console.log(`✅ ${result.name} PASSED`);
    }
  }

  console.log('\n📄 Reports saved to: reports/lighthouse/\n');

  if (!allPassed) {
    console.error('❌ Some performance thresholds were not met');
    process.exit(1);
  } else {
    console.log('✅ All performance thresholds met!');
    process.exit(0);
  }
}

main().catch((error) => {
  console.error('❌ Lighthouse test failed:', error);
  process.exit(1);
});
