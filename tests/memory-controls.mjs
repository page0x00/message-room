export async function memoryControl(page,selector){
 if(await page.locator('#memoryTools').isHidden())await page.locator('#memoryToolsToggle').click();
 if(selector!=='#memoryToolsToggle')await page.locator(selector).click();
}
