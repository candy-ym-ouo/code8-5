import { expect, test } from '@playwright/test';

async function registerAndCreateBook(page: import('@playwright/test').Page, title: string, pageCount: string) {
  const email = `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.goto('/register');
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码', { exact: true }).fill('acceptance-password');
  await page.getByLabel('确认密码').fill('acceptance-password');
  await page.getByRole('button', { name: '创建账号' }).click();
  await expect(page.getByRole('heading', { name: '我的书' })).toBeVisible();
  await page.getByRole('link', { name: '添加第一本书' }).click();
  await page.getByLabel('书名').fill(title);
  await page.getByLabel('总页数').fill(pageCount);
  await page.getByRole('button', { name: '保存书目' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

test('annotation keeps quote anchor and exposes revision history', async ({ page }) => {
  await registerAndCreateBook(page, '锚点批注测试书', '300');

  await page.getByRole('button', { name: '写批注' }).click();
  await page.getByLabel('起始页').fill('150');
  await page.getByLabel('引用摘录（可选，便于日后核对原文）').fill('这是被批注的书页原文。');
  await page.getByLabel('锚点位置说明（可选）').fill('第三章');
  await page.getByLabel('批注').fill('第一次写下的想法。');
  await page.getByRole('button', { name: '保存痕迹' }).click();

  await expect(page.getByText('这是被批注的书页原文。')).toBeVisible();
  await expect(page.getByText('锚点一致')).toBeVisible();
  await expect(page.getByText('锚定于 300 页版本')).toBeVisible();

  await page.getByRole('button', { name: '修订记录' }).click();
  await expect(page.getByText('初版 · 第 150 页')).toBeVisible();
  await expect(page.getByText('第一次写下的想法。')).toBeVisible();

  // 修订批注后，初版保留，新版与初版都可追溯。
  await page.getByRole('button', { name: '收起修订' }).click();
  await page.getByRole('button', { name: '编辑' }).first().click();
  await page.getByLabel('批注').fill('修订后的想法。');
  await page.getByRole('button', { name: '保存痕迹' }).click();
  await expect(page.getByText('修订后的想法。')).toBeVisible();
  await page.getByRole('button', { name: '修订记录' }).click();
  await expect(page.getByText('初版 · 第 150 页')).toBeVisible();
  await expect(page.getByText('第 3 次修订 · 第 150 页')).not.toBeVisible();
  await expect(page.getByText(/第 2 次修订/)).toBeVisible();
});
