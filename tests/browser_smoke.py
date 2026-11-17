"""Offline visual smoke using inline generated file: no API/model/Kane claims."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1280,'height':900})
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.set_content((root/'rule-sabotage-v2-offline-demo.html').read_text(),wait_until='domcontentloaded',timeout=15000)
    assert page.locator('.cell').count()==49
    page.locator('#rule-input').fill('이 칸을 밟으면 한 칸 뒤로 돌아간다')
    page.wait_for_timeout(1000)
    assert page.locator('#deploy').is_enabled()
    assert '로컬 해석' in page.locator('#preview-message').inner_text()
    page.locator('#deploy').click()
    page.wait_for_timeout(950)
    assert page.evaluate('window.__RULE_SABOTAGE_V1_SNAPSHOT__().round')==2
    assert 'KANE AUDIT PENDING' in page.locator('.version').inner_text()
    assert not errors,errors
    print('PASS: browser inline 49 cells, offline interpreter, deploy round, explicit no-Kane label, zero page errors')
    browser.close()
