// The steps a test script is made of, shared by shot.mjs (one run) and drive.mjs (a
// browser kept open between commands). `say` gets what a step prints.
// step: { goto } | { reload } | { wait: ms } | { key, hold, times, gap } |
//       { point: selector, dx, dy, hold, times, gap } | { until: js, timeout } |
//       { eval: js } | { shot: name } | { screen: name }
// `shot`/`screen` names are joined to `prefix` (`<prefix>-<name>.png`); an absolute
// path ending in .png is used as it is.
export async function runSteps(page, steps, { prefix = '/tmp/luma', say = console.log } = {}) {
  const file = (name) => (name.startsWith('/') && name.endsWith('.png') ? name : `${prefix}-${name}.png`);
  for (const step of steps) {
    if (step.goto) await page.goto(step.goto);
    if (step.reload) await page.reload();
    if (step.wait) await page.waitForTimeout(step.wait);
    if (step.key) {
      for (let i = 0; i < (step.times || 1); i++) {
        await page.keyboard.down(step.key);
        await page.waitForTimeout(step.hold || 60);
        await page.keyboard.up(step.key);
        await page.waitForTimeout(step.gap || 60);
      }
    }
    // presses an on-screen control with the mouse (pointer events), optionally off-centre
    if (step.point) {
      const box = await page.locator(step.point).boundingBox();
      const x = box.x + box.width / 2 + (step.dx || 0) * box.width / 2;
      const y = box.y + box.height / 2 + (step.dy || 0) * box.height / 2;
      for (let i = 0; i < (step.times || 1); i++) {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.waitForTimeout(step.hold || 80);
        await page.mouse.up();
        await page.waitForTimeout(step.gap || 80);
      }
    }
    // waits until a JS expression is true in the page (e.g. a scene is on top)
    if (step.until) await page.waitForFunction(step.until, null, { timeout: step.timeout || 15000 });
    if (step.eval) say(JSON.stringify(await page.evaluate(step.eval)));
    if (step.shot) { await page.screenshot({ path: file(step.shot) }); say(`shot ${file(step.shot)}`); }
    if (step.screen) { await page.locator('#screen').screenshot({ path: file(step.screen) }); say(`shot ${file(step.screen)}`); }
  }
}
