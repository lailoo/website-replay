import assert from 'node:assert/strict';

// Adapt the observed accessible names and assertions to the target site.
// This is trusted local code executed on both the source and offline page.
export default async function scenario(page){
  const counter=page.locator('output');
  const before=Number(await counter.innerText());
  await page.getByRole('button',{name:'Increment',exact:true}).click();
  assert.equal(Number(await counter.innerText()),before+1);
}
