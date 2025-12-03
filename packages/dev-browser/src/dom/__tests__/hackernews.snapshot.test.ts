import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { chromium, Browser, Page } from 'playwright';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getLLMTree } from '../index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturesDir = join(__dirname, 'fixtures');

let browser: Browser;
let page: Page;

beforeAll(async () => {
	browser = await chromium.launch();
	page = await browser.newPage();
});

afterAll(async () => {
	await browser.close();
});

describe('Hacker News snapshot', () => {
	test('produces expected LLM tree output', async () => {
		const fixturePath = join(fixturesDir, 'hackernews.html');
		await page.goto(`file://${fixturePath}`);

		const { tree, selectorMap } = await getLLMTree(page);

		// Verify structure
		expect(selectorMap.size).toBeGreaterThan(100);

		// Use snapshot to verify output format
		expect(tree).toMatchSnapshot();
	});

	test('contains expected interactive elements', async () => {
		const fixturePath = join(fixturesDir, 'hackernews.html');
		await page.goto(`file://${fixturePath}`);

		const { tree } = await getLLMTree(page);

		// Navigation links
		expect(tree).toContain('Hacker News');
		expect(tree).toContain('new');
		expect(tree).toContain('past');
		expect(tree).toContain('comments');
		expect(tree).toContain('ask');
		expect(tree).toContain('show');
		expect(tree).toContain('jobs');
		expect(tree).toContain('submit');
		expect(tree).toContain('login');

		// Story entries should have numbered elements
		expect(tree).toMatch(/\[\d+\]<a/);

		// Should have vote links
		expect(tree).toContain('vote?');

		// Should have user links
		expect(tree).toContain('user?id=');

		// Should have points/comments text
		expect(tree).toMatch(/\d+ points/);
		expect(tree).toMatch(/\d+.*comments/);

		// Should have input for search
		expect(tree).toContain('<input');
	});

	test('preserves text content', async () => {
		const fixturePath = join(fixturesDir, 'hackernews.html');
		await page.goto(`file://${fixturePath}`);

		const { tree } = await getLLMTree(page);

		// Number rankings should appear as text
		expect(tree).toMatch(/^1\.$/m);
		expect(tree).toMatch(/^2\.$/m);

		// "by" attribution text
		expect(tree).toContain('by');

		// Points as standalone text
		expect(tree).toMatch(/\d+ points/);
	});

	test('output is flat structure (no deep nesting)', async () => {
		const fixturePath = join(fixturesDir, 'hackernews.html');
		await page.goto(`file://${fixturePath}`);

		const { tree } = await getLLMTree(page);
		const lines = tree.split('\n').filter((l) => l.trim());

		// Lines should not be deeply indented (flat structure)
		const deeplyIndented = lines.filter((l) => l.startsWith('\t\t\t'));
		expect(deeplyIndented.length).toBe(0);

		// Should NOT contain structural table elements
		expect(tree).not.toContain('<table');
		expect(tree).not.toContain('<tbody');
		expect(tree).not.toContain('<tr');
		expect(tree).not.toContain('<td');

		// Should NOT contain structural span elements (but divs like votearrow are interactive)
		expect(tree).not.toMatch(/<span[^>]*>/);

		// Interactive divs (like votearrow) are OK, but wrapper divs should not appear
		// Count how many div elements appear - should only be the votearrow ones
		const divMatches = tree.match(/<div/g) || [];
		const votearrowMatches = tree.match(/votearrow/g) || [];
		expect(divMatches.length).toBe(votearrowMatches.length);
	});
});
